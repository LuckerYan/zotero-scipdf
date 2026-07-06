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

  it("should install Sci-Hub custom file resolvers", function () {
    const resolvers = JSON.parse(
      Zotero.Prefs.get("extensions.zotero.findPDFs.resolvers", true) as string,
    );
    assert.isArray(resolvers);
    assert.include(
      resolvers.map((resolver: { url: string }) => resolver.url),
      "https://sci-hub.se/{doi}",
    );
  });
});
