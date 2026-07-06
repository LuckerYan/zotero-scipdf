import { assert } from "chai";
import { config } from "../package.json";

describe("startup", function () {
  it("should have plugin instance defined", function () {
    assert.isNotEmpty(Zotero[config.addonInstance]);
  });

  it("should register a Zotero 9 preference pane", function () {
    assert.isTrue(
      Zotero.PreferencePanes.pluginPanes.some(
        (pane) =>
          pane.pluginID === config.addonID &&
          pane.id === `zotero-prefpane-${config.addonRef}`,
      ),
    );
  });

  it("should install updated Sci-Hub custom file resolvers", function () {
    const resolvers = JSON.parse(
      Zotero.Prefs.get("extensions.zotero.findPDFs.resolvers", true) as string,
    );
    assert.isArray(resolvers);
    const urls = resolvers.map((resolver: { url: string }) => resolver.url);
    for (const url of [
      "https://sci-hub.kvnp.top/{doi}",
      "https://www.tesble.com/{doi}",
      "https://sci-hub.ru/{doi}",
      "https://sci-hub.su/{doi}",
      "https://sci-hub.red/{doi}",
      "https://sci-hub.box/{doi}",
      "https://sci-hub.st/{doi}",
      "https://sci-hub.ren/{doi}",
      "https://sci-hub.ee/{doi}",
      "https://sci-hub.world/{doi}",
    ]) {
      assert.include(urls, url);
    }
    assert.notInclude(urls, "https://sci-hub.se/{doi}");
    assert.include(
      resolvers.map((resolver: { selector: string }) => resolver.selector),
      "object[type='application/pdf']",
    );
    assert.include(
      resolvers.map((resolver: { selector: string }) => resolver.selector),
      'meta[name="citation_pdf_url"]',
    );
    assert.include(
      resolvers.map((resolver: { selector: string }) => resolver.selector),
      "iframe[src*='.pdf']",
    );
  });
});
