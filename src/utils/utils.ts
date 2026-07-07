import { matchDOIs } from "./identifierPatterns";

type PopWinType = "fail" | "success" | "warning" | "default";

interface ProgressPopupOptions {
  type?: PopWinType;
  closeTime?: number;
  progress?: number;
}

interface ProgressUpdateOptions {
  type?: PopWinType;
}

export interface ProgressPopupHandle {
  update(
    message: string,
    progress: number,
    options?: ProgressUpdateOptions,
  ): void;
  startCloseTimer(ms: number, requireMouseOver?: boolean): void;
  close(): void;
}

interface ProgressDecorOptions {
  progressMode?: boolean;
}

export class Utils {
  static async extractDOIs(item: Zotero.Item): Promise<string[]> {
    const dois: string[] = [];

    const extract = (text: string) => {
      for (const doi of matchDOIs(text)) {
        if (!dois.includes(doi)) {
          dois.push(doi);
        }
      }
    };

    const extractFromItem = (it: Zotero.Item) => {
      for (const field of ["DOI", "url", "title", "extra"] as const) {
        const value = it.getField(field);
        if (value && typeof value === "string") {
          extract(value);
        }
      }
    };

    extractFromItem(item);
    for (const attachment of await item.getBestAttachments()) {
      extractFromItem(attachment);
    }
    return dois;
  }

  static async attachRemotePDF(pdfURL: URL, item: Zotero.Item) {
    const filename = pdfURL.pathname.split("/").pop() || null;
    const importOptions = {
      libraryID: item.libraryID,
      url: pdfURL.href,
      parentItemID: item.id,
      title: item.getField("title"),
      fileBaseName: filename,
      contentType: "application/pdf",
      referrer: "",
      cookieSandbox: null,
    };
    ztoolkit.log(
      `Import Options: ${JSON.stringify(importOptions, null, "\t")}`,
    );
    await Zotero.Attachments.importFromURL(importOptions);
  }

  static showPopWin(
    title: string,
    message: string,
    type?: PopWinType,
    closeTime: number = 3000,
    fullMessage?: string,
  ) {
    const popupType = type ?? "default";
    const displayMessage = fullMessage
      ? this.truncatePopupMessage(message)
      : message;
    const card = this.createNotificationCard(
      title,
      displayMessage,
      popupType,
      closeTime,
      fullMessage,
    );
    if (card) {
      return card;
    }

    const win = new ztoolkit.ProgressWindow(title, {
      closeOnClick: !fullMessage,
      closeTime: closeTime,
    }).createLine({
      text: displayMessage,
      type: popupType,
      progress: popupType === "success" ? 100 : 0,
    });
    win.show(closeTime);
    this.decoratePopWin(win, title, popupType, fullMessage);
    this.forceClosePopWin(win, closeTime);
    return win;
  }

  static showProgressPopWin(
    title: string,
    message: string,
    options: ProgressPopupOptions = {},
  ): ProgressPopupHandle {
    let currentType = options.type ?? "default";
    let currentProgress = this.clampProgress(options.progress ?? 0);
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    const card = this.createProgressCard(
      title,
      this.truncatePopupMessage(message, 132),
      currentProgress,
    );

    const updateCard = (status: string, progress: number) => {
      if (!card) {
        return;
      }
      const clampedProgress = this.clampProgress(progress);
      card.status.textContent = this.truncatePopupMessage(status, 132);
      card.fill.style.width = `${clampedProgress}%`;
      card.root.setAttribute("data-progress", String(clampedProgress));
    };

    const closeCard = () => {
      if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = undefined;
      }
      card?.root.remove();
    };

    updateCard(message, currentProgress);

    return {
      update: (message, progress, updateOptions = {}) => {
        currentType = updateOptions.type ?? currentType;
        currentProgress = this.clampProgress(progress);
        updateCard(message, currentProgress);
      },
      startCloseTimer: (ms) => {
        if (!Number.isFinite(ms) || ms <= 0) {
          return;
        }
        if (closeTimer) {
          clearTimeout(closeTimer);
        }
        closeTimer = setTimeout(closeCard, ms);
      },
      close: closeCard,
    };
  }

  private static createProgressCard(
    title: string,
    status: string,
    progress: number,
  ) {
    try {
      Zotero.ProgressWindowSet?.closeAll?.();
    } catch (error) {
      ztoolkit.log(
        `Failed to close native progress windows before showing custom progress card: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    try {
      const mainWindows = Zotero.getMainWindows?.() ?? [];
      const win = Zotero.getMainWindow?.() ?? mainWindows[0];
      const doc = win?.document;
      const host = doc?.body ?? doc?.documentElement;
      if (!doc || !host) {
        ztoolkit.log(
          "Cannot show custom progress card: main window not found.",
        );
        return undefined;
      }

      doc.getElementById("scipdf-fetch-progress-card")?.remove();

      const htmlNS = "http://www.w3.org/1999/xhtml";
      const create = <K extends keyof HTMLElementTagNameMap>(tagName: K) =>
        doc.createElementNS(htmlNS, tagName) as HTMLElementTagNameMap[K];

      const root = create("div");
      root.id = "scipdf-fetch-progress-card";
      root.setAttribute("data-progress", String(this.clampProgress(progress)));
      Object.assign(root.style, {
        position: "fixed",
        right: "16px",
        bottom: "18px",
        zIndex: "2147483647",
        width: "336px",
        boxSizing: "border-box",
        padding: "14px 16px 15px",
        border: "1px solid rgba(59, 130, 246, 0.22)",
        borderRadius: "16px",
        background: "linear-gradient(135deg, #fbfdff 0%, #f1f6ff 100%)",
        boxShadow: "0 14px 34px rgba(30, 41, 59, 0.18)",
        color: "#0f172a",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
        pointerEvents: "none",
        overflow: "hidden",
        transform: "translateZ(0)",
      } satisfies Partial<CSSStyleDeclaration>);

      const titleNode = create("div");
      titleNode.textContent = title;
      Object.assign(titleNode.style, {
        margin: "0 0 7px 0",
        color: "#0f172a",
        fontSize: "12px",
        lineHeight: "16px",
        fontWeight: "800",
        letterSpacing: ".01em",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      } satisfies Partial<CSSStyleDeclaration>);

      const statusNode = create("div");
      statusNode.textContent = this.truncatePopupMessage(status, 132);
      Object.assign(statusNode.style, {
        margin: "0 0 13px 0",
        color: "#0f172a",
        fontSize: "14px",
        lineHeight: "20px",
        fontWeight: "750",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      } satisfies Partial<CSSStyleDeclaration>);

      const progressRow = create("div");
      Object.assign(progressRow.style, {
        display: "grid",
        gridTemplateColumns: "56px 1fr",
        alignItems: "center",
        columnGap: "4px",
        width: "100%",
      } satisfies Partial<CSSStyleDeclaration>);

      const progressLabel = create("div");
      progressLabel.textContent = "检索进度";
      Object.assign(progressLabel.style, {
        color: "#2563eb",
        fontSize: "12px",
        lineHeight: "16px",
        fontWeight: "700",
        whiteSpace: "nowrap",
      } satisfies Partial<CSSStyleDeclaration>);

      const track = create("div");
      Object.assign(track.style, {
        position: "relative",
        height: "2px",
        minHeight: "2px",
        borderRadius: "999px",
        background: "rgba(37, 99, 235, 0.16)",
        overflow: "hidden",
      } satisfies Partial<CSSStyleDeclaration>);

      const fill = create("div");
      fill.setAttribute("data-scipdf-progress-fill", "true");
      Object.assign(fill.style, {
        position: "absolute",
        left: "0",
        top: "0",
        height: "100%",
        width: `${this.clampProgress(progress)}%`,
        borderRadius: "999px",
        background: "linear-gradient(90deg, #2563eb 0%, #60a5fa 100%)",
        transition: "width 160ms ease-out",
      } satisfies Partial<CSSStyleDeclaration>);

      track.appendChild(fill);
      progressRow.appendChild(progressLabel);
      progressRow.appendChild(track);
      root.appendChild(titleNode);
      root.appendChild(statusNode);
      root.appendChild(progressRow);
      host.appendChild(root);

      return {
        root,
        status: statusNode,
        fill,
      };
    } catch (error) {
      ztoolkit.log(
        `Failed to show custom progress card: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    }
  }

  private static createNotificationCard(
    title: string,
    message: string,
    type: PopWinType,
    closeTime: number,
    fullMessage?: string,
  ) {
    const themes: Record<
      PopWinType,
      {
        background: string;
        border: string;
        borderSoft: string;
        color: string;
        muted: string;
        rail: string;
        railSoft: string;
        shadow: string;
      }
    > = {
      default: {
        background: "linear-gradient(135deg, #fbfdff 0%, #f1f6ff 100%)",
        border: "#3b82f6",
        borderSoft: "rgba(59, 130, 246, 0.22)",
        color: "#0f172a",
        muted: "#334155",
        rail: "#2563eb",
        railSoft: "rgba(37, 99, 235, 0.16)",
        shadow: "0 14px 34px rgba(30, 41, 59, 0.18)",
      },
      success: {
        background: "linear-gradient(135deg, #fdfffe 0%, #f1fbf5 100%)",
        border: "#16a34a",
        borderSoft: "rgba(22, 163, 74, 0.22)",
        color: "#14532d",
        muted: "#334155",
        rail: "#16a34a",
        railSoft: "rgba(22, 163, 74, 0.16)",
        shadow: "0 14px 34px rgba(20, 83, 45, 0.14)",
      },
      warning: {
        background: "linear-gradient(135deg, #fffefd 0%, #fff8e8 100%)",
        border: "#f59e0b",
        borderSoft: "rgba(245, 158, 11, 0.24)",
        color: "#92400e",
        muted: "#334155",
        rail: "#f59e0b",
        railSoft: "rgba(245, 158, 11, 0.17)",
        shadow: "0 14px 34px rgba(113, 63, 18, 0.14)",
      },
      fail: {
        background: "linear-gradient(135deg, #fffefe 0%, #fff2f5 100%)",
        border: "#e11d48",
        borderSoft: "rgba(225, 29, 72, 0.22)",
        color: "#7f1d1d",
        muted: "#334155",
        rail: "#e11d48",
        railSoft: "rgba(225, 29, 72, 0.16)",
        shadow: "0 14px 34px rgba(127, 29, 29, 0.15)",
      },
    };

    try {
      const mainWindows = Zotero.getMainWindows?.() ?? [];
      const win = Zotero.getMainWindow?.() ?? mainWindows[0];
      const doc = win?.document;
      const host = doc?.body ?? doc?.documentElement;
      if (!doc || !host) {
        ztoolkit.log(
          "Cannot show custom notification card: main window not found.",
        );
        return undefined;
      }

      doc.getElementById("scipdf-result-card")?.remove();
      const htmlNS = "http://www.w3.org/1999/xhtml";
      const create = <K extends keyof HTMLElementTagNameMap>(tagName: K) =>
        doc.createElementNS(htmlNS, tagName) as HTMLElementTagNameMap[K];
      const theme = themes[type];
      let closeTimer: ReturnType<typeof setTimeout> | undefined;

      const root = create("div");
      root.id = "scipdf-result-card";
      Object.assign(root.style, {
        position: "fixed",
        right: "16px",
        bottom: "18px",
        zIndex: "2147483647",
        width: "336px",
        boxSizing: "border-box",
        padding: "14px 16px 15px",
        border: `1px solid ${theme.borderSoft}`,
        borderRadius: "16px",
        background: theme.background,
        boxShadow: theme.shadow,
        color: theme.color,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
        pointerEvents: fullMessage ? "auto" : "none",
        overflow: "hidden",
        transform: "translateZ(0)",
      } satisfies Partial<CSSStyleDeclaration>);

      const titleNode = create("div");
      titleNode.textContent = title;
      Object.assign(titleNode.style, {
        margin: "0 0 7px 0",
        color: theme.color,
        fontSize: "12px",
        lineHeight: "16px",
        fontWeight: "800",
        letterSpacing: ".01em",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      } satisfies Partial<CSSStyleDeclaration>);

      const messageNode = create("div");
      messageNode.textContent = this.truncatePopupMessage(message, 82);
      Object.assign(messageNode.style, {
        margin: "0 0 13px 0",
        color: theme.muted,
        fontSize: "14px",
        lineHeight: "20px",
        fontWeight: "720",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      } satisfies Partial<CSSStyleDeclaration>);

      const stateRow = create("div");
      Object.assign(stateRow.style, {
        display: "grid",
        gridTemplateColumns: fullMessage ? "56px 1fr 54px" : "56px 1fr",
        alignItems: "center",
        columnGap: "4px",
        width: "100%",
      } satisfies Partial<CSSStyleDeclaration>);

      const stateLabel = create("div");
      stateLabel.textContent = "状态";
      Object.assign(stateLabel.style, {
        color: theme.color,
        fontSize: "12px",
        lineHeight: "16px",
        fontWeight: "700",
        whiteSpace: "nowrap",
      } satisfies Partial<CSSStyleDeclaration>);

      const rail = create("div");
      Object.assign(rail.style, {
        position: "relative",
        height: "2px",
        minHeight: "2px",
        borderRadius: "999px",
        background: theme.railSoft,
        overflow: "hidden",
      } satisfies Partial<CSSStyleDeclaration>);

      const railFill = create("div");
      Object.assign(railFill.style, {
        position: "absolute",
        left: "0",
        top: "0",
        height: "100%",
        width: "100%",
        borderRadius: "999px",
        background: theme.rail,
      } satisfies Partial<CSSStyleDeclaration>);
      rail.appendChild(railFill);
      stateRow.appendChild(stateLabel);
      stateRow.appendChild(rail);

      if (fullMessage) {
        const copyButton = create("button");
        copyButton.textContent = "复制";
        copyButton.setAttribute("type", "button");
        Object.assign(copyButton.style, {
          height: "22px",
          minWidth: "52px",
          padding: "0 10px",
          border: `1px solid ${theme.borderSoft}`,
          borderRadius: "999px",
          background: "rgba(255, 255, 255, 0.76)",
          color: theme.color,
          fontSize: "12px",
          fontWeight: "700",
          cursor: "pointer",
        } satisfies Partial<CSSStyleDeclaration>);
        const copyFullMessage = (event: Event) => {
          event.preventDefault();
          event.stopPropagation();
          Zotero.Utilities.Internal.copyTextToClipboard(fullMessage);
          copyButton.textContent = "已复制";
        };
        copyButton.addEventListener("click", copyFullMessage);
        stateRow.appendChild(copyButton);
      }

      root.appendChild(titleNode);
      root.appendChild(messageNode);
      root.appendChild(stateRow);
      host.appendChild(root);

      const close = () => {
        if (closeTimer) {
          clearTimeout(closeTimer);
          closeTimer = undefined;
        }
        root.remove();
      };
      const startCloseTimer = (ms: number) => {
        if (!Number.isFinite(ms) || ms <= 0) {
          return;
        }
        if (closeTimer) {
          clearTimeout(closeTimer);
        }
        closeTimer = setTimeout(close, ms);
      };
      startCloseTimer(closeTime);

      return {
        close,
        startCloseTimer,
      };
    } catch (error) {
      ztoolkit.log(
        `Failed to show custom notification card: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    }
  }

  private static clampProgress(progress: number) {
    if (!Number.isFinite(progress)) {
      return 0;
    }
    return Math.min(100, Math.max(0, Math.round(progress)));
  }

  private static truncatePopupMessage(message: string, maxLength = 96) {
    const compact = message.replace(/\s+/g, " ").trim();
    return compact.length > maxLength
      ? `${compact.slice(0, Math.max(0, maxLength - 3))}...`
      : compact;
  }

  private static progressTextBar(progress: number) {
    const width = 28;
    const filled = Math.max(
      0,
      Math.min(width, Math.round((this.clampProgress(progress) / 100) * width)),
    );
    return `检索进度  ${"━".repeat(filled)}${"─".repeat(width - filled)}`;
  }

  private static forceClosePopWin(win: unknown, closeTime: number) {
    if (!Number.isFinite(closeTime) || closeTime <= 0) {
      return;
    }
    setTimeout(() => {
      try {
        const popup = win as {
          close?: () => unknown;
          win?: { close?: () => unknown };
        };
        if (popup.close) {
          popup.close();
        } else {
          popup.win?.close?.();
        }
      } catch (error) {
        ztoolkit.log(
          `Failed to close popup by fallback timer: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }, closeTime);
  }

  private static stabilizeProgressPopWin(win: unknown) {
    type ProgressLine = {
      _hbox?: HTMLElement;
      _image?: HTMLElement;
      _itemText?: HTMLElement;
    };
    type ProgressWindowWithLines = {
      lines?: ProgressLine[];
    };

    const popup = win as ProgressWindowWithLines;
    const statusLine = popup.lines?.[0];
    const progressLine = popup.lines?.[1];
    const fixedRowWidth = "344px";

    for (const line of [statusLine, progressLine]) {
      const image = line?._image;
      if (image) {
        image.style.display = "none";
        image.style.visibility = "hidden";
        image.style.width = "0";
        image.style.minWidth = "0";
        image.style.maxWidth = "0";
        image.style.margin = "0";
        image.style.padding = "0";
      }

      const hbox = line?._hbox;
      if (hbox) {
        hbox.style.width = fixedRowWidth;
        hbox.style.minWidth = fixedRowWidth;
        hbox.style.maxWidth = fixedRowWidth;
        hbox.style.boxSizing = "border-box";
        hbox.style.overflow = "hidden";
      }
    }

    const statusText = statusLine?._itemText;
    if (statusText) {
      statusText.style.width = fixedRowWidth;
      statusText.style.minWidth = fixedRowWidth;
      statusText.style.maxWidth = fixedRowWidth;
      statusText.style.whiteSpace = "nowrap";
      statusText.style.overflow = "hidden";
      statusText.style.textOverflow = "ellipsis";
    }

    const progressText = progressLine?._itemText;
    if (progressText) {
      progressText.style.width = fixedRowWidth;
      progressText.style.minWidth = fixedRowWidth;
      progressText.style.maxWidth = fixedRowWidth;
      progressText.style.whiteSpace = "nowrap";
      progressText.style.overflow = "hidden";
      progressText.style.textOverflow = "clip";
      progressText.style.fontFamily = 'Consolas, "Courier New", monospace';
    }
  }

  private static decoratePopWin(
    win: unknown,
    title: string,
    type: PopWinType,
    fullMessage?: string,
    progressOptions: ProgressDecorOptions = {},
  ) {
    type ProgressLine = {
      _hbox?: HTMLElement;
      _image?: HTMLElement;
      _itemText?: HTMLElement;
    };
    type ProgressWindowWithLines = {
      lines?: ProgressLine[];
      win?: Record<string, unknown>;
    };

    const themes: Record<
      PopWinType,
      {
        background: string;
        surface: string;
        border: string;
        borderSoft: string;
        color: string;
        muted: string;
        track: string;
        accent: string;
        accentTo: string;
        shadow: string;
      }
    > = {
      default: {
        background: "linear-gradient(135deg, #fbfdff 0%, #f1f6ff 100%)",
        surface: "#f8fbff",
        border: "#3b82f6",
        borderSoft: "rgba(59, 130, 246, 0.22)",
        color: "#0f172a",
        muted: "#26364d",
        track: "rgba(59, 130, 246, 0.16)",
        accent: "#2563eb",
        accentTo: "#60a5fa",
        shadow: "0 14px 34px rgba(30, 41, 59, 0.18)",
      },
      fail: {
        background: "linear-gradient(135deg, #fffefe 0%, #f9f3f5 100%)",
        surface: "#fff9fb",
        border: "#e11d48",
        borderSoft: "rgba(225, 29, 72, 0.2)",
        color: "#7f1d1d",
        muted: "#334155",
        track: "rgba(225, 29, 72, 0.15)",
        accent: "#e11d48",
        accentTo: "#fb7185",
        shadow: "0 14px 34px rgba(127, 29, 29, 0.15)",
      },
      success: {
        background: "linear-gradient(135deg, #fdfffe 0%, #f0f8f3 100%)",
        surface: "#f8fffb",
        border: "#16a34a",
        borderSoft: "rgba(22, 163, 74, 0.2)",
        color: "#14532d",
        muted: "#334155",
        track: "rgba(22, 163, 74, 0.15)",
        accent: "#16a34a",
        accentTo: "#4ade80",
        shadow: "0 14px 34px rgba(20, 83, 45, 0.14)",
      },
      warning: {
        background: "linear-gradient(135deg, #fffefd 0%, #f8f4ec 100%)",
        surface: "#fffdf8",
        border: "#f59e0b",
        borderSoft: "rgba(245, 158, 11, 0.22)",
        color: "#92400e",
        muted: "#334155",
        track: "rgba(217, 119, 6, 0.15)",
        accent: "#f59e0b",
        accentTo: "#fbbf24",
        shadow: "0 14px 34px rgba(113, 63, 18, 0.14)",
      },
    };

    const applyDecoration = () => {
      try {
        const popup = win as ProgressWindowWithLines;
        const line = popup.lines?.[0];
        const hbox = line?._hbox;
        const text = line?._itemText;
        const doc = hbox?.ownerDocument;
        if (!hbox || !doc) {
          return;
        }

        const theme = themes[type];
        const progressMode = Boolean(progressOptions.progressMode);
        const progressBox = doc.getElementById(
          "zotero-progress-text-box",
        ) as HTMLElement | null;
        if (progressBox) {
          const boxWidth = progressMode ? "376px" : "384px";
          progressBox.style.boxSizing = "border-box";
          progressBox.style.width = boxWidth;
          progressBox.style.minWidth = boxWidth;
          progressBox.style.maxWidth = boxWidth;
          progressBox.style.padding = progressMode
            ? "13px 16px 12px"
            : "12px 15px";
          progressBox.style.border = `1px solid ${theme.borderSoft}`;
          progressBox.style.borderRadius = "16px";
          progressBox.style.background = theme.background;
          progressBox.style.boxShadow = theme.shadow;
          progressBox.style.overflow = "hidden";
          progressBox.style.transform = "translateZ(0)";
        }
        const normalize = (value: string | null | undefined) =>
          (value ?? "").replace(/\s+/g, " ").trim();
        const hasStyle = (value: unknown): value is HTMLElement =>
          Boolean(value && typeof (value as HTMLElement).style === "object");
        const knownHeadlineKeys = [
          "_headline",
          "_headlineBox",
          "_headlineText",
          "_headlineLabel",
          "_headLine",
          "_headLineBox",
        ];
        const directHeadline = knownHeadlineKeys
          .map((key) => popup.win?.[key])
          .find(hasStyle);
        const queriedHeadline = (
          Array.from(doc.querySelectorAll("*")) as Element[]
        ).find((element) => {
          if (element === hbox || element.contains(hbox)) {
            return false;
          }
          if (hbox.contains(element)) {
            return false;
          }
          const elementTitle =
            normalize(element.getAttribute("value")) ||
            normalize(element.textContent);
          return elementTitle === title;
        }) as HTMLElement | undefined;
        const headline = directHeadline ?? queriedHeadline;

        if (headline) {
          let headlineBox = headline;
          const parent = headline.parentElement as HTMLElement | null;
          if (parent && !parent.contains(hbox) && parent.children.length <= 4) {
            headlineBox = parent;
          }

          headlineBox.style.display = "";
          headlineBox.style.boxSizing = "border-box";
          headlineBox.style.margin = progressMode ? "0 0 5px 0" : "0 0 4px 0";
          headlineBox.style.padding = "0";
          headlineBox.style.border = "0";
          headlineBox.style.borderRadius = "0";
          headlineBox.style.background = "transparent";
          headlineBox.style.color = theme.color;
          headlineBox.style.fontSize = "12px";
          headlineBox.style.fontWeight = "700";
          headlineBox.style.letterSpacing = ".01em";
          headlineBox.style.overflow = "hidden";
          if (headline !== headlineBox) {
            headline.style.display = "";
            headline.style.color = theme.color;
            headline.style.fontSize = "12px";
            headline.style.fontWeight = "700";
          }
        }

        const image = line?._image;
        if (image) {
          if (progressMode) {
            image.style.display = "none";
            image.style.visibility = "hidden";
            image.style.width = "0";
            image.style.minWidth = "0";
            image.style.maxWidth = "0";
            image.style.margin = "0";
            image.style.padding = "0";
          } else {
            image.style.display = "block";
            image.style.visibility = "visible";
            image.style.width = "9px";
            image.style.minWidth = "9px";
            image.style.maxWidth = "9px";
            image.style.height = "9px";
            image.style.minHeight = "9px";
            image.style.maxHeight = "9px";
            image.style.margin = "5px 10px 0 0";
            image.style.padding = "0";
            image.style.borderRadius = "999px";
            image.style.backgroundImage = "none";
            image.style.backgroundColor = theme.border;
            image.style.boxShadow = `0 0 0 4px ${theme.track}`;
          }
        }

        hbox.style.position = "relative";
        hbox.style.boxSizing = "border-box";
        hbox.style.alignItems = progressMode ? "flex-start" : "center";
        hbox.style.height = "auto";
        hbox.style.minHeight = progressMode
          ? "24px"
          : fullMessage
            ? "28px"
            : "22px";
        hbox.style.maxHeight = progressMode
          ? "32px"
          : fullMessage
            ? "36px"
            : "30px";
        hbox.style.width = progressMode ? "344px" : "354px";
        hbox.style.minWidth = progressMode ? "344px" : "354px";
        hbox.style.maxWidth = progressMode ? "344px" : "354px";
        hbox.style.margin = progressMode ? "0" : "0";
        hbox.style.padding = progressMode
          ? "0"
          : fullMessage
            ? "2px 86px 2px 0"
            : "0";
        hbox.style.border = "0";
        hbox.style.borderLeft = "0";
        hbox.style.borderRadius = "0";
        hbox.style.background = "transparent";
        hbox.style.boxShadow = "none";
        hbox.style.overflow = "hidden";

        let ancestor = hbox.parentElement as HTMLElement | null;
        for (let depth = 0; ancestor && depth < 3; depth += 1) {
          ancestor.style.minHeight = "0";
          ancestor.style.height = "auto";
          ancestor.style.maxHeight = progressMode ? "132px" : "112px";
          ancestor.style.overflow = "hidden";
          if (depth === 0) {
            ancestor.style.borderRadius = progressMode ? "14px" : "16px";
          }
          ancestor = ancestor.parentElement as HTMLElement | null;
        }

        if (text) {
          text.style.display = "block";
          const textWidth = progressMode
            ? "344px"
            : fullMessage
              ? "248px"
              : "318px";
          text.style.width = textWidth;
          text.style.minWidth = textWidth;
          text.style.maxWidth = textWidth;
          text.style.whiteSpace = "nowrap";
          text.style.overflow = "hidden";
          text.style.textOverflow = "ellipsis";
          text.style.lineHeight = progressMode ? "20px" : "18px";
          text.style.maxHeight = progressMode ? "20px" : "36px";
          text.style.color = progressMode ? "#0f172a" : theme.muted;
          text.style.fontSize = progressMode ? "14px" : "13px";
          text.style.fontWeight = progressMode ? "700" : "650";
        }

        const progressLine = popup.lines?.[1];
        const progressHbox = progressLine?._hbox;
        const progressImage = progressLine?._image;
        const progressText = progressLine?._itemText;
        if (progressHbox && progressText) {
          progressHbox.style.boxSizing = "border-box";
          progressHbox.style.alignItems = "center";
          progressHbox.style.width = "344px";
          progressHbox.style.minWidth = "344px";
          progressHbox.style.maxWidth = "344px";
          progressHbox.style.minHeight = "18px";
          progressHbox.style.maxHeight = "20px";
          progressHbox.style.margin = "8px 0 0 0";
          progressHbox.style.padding = "0";
          progressHbox.style.border = "0";
          progressHbox.style.borderRadius = "0";
          progressHbox.style.background = "transparent";
          progressHbox.style.boxShadow = "none";
          progressHbox.style.opacity = "1";
          progressHbox.style.overflow = "hidden";

          if (progressImage) {
            progressImage.style.display = "none";
          }

          progressText.style.display = "block";
          progressText.style.width = "344px";
          progressText.style.minWidth = "344px";
          progressText.style.maxWidth = "344px";
          progressText.style.whiteSpace = "nowrap";
          progressText.style.overflow = "hidden";
          progressText.style.textOverflow = "clip";
          progressText.style.color = theme.accent;
          progressText.style.fontSize = "12px";
          progressText.style.lineHeight = "17px";
          progressText.style.fontWeight = "700";
          progressText.style.fontFamily = 'Consolas, "Courier New", monospace';
          progressText.style.letterSpacing = "0";
          progressText.style.textShadow = "none";
        }

        if (progressMode) {
          return;
        }

        hbox
          .querySelectorAll('[data-scipdf-progress-ui="true"]')
          .forEach((node: Element) => node.remove());

        if (!fullMessage) {
          return;
        }

        const oldButton = hbox.querySelector(
          '[data-scipdf-copy-button="true"]',
        );
        oldButton?.remove();

        const xulDoc = doc as Document & {
          createXULElement?: (tagName: string) => HTMLElement;
        };
        const isXULButton = Boolean(xulDoc.createXULElement);
        const button = (
          isXULButton
            ? xulDoc.createXULElement?.("button")
            : doc.createElement("button")
        ) as HTMLElement;

        const setButtonText = (label: string) => {
          button.setAttribute("label", label);
          if (!isXULButton) {
            button.textContent = label;
          }
        };
        setButtonText("复制");
        button.setAttribute("data-scipdf-copy-button", "true");
        button.setAttribute("tooltiptext", "复制完整错误信息");
        button.style.position = "absolute";
        button.style.right = "12px";
        button.style.bottom = "8px";
        button.style.minHeight = "22px";
        button.style.maxHeight = "24px";
        button.style.minWidth = "58px";
        button.style.padding = "0 9px";
        button.style.margin = "0";
        button.style.border = `1px solid ${theme.borderSoft}`;
        button.style.borderRadius = "999px";
        button.style.background = theme.surface;
        button.style.color = theme.color;
        button.style.fontSize = "12px";
        button.style.fontWeight = "600";

        const copyFullMessage = (event: Event) => {
          event.preventDefault();
          event.stopPropagation();
          Zotero.Utilities.Internal.copyTextToClipboard(fullMessage);
          setButtonText("已复制");
        };
        button.addEventListener("click", copyFullMessage);
        button.addEventListener("command", copyFullMessage);
        hbox.appendChild(button);
      } catch (error) {
        ztoolkit.log(
          `Failed to decorate popup: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    };

    if (progressOptions.progressMode) {
      applyDecoration();
    } else {
      setTimeout(applyDecoration, 80);
    }
  }
}
