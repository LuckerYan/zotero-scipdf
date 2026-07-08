import { config } from "../../package.json";
import { presetSciHubCustomResolvers } from "./CustomResolver";
import { CustomResolverManager } from "./CustomResolverManager";
import { getPref, setPref } from "../utils/prefs";

const defaultFetchConcurrency = 3;
const minFetchConcurrency = 1;
const maxFetchConcurrency = 5;

function normalizeFetchConcurrency(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return defaultFetchConcurrency;
  }
  return Math.min(
    maxFetchConcurrency,
    Math.max(minFetchConcurrency, Math.round(parsed)),
  );
}

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
  const fetchConcurrencyInput = _window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-fetchConcurrency`,
  ) as HTMLInputElement | null;
  const githubLink = _window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-github`,
  ) as HTMLAnchorElement | null;
  if (!autoDownloadCheckbox || !fetchConcurrencyInput || !githubLink) {
    ztoolkit.log("Sci-PDF preference controls were not found");
    return;
  }

  const resolvers = CustomResolverManager.shared.customResolvers;
  autoDownloadCheckbox.checked =
    resolvers.length > 0 && resolvers[0].automatic !== false;
  fetchConcurrencyInput.value = String(
    normalizeFetchConcurrency(getPref("fetchConcurrency")),
  );

  const updateAutoDownload = () => {
    CustomResolverManager.shared.removeAllCustomResolversInZotero();
    CustomResolverManager.shared.appendCustomResolversInZotero(
      presetSciHubCustomResolvers(autoDownloadCheckbox.checked),
    );
  };

  const updateFetchConcurrency = () => {
    const concurrency = normalizeFetchConcurrency(fetchConcurrencyInput.value);
    fetchConcurrencyInput.value = String(concurrency);
    setPref("fetchConcurrency", concurrency);
  };

  autoDownloadCheckbox.addEventListener("change", () => {
    updateAutoDownload();
  });

  fetchConcurrencyInput.addEventListener("change", () => {
    updateFetchConcurrency();
  });

  fetchConcurrencyInput.addEventListener("blur", () => {
    updateFetchConcurrency();
  });

  githubLink.addEventListener("click", (event) => {
    event.preventDefault();
    Zotero.launchURL(githubLink.href);
  });
}
