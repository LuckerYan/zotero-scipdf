import { getString } from "../utils/locale";
import { getPref } from "../utils/prefs";
import { Utils } from "../utils/utils";
import { CustomResolverManager } from "./CustomResolverManager";
import { DDoSGuardSolver } from "./DDoSGuardSolver";
import {
  PlatformWeightManager,
  type PlatformCandidate,
  type PlatformOutcome,
} from "./PlatformWeightManager";

class PDFNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfNotFoundError";
    Object.setPrototypeOf(this, PDFNotFoundError.prototype);
  }
}

interface SciHubWorldPaperResponse {
  success?: boolean;
  doi?: string;
  url?: string;
  cached?: boolean;
  source?: string;
  detail?: string;
  message?: string;
  error?: string;
}

interface SciHubPlatform {
  id: string;
  baseURL: string;
}

interface OpenAlexLocation {
  is_oa?: boolean;
  pdf_url?: string | null;
  landing_page_url?: string | null;
}

interface OpenAlexWorkResponse {
  id?: string;
  doi?: string | null;
  title?: string;
  display_name?: string;
  open_access?: {
    is_oa?: boolean;
    oa_status?: string;
    oa_url?: string | null;
    any_repository_has_fulltext?: boolean;
  };
  primary_location?: OpenAlexLocation | null;
  best_oa_location?: OpenAlexLocation | null;
  locations?: OpenAlexLocation[];
}

interface UnpaywallLocation {
  host_type?: string | null;
  is_best?: boolean;
  url?: string | null;
  url_for_landing_page?: string | null;
  url_for_pdf?: string | null;
  version?: string | null;
}

interface UnpaywallResponse {
  best_oa_location?: UnpaywallLocation | null;
  doi?: string | null;
  doi_url?: string | null;
  first_oa_location?: UnpaywallLocation | null;
  is_oa?: boolean;
  oa_locations?: UnpaywallLocation[];
  oa_status?: string | null;
  title?: string | null;
}

type FetchPlatform =
  | {
      id: string;
      label: string;
      type: "semantic-scholar";
    }
  | {
      id: string;
      label: string;
      type: "google-scholar";
    }
  | {
      id: string;
      label: string;
      type: "unpaywall";
    }
  | {
      id: string;
      label: string;
      type: "openalex";
    }
  | {
      baseURL: string;
      id: string;
      label: string;
      type: "sci-hub";
    };

interface AltchaChallenge {
  algorithm: string;
  challenge: string;
  maxNumber: number;
  salt: string;
  signature: string;
}

interface AltchaSolution {
  algorithm: string;
  challenge: string;
  number: number;
  salt: string;
  signature: string;
  took: number;
}

interface AltchaSolutionResponse {
  success?: boolean;
}

interface KvnpTopStatusResponse {
  status?: "processing" | "completed" | "error" | string;
  message?: string;
  data?: {
    doi?: string | null;
    pdf_url?: string | null;
    title?: string | null;
  } | null;
  reason?: string | null;
  official_pdf?: string | null;
}

interface SemanticScholarGraphPaper {
  paperId?: string;
  externalIds?: Record<string, string | number | undefined>;
  title?: string;
  url?: string;
  isOpenAccess?: boolean;
  openAccessPdf?: {
    url?: string;
    status?: string | null;
    license?: string | null;
  };
}

interface SemanticScholarPaperLink {
  url?: string;
  linkType?: string;
}

interface SemanticScholarSearchPaper {
  id?: string;
  doiInfo?: {
    doi?: string;
  };
  title?: {
    text?: string;
  };
  isPdfVisible?: boolean;
  primaryPaperLink?: SemanticScholarPaperLink;
  alternatePaperLinks?: SemanticScholarPaperLink[];
  openAccessInfo?: {
    status?: string | null;
    license?: string | null;
    location?: {
      url?: string;
      isPdf?: boolean;
    };
  };
}

interface SemanticScholarSearchResponse {
  results?: SemanticScholarSearchPaper[];
}

interface SemanticScholarPDFData {
  pdfUrl?: string;
  pdfUrlSelfHosted?: string;
}

interface SemanticScholarPDFVisible {
  pdfUrl?: {
    url?: string;
  };
  pdfUrlSelfHosted?: {
    url?: string;
  };
}

interface SemanticScholarPDFCandidate {
  url: URL;
  source: string;
}

interface FetchQueueEntry {
  item: Zotero.Item;
  keys: string[];
}

export class SciHubFetcher {
  private static readonly pdfNotAvailableRegexes = [
    /Please try to search again using DOI/im,
    /статья не найдена в базе/im,
    /未找到与您的请求匹配的文章/im,
    /未找到.*(?:文章|论文|文献|PDF)/im,
    /(?:该|这|此)?(?:文章|论文|文献).*?Sci-?Hub.*?不可用/im,
    /(?:文章|论文|文献|PDF).*?(?:不可用|找不到|没有找到)/im,
    /(?:不可用|找不到|没有找到).*?(?:文章|论文|文献|PDF)/im,
    /(?:article|paper|document|PDF)\s+(?:not\s+found|not\s+available|unavailable)/im,
    /(?:not\s+found|not\s+available|unavailable).*?(?:article|paper|document|PDF)/im,
    /could\s+not\s+find/im,
    /no\s+(?:article|paper|document|PDF)\s+(?:found|available)/im,
  ];

  private static readonly mobileUserAgent =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 11_3_1 like Mac OS X) AppleWebKit/603.1.30 (KHTML, like Gecko) Version/10.0 Mobile/14E304 Safari/602.1";

  private static readonly semanticScholarUserAgent =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

  private static semanticScholarUIVersionCache: string | undefined;

  private static readonly activeFetchKeys = new Set<string>();

  private static readonly workerResultDisplayMs = 1500;

  private static readonly sha256InitialHash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ];

  private static readonly sha256K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  static async updateItems(
    items: Zotero.Item[],
    skipIfExistPDF: boolean = true,
  ) {
    const filtered: Zotero.Item[] = [];
    const filteredItemIDs = new Set<number>();
    const appendFiltered = (item: Zotero.Item) => {
      if (filteredItemIDs.has(item.id)) {
        return;
      }
      filteredItemIDs.add(item.id);
      filtered.push(item);
    };

    for (const item of items) {
      if (!item.isRegularItem()) {
        continue;
      }
      if (!skipIfExistPDF) {
        appendFiltered(item);
        continue;
      }
      const attachment = await item.getBestAttachment();
      if (!attachment || !attachment.isPDFAttachment()) {
        appendFiltered(item);
      }
    }

    if (filtered.length <= 0) {
      return;
    }

    const queuedKeys = new Set<string>();
    const queue: FetchQueueEntry[] = [];
    for (const item of filtered) {
      const keys = await this.itemFetchIdentityKeys(item);
      const duplicateInCurrentBatch = keys.some((key) => queuedKeys.has(key));
      if (duplicateInCurrentBatch) {
        ztoolkit.log(
          `sci-pdf: skipped duplicate selected item "${item.getDisplayTitle()}"`,
        );
        continue;
      }
      for (const key of keys) {
        queuedKeys.add(key);
      }
      queue.push({ item, keys });
    }

    if (queue.length <= 0) {
      return;
    }

    await this.runWithConcurrency(
      queue,
      this.fetchConcurrency(),
      async (entry, _index, workerIndex) => {
        const { item, keys } = entry;
        if (!this.claimActiveFetch(keys)) {
          ztoolkit.log(
            `sci-pdf: skipped already-running fetch for "${item.getDisplayTitle()}"`,
          );
          return;
        }
        try {
          await this.updateItem(item, workerIndex);
        } catch (error) {
          const message = this.formatFetchFailure(error);
          ztoolkit.log(
            `sci-pdf: unexpected batch fetch failure for "${item.getDisplayTitle()}":\n${message}`,
          );
          Utils.showPopWin(
            getString("popwin-unknownerror"),
            message,
            "fail",
            this.workerResultDisplayMs,
            message,
            { slotIndex: workerIndex },
          );
          return true;
        } finally {
          this.releaseActiveFetch(keys);
        }
        return true;
      },
    );
  }

  private static async updateItem(item: Zotero.Item, workerIndex?: number) {
    const dois = await Utils.extractDOIs(item);
    const title = this.itemTitle(item);
    if (dois.length <= 0 && !title) {
      Utils.showPopWin(
        getString("popwin-doimissing"),
        item.getDisplayTitle(),
        "warning",
        this.workerResultDisplayMs,
        undefined,
        { slotIndex: workerIndex },
      );
      ztoolkit.log(`DOI/Title Not Found for "${item.getField("title")}"`);
      return;
    }

    let success = false;
    const notFoundErrors: PDFNotFoundError[] = [];
    const errors: unknown[] = [];
    const platforms = PlatformWeightManager.sort(
      this.buildFetchPlatforms(dois, title),
    );
    const attemptsForPlatform = (platform: FetchPlatform) =>
      platform.type === "semantic-scholar" ? 1 : Math.max(dois.length, 1);
    const totalAttempts = Math.max(
      platforms.reduce(
        (count, candidate) => count + attemptsForPlatform(candidate.value),
        0,
      ),
      1,
    );
    let completedAttempts = 0;
    const progressPercent = (completed = completedAttempts) =>
      Math.min(
        96,
        Math.max(6, Math.round(6 + (completed / totalAttempts) * 88)),
      );
    const platformLabel = (platform: FetchPlatform) =>
      platform.label || platform.id;
    const itemDisplayTitle = item.getDisplayTitle();
    const progressWin = Utils.showProgressPopWin(
      getString("popwin-fetching"),
      "准备检索文献 PDF 来源",
      {
        progress: progressPercent(0),
        itemTitle: itemDisplayTitle,
        slotIndex: workerIndex,
      },
    );
    const markAttemptStart = (platform: FetchPlatform, doi?: string) => {
      const label = platformLabel(platform);
      const doiHint = doi ? ` · DOI ${this.shortDOI(doi)}` : "";
      progressWin.update(
        `正在检索 ${label}${doiHint}`,
        progressPercent(completedAttempts),
      );
    };
    const markAttemptDone = (
      platform: FetchPlatform,
      result: "miss" | "success",
    ) => {
      completedAttempts = Math.min(completedAttempts + 1, totalAttempts);
      const label = platformLabel(platform);
      progressWin.update(
        result === "success"
          ? `${label} 已找到并保存 PDF`
          : `${label} 未命中，继续尝试下一个来源`,
        result === "success" ? 100 : progressPercent(completedAttempts),
        {
          type: result === "success" ? "success" : "default",
        },
      );
    };

    ztoolkit.log(
      `sci-pdf platform order: ${platforms
        .map(
          (platform) =>
            `${platform.label ?? platform.id}(score=${platform.stats.score.toFixed(
              2,
            )}, rank=${platform.rank.toFixed(2)})`,
        )
        .join(" -> ")}`,
    );

    for (const candidate of platforms) {
      const platform = candidate.value;
      const platformErrors: unknown[] = [];

      if (platform.type === "semantic-scholar") {
        markAttemptStart(platform);
        try {
          await this.fetchSemanticScholarPDF(undefined, item);
          markAttemptDone(platform, "success");
          success = true;
        } catch (error) {
          platformErrors.push(error);
          markAttemptDone(platform, "miss");
        }
      } else if (platform.type === "google-scholar") {
        for (const doi of dois) {
          markAttemptStart(platform, doi);
          try {
            await this.fetchGoogleScholarPDF(doi, item);
            markAttemptDone(platform, "success");
            success = true;
            break;
          } catch (error) {
            platformErrors.push(error);
            markAttemptDone(platform, "miss");
          }
        }
      } else if (platform.type === "unpaywall") {
        for (const doi of dois) {
          markAttemptStart(platform, doi);
          try {
            await this.fetchUnpaywallPDF(doi, item);
            markAttemptDone(platform, "success");
            success = true;
            break;
          } catch (error) {
            platformErrors.push(error);
            markAttemptDone(platform, "miss");
          }
        }
      } else if (platform.type === "openalex") {
        for (const doi of dois) {
          markAttemptStart(platform, doi);
          try {
            await this.fetchOpenAlexPDF(doi, item);
            markAttemptDone(platform, "success");
            success = true;
            break;
          } catch (error) {
            platformErrors.push(error);
            markAttemptDone(platform, "miss");
          }
        }
      } else {
        for (const doi of dois) {
          markAttemptStart(platform, doi);
          let scihubUrl: URL;
          try {
            scihubUrl = new URL(doi, platform.baseURL);
          } catch (error) {
            platformErrors.push(
              new Error(
                `Invalid Sci-Hub platform URL ${platform.baseURL}: ${this.formatError(
                  error,
                )}`,
              ),
            );
            markAttemptDone(platform, "miss");
            continue;
          }

          try {
            await this.fetchPDF(scihubUrl, item);
            markAttemptDone(platform, "success");
            success = true;
            break;
          } catch (error) {
            platformErrors.push(error);
            markAttemptDone(platform, "miss");
          }
        }
      }

      if (success) {
        PlatformWeightManager.record(platform.id, "success");
        break;
      }

      if (platformErrors.length > 0) {
        const primaryError =
          platformErrors.find((error) => !this.asPDFNotFoundError(error)) ??
          platformErrors[0];
        PlatformWeightManager.record(
          platform.id,
          this.classifyPlatformFailure(primaryError),
        );
        for (const error of platformErrors) {
          const notFoundError = this.asPDFNotFoundError(error);
          if (notFoundError) {
            notFoundErrors.push(notFoundError);
          } else {
            errors.push(error);
          }
        }
      }
    }

    progressWin.close();

    const onlyNonDecisiveErrors =
      errors.length > 0 &&
      errors.every((error) => this.isNonDecisivePlatformFailure(error));

    if (success) {
      Utils.showPopWin(
        getString("popwin-fetchsuccess"),
        itemDisplayTitle,
        "success",
        this.workerResultDisplayMs,
        undefined,
        { slotIndex: workerIndex },
      );
    } else if (
      notFoundErrors.length > 0 &&
      (errors.length <= 0 || onlyNonDecisiveErrors)
    ) {
      ztoolkit.log(
        `sci-pdf: PDF not found for "${itemDisplayTitle}": ${notFoundErrors
          .map((error) => error.message)
          .join("\n")}`,
      );
      if (onlyNonDecisiveErrors) {
        ztoolkit.log(
          `sci-pdf: suppressing non-decisive platform failure(s) after PDF-not-found decision for "${itemDisplayTitle}":\n${errors
            .map((error) => this.formatFetchFailure(error))
            .join("\n\n")}`,
        );
      }
      Utils.showPopWin(
        getString("popwin-pdfnotavaliable"),
        itemDisplayTitle,
        "warning",
        this.workerResultDisplayMs,
        undefined,
        { slotIndex: workerIndex },
      );
    } else {
      const failures = [...errors, ...notFoundErrors];
      const message = failures.length
        ? failures.map((error) => this.formatFetchFailure(error)).join("\n\n")
        : `No PDF resolver succeeded for "${itemDisplayTitle}"`;
      ztoolkit.log(
        `sci-pdf: failed to fetch PDF for "${itemDisplayTitle}":\n${message}`,
      );
      Utils.showPopWin(
        getString("popwin-unknownerror"),
        message,
        "fail",
        this.workerResultDisplayMs,
        message,
        { slotIndex: workerIndex },
      );
    }
  }

  private static fetchConcurrency() {
    const parsed = Number(getPref("fetchConcurrency"));
    if (!Number.isFinite(parsed)) {
      return 3;
    }
    return Math.min(5, Math.max(1, Math.round(parsed)));
  }

  private static async itemFetchIdentityKeys(item: Zotero.Item) {
    const keys = [`item:${item.id}`];
    const doiKeys = (await Utils.extractDOIs(item))
      .map((doi) => this.normalizeDOIIdentity(doi))
      .filter(Boolean)
      .map((doi) => `doi:${doi}`);

    if (doiKeys.length > 0) {
      keys.push(...doiKeys);
    } else {
      const titleKey = this.normalizeTitleIdentity(this.itemTitle(item));
      if (titleKey) {
        keys.push(`title:${titleKey}`);
      }
    }

    return Array.from(new Set(keys));
  }

  private static normalizeDOIIdentity(doi: string) {
    return doi
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "");
  }

  private static normalizeTitleIdentity(title: string) {
    return title.trim().replace(/\s+/g, " ").toLowerCase();
  }

  private static claimActiveFetch(keys: string[]) {
    if (keys.some((key) => this.activeFetchKeys.has(key))) {
      return false;
    }
    for (const key of keys) {
      this.activeFetchKeys.add(key);
    }
    return true;
  }

  private static releaseActiveFetch(keys: string[]) {
    for (const key of keys) {
      this.activeFetchKeys.delete(key);
    }
  }

  private static async runWithConcurrency<T>(
    items: T[],
    concurrency: number,
    worker: (
      item: T,
      index: number,
      workerIndex: number,
    ) => Promise<boolean | void>,
  ) {
    const workerCount = Math.min(Math.max(1, concurrency), items.length);
    let nextIndex = 0;
    const claimedIndices = new Set<number>();
    const claimNextIndex = () => {
      while (nextIndex < items.length && claimedIndices.has(nextIndex)) {
        nextIndex += 1;
      }
      if (nextIndex >= items.length) {
        return undefined;
      }
      const itemIndex = nextIndex;
      claimedIndices.add(itemIndex);
      nextIndex += 1;
      return itemIndex;
    };

    const runWorker = async (workerIndex: number) => {
      while (true) {
        const itemIndex = claimNextIndex();
        if (itemIndex === undefined) {
          return;
        }
        const shouldHoldResult = await worker(
          items[itemIndex],
          itemIndex,
          workerIndex,
        );
        if (shouldHoldResult) {
          await this.sleep(this.workerResultDisplayMs);
        }
      }
    };
    await Promise.all(
      Array.from(
        { length: workerCount },
        async (_unused, workerIndex) => await runWorker(workerIndex),
      ),
    );
  }

  private static async buildSciHubURLs(item: Zotero.Item): Promise<URL[]> {
    return this.buildSciHubURLsForDOIs(await Utils.extractDOIs(item));
  }

  private static buildSciHubURLsForDOIs(dois: string[]): URL[] {
    const sciHubPlatforms = PlatformWeightManager.sort(
      this.sciHubPlatforms.map((platform) => ({
        id: platform.id,
        label: platform.id,
        value: platform,
      })),
    ).map((candidate) => candidate.value);
    const urls: URL[] = [];
    for (const doi of dois) {
      for (const platform of sciHubPlatforms) {
        try {
          urls.push(new URL(doi, platform.baseURL));
        } catch {
          // skip invalid URLs
        }
      }
    }
    return urls;
  }

  private static get baseSciHubURLs(): string[] {
    const resolvers = CustomResolverManager.shared.customResolvers;
    const urls =
      resolvers.length > 0
        ? resolvers.map((r) => {
            // resolver.url is like "https://sci-hub.kvnp.top/{doi}", extract the base.
            return r.url.replace(/\{doi\}.*$/, "");
          })
        : [
            "https://sci-hub.kvnp.top/",
            "https://www.tesble.com/",
            "https://sci-hub.ru/",
            "https://sci-hub.su/",
            "https://sci-hub.red/",
            "https://sci-hub.box/",
            "https://sci-hub.st/",
            "https://sci-hub.ren/",
            "https://sci-hub.world/",
          ];
    return Array.from(new Set(urls));
  }

  private static get sciHubPlatforms(): SciHubPlatform[] {
    return this.baseSciHubURLs.map((baseURL) => ({
      baseURL,
      id: this.sciHubPlatformID(baseURL),
    }));
  }

  private static sciHubPlatformID(baseURL: string) {
    try {
      return new URL(baseURL).hostname;
    } catch {
      return baseURL;
    }
  }

  private static buildFetchPlatforms(
    dois: string[],
    title: string,
  ): PlatformCandidate<FetchPlatform>[] {
    const platforms: PlatformCandidate<FetchPlatform>[] = [];
    if (title) {
      platforms.push({
        id: "semanticscholar.org",
        label: "Semantic Scholar",
        value: {
          id: "semanticscholar.org",
          label: "Semantic Scholar",
          type: "semantic-scholar",
        },
      });
    }

    if (dois.length > 0) {
      platforms.push({
        id: "scholar.google.com",
        label: "Google Scholar",
        value: {
          id: "scholar.google.com",
          label: "Google Scholar",
          type: "google-scholar",
        },
      });

      platforms.push({
        id: "unpaywall.org",
        label: "Unpaywall",
        value: {
          id: "unpaywall.org",
          label: "Unpaywall",
          type: "unpaywall",
        },
      });

      platforms.push({
        id: "openalex.org",
        label: "OpenAlex",
        value: {
          id: "openalex.org",
          label: "OpenAlex",
          type: "openalex",
        },
      });

      for (const platform of this.sciHubPlatforms) {
        platforms.push({
          id: platform.id,
          label: platform.id,
          value: {
            baseURL: platform.baseURL,
            id: platform.id,
            label: platform.id,
            type: "sci-hub",
          },
        });
      }
    }

    return platforms;
  }

  private static async fetchPDF(scihubUrl: URL, item: Zotero.Item) {
    if (scihubUrl.hostname.toLowerCase() === "sci-hub.world") {
      await this.fetchSciHubWorldPDF(scihubUrl, item);
      return;
    }

    let ddgHeaders: Record<string, string> = {};
    let xhr = await this.fetchSciHubDocument(scihubUrl, ddgHeaders);
    const initialDdgHeaders = await this.solveDDoSGuardIfPresent(
      xhr,
      scihubUrl,
    );
    if (initialDdgHeaders) {
      ddgHeaders = initialDdgHeaders;
      xhr = await this.fetchSciHubDocument(scihubUrl, ddgHeaders);
    }

    let pdfUrl = this.extractPDFURL(xhr.responseXML, scihubUrl.href);
    if (!pdfUrl) {
      pdfUrl = await this.resolveKvnpTopPDFURL(xhr, scihubUrl);
    }
    let body = xhr.responseXML?.querySelector("body");

    if (xhr.status === 200 && !pdfUrl) {
      const solved = await this.solveAltchaChallengeIfPresent(
        xhr.responseXML,
        scihubUrl.href,
        ddgHeaders,
      );
      if (solved) {
        xhr = await this.fetchSciHubDocument(scihubUrl, ddgHeaders);
        pdfUrl = this.extractPDFURL(xhr.responseXML, scihubUrl.href);
        if (!pdfUrl) {
          pdfUrl = await this.resolveKvnpTopPDFURL(xhr, scihubUrl);
        }
        body = xhr.responseXML?.querySelector("body");
      }
    }

    if (
      (xhr.status === 200 || xhr.status === 404) &&
      !pdfUrl &&
      this.shouldTrySciHubFormFallback(xhr, scihubUrl)
    ) {
      try {
        xhr = await this.fetchSciHubFormDocument(scihubUrl, ddgHeaders);
        const formDdgHeaders = await this.solveDDoSGuardIfPresent(
          xhr,
          scihubUrl,
        );
        if (formDdgHeaders) {
          ddgHeaders = formDdgHeaders;
          xhr = await this.fetchSciHubFormDocument(scihubUrl, ddgHeaders);
        }

        pdfUrl = this.extractPDFURL(xhr.responseXML, scihubUrl.href);
        if (!pdfUrl) {
          pdfUrl = await this.resolveKvnpTopPDFURL(xhr, scihubUrl);
        }
        body = xhr.responseXML?.querySelector("body");

        if (xhr.status === 200 && !pdfUrl) {
          const solved = await this.solveAltchaChallengeIfPresent(
            xhr.responseXML,
            scihubUrl.href,
            ddgHeaders,
          );
          if (solved) {
            xhr = await this.fetchSciHubDocument(scihubUrl, ddgHeaders);
            pdfUrl = this.extractPDFURL(xhr.responseXML, scihubUrl.href);
            if (!pdfUrl) {
              pdfUrl = await this.resolveKvnpTopPDFURL(xhr, scihubUrl);
            }
            body = xhr.responseXML?.querySelector("body");
          }
        }
      } catch (error) {
        if (
          error instanceof PDFNotFoundError ||
          scihubUrl.hostname.toLowerCase() === "sci-hub.kvnp.top"
        ) {
          throw error;
        }
        ztoolkit.log(
          `scihub: form POST fallback failed for ${scihubUrl.href}: ${this.formatError(
            error,
          )}`,
        );
      }
    }

    if (xhr.status === 200 && pdfUrl) {
      await Utils.attachRemotePDF(pdfUrl, item);
      return;
    }

    if (
      (xhr.status === 200 || xhr.status === 404) &&
      (this.pdfNotAvailable(body) ||
        this.sciHubLandingWithoutPDF(xhr) ||
        this.sciHubHTMLWithoutPDF(xhr))
    ) {
      const message = `PDF not found at ${scihubUrl.href}: ${this.responseSummary(xhr)}`;
      ztoolkit.log(`scihub: ${message}`);
      throw new PDFNotFoundError(message);
    }

    const message = `Failed to fetch PDF from ${scihubUrl.href}: ${this.responseSummary(xhr)}`;
    ztoolkit.log(`scihub: ${message}`);
    throw new Error(message);
  }

  private static async fetchSciHubWorldPDF(scihubUrl: URL, item: Zotero.Item) {
    const doi = this.sciHubDOIFromURL(scihubUrl);
    const apiURL = new URL(
      `/api/v1/paper/${encodeURIComponent(doi)}`,
      "https://fast.wbleb.com",
    );

    const xhr = await Zotero.HTTP.request("GET", apiURL.href, {
      responseType: "json",
      headers: {
        "User-Agent": this.semanticScholarUserAgent,
        Accept: "application/json",
        Origin: "https://sci-hub.world",
        Referer: "https://sci-hub.world/zh",
      },
      successCodes: false,
    });

    let data: SciHubWorldPaperResponse | undefined;
    try {
      data = this.parseJSONResponse<SciHubWorldPaperResponse>(xhr);
    } catch (error) {
      if (xhr.status === 404) {
        const message = `PDF not found at ${scihubUrl.href}: sci-hub.world API HTTP 404; ${this.responseTextSnippet(
          xhr,
        )}`;
        ztoolkit.log(`scihub: ${message}`);
        throw new PDFNotFoundError(message);
      }
      throw new Error(
        `sci-hub.world API returned non-JSON response for ${scihubUrl.href}: ${this.responseSummary(
          xhr,
        )}; ${this.formatError(error)}`,
      );
    }

    const apiMessage = data.detail || data.message || data.error || "";
    if (
      xhr.status === 404 ||
      /paper not found|not found|no pdf/i.test(apiMessage)
    ) {
      const message = `PDF not found at ${scihubUrl.href}: sci-hub.world API HTTP ${xhr.status}; ${
        apiMessage || this.responseTextSnippet(xhr)
      }`;
      ztoolkit.log(`scihub: ${message}`);
      throw new PDFNotFoundError(message);
    }

    if (xhr.status !== 200) {
      throw new Error(
        `Failed to fetch PDF from ${scihubUrl.href}: sci-hub.world API ${this.responseSummary(
          xhr,
        )}`,
      );
    }

    if (!data.success || !data.url) {
      const message = `PDF not found at ${scihubUrl.href}: sci-hub.world API returned no PDF URL; ${this.responseTextSnippet(
        xhr,
      )}`;
      ztoolkit.log(`scihub: ${message}`);
      throw new PDFNotFoundError(message);
    }

    const pdfURL = new URL(data.url, "https://fast.wbleb.com");
    pdfURL.protocol = "https:";
    await this.assertSciHubWorldPDFCandidate(pdfURL, scihubUrl);
    await Utils.attachRemotePDF(pdfURL, item);
  }

  private static async assertSciHubWorldPDFCandidate(
    pdfURL: URL,
    scihubUrl: URL,
  ) {
    const rawFileName = pdfURL.pathname.split("/").pop() || "";
    let fileName = rawFileName;
    try {
      fileName = decodeURIComponent(rawFileName);
    } catch {
      // Keep the raw file name if the URL contains malformed escapes.
    }

    if (fileName.toLowerCase() === "sci.pdf") {
      const message = `PDF not found at ${scihubUrl.href}: sci-hub.world API returned placeholder ${pdfURL.href}, not the requested paper`;
      ztoolkit.log(`scihub: ${message}`);
      throw new PDFNotFoundError(message);
    }

    const probeXHR = await Zotero.HTTP.request("GET", pdfURL.href, {
      responseType: "arraybuffer",
      headers: {
        "User-Agent": this.semanticScholarUserAgent,
        Accept: "application/pdf,*/*;q=0.8",
        Range: "bytes=0-1048575",
        Referer: "https://sci-hub.world/zh",
      },
      successCodes: false,
    });

    if (probeXHR.status !== 200 && probeXHR.status !== 206) {
      throw new Error(
        `sci-hub.world PDF probe failed for ${pdfURL.href}: HTTP ${probeXHR.status}; ${this.responseTextSnippet(
          probeXHR,
        )}`,
      );
    }

    const bytes = this.bytesFromXHRResponse(probeXHR.response);
    if (bytes.length <= 0) {
      throw new Error(
        `sci-hub.world PDF probe returned an empty body for ${pdfURL.href}`,
      );
    }

    const pdfHeader = this.latin1FromBytes(bytes.subarray(0, 5));
    if (pdfHeader !== "%PDF-") {
      throw new Error(
        `sci-hub.world PDF probe returned non-PDF content for ${pdfURL.href}: HTTP ${probeXHR.status}; content-type=${
          probeXHR.getResponseHeader("Content-Type") || ""
        }`,
      );
    }

    const probeHash = this.sha256BytesHex(bytes);
    if (
      probeHash ===
      "9e422f86b9b632d2ebd4574747d12344e18c01abaa4f5ee2a9de185a6faa0d53"
    ) {
      const message = `PDF not found at ${scihubUrl.href}: sci-hub.world returned its default Sci-Hub tokenomics placeholder PDF (${pdfURL.href})`;
      ztoolkit.log(`scihub: ${message}`);
      throw new PDFNotFoundError(message);
    }
  }

  private static bytesFromXHRResponse(response: XMLHttpRequest["response"]) {
    if (response instanceof ArrayBuffer) {
      return new Uint8Array(response);
    }
    if (ArrayBuffer.isView(response)) {
      return new Uint8Array(
        response.buffer,
        response.byteOffset,
        response.byteLength,
      );
    }
    if (typeof response === "string") {
      const bytes = new Uint8Array(response.length);
      for (let index = 0; index < response.length; index++) {
        bytes[index] = response.charCodeAt(index) & 0xff;
      }
      return bytes;
    }
    return new Uint8Array();
  }

  private static latin1FromBytes(bytes: Uint8Array) {
    let value = "";
    for (let index = 0; index < bytes.length; index++) {
      value += String.fromCharCode(bytes[index]);
    }
    return value;
  }

  private static sha256BytesHex(bytes: Uint8Array) {
    const chunks: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      const end = Math.min(offset + 8192, bytes.length);
      let chunk = "";
      for (let index = offset; index < end; index++) {
        chunk += String.fromCharCode(bytes[index]);
      }
      chunks.push(chunk);
    }
    return this.sha256Hex(chunks.join(""));
  }

  private static async fetchOpenAlexPDF(doi: string, item: Zotero.Item) {
    const normalizedDOI = this.normalizeDOI(doi);
    const work = await this.fetchOpenAlexWorkByDOI(normalizedDOI);
    const candidates = this.openAlexPDFCandidates(work);

    if (candidates.length <= 0) {
      const details = [
        `OpenAlex PDF not found for DOI ${normalizedDOI}`,
        work.id ? `work=${work.id}` : undefined,
        work.open_access?.oa_status
          ? `oa_status=${work.open_access.oa_status}`
          : undefined,
        work.open_access?.oa_url
          ? `oa_url_without_pdf=${work.open_access.oa_url}`
          : undefined,
      ]
        .filter(Boolean)
        .join("; ");
      throw new PDFNotFoundError(details);
    }

    const attachErrors: unknown[] = [];
    for (const candidate of candidates) {
      try {
        ztoolkit.log(
          `openalex: importing ${candidate.source} PDF ${candidate.url.href}`,
        );
        await Utils.attachRemotePDF(candidate.url, item);
        return;
      } catch (error) {
        attachErrors.push(
          new Error(
            `OpenAlex candidate failed (${candidate.source}, ${candidate.url.href}): ${this.formatError(
              error,
            )}`,
          ),
        );
      }
    }

    throw new Error(
      `OpenAlex PDF candidates failed for DOI ${normalizedDOI}:\n${attachErrors
        .map((error) => this.formatError(error))
        .join("\n\n")}`,
    );
  }

  private static async fetchOpenAlexWorkByDOI(
    doi: string,
  ): Promise<OpenAlexWorkResponse> {
    const workURL = new URL(
      `/works/doi:${encodeURIComponent(doi)}`,
      "https://api.openalex.org",
    );
    workURL.searchParams.set("mailto", "ui@openalex.org");

    const xhr = await Zotero.HTTP.request("GET", workURL.href, {
      responseType: "json",
      headers: this.semanticScholarHeaders({
        Accept: "application/json",
        Origin: "https://openalex.org",
        Referer: "https://openalex.org/",
      }),
      successCodes: false,
    });

    if (xhr.status === 404) {
      throw new PDFNotFoundError(
        `OpenAlex work not found for DOI ${doi}: ${this.responseSummary(xhr)}`,
      );
    }
    if (xhr.status !== 200) {
      throw new Error(
        `OpenAlex DOI lookup failed for DOI ${doi}: ${this.responseSummary(
          xhr,
        )}`,
      );
    }

    const work = this.parseJSONResponse<OpenAlexWorkResponse>(xhr);
    const returnedDOI = this.normalizeDOI(work.doi);
    if (returnedDOI && returnedDOI !== doi) {
      throw new PDFNotFoundError(
        `OpenAlex DOI mismatch for DOI ${doi}: work ${work.id ?? "unknown"} returned ${returnedDOI}`,
      );
    }
    return work;
  }

  private static openAlexPDFCandidates(
    work: OpenAlexWorkResponse,
  ): SemanticScholarPDFCandidate[] {
    const candidates: SemanticScholarPDFCandidate[] = [];
    this.addOpenAlexPDFCandidate(
      candidates,
      work.primary_location?.pdf_url,
      "OpenAlex primary_location.pdf_url",
    );
    this.addOpenAlexPDFCandidate(
      candidates,
      work.best_oa_location?.pdf_url,
      "OpenAlex best_oa_location.pdf_url",
    );
    for (const location of work.locations ?? []) {
      this.addOpenAlexPDFCandidate(
        candidates,
        location.pdf_url,
        "OpenAlex locations[].pdf_url",
      );
    }
    return candidates;
  }

  private static addOpenAlexPDFCandidate(
    candidates: SemanticScholarPDFCandidate[],
    rawURL: string | null | undefined,
    source: string,
  ) {
    if (!rawURL) {
      return;
    }
    try {
      const pdfURL = new URL(rawURL);
      if (!["http:", "https:"].includes(pdfURL.protocol)) {
        return;
      }
      if (!candidates.some((candidate) => candidate.url.href === pdfURL.href)) {
        candidates.push({ url: pdfURL, source });
      }
    } catch (error) {
      ztoolkit.log(
        `openalex: skipped invalid PDF candidate ${rawURL}: ${this.formatError(
          error,
        )}`,
      );
    }
  }

  private static async fetchUnpaywallPDF(doi: string, item: Zotero.Item) {
    const normalizedDOI = this.normalizeDOI(doi);
    const data = await this.fetchUnpaywallByDOI(normalizedDOI);
    const candidates = this.unpaywallPDFCandidates(data);

    if (candidates.length <= 0) {
      const details = [
        `Unpaywall PDF not found for DOI ${normalizedDOI}`,
        data.is_oa === false ? "is_oa=false" : undefined,
        data.oa_status ? `oa_status=${data.oa_status}` : undefined,
        data.best_oa_location?.url_for_landing_page
          ? `landing_page_without_pdf=${data.best_oa_location.url_for_landing_page}`
          : undefined,
      ]
        .filter(Boolean)
        .join("; ");
      throw new PDFNotFoundError(details);
    }

    const attachErrors: unknown[] = [];
    for (const candidate of candidates) {
      try {
        ztoolkit.log(
          `unpaywall: importing ${candidate.source} PDF ${candidate.url.href}`,
        );
        await Utils.attachRemotePDF(candidate.url, item);
        return;
      } catch (error) {
        attachErrors.push(
          new Error(
            `Unpaywall candidate failed (${candidate.source}, ${candidate.url.href}): ${this.formatError(
              error,
            )}`,
          ),
        );
      }
    }

    throw new Error(
      `Unpaywall PDF candidates failed for DOI ${normalizedDOI}:\n${attachErrors
        .map((error) => this.formatError(error))
        .join("\n\n")}`,
    );
  }

  private static async fetchUnpaywallByDOI(
    doi: string,
  ): Promise<UnpaywallResponse> {
    const apiURL = new URL(
      `/v2/${encodeURIComponent(doi)}`,
      "https://api.unpaywall.org",
    );
    apiURL.searchParams.set("email", "scipdf@ytshen.com");

    const xhr = await Zotero.HTTP.request("GET", apiURL.href, {
      responseType: "json",
      headers: this.semanticScholarHeaders({
        Accept: "application/json",
        Origin: "https://unpaywall.org",
        Referer: "https://unpaywall.org/",
      }),
      successCodes: false,
    });

    if (xhr.status === 404) {
      throw new PDFNotFoundError(
        `Unpaywall work not found for DOI ${doi}: ${this.responseSummary(xhr)}`,
      );
    }
    if (xhr.status !== 200) {
      throw new Error(
        `Unpaywall DOI lookup failed for DOI ${doi}: ${this.responseSummary(
          xhr,
        )}`,
      );
    }

    const data = this.parseJSONResponse<UnpaywallResponse>(xhr);
    const returnedDOI = this.normalizeDOI(data.doi);
    if (returnedDOI && returnedDOI !== doi) {
      throw new PDFNotFoundError(
        `Unpaywall DOI mismatch for DOI ${doi}: returned ${returnedDOI}`,
      );
    }
    return data;
  }

  private static unpaywallPDFCandidates(
    data: UnpaywallResponse,
  ): SemanticScholarPDFCandidate[] {
    const candidates: SemanticScholarPDFCandidate[] = [];
    this.addUnpaywallPDFCandidate(
      candidates,
      data.best_oa_location?.url_for_pdf,
      "Unpaywall best_oa_location.url_for_pdf",
    );
    this.addUnpaywallPDFCandidate(
      candidates,
      data.first_oa_location?.url_for_pdf,
      "Unpaywall first_oa_location.url_for_pdf",
    );
    for (const location of data.oa_locations ?? []) {
      this.addUnpaywallPDFCandidate(
        candidates,
        location.url_for_pdf,
        "Unpaywall oa_locations[].url_for_pdf",
      );
    }
    return candidates;
  }

  private static addUnpaywallPDFCandidate(
    candidates: SemanticScholarPDFCandidate[],
    rawURL: string | null | undefined,
    source: string,
  ) {
    if (!rawURL) {
      return;
    }
    try {
      const pdfURL = new URL(rawURL);
      if (!["http:", "https:"].includes(pdfURL.protocol)) {
        return;
      }
      if (!candidates.some((candidate) => candidate.url.href === pdfURL.href)) {
        candidates.push({ url: pdfURL, source });
      }
    } catch (error) {
      ztoolkit.log(
        `unpaywall: skipped invalid PDF candidate ${rawURL}: ${this.formatError(
          error,
        )}`,
      );
    }
  }

  private static async fetchGoogleScholarPDF(doi: string, item: Zotero.Item) {
    const normalizedDOI = this.normalizeDOI(doi);
    const xhr = await this.fetchGoogleScholarDocument(normalizedDOI);
    const candidates = this.googleScholarPDFCandidates(xhr.responseXML);

    if (candidates.length <= 0) {
      throw new PDFNotFoundError(
        `Google Scholar PDF not found for DOI ${normalizedDOI}: ${this.responseSummary(
          xhr,
        )}`,
      );
    }

    const attachErrors: unknown[] = [];
    for (const candidate of candidates) {
      try {
        ztoolkit.log(
          `google-scholar: importing ${candidate.source} PDF ${candidate.url.href}`,
        );
        await Utils.attachRemotePDF(candidate.url, item);
        return;
      } catch (error) {
        attachErrors.push(
          new Error(
            `Google Scholar candidate failed (${candidate.source}, ${candidate.url.href}): ${this.formatError(
              error,
            )}`,
          ),
        );
      }
    }

    throw new Error(
      `Google Scholar PDF candidates failed for DOI ${normalizedDOI}:\n${attachErrors
        .map((error) => this.formatError(error))
        .join("\n\n")}`,
    );
  }

  private static async fetchGoogleScholarDocument(doi: string) {
    const scholarURL = new URL("https://scholar.google.com/scholar");
    scholarURL.searchParams.set("hl", "zh-CN");
    scholarURL.searchParams.set("as_sdt", "0,5");
    scholarURL.searchParams.set("q", doi);
    scholarURL.searchParams.set("btnG", "");

    const xhr = await Zotero.HTTP.request("GET", scholarURL.href, {
      responseType: "document",
      headers: this.semanticScholarHeaders({
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
        Referer: "https://scholar.google.com/",
      }),
      successCodes: false,
    });

    if (xhr.status === 403 || xhr.status === 429) {
      throw new Error(
        `Google Scholar captcha/blocked for DOI ${doi}: ${this.responseSummary(
          xhr,
        )}`,
      );
    }
    if (xhr.status !== 200) {
      throw new Error(
        `Google Scholar lookup failed for DOI ${doi}: ${this.responseSummary(
          xhr,
        )}`,
      );
    }
    if (this.responseLooksGoogleScholarBlock(xhr)) {
      throw new Error(
        `Google Scholar captcha/challenge for DOI ${doi}: ${this.responseSummary(
          xhr,
        )}`,
      );
    }

    return xhr;
  }

  private static googleScholarPDFCandidates(
    doc: Document | null | undefined,
  ): SemanticScholarPDFCandidate[] {
    const candidates: SemanticScholarPDFCandidate[] = [];
    if (!doc) {
      return candidates;
    }

    const anchors = Array.prototype.slice.call(
      doc.querySelectorAll("a"),
    ) as HTMLAnchorElement[];
    for (const anchor of anchors) {
      const rawURL = anchor.getAttribute("href");
      if (!rawURL) {
        continue;
      }
      const text = this.compactText(anchor.textContent);
      this.addGoogleScholarPDFCandidate(candidates, rawURL, text);
    }
    return candidates;
  }

  private static addGoogleScholarPDFCandidate(
    candidates: SemanticScholarPDFCandidate[],
    rawURL: string,
    linkText: string,
  ) {
    try {
      let pdfURL = new URL(rawURL, "https://scholar.google.com");
      if (
        pdfURL.hostname === "scholar.google.com" &&
        pdfURL.pathname === "/scholar_url" &&
        pdfURL.searchParams.get("url")
      ) {
        pdfURL = new URL(pdfURL.searchParams.get("url") as string);
      }

      const href = pdfURL.href;
      const looksLikePDFLinkText = /(?:^|\[|\b)PDF(?:\]|\b)|全文|下载/i.test(
        linkText,
      );
      const looksLikePDFURL =
        /\.pdf(?:[?#]|$)|\/pdf(?:\/|$)|\/pdf\/|article\/download|download\/pdf|\/content\/pdf\//i.test(
          href,
        );
      if (!looksLikePDFLinkText && !looksLikePDFURL) {
        return;
      }
      if (!["http:", "https:"].includes(pdfURL.protocol)) {
        return;
      }
      if (/^(?:scholar\.)?google\./i.test(pdfURL.hostname)) {
        return;
      }
      if (!candidates.some((candidate) => candidate.url.href === pdfURL.href)) {
        candidates.push({
          source: `Google Scholar ${linkText || "PDF link"}`,
          url: pdfURL,
        });
      }
    } catch (error) {
      ztoolkit.log(
        `google-scholar: skipped invalid PDF candidate ${rawURL}: ${this.formatError(
          error,
        )}`,
      );
    }
  }

  private static responseLooksGoogleScholarBlock(xhr: XMLHttpRequest) {
    const text = [
      this.responseTitle(xhr.responseXML),
      this.responseSnippet(xhr.responseXML),
      this.responseTextSnippet(xhr),
    ].join(" ");
    return /captcha|recaptcha|unusual traffic|detected unusual|sorry|not a robot|不是机器人|异常流量|流量异常|请进行人机身份验证/i.test(
      text,
    );
  }

  private static async fetchSemanticScholarPDF(
    doi: string | undefined,
    item: Zotero.Item,
  ) {
    const candidates: SemanticScholarPDFCandidate[] = [];
    const notFoundErrors: PDFNotFoundError[] = [];
    const softErrors: unknown[] = [];
    const fatalErrors: unknown[] = [];
    let graphPaper: SemanticScholarGraphPaper | undefined;
    let searchPaper: SemanticScholarSearchPaper | undefined;

    if (doi) {
      try {
        graphPaper = await this.fetchSemanticScholarGraphPaper(doi);
        this.addSemanticScholarPDFCandidate(
          candidates,
          graphPaper.openAccessPdf?.url,
          "Semantic Scholar Graph openAccessPdf",
        );
      } catch (error) {
        if (error instanceof PDFNotFoundError) {
          notFoundErrors.push(error);
        } else {
          // Graph API is useful when available, but the no-key endpoint is easy to rate-limit.
          // Keep these as soft evidence until the website API also fails.
          softErrors.push(error);
        }
      }
    }

    if (graphPaper?.paperId) {
      try {
        this.addSemanticScholarPDFCandidates(
          candidates,
          await this.fetchSemanticScholarWebsitePDFCandidates(
            graphPaper.paperId,
          ),
        );
      } catch (error) {
        if (error instanceof PDFNotFoundError) {
          notFoundErrors.push(error);
        } else {
          softErrors.push(error);
        }
      }
    }

    this.addSemanticScholarArxivCandidate(
      candidates,
      graphPaper?.externalIds?.ArXiv,
      "Semantic Scholar Graph ArXiv",
    );

    if (candidates.length <= 0 || !doi) {
      try {
        searchPaper = await this.searchSemanticScholarPaper(doi, item);
        this.addSemanticScholarSearchCandidates(candidates, searchPaper);
        if (searchPaper.id) {
          this.addSemanticScholarPDFCandidates(
            candidates,
            await this.fetchSemanticScholarWebsitePDFCandidates(searchPaper.id),
          );
        }
      } catch (error) {
        if (error instanceof PDFNotFoundError) {
          notFoundErrors.push(error);
        } else {
          fatalErrors.push(error);
        }
      }
    }

    if (candidates.length <= 0) {
      const target = doi ? `DOI ${doi}` : `title "${this.itemTitle(item)}"`;
      if (searchPaper || fatalErrors.length <= 0) {
        const details = [
          `Semantic Scholar PDF not found for ${target}`,
          searchPaper
            ? "Semantic Scholar has a matching paper record, but no visible PDF candidate was returned."
            : undefined,
          ...notFoundErrors.map((error) => error.message),
        ]
          .filter(Boolean)
          .join("\n");
        if (softErrors.length > 0) {
          ztoolkit.log(
            `semantic-scholar: ignored soft failure(s) after PDF-not-found decision for ${target}:\n${softErrors
              .map((error) => this.formatError(error))
              .join("\n\n")}`,
          );
        }
        throw new PDFNotFoundError(details);
      }

      const message = [
        `Semantic Scholar failed before it could decide PDF availability for ${target}`,
        ...fatalErrors.map((error) => this.formatError(error)),
        ...softErrors.map((error) => this.formatError(error)),
        ...notFoundErrors.map((error) => error.message),
      ]
        .filter(Boolean)
        .join("\n\n");
      throw new Error(message);
    }

    const attachErrors: unknown[] = [];
    for (const candidate of candidates) {
      try {
        ztoolkit.log(
          `semantic-scholar: importing ${candidate.source} PDF ${candidate.url.href}`,
        );
        await Utils.attachRemotePDF(candidate.url, item);
        return;
      } catch (error) {
        attachErrors.push(
          new Error(
            `Semantic Scholar candidate failed (${candidate.source}, ${candidate.url.href}): ${this.formatError(
              error,
            )}`,
          ),
        );
      }
    }

    throw new Error(
      `Semantic Scholar PDF candidates failed for ${
        doi ? `DOI ${doi}` : `title "${this.itemTitle(item)}"`
      }:\n${attachErrors.map((error) => this.formatError(error)).join("\n\n")}`,
    );
  }

  private static async fetchSemanticScholarGraphPaper(
    doi: string,
  ): Promise<SemanticScholarGraphPaper> {
    const url = new URL(
      `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(
        doi,
      )}`,
    );
    url.searchParams.set(
      "fields",
      "paperId,externalIds,title,openAccessPdf,url,isOpenAccess",
    );

    const xhr = await Zotero.HTTP.request("GET", url.href, {
      responseType: "json",
      headers: this.semanticScholarHeaders({
        Accept: "application/json",
      }),
      successCodes: false,
    });
    if (xhr.status === 404) {
      throw new PDFNotFoundError(
        `Semantic Scholar paper not found for DOI ${doi}: ${this.responseSummary(
          xhr,
        )}`,
      );
    }
    if (xhr.status !== 200) {
      throw new Error(
        `Semantic Scholar Graph API failed for DOI ${doi}: ${this.responseSummary(
          xhr,
        )}`,
      );
    }

    return this.parseJSONResponse<SemanticScholarGraphPaper>(xhr);
  }

  private static async fetchSemanticScholarWebsitePDFCandidates(
    paperId: string,
  ): Promise<SemanticScholarPDFCandidate[]> {
    const candidates: SemanticScholarPDFCandidate[] = [];
    const pdfDataURL = new URL(
      `/api/1/paper/${encodeURIComponent(paperId)}/pdf-data`,
      "https://www.semanticscholar.org",
    );
    const xhr = await Zotero.HTTP.request("GET", pdfDataURL.href, {
      responseType: "json",
      headers: await this.semanticScholarWebsiteHeaders(),
      successCodes: false,
    });

    if (xhr.status === 404) {
      throw new PDFNotFoundError(
        `Semantic Scholar website PDF data not found for paper ${paperId}: ${this.responseSummary(
          xhr,
        )}`,
      );
    }
    if (xhr.status !== 200) {
      throw new Error(
        `Semantic Scholar website PDF data failed for paper ${paperId}: ${this.responseSummary(
          xhr,
        )}`,
      );
    }

    const data = this.parseJSONResponse<SemanticScholarPDFData>(xhr);
    this.addSemanticScholarPDFCandidate(
      candidates,
      data.pdfUrlSelfHosted,
      "Semantic Scholar self-hosted PDF",
    );
    this.addSemanticScholarPDFCandidate(
      candidates,
      data.pdfUrl,
      "Semantic Scholar visible PDF",
    );
    if (candidates.length <= 0) {
      return await this.fetchSemanticScholarPDFVisibilityCandidates(paperId);
    }
    return candidates;
  }

  private static async fetchSemanticScholarPDFVisibilityCandidates(
    paperId: string,
  ): Promise<SemanticScholarPDFCandidate[]> {
    const candidates: SemanticScholarPDFCandidate[] = [];
    const visibleURL = new URL(
      `/api/1/paper/${encodeURIComponent(paperId)}/pdf-visible`,
      "https://www.semanticscholar.org",
    );
    const xhr = await Zotero.HTTP.request("GET", visibleURL.href, {
      responseType: "json",
      headers: await this.semanticScholarWebsiteHeaders(),
      successCodes: false,
    });

    if (xhr.status === 404) {
      throw new PDFNotFoundError(
        `Semantic Scholar website PDF visibility not found for paper ${paperId}: ${this.responseSummary(
          xhr,
        )}`,
      );
    }
    if (xhr.status !== 200) {
      throw new Error(
        `Semantic Scholar website PDF visibility failed for paper ${paperId}: ${this.responseSummary(
          xhr,
        )}`,
      );
    }

    const data = this.parseJSONResponse<SemanticScholarPDFVisible>(xhr);
    this.addSemanticScholarPDFCandidate(
      candidates,
      data.pdfUrlSelfHosted?.url,
      "Semantic Scholar self-hosted visible PDF",
    );
    this.addSemanticScholarPDFCandidate(
      candidates,
      data.pdfUrl?.url,
      "Semantic Scholar visible PDF",
    );
    return candidates;
  }

  private static async searchSemanticScholarPaper(
    doi: string | undefined,
    item: Zotero.Item,
  ): Promise<SemanticScholarSearchPaper> {
    const title = this.itemTitle(item);
    const queryString = title || doi;
    if (!queryString) {
      throw new PDFNotFoundError("Semantic Scholar search has no DOI or title");
    }

    const searchURL = new URL(
      `https://www.semanticscholar.org/search?q=${encodeURIComponent(
        queryString,
      )}&sort=relevance`,
    );
    const xhr = await Zotero.HTTP.request(
      "POST",
      "https://www.semanticscholar.org/api/1/search",
      {
        body: JSON.stringify(this.semanticScholarSearchPayload(queryString)),
        responseType: "json",
        headers: await this.semanticScholarWebsiteHeaders({
          "Content-Type": "application/json",
          Origin: "https://www.semanticscholar.org",
          Referer: searchURL.href,
        }),
        successCodes: false,
      },
    );

    if (xhr.status !== 200) {
      throw new Error(
        `Semantic Scholar website search failed for ${
          doi ? `DOI ${doi}` : `title "${title}"`
        }: ${this.responseSummary(xhr)}`,
      );
    }

    const response = this.parseJSONResponse<SemanticScholarSearchResponse>(xhr);
    const results = response.results ?? [];
    const normalizedDOI = this.normalizeDOI(doi);
    const normalizedTitle = this.normalizeTitle(title);
    const paper =
      (normalizedDOI
        ? results.find(
            (result) =>
              this.normalizeDOI(result.doiInfo?.doi) === normalizedDOI,
          )
        : undefined) ||
      (normalizedTitle
        ? results.find(
            (result) =>
              this.normalizeTitle(result.title?.text) === normalizedTitle,
          )
        : undefined) ||
      (normalizedTitle &&
      results[0] &&
      this.titleLooksLikeMatch(title, results[0].title?.text)
        ? results[0]
        : undefined);

    if (!paper) {
      throw new PDFNotFoundError(
        `Semantic Scholar website search did not return ${
          doi ? `DOI ${doi}` : `title "${title}"`
        }`,
      );
    }
    return paper;
  }

  private static semanticScholarSearchPayload(queryString: string) {
    return {
      queryString,
      page: 1,
      pageSize: 10,
      sort: "relevance",
      authors: [],
      coAuthors: [],
      venues: [],
      yearFilter: null,
      requireViewablePdf: false,
      fieldsOfStudy: [],
      hydrateWithDdb: true,
      includeTldrs: true,
      performTitleMatch: true,
      includeBadges: true,
      getQuerySuggestions: false,
      cues: [
        "CitedByLibraryPaperCue",
        "CitesYourPaperCue",
        "CitesLibraryPaperCue",
      ],
      includePdfVisibility: true,
    };
  }

  private static addSemanticScholarSearchCandidates(
    candidates: SemanticScholarPDFCandidate[],
    paper: SemanticScholarSearchPaper,
  ) {
    if (paper.openAccessInfo?.location?.isPdf) {
      this.addSemanticScholarPDFCandidate(
        candidates,
        paper.openAccessInfo.location.url,
        "Semantic Scholar search open-access PDF",
      );
    }
    const links = [
      paper.primaryPaperLink,
      ...(paper.alternatePaperLinks ?? []),
    ];
    for (const link of links) {
      const linkType = link?.linkType?.toLowerCase();
      if (
        linkType === "arxiv" ||
        linkType === "openaccess" ||
        link?.url?.toLowerCase().includes(".pdf") ||
        link?.url?.toLowerCase().includes("/pdf/")
      ) {
        this.addSemanticScholarPDFCandidate(
          candidates,
          link?.url,
          `Semantic Scholar search ${linkType || "PDF link"}`,
        );
      }
    }
  }

  private static addSemanticScholarPDFCandidates(
    target: SemanticScholarPDFCandidate[],
    source: SemanticScholarPDFCandidate[],
  ) {
    for (const candidate of source) {
      this.addSemanticScholarPDFCandidate(
        target,
        candidate.url.href,
        candidate.source,
      );
    }
  }

  private static addSemanticScholarArxivCandidate(
    candidates: SemanticScholarPDFCandidate[],
    arxivID: string | number | undefined,
    source: string,
  ) {
    if (typeof arxivID !== "string" || !arxivID.trim()) {
      return;
    }
    const cleanID = arxivID.trim().replace(/^arxiv:/i, "");
    const pdfPath = cleanID.toLowerCase().endsWith(".pdf")
      ? cleanID
      : `${cleanID}.pdf`;
    this.addSemanticScholarPDFCandidate(
      candidates,
      `https://arxiv.org/pdf/${pdfPath}`,
      source,
    );
  }

  private static addSemanticScholarPDFCandidate(
    candidates: SemanticScholarPDFCandidate[],
    rawURL: string | undefined,
    source: string,
  ) {
    if (!rawURL) {
      return;
    }
    try {
      const pdfURL = new URL(rawURL, "https://www.semanticscholar.org");
      if (!["http:", "https:"].includes(pdfURL.protocol)) {
        return;
      }
      if (pdfURL.hostname === "export.arxiv.org") {
        pdfURL.hostname = "arxiv.org";
      }
      if (
        pdfURL.hostname === "pdfs.semanticscholar.org" &&
        !pdfURL.searchParams.has("skipShowableCheck")
      ) {
        pdfURL.searchParams.set("skipShowableCheck", "true");
      }
      if (!candidates.some((candidate) => candidate.url.href === pdfURL.href)) {
        candidates.push({ url: pdfURL, source });
      }
    } catch (error) {
      ztoolkit.log(
        `semantic-scholar: skipped invalid PDF candidate ${rawURL}: ${this.formatError(
          error,
        )}`,
      );
    }
  }

  private static async semanticScholarWebsiteHeaders(
    extraHeaders: Record<string, string> = {},
  ) {
    return this.semanticScholarHeaders({
      Accept: "application/json",
      "Cache-Control": "no-cache,no-store,must-revalidate,max-age=-1",
      "X-S2-Client": "webapp-browser",
      "X-S2-UI-Version": await this.semanticScholarUIVersion(),
      ...extraHeaders,
    });
  }

  private static async semanticScholarUIVersion() {
    if (this.semanticScholarUIVersionCache) {
      return this.semanticScholarUIVersionCache;
    }

    const xhr = await Zotero.HTTP.request(
      "GET",
      "https://www.semanticscholar.org/search?q=semantic%20scholar&sort=relevance",
      {
        headers: this.semanticScholarHeaders({
          Accept: "text/html,application/xhtml+xml",
        }),
        successCodes: false,
      },
    );
    const html = this.responseText(xhr);
    const match = html.match(
      /cdn\.semanticscholar\.org\/([^/]+)\/js\/BrowserEntry\.tsx\.js/,
    );
    this.semanticScholarUIVersionCache =
      match?.[1] || "00b7315f9df88896bcbc322bb8ddce275c4d4ef8";
    return this.semanticScholarUIVersionCache;
  }

  private static semanticScholarHeaders(
    extraHeaders: Record<string, string> = {},
  ) {
    return {
      "User-Agent": this.semanticScholarUserAgent,
      ...extraHeaders,
    };
  }

  private static normalizeDOI(doi: string | null | undefined) {
    return (doi ?? "")
      .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
      .trim()
      .toLowerCase();
  }

  private static shortDOI(doi: string) {
    const normalized = this.normalizeDOI(doi);
    return normalized.length > 34
      ? `${normalized.slice(0, 31)}...`
      : normalized;
  }

  private static normalizeTitle(title: string | null | undefined) {
    return (title ?? "")
      .toLowerCase()
      .replace(/[\u2010-\u2015]/g, "-")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private static titleLooksLikeMatch(
    expected: string | null | undefined,
    actual: string | null | undefined,
  ) {
    const expectedTitle = this.normalizeTitle(expected);
    const actualTitle = this.normalizeTitle(actual);
    if (!expectedTitle || !actualTitle) {
      return false;
    }
    return (
      expectedTitle === actualTitle ||
      actualTitle.includes(expectedTitle) ||
      expectedTitle.includes(actualTitle)
    );
  }

  private static itemTitle(item: Zotero.Item) {
    return String(
      item.getField("title") || item.getDisplayTitle() || "",
    ).trim();
  }

  private static formatFetchFailure(error: unknown) {
    if (error instanceof PDFNotFoundError) {
      return error.message;
    }
    return this.formatError(error);
  }

  private static asPDFNotFoundError(
    error: unknown,
  ): PDFNotFoundError | undefined {
    if (error instanceof PDFNotFoundError) {
      return error;
    }

    const message = this.formatError(error);
    if (
      /Failed to fetch PDF from https?:\/\//i.test(message) &&
      /HTTP (?:200|404)\b/i.test(message) &&
      !/captcha|altcha|robot|human|cloudflare|turnstile|ddos-guard|forbidden|blocked|verify|verification|challenge|access denied|too many requests|rate limit/i.test(
        message,
      ) &&
      /(sci-?hub|scihub|Academic Paper|free access to research papers|ScienceDirect|首页|主页|科研论文|论文求助|网站地图|Loading|not found|not available|no pdf|article unavailable|could not find|unavailable|不可用|找不到|没有找到)/i.test(
        message,
      )
    ) {
      return new PDFNotFoundError(message);
    }

    return undefined;
  }

  private static isNonDecisivePlatformFailure(error: unknown): boolean {
    return ["captcha", "blocked", "rateLimited", "networkError"].includes(
      this.classifyPlatformFailure(error),
    );
  }

  private static classifyPlatformFailure(error: unknown): PlatformOutcome {
    if (error instanceof PDFNotFoundError) {
      return "notFound";
    }

    const message = this.formatError(error).toLowerCase();
    if (
      /captcha|altcha|robot|human|turnstile|challenge|verify|verification|are you are robot|are you a robot/.test(
        message,
      )
    ) {
      return "captcha";
    }
    if (
      /\b403\b|forbidden|blocked|cloudflare|access denied|ddos-guard|just a moment/.test(
        message,
      )
    ) {
      return "blocked";
    }
    if (/\b429\b|rate limit|too many requests/.test(message)) {
      return "rateLimited";
    }
    if (
      /timeout|network|ns_error|ssl|econn|etimedout|dns|socket/.test(message)
    ) {
      return "networkError";
    }
    if (/json|parse|unexpected token|syntaxerror/.test(message)) {
      return "parseError";
    }
    if (/importfromurl|attachment|attach|import/.test(message)) {
      return "importError";
    }
    return "error";
  }

  private static async fetchSciHubFormDocument(
    scihubUrl: URL,
    extraHeaders: Record<string, string> = {},
  ) {
    const baseURL = new URL("/", scihubUrl.href);
    const doi = this.sciHubDOIFromURL(scihubUrl);
    const formData = new URLSearchParams();
    if (scihubUrl.hostname.toLowerCase() === "sci-hub.kvnp.top") {
      formData.set("sci-hub-plugin-check", "");
    }
    formData.set("request", doi);

    ztoolkit.log(`scihub: trying form POST fallback at ${baseURL.href}`);
    const xhr = await Zotero.HTTP.request("POST", baseURL.href, {
      body: formData.toString(),
      responseType: "document",
      headers: this.requestHeaders({
        ...extraHeaders,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: baseURL.href,
      }),
      successCodes: false,
    });
    return await this.followSciHubRedirect(xhr, baseURL.href, extraHeaders);
  }

  private static async followSciHubRedirect(
    xhr: XMLHttpRequest,
    baseURL: string,
    extraHeaders: Record<string, string> = {},
  ) {
    if (xhr.status < 300 || xhr.status >= 400) {
      return xhr;
    }

    const location = xhr.getResponseHeader("Location");
    if (!location) {
      return xhr;
    }

    const redirectURL = new URL(location, baseURL);
    ztoolkit.log(`scihub: following redirect to ${redirectURL.href}`);
    return await this.fetchSciHubDocument(redirectURL, extraHeaders);
  }

  private static shouldTrySciHubFormFallback(
    xhr: XMLHttpRequest,
    scihubUrl: URL,
  ): boolean {
    if (!this.supportsSciHubFormPost(scihubUrl)) {
      return false;
    }
    if (xhr.status !== 200 && xhr.status !== 404) {
      return false;
    }
    if (this.responseLooksPDFNotAvailable(xhr)) {
      return false;
    }

    const text = this.sciHubResponseText(xhr);
    if (
      /captcha|altcha|robot|human|cloudflare|turnstile|forbidden|blocked|verify|verification|challenge|access denied|too many requests|rate limit|ddos-guard/i.test(
        text,
      )
    ) {
      return false;
    }

    return this.sciHubLandingWithoutPDF(xhr) || this.sciHubHTMLWithoutPDF(xhr);
  }

  private static supportsSciHubFormPost(scihubUrl: URL): boolean {
    return [
      "sci-hub.kvnp.top",
      "sci-hub.ru",
      "sci-hub.su",
      "sci-hub.st",
      "sci-hub.red",
      "sci-hub.box",
      "sci-hub.ren",
    ].includes(scihubUrl.hostname.toLowerCase());
  }

  private static sciHubDOIFromURL(scihubUrl: URL): string {
    const doi = decodeURIComponent(scihubUrl.pathname.replace(/^\/+/, ""));
    return doi || scihubUrl.href;
  }

  private static async resolveKvnpTopPDFURL(
    xhr: XMLHttpRequest,
    scihubUrl: URL,
  ): Promise<URL | undefined> {
    if (scihubUrl.hostname.toLowerCase() !== "sci-hub.kvnp.top") {
      return undefined;
    }

    const taskID = this.extractKvnpTopTaskID(xhr);
    if (!taskID) {
      return undefined;
    }

    ztoolkit.log(`scihub: polling sci-hub.kvnp.top task ${taskID}`);
    return await this.pollKvnpTopPDFURL(scihubUrl, taskID);
  }

  private static extractKvnpTopTaskID(xhr: XMLHttpRequest): string | undefined {
    const scriptText = xhr.responseXML
      ? Array.from<HTMLScriptElement>(
          xhr.responseXML.querySelectorAll(
            "script",
          ) as NodeListOf<HTMLScriptElement>,
        )
          .map((script) => script.textContent ?? "")
          .join("\n")
      : "";
    const text = `${scriptText}\n${this.responseText(xhr)}`;
    return (
      text.match(/taskId\s*=\s*["']([A-Za-z0-9_-]{8,128})["']/)?.[1] ??
      text.match(/task_id[=:]\s*["']?([A-Za-z0-9_-]{8,128})/i)?.[1]
    );
  }

  private static async pollKvnpTopPDFURL(
    scihubUrl: URL,
    taskID: string,
  ): Promise<URL | undefined> {
    for (let attempt = 0; attempt < 12; attempt++) {
      if (attempt > 0) {
        await this.sleep(1500);
      }

      const statusURL = new URL(
        `/api/check-status?task_id=${encodeURIComponent(taskID)}`,
        scihubUrl.href,
      );
      const xhr = await Zotero.HTTP.request("GET", statusURL.href, {
        responseType: "json",
        headers: this.requestHeaders({ Accept: "application/json" }),
        successCodes: false,
      });
      if (xhr.status !== 200) {
        throw new Error(
          `sci-hub.kvnp.top task ${taskID} status check failed: ${this.responseSummary(
            xhr,
          )}`,
        );
      }

      const status = this.parseJSONResponse<KvnpTopStatusResponse>(xhr);
      const pdfURL = status.data?.pdf_url || status.official_pdf || undefined;
      if (status.status === "completed") {
        if (pdfURL) {
          return new URL(pdfURL, scihubUrl.href);
        }
        throw new Error(
          `sci-hub.kvnp.top task ${taskID} completed without pdf_url`,
        );
      }

      if (status.status === "error") {
        const message = status.message || "PDF download failed";
        if (status.reason === "not_found" || /not[_ -]?found/i.test(message)) {
          throw new PDFNotFoundError(
            `PDF not found at ${scihubUrl.href}: sci-hub.kvnp.top task ${taskID} returned ${message}`,
          );
        }
        throw new Error(
          `sci-hub.kvnp.top task ${taskID} failed: ${message}${
            status.reason ? ` (${status.reason})` : ""
          }`,
        );
      }
    }

    throw new Error(
      `sci-hub.kvnp.top task ${taskID} did not finish before timeout`,
    );
  }

  private static responseLooksPDFNotAvailable(xhr: XMLHttpRequest): boolean {
    const text = this.sciHubResponseText(xhr);
    return (
      this.pdfNotAvailable(xhr.responseXML?.querySelector("body")) ||
      this.pdfNotAvailableRegexes.some((regex) => regex.test(text))
    );
  }

  private static responseLooksDDoSGuard(xhr: XMLHttpRequest): boolean {
    const title = this.responseTitle(xhr.responseXML).toLowerCase();
    const text = this.sciHubResponseText(xhr).toLowerCase();
    return (
      title.includes("ddos-guard") ||
      /ddos-guard|checking your browser|well-known\/ddos-guard|js-challenge\/index\.js/.test(
        text,
      )
    );
  }

  private static async solveDDoSGuardIfPresent(
    xhr: XMLHttpRequest,
    scihubUrl: URL,
  ): Promise<Record<string, string> | null> {
    if (!this.responseLooksDDoSGuard(xhr)) {
      return null;
    }

    try {
      await DDoSGuardSolver.solve(scihubUrl);
      return DDoSGuardSolver.requestHeaders();
    } catch (error) {
      const message = `DDoS-Guard challenge failed for ${scihubUrl.href}: ${this.formatError(
        error,
      )}`;
      ztoolkit.log(`scihub: ${message}`);
      throw new Error(message);
    }
  }

  private static sciHubResponseText(xhr: XMLHttpRequest): string {
    const doc = xhr.responseXML;
    return [
      this.responseTitle(doc),
      this.compactText(doc?.querySelector("body")?.textContent),
      this.responseText(xhr),
    ].join("\n");
  }

  private static async sleep(milliseconds: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  }

  private static async fetchSciHubDocument(
    scihubUrl: URL,
    extraHeaders: Record<string, string> = {},
  ) {
    return await Zotero.HTTP.request("GET", scihubUrl.href, {
      responseType: "document",
      headers: this.requestHeaders(extraHeaders),
      successCodes: false,
    });
  }

  private static requestHeaders(extraHeaders: Record<string, string> = {}) {
    return {
      "User-Agent": this.mobileUserAgent,
      ...extraHeaders,
    };
  }

  private static async solveAltchaChallengeIfPresent(
    doc: Document | null | undefined,
    baseURL: string,
    extraHeaders: Record<string, string> = {},
  ): Promise<boolean> {
    const challengeURL = this.extractAltchaChallengeURL(doc, baseURL);
    if (!challengeURL) {
      return false;
    }

    const solutionURL = new URL(
      challengeURL.href.replace("/captcha/challenge/", "/captcha/solution/"),
    );
    try {
      ztoolkit.log(`scihub: solving ALTCHA challenge "${challengeURL.href}"`);
      const challenge = await this.requestAltchaChallenge(
        challengeURL,
        extraHeaders,
      );
      const solution = this.solveAltchaChallenge(challenge);
      if (!solution) {
        ztoolkit.log(
          `scihub: failed to solve ALTCHA challenge "${challengeURL.href}"`,
        );
        return false;
      }

      const xhr = await Zotero.HTTP.request("POST", solutionURL.href, {
        body: JSON.stringify({ captcha: this.encodeAltchaSolution(solution) }),
        responseType: "json",
        headers: this.requestHeaders({
          ...extraHeaders,
          "Content-Type": "application/json",
          Accept: "application/json",
        }),
      });
      const response = this.parseJSONResponse<AltchaSolutionResponse>(xhr);
      if (response.success) {
        ztoolkit.log(
          `scihub: solved ALTCHA challenge "${challengeURL.href}" in ${solution.took} ms`,
        );
        return true;
      }
    } catch (error) {
      ztoolkit.log(
        `scihub: ALTCHA challenge failed "${challengeURL.href}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return false;
  }

  private static extractAltchaChallengeURL(
    doc: Document | null | undefined,
    baseURL: string,
  ) {
    if (!doc) {
      return undefined;
    }

    const candidates: string[] = [];
    const widgets = Array.from(
      doc.querySelectorAll("altcha-widget"),
    ) as Element[];
    for (const widget of widgets) {
      const challengeURL =
        widget.getAttribute("challengeurl") ??
        widget.getAttribute("challenge-url");
      if (challengeURL) {
        candidates.push(challengeURL);
      }
    }

    const html = String(doc.documentElement?.innerHTML ?? "");
    for (const match of html.matchAll(
      /(?:https?:\/\/[^"'`\s<>]+)?\/captcha\/challenge\/\d+/gi,
    )) {
      candidates.push(match[0]);
    }

    for (const candidate of candidates) {
      try {
        return new URL(candidate, baseURL);
      } catch {
        // skip malformed challenge URLs
      }
    }
    return undefined;
  }

  private static async requestAltchaChallenge(
    challengeURL: URL,
    extraHeaders: Record<string, string> = {},
  ): Promise<AltchaChallenge> {
    const xhr = await Zotero.HTTP.request("GET", challengeURL.href, {
      responseType: "json",
      headers: this.requestHeaders({
        ...extraHeaders,
        Accept: "application/json",
      }),
    });
    const challenge = this.parseJSONResponse<AltchaChallenge>(xhr);
    if (
      !challenge?.algorithm ||
      !challenge.challenge ||
      !Number.isFinite(Number(challenge.maxNumber)) ||
      !challenge.salt ||
      !challenge.signature
    ) {
      throw new Error("Invalid ALTCHA challenge payload");
    }
    return {
      ...challenge,
      maxNumber: Number(challenge.maxNumber),
    };
  }

  private static solveAltchaChallenge(
    challenge: AltchaChallenge,
  ): AltchaSolution | undefined {
    if (challenge.algorithm.toUpperCase() !== "SHA-256") {
      return undefined;
    }

    const startedAt = Date.now();
    const targetHash = challenge.challenge.toLowerCase();
    for (let number = 0; number <= challenge.maxNumber; number++) {
      if (this.sha256Hex(`${challenge.salt}${number}`) === targetHash) {
        return {
          algorithm: challenge.algorithm,
          challenge: challenge.challenge,
          number,
          salt: challenge.salt,
          signature: challenge.signature,
          took: Date.now() - startedAt,
        };
      }
    }
    return undefined;
  }

  private static encodeAltchaSolution(solution: AltchaSolution) {
    return btoa(JSON.stringify(solution));
  }

  private static parseJSONResponse<T>(xhr: XMLHttpRequest): T {
    if (xhr.response && typeof xhr.response !== "string") {
      return xhr.response as T;
    }
    return JSON.parse(String(xhr.response || xhr.responseText)) as T;
  }

  private static sha256Hex(message: string) {
    const bytes: number[] = [];
    for (let index = 0; index < message.length; index++) {
      bytes.push(message.charCodeAt(index) & 0xff);
    }

    const bitLength = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) {
      bytes.push(0);
    }

    const bitLengthHigh = Math.floor(bitLength / 0x100000000);
    const bitLengthLow = bitLength >>> 0;
    for (let shift = 24; shift >= 0; shift -= 8) {
      bytes.push((bitLengthHigh >>> shift) & 0xff);
    }
    for (let shift = 24; shift >= 0; shift -= 8) {
      bytes.push((bitLengthLow >>> shift) & 0xff);
    }

    const hash = [...this.sha256InitialHash];
    const words = new Array<number>(64);
    for (let offset = 0; offset < bytes.length; offset += 64) {
      for (let index = 0; index < 16; index++) {
        const wordOffset = offset + index * 4;
        words[index] =
          ((bytes[wordOffset] << 24) |
            (bytes[wordOffset + 1] << 16) |
            (bytes[wordOffset + 2] << 8) |
            bytes[wordOffset + 3]) >>>
          0;
      }
      for (let index = 16; index < 64; index++) {
        const s0 =
          this.rotateRight(words[index - 15], 7) ^
          this.rotateRight(words[index - 15], 18) ^
          (words[index - 15] >>> 3);
        const s1 =
          this.rotateRight(words[index - 2], 17) ^
          this.rotateRight(words[index - 2], 19) ^
          (words[index - 2] >>> 10);
        words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
      }

      let a = hash[0];
      let b = hash[1];
      let c = hash[2];
      let d = hash[3];
      let e = hash[4];
      let f = hash[5];
      let g = hash[6];
      let h = hash[7];

      for (let index = 0; index < 64; index++) {
        const s1 =
          this.rotateRight(e, 6) ^
          this.rotateRight(e, 11) ^
          this.rotateRight(e, 25);
        const ch = (e & f) ^ (~e & g);
        const temp1 = (h + s1 + ch + this.sha256K[index] + words[index]) >>> 0;
        const s0 =
          this.rotateRight(a, 2) ^
          this.rotateRight(a, 13) ^
          this.rotateRight(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (s0 + maj) >>> 0;

        h = g;
        g = f;
        f = e;
        e = (d + temp1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (temp1 + temp2) >>> 0;
      }

      hash[0] = (hash[0] + a) >>> 0;
      hash[1] = (hash[1] + b) >>> 0;
      hash[2] = (hash[2] + c) >>> 0;
      hash[3] = (hash[3] + d) >>> 0;
      hash[4] = (hash[4] + e) >>> 0;
      hash[5] = (hash[5] + f) >>> 0;
      hash[6] = (hash[6] + g) >>> 0;
      hash[7] = (hash[7] + h) >>> 0;
    }

    return hash.map((value) => value.toString(16).padStart(8, "0")).join("");
  }

  private static rotateRight(value: number, bits: number) {
    return (value >>> bits) | (value << (32 - bits));
  }

  private static extractPDFURL(
    doc: Document | null | undefined,
    baseURL: string,
  ) {
    const selectors = [
      {
        selector: "object[type='application/pdf']",
        attribute: "data",
      },
      {
        selector: 'meta[name="citation_pdf_url"]',
        attribute: "content",
      },
      {
        selector: "#pdf",
        attribute: "src",
      },
      {
        selector: "iframe[src*='.pdf']",
        attribute: "src",
      },
      {
        selector: "embed[src*='.pdf']",
        attribute: "src",
      },
      {
        selector: "a[href*='.pdf']",
        attribute: "href",
      },
    ];
    for (const { selector, attribute } of selectors) {
      const rawPDFUrl = doc?.querySelector(selector)?.getAttribute(attribute);
      if (!rawPDFUrl) {
        continue;
      }
      const pdfUrl = new URL(rawPDFUrl.split("#")[0], baseURL);
      pdfUrl.protocol = "https:";
      return pdfUrl;
    }

    const scriptElements: HTMLScriptElement[] = doc
      ? Array.from(
          doc.querySelectorAll("script") as NodeListOf<HTMLScriptElement>,
        )
      : [];
    const scriptText = scriptElements
      .map((script) => script.textContent ?? "")
      .join("\n")
      .replace(/\\\//g, "/");
    const scriptPDFUrl = scriptText.match(
      /(?:https?:)?\/\/[^"'`\s<>]+\.pdf(?:[?#][^"'`\s<>]+)?|\/(?:storage|pdf)\/[^"'`\s<>]+\.pdf(?:[?#][^"'`\s<>]+)?/i,
    )?.[0];
    if (scriptPDFUrl) {
      const pdfUrl = new URL(scriptPDFUrl.split("#")[0], baseURL);
      pdfUrl.protocol = "https:";
      return pdfUrl;
    }

    return undefined;
  }

  private static responseSummary(xhr: XMLHttpRequest) {
    const statusText = xhr.statusText ? ` ${xhr.statusText}` : "";
    const title = this.responseTitle(xhr.responseXML);
    const snippet =
      this.responseSnippet(xhr.responseXML) || this.responseTextSnippet(xhr);
    return [
      `HTTP ${xhr.status}${statusText}`,
      title ? `title=${title}` : undefined,
      snippet ? `body=${snippet}` : undefined,
    ]
      .filter(Boolean)
      .join("; ");
  }

  private static responseTitle(doc: Document | null | undefined) {
    return this.compactText(doc?.querySelector("title")?.textContent).slice(
      0,
      200,
    );
  }

  private static responseSnippet(doc: Document | null | undefined) {
    const bodyText = this.compactText(doc?.querySelector("body")?.textContent);
    return bodyText.slice(0, 500);
  }

  private static responseTextSnippet(xhr: XMLHttpRequest) {
    return this.compactText(this.responseText(xhr)).slice(0, 500);
  }

  private static responseText(xhr: XMLHttpRequest) {
    try {
      if (xhr.responseText) {
        return xhr.responseText;
      }
    } catch {
      // responseText is unavailable for some responseType values.
    }
    if (typeof xhr.response === "string") {
      return xhr.response;
    }
    if (xhr.response) {
      try {
        return JSON.stringify(xhr.response);
      } catch {
        return String(xhr.response);
      }
    }
    return "";
  }

  private static compactText(text: string | null | undefined) {
    return (text ?? "").replace(/\s+/g, " ").trim();
  }

  private static formatError(error: unknown) {
    if (error instanceof Error) {
      const message = error.message || error.name;
      if (error.stack) {
        return message && !error.stack.includes(message)
          ? `${message}\n${error.stack}`
          : error.stack;
      }
      return message;
    }
    if (typeof error === "string") {
      return error;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  private static pdfNotAvailable(body?: Element | null): boolean {
    const text = [
      this.compactText(body?.textContent),
      (body as HTMLElement | null | undefined)?.innerHTML ?? "",
    ].join("\n");
    if (!text.trim()) {
      return false;
    }
    return this.pdfNotAvailableRegexes.some((regex) => regex.test(text));
  }

  private static sciHubHTMLWithoutPDF(xhr: XMLHttpRequest): boolean {
    const doc = xhr.responseXML;
    const title = this.responseTitle(doc);
    const bodyText = this.compactText(doc?.querySelector("body")?.textContent);
    const rawText = this.responseText(xhr);
    const text = `${title}\n${bodyText}\n${rawText}`;
    const contentType = xhr.getResponseHeader("content-type") ?? "";

    if (!text.trim() && !doc) {
      return false;
    }

    if (
      this.pdfNotAvailable(doc?.querySelector("body")) ||
      this.pdfNotAvailableRegexes.some((regex) => regex.test(text)) ||
      /article\s+is\s+not\s+available\s+through\s+sci-?hub|(?:article|paper|document|PDF)\s+(?:not\s+found|not\s+available|unavailable)|(?:not\s+found|not\s+available|unavailable).*?(?:article|paper|document|PDF)|could\s+not\s+find|no\s+(?:article|paper|document|PDF)\s+(?:found|available)/i.test(
        text,
      )
    ) {
      return true;
    }

    // Anti-bot or access-control pages are operational errors, not a true PDF-not-found decision.
    if (
      /captcha|altcha|robot|human|cloudflare|turnstile|ddos-guard|forbidden|blocked|verify|verification|challenge|access denied|too many requests|rate limit/i.test(
        text,
      )
    ) {
      return false;
    }

    const looksHTML =
      /html|text\/plain|xml/i.test(contentType) ||
      Boolean(doc?.querySelector("html, body")) ||
      /<!doctype html|<html|<body|self\.__next_f|__NEXT_DATA__/i.test(rawText);
    if (!looksHTML) {
      return false;
    }

    if (xhr.status === 404) {
      return true;
    }

    return (
      xhr.status === 200 &&
      /(sci-?hub|scihub|Academic Paper|free access to research papers|ScienceDirect|首页|主页|科研论文|论文求助|网站地图|Loading|not found|not available|no pdf|article unavailable|could not find|unavailable)/i.test(
        text,
      )
    );
  }

  private static sciHubLandingWithoutPDF(xhr: XMLHttpRequest): boolean {
    const title = this.responseTitle(xhr.responseXML);
    const bodyText = this.compactText(
      xhr.responseXML?.querySelector("body")?.textContent,
    );
    const bodyHTML =
      xhr.responseXML?.querySelector("body")?.innerHTML ??
      this.responseText(xhr);
    const text = `${title}\n${bodyText}\n${bodyHTML}`;
    if (!text.trim()) {
      return false;
    }

    if (
      this.pdfNotAvailable(xhr.responseXML?.querySelector("body")) ||
      this.pdfNotAvailableRegexes.some((regex) => regex.test(text)) ||
      /article\s+is\s+not\s+available\s+through\s+sci-?hub|(?:article|paper|document|PDF)\s+(?:not\s+found|not\s+available|unavailable)|(?:not\s+found|not\s+available|unavailable).*?(?:article|paper|document|PDF)|could\s+not\s+find|no\s+(?:article|paper|document|PDF)\s+(?:found|available)/i.test(
        text,
      )
    ) {
      return true;
    }

    // Do not hide real anti-bot/network failures. These should still be surfaced as errors.
    if (
      /captcha|altcha|robot|human|cloudflare|turnstile|ddos-guard|forbidden|blocked|verify|verification|challenge/i.test(
        text,
      )
    ) {
      return false;
    }

    return (
      /sci-?hub/i.test(title) &&
      /(Academic Paper|首页|主页|科研论文|论文求助|网站地图|ScienceDirect|free access to research papers|Loading)/i.test(
        text,
      )
    );
  }
}
