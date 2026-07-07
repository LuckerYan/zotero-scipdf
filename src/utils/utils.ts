import { matchDOIs } from "./identifierPatterns";

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
    type?: "fail" | "success" | "warning" | "default",
    closeTime: number = 3000,
    fullMessage?: string,
  ) {
    const displayMessage = fullMessage
      ? this.truncatePopupMessage(message)
      : message;
    const win = new ztoolkit.ProgressWindow(title, {
      closeOnClick: !fullMessage,
      closeTime: closeTime,
    }).createLine({
      text: displayMessage,
      type: type,
      progress: 0,
    });
    win.show(closeTime);
    this.decoratePopWin(win, title, type ?? "default", fullMessage);
    return win;
  }

  private static truncatePopupMessage(message: string) {
    const compact = message.replace(/\s+/g, " ").trim();
    return compact.length > 96 ? `${compact.slice(0, 93)}...` : compact;
  }

  private static decoratePopWin(
    win: unknown,
    title: string,
    type: "fail" | "success" | "warning" | "default",
    fullMessage?: string,
  ) {
    type ProgressLine = {
      _hbox?: HTMLElement;
      _itemText?: HTMLElement;
    };
    type ProgressWindowWithLines = {
      lines?: ProgressLine[];
      win?: Record<string, unknown>;
    };

    const themes: Record<
      typeof type,
      { background: string; border: string; color: string }
    > = {
      default: {
        background: "#eef6ff",
        border: "#3b82f6",
        color: "#1e3a8a",
      },
      fail: {
        background: "#fff1f2",
        border: "#dc2626",
        color: "#7f1d1d",
      },
      success: {
        background: "#eefaf1",
        border: "#16a34a",
        color: "#14532d",
      },
      warning: {
        background: "#fff8e1",
        border: "#f59e0b",
        color: "#713f12",
      },
    };

    setTimeout(() => {
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

          headlineBox.style.boxSizing = "border-box";
          headlineBox.style.margin = "0 0 4px 0";
          headlineBox.style.padding = "6px 10px";
          headlineBox.style.borderLeft = `4px solid ${theme.border}`;
          headlineBox.style.borderRadius = "6px";
          headlineBox.style.backgroundColor = theme.background;
          headlineBox.style.color = theme.color;
          headlineBox.style.fontWeight = "600";
          headlineBox.style.overflow = "hidden";

          if (headline !== headlineBox) {
            headline.style.color = theme.color;
            headline.style.fontWeight = "600";
          }
        }

        hbox.style.position = "relative";
        hbox.style.boxSizing = "border-box";
        hbox.style.alignItems = "flex-start";
        hbox.style.minHeight = fullMessage ? "32px" : "28px";
        hbox.style.maxHeight = "40px";
        hbox.style.maxWidth = "520px";
        hbox.style.margin = "0";
        hbox.style.padding = fullMessage ? "4px 82px 4px 12px" : "4px 12px";
        hbox.style.borderLeft = "0";
        hbox.style.borderRadius = "0";
        hbox.style.backgroundColor = "transparent";
        hbox.style.overflow = "hidden";

        let ancestor = hbox.parentElement as HTMLElement | null;
        for (let depth = 0; ancestor && depth < 3; depth += 1) {
          ancestor.style.minHeight = "0";
          ancestor.style.height = "auto";
          ancestor.style.maxHeight = "96px";
          ancestor.style.overflow = "hidden";
          ancestor = ancestor.parentElement as HTMLElement | null;
        }

        if (text) {
          text.style.display = "block";
          text.style.maxWidth = fullMessage ? "390px" : "470px";
          text.style.whiteSpace = "nowrap";
          text.style.overflow = "hidden";
          text.style.textOverflow = "ellipsis";
          text.style.lineHeight = "18px";
          text.style.maxHeight = "18px";
          text.style.color = "#6b7280";
        }

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
        button.style.right = "10px";
        button.style.bottom = "5px";
        button.style.minHeight = "20px";
        button.style.maxHeight = "22px";
        button.style.minWidth = "54px";
        button.style.padding = "0 8px";
        button.style.margin = "0";
        button.style.fontSize = "12px";

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
    }, 100);
  }
}
