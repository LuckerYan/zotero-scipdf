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
    type?: "fail" | "success" | "default",
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
    if (fullMessage) {
      this.attachCopyButtonToPopWin(win, fullMessage);
    }
    return win;
  }

  private static truncatePopupMessage(message: string) {
    const compact = message.replace(/\s+/g, " ").trim();
    return compact.length > 180 ? `${compact.slice(0, 177)}...` : compact;
  }

  private static attachCopyButtonToPopWin(win: unknown, fullMessage: string) {
    type ProgressLine = {
      _hbox?: HTMLElement;
      _itemText?: HTMLElement;
    };
    type ProgressWindowWithLines = {
      lines?: ProgressLine[];
    };

    setTimeout(() => {
      try {
        const line = (win as ProgressWindowWithLines).lines?.[0];
        const hbox = line?._hbox;
        const text = line?._itemText;
        const doc = hbox?.ownerDocument;
        if (!hbox || !doc) {
          return;
        }

        if (text) {
          text.style.maxWidth = "520px";
          text.style.whiteSpace = "nowrap";
          text.style.overflow = "hidden";
          text.style.textOverflow = "ellipsis";
        }
        hbox.style.alignItems = "center";
        hbox.style.maxWidth = "640px";

        const xulDoc = doc as Document & {
          createXULElement?: (tagName: string) => HTMLElement;
        };
        const button = (
          xulDoc.createXULElement
            ? xulDoc.createXULElement("button")
            : doc.createElement("button")
        ) as HTMLElement;
        button.setAttribute("label", "复制");
        button.setAttribute("tooltiptext", "复制完整错误信息");
        button.textContent = button.textContent || "复制";
        button.style.marginLeft = "8px";
        button.style.minHeight = "20px";
        button.style.maxHeight = "24px";
        button.style.padding = "0 8px";
        button.addEventListener("click", (event: Event) => {
          event.preventDefault();
          event.stopPropagation();
          Zotero.Utilities.Internal.copyTextToClipboard(fullMessage);
          button.setAttribute("label", "已复制");
          button.textContent = "已复制";
        });
        button.addEventListener("command", (event: Event) => {
          event.preventDefault();
          event.stopPropagation();
          Zotero.Utilities.Internal.copyTextToClipboard(fullMessage);
          button.setAttribute("label", "已复制");
          button.textContent = "已复制";
        });
        hbox.appendChild(button);
      } catch (error) {
        ztoolkit.log(
          `Failed to attach popup copy button: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }, 100);
  }
}
