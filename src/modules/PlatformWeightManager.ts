import { getPref, setPref } from "../utils/prefs";

export type PlatformOutcome =
  | "success"
  | "notFound"
  | "captcha"
  | "blocked"
  | "rateLimited"
  | "networkError"
  | "parseError"
  | "importError"
  | "error";

export interface PlatformCandidate<T> {
  id: string;
  label?: string;
  value: T;
}

interface PlatformStats {
  score: number;
  attempts: number;
  successes: number;
  notFounds: number;
  errors: number;
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  consecutiveErrors: number;
}

type PlatformStatsStore = Record<string, PlatformStats>;

interface RankedPlatformCandidate<T> extends PlatformCandidate<T> {
  rank: number;
  stats: PlatformStats;
}

export class PlatformWeightManager {
  private static readonly defaultScore = 1;

  private static readonly defaultSemanticScholarScore = 1.25;

  private static readonly minScore = 0.2;

  private static readonly maxScore = 5;

  private static readonly staleBonusWindowMs = 7 * 24 * 60 * 60 * 1000;

  static sort<T>(
    candidates: PlatformCandidate<T>[],
  ): RankedPlatformCandidate<T>[] {
    const store = this.load();
    const now = Date.now();
    return candidates
      .map((candidate, index) => {
        const stats = this.normalizedStats(candidate.id, store[candidate.id]);
        return {
          ...candidate,
          rank:
            stats.score +
            this.coldStartBonus(stats) +
            this.staleBonus(stats, now) +
            this.deterministicJitter(candidate.id) -
            index * 0.0001,
          stats,
        };
      })
      .sort((a, b) => b.rank - a.rank);
  }

  static record(id: string, outcome: PlatformOutcome) {
    const store = this.load();
    const current = this.normalizedStats(id, store[id]);
    const now = Date.now();
    const next: PlatformStats = {
      ...current,
      attempts: current.attempts + 1,
      lastAttemptAt: now,
    };

    switch (outcome) {
      case "success":
        next.successes += 1;
        next.lastSuccessAt = now;
        next.consecutiveErrors = 0;
        next.score = this.clampScore(current.score + 0.65);
        break;

      case "notFound":
        next.notFounds += 1;
        next.consecutiveErrors = 0;
        next.score = this.clampScore(current.score - 0.08);
        break;

      case "captcha":
      case "blocked":
      case "rateLimited":
        next.errors += 1;
        next.consecutiveErrors += 1;
        next.score = this.clampScore(current.score - 0.35);
        break;

      case "networkError":
        next.errors += 1;
        next.consecutiveErrors += 1;
        next.score = this.clampScore(current.score - 0.25);
        break;

      case "parseError":
      case "error":
        next.errors += 1;
        next.consecutiveErrors += 1;
        next.score = this.clampScore(current.score - 0.18);
        break;

      case "importError":
        next.errors += 1;
        next.consecutiveErrors += 1;
        next.score = this.clampScore(current.score - 0.05);
        break;
    }

    store[id] = next;
    this.save(store);
  }

  static describe(id: string) {
    const stats = this.normalizedStats(id, this.load()[id]);
    return `${id}(score=${stats.score.toFixed(2)}, attempts=${
      stats.attempts
    }, ok=${stats.successes}, nf=${stats.notFounds}, err=${stats.errors})`;
  }

  private static load(): PlatformStatsStore {
    const raw = getPref("platformStats");
    if (typeof raw !== "string" || raw.trim().length === 0) {
      return {};
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
      }
      return parsed as PlatformStatsStore;
    } catch (error) {
      ztoolkit.log(
        `sci-pdf: failed to parse platformStats preference: ${String(error)}`,
      );
      return {};
    }
  }

  private static save(store: PlatformStatsStore) {
    const entries = Object.entries(store)
      .sort(([, a], [, b]) => {
        const lastA = a.lastAttemptAt ?? 0;
        const lastB = b.lastAttemptAt ?? 0;
        return lastB - lastA;
      })
      .slice(0, 50);

    setPref("platformStats", JSON.stringify(Object.fromEntries(entries)));
  }

  private static normalizedStats(
    id: string,
    stats?: Partial<PlatformStats>,
  ): PlatformStats {
    return {
      score: this.clampScore(
        typeof stats?.score === "number"
          ? stats.score
          : this.initialScoreFor(id),
      ),
      attempts: this.nonNegativeInteger(stats?.attempts),
      successes: this.nonNegativeInteger(stats?.successes),
      notFounds: this.nonNegativeInteger(stats?.notFounds),
      errors: this.nonNegativeInteger(stats?.errors),
      lastAttemptAt:
        typeof stats?.lastAttemptAt === "number"
          ? stats.lastAttemptAt
          : undefined,
      lastSuccessAt:
        typeof stats?.lastSuccessAt === "number"
          ? stats.lastSuccessAt
          : undefined,
      consecutiveErrors: this.nonNegativeInteger(stats?.consecutiveErrors),
    };
  }

  private static initialScoreFor(id: string) {
    return id === "semanticscholar.org"
      ? this.defaultSemanticScholarScore
      : this.defaultScore;
  }

  private static nonNegativeInteger(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) && value > 0
      ? Math.floor(value)
      : 0;
  }

  private static clampScore(score: number) {
    return Math.min(this.maxScore, Math.max(this.minScore, score));
  }

  private static coldStartBonus(stats: PlatformStats) {
    if (stats.attempts === 0) {
      return 0.35;
    }
    return Math.min(0.2, 0.12 / Math.sqrt(stats.attempts));
  }

  private static staleBonus(stats: PlatformStats, now: number) {
    if (!stats.lastAttemptAt) {
      return 0;
    }
    const staleRatio = Math.max(
      0,
      Math.min(1, (now - stats.lastAttemptAt) / this.staleBonusWindowMs),
    );
    return staleRatio * 0.9;
  }

  private static deterministicJitter(id: string) {
    let hash = 0;
    for (let index = 0; index < id.length; index += 1) {
      hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
    }
    return (hash % 1000) / 1000 / 20;
  }
}
