import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { SciHubFetcher } from "./SciHubFetcher";

export class Common {
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
    const menuIcon = `chrome://${config.addonRef}/content/icons/sci-hub-logo.svg`;
    ztoolkit.Menu.register("item", {
      tag: "menuitem",
      id: "zotero-itemmenu-scihub-fetch",
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
}
