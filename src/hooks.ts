import { getString, initLocale } from "./utils/locale";
import { registerPrefsScripts } from "./modules/preferenceScript";
import { createZToolkit } from "./utils/ztoolkit";
import { getPref, setPref } from "./utils/prefs";
import {
  sciHubCustomResolvers,
  presetSciHubCustomResolvers,
} from "./modules/CustomResolver";
import { CustomResolverManager } from "./modules/CustomResolverManager";
import { Common } from "./modules/Common";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  const resolverManager = CustomResolverManager.shared;
  const presetVersion = 4;
  const legacyPresetHosts = new Set([
    "sci-hub.se",
    "sci-hub.st",
    "sci-hub.ru",
    "sci-hub.box",
    "sci-hub.red",
    "sci-hub.ren",
    "sci-hub.ee",
    "sci-hub.su",
    "sci-hub.world",
    "sci-hub.kvnp.top",
    "www.tesble.com",
  ]);
  const isLegacyPresetResolver = (resolverURL: string) => {
    try {
      return legacyPresetHosts.has(
        new URL(resolverURL.replace(/\{doi\}.*$/, "")).hostname,
      );
    } catch {
      return false;
    }
  };
  const migratePresetResolvers = (automatic = true) => {
    const oldPresetResolvers = resolverManager.customResolvers.filter(
      (resolver) => isLegacyPresetResolver(resolver.url),
    );
    resolverManager.removeCustomResolversInZotero(oldPresetResolvers);
    resolverManager.appendCustomResolversInZotero(
      presetSciHubCustomResolvers(automatic),
    );
    setPref("presetVersion", presetVersion);
  };

  if (!getPref("firstInstall")) {
    setPref("firstInstall", true);
    const url = Zotero.Prefs.get("zoteroscihub.scihub_url");
    const autoDownload = Boolean(
      Zotero.Prefs.get("zoteroscihub.automatic_pdf_download"),
    );
    if (url && typeof url === "string" && !isLegacyPresetResolver(url)) {
      resolverManager.appendCustomResolversInZotero(
        sciHubCustomResolvers(url, autoDownload),
      );
      setPref("presetVersion", presetVersion);
    } else {
      migratePresetResolvers(
        url && typeof url === "string" ? autoDownload : true,
      );
    }
  } else if (getPref("presetVersion") !== presetVersion) {
    const oldPresetResolver = resolverManager.customResolvers.find((resolver) =>
      isLegacyPresetResolver(resolver.url),
    );
    migratePresetResolvers(oldPresetResolver?.automatic !== false);
  } else {
    resolverManager.restoreCustomResolversInZotero();
  }

  await Common.registerPrefs();

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  // Mark initialized as true to confirm plugin loading status
  // outside of the plugin (e.g. scaffold testing process)
  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  // Create ztoolkit for every window
  addon.data.ztoolkit = createZToolkit();

  Common.registerRightClickMenuItem();
}

async function onMainWindowUnload(win: Window): Promise<void> {
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
}

function onShutdown(): void {
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
  // Remove addon object
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

/**
 * This function is just an example of dispatcher for Preference UI events.
 * Any operations should be placed in a function to keep this funcion clear.
 * @param type event type
 * @param data event data
 */
async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  switch (type) {
    case "load":
      await registerPrefsScripts(data.window);
      break;
    default:
      return;
  }
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onPrefsEvent,
};
