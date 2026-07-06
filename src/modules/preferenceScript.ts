import { config } from "../../package.json";
import { sciHubCustomResolver } from "./CustomResolver";
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
  ) as XUL.Checkbox | null;
  const urlInput = _window.document.querySelector(
    `#zotero-prefpane-${config.addonRef}-scihubUrl`,
  ) as HTMLInputElement | null;
  if (!autoDownloadCheckbox || !urlInput) {
    ztoolkit.log("Sci-PDF preference controls were not found");
    return;
  }

  const resolver = CustomResolverManager.shared.customResolvers;
  autoDownloadCheckbox.checked =
    resolver.length > 0 && resolver[0].automatic !== false;
  urlInput.value = resolver.map((e) => e.url).join(";");

  const parseResolver = (url: string) => {
    const trimmedURL = url.trim();
    if (trimmedURL.length <= 0) {
      return undefined;
    }
    const resolver = sciHubCustomResolver(
      trimmedURL,
      autoDownloadCheckbox.checked,
    );
    try {
      new URL(resolver.url.replace("{doi}", "10.0000/test"));
      return resolver;
    } catch {
      return undefined;
    }
  };

  const showURLError = () => {
    new ztoolkit.ProgressWindow(config.addonName, {
      closeOnClick: true,
      closeTime: 3000,
    })
      .createLine({
        text: `URL Error`,
        type: "fail",
        progress: 0,
      })
      .show();
  };

  const updateResolver = () => {
    CustomResolverManager.shared.removeAllCustomResolversInZotero();
    const urls = Array.from(
      new Set(
        urlInput.value.split(/\s*[;,，；、\s]\s*/).map((url) => url.trim()),
      ),
    );
    const setedURLs: string[] = [];
    let hasInvalidURL = false;
    for (const url of urls) {
      if (url.length <= 0) {
        continue;
      }
      const resolver = parseResolver(url);
      if (resolver) {
        CustomResolverManager.shared.appendCustomResolversInZotero([resolver]);
        setedURLs.push(resolver.url);
      } else {
        hasInvalidURL = true;
      }
    }
    urlInput.value = setedURLs.join(",");
    if (hasInvalidURL) {
      showURLError();
    }
  };

  autoDownloadCheckbox.addEventListener("command", () => {
    updateResolver();
  });

  urlInput.addEventListener("change", () => {
    updateResolver();
  });
}
