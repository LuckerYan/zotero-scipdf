import { getString } from "../utils/locale";
import { Utils } from "../utils/utils";
import { CustomResolverManager } from "./CustomResolverManager";

class PDFNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfNotFoundError";
    Object.setPrototypeOf(this, PDFNotFoundError.prototype);
  }
}

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

export class SciHubFetcher {
  private static readonly pdfNotAvailableRegexes = [
    /Please try to search again using DOI/im,
    /статья не найдена в базе/im,
    /未找到与您的请求匹配的文章/im,
    /未找到.*(?:文章|论文|文献|PDF)/im,
    /(?:article|paper|document|PDF)\s+(?:not\s+found|not\s+available|unavailable)/im,
    /(?:not\s+found|not\s+available|unavailable).*?(?:article|paper|document|PDF)/im,
    /could\s+not\s+find/im,
    /no\s+(?:article|paper|document|PDF)\s+(?:found|available)/im,
  ];

  private static readonly mobileUserAgent =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 11_3_1 like Mac OS X) AppleWebKit/603.1.30 (KHTML, like Gecko) Version/10.0 Mobile/14E304 Safari/602.1";

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
    for (const item of items) {
      if (!item.isRegularItem()) {
        continue;
      }
      if (!skipIfExistPDF) {
        filtered.push(item);
        continue;
      }
      const attachment = await item.getBestAttachment();
      if (!attachment || !attachment.isPDFAttachment()) {
        filtered.push(item);
      }
    }

    if (filtered.length <= 0) {
      return;
    }

    for (const item of filtered) {
      const scihubUrls = await this.buildSciHubURLs(item);
      if (scihubUrls.length <= 0) {
        Utils.showPopWin(
          getString("popwin-doimissing"),
          item.getDisplayTitle(),
          "fail",
        );
        ztoolkit.log(`DOI Not Found for "${item.getField("title")}"`);
        continue;
      }

      const win = Utils.showPopWin(
        getString("popwin-fetching"),
        item.getDisplayTitle(),
      );

      let success = false;
      let notFoundError: PDFNotFoundError | undefined;
      const errors: unknown[] = [];
      for (const scihubUrl of scihubUrls) {
        try {
          await this.fetchPDF(scihubUrl, item);
          success = true;
          break;
        } catch (error) {
          errors.push(error);
          if (error instanceof PDFNotFoundError) {
            notFoundError ??= error;
          }
        }
      }
      win.close();

      if (success) {
        Utils.showPopWin(
          getString("popwin-fetchsuccess"),
          item.getDisplayTitle(),
          "success",
        );
      } else if (notFoundError) {
        ztoolkit.log(
          `scihub: PDF not found for "${item.getDisplayTitle()}": ${notFoundError.message}`,
        );
        Utils.showPopWin(
          getString("popwin-pdfnotavaliable"),
          item.getDisplayTitle(),
          "fail",
          5000,
        );
      } else {
        const message = errors.length
          ? errors.map((error) => this.formatError(error)).join("\n\n")
          : `No Sci-Hub resolver succeeded for "${item.getDisplayTitle()}"`;
        ztoolkit.log(
          `scihub: failed to fetch PDF for "${item.getDisplayTitle()}":\n${message}`,
        );
        Utils.showPopWin(
          getString("popwin-unknownerror"),
          message,
          "fail",
          15000,
        );
      }
    }
  }

  private static async buildSciHubURLs(item: Zotero.Item): Promise<URL[]> {
    const dois = await Utils.extractDOIs(item);
    const baseURLs = this.baseSciHubURLs;
    const urls: URL[] = [];
    for (const doi of dois) {
      for (const base of baseURLs) {
        try {
          urls.push(new URL(doi, base));
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
            "https://sci-hub.ee/",
            "https://sci-hub.world/",
          ];
    return Array.from(new Set(urls));
  }

  private static async fetchPDF(scihubUrl: URL, item: Zotero.Item) {
    let xhr = await this.fetchSciHubDocument(scihubUrl);
    let pdfUrl = this.extractPDFURL(xhr.responseXML, scihubUrl.href);
    let body = xhr.responseXML?.querySelector("body");

    if (xhr.status === 200 && !pdfUrl) {
      const solved = await this.solveAltchaChallengeIfPresent(
        xhr.responseXML,
        scihubUrl.href,
      );
      if (solved) {
        xhr = await this.fetchSciHubDocument(scihubUrl);
        pdfUrl = this.extractPDFURL(xhr.responseXML, scihubUrl.href);
        body = xhr.responseXML?.querySelector("body");
      }
    }

    if (xhr.status === 200 && pdfUrl) {
      await Utils.attachRemotePDF(pdfUrl, item);
      return;
    }

    if (
      (xhr.status === 200 || xhr.status === 404) &&
      this.pdfNotAvailable(body)
    ) {
      const message = `PDF not found at ${scihubUrl.href}: ${this.responseSummary(xhr)}`;
      ztoolkit.log(`scihub: ${message}`);
      throw new PDFNotFoundError(message);
    }

    const message = `Failed to fetch PDF from ${scihubUrl.href}: ${this.responseSummary(xhr)}`;
    ztoolkit.log(`scihub: ${message}`);
    throw new Error(message);
  }

  private static async fetchSciHubDocument(scihubUrl: URL) {
    return await Zotero.HTTP.request("GET", scihubUrl.href, {
      responseType: "document",
      headers: this.requestHeaders(),
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
      const challenge = await this.requestAltchaChallenge(challengeURL);
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
  ): Promise<AltchaChallenge> {
    const xhr = await Zotero.HTTP.request("GET", challengeURL.href, {
      responseType: "json",
      headers: this.requestHeaders({
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
    const snippet = this.responseSnippet(xhr.responseXML);
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

  private static compactText(text: string | null | undefined) {
    return (text ?? "").replace(/\s+/g, " ").trim();
  }

  private static formatError(error: unknown) {
    if (error instanceof Error) {
      return error.stack || error.message || error.name;
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
}
