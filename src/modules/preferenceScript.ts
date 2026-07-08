import { config } from "../../package.json";
import { presetSciHubCustomResolvers } from "./CustomResolver";
import { CustomResolverManager } from "./CustomResolverManager";

export async function registerPrefsScripts(_window: Window) {
  // This function is called when the prefs window is opened
  // See addon/content/preferences.xhtml onpaneload
  if (!addon.data.prefs) {
    addon.data.prefs = {
      window: _window,
    };
  } else {
    addon.data.prefs.window = _window;
  }
  const autoDownloadCheckbox = _window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-autoDownload`,
  ) as HTMLInputElement | null;
  if (!autoDownloadCheckbox) {
    ztoolkit.log("Sci-PDF preference controls were not found");
    return;
  }

  const resolvers = CustomResolverManager.shared.customResolvers;
  autoDownloadCheckbox.checked =
    resolvers.length > 0 && resolvers[0].automatic !== false;

  const updateAutoDownload = () => {
    CustomResolverManager.shared.removeAllCustomResolversInZotero();
    CustomResolverManager.shared.appendCustomResolversInZotero(
      presetSciHubCustomResolvers(autoDownloadCheckbox.checked),
    );
  };

  autoDownloadCheckbox.addEventListener("change", () => {
    updateAutoDownload();
  });
}
