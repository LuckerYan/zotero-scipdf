import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { SciHubFetcher } from "./SciHubFetcher";

export class Common {
  private static readonly fetchMenuItemID = "zotero-itemmenu-scihub-fetch";

  static async registerPrefs() {
    const prefOptions = {
      pluginID: config.addonID,
      id: `zotero-prefpane-${config.addonRef}`,
      src: "content/preferences.xhtml",
      label: getString("prefs-title"),
      image: "content/icons/sci-hub-logo.svg",
    };
    const preferencePanes = ztoolkit.getGlobal("Zotero").PreferencePanes;
    try {
      await preferencePanes.register(prefOptions);
    } catch (error) {
      if (String(error).includes("already registered")) {
        ztoolkit.log(`Preference pane ${prefOptions.id} already registered`);
        return;
      }
      throw error;
    }
  }

  static registerRightClickMenuItem() {
    this.removeExistingRightClickMenuItems();

    const menuIcon = `chrome://${config.addonRef}/content/icons/sci-hub-logo.svg`;
    ztoolkit.Menu.register("item", {
      tag: "menuitem",
      id: this.fetchMenuItemID,
      label: getString("menuitem-fetch"),
      isHidden: () => {
        const items = Zotero.getActiveZoteroPane().getSelectedItems();
        return !items.some((item) => item.isRegularItem());
      },
      commandListener: () => {
        const zoteroPane = Zotero.getActiveZoteroPane();
        SciHubFetcher.updateItems(zoteroPane.getSelectedItems(), false);
      },
      icon: menuIcon,
    });
  }

  private static removeExistingRightClickMenuItems() {
    const windows = Zotero.getMainWindows?.() ?? [];
    const currentWindow = Zotero.getMainWindow?.();
    if (currentWindow && !windows.includes(currentWindow)) {
      windows.push(currentWindow);
    }

    for (const win of windows) {
      try {
        const staleItems = win.document.querySelectorAll(
          `[id="${this.fetchMenuItemID}"]`,
        );
        staleItems.forEach((item: Element) => item.remove());
        if (staleItems.length > 0) {
          ztoolkit.log(
            `Removed ${staleItems.length} stale Sci-PDF context menu item(s)`,
          );
        }
      } catch (error) {
        ztoolkit.log(
          `Failed to remove stale Sci-PDF context menu item(s): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}
