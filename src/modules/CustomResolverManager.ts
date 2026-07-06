import { LargePrefHelper } from "zotero-plugin-toolkit";
import { config } from "../../package.json";
import { CustomResolver, isCustomResolverEqual } from "./CustomResolver";

export class CustomResolverManager {
  private static _shared?: CustomResolverManager;
  private static zoteroCustomResolversPrefKey: Readonly<string> =
    "extensions.zotero.findPDFs.resolvers";
  private static customResolversPrefKey: Readonly<string> = "resolvers";
  private static customResolversLargerPrefKey: Readonly<string> =
    "userCustomResolvers";

  static get shared() {
    if (!this._shared) {
      this._shared = new CustomResolverManager();
    }
    return this._shared;
  }

  // user custom resolvers
  private prefs = new LargePrefHelper(
    CustomResolverManager.customResolversLargerPrefKey,
    config.prefsPrefix,
    "parser",
  );
  get customResolvers() {
    return (
      (this.prefs.getValue(
        CustomResolverManager.customResolversPrefKey,
      ) as CustomResolver[]) ?? []
    );
  }
  private set customResolvers(value: CustomResolver[]) {
    this.prefs.setValue(
      CustomResolverManager.customResolversPrefKey,
      this.uniqueResolvers(value),
    );
  }

  /**
   * Restore the plugin-managed resolvers into Zotero's built-in file resolver preference.
   * Zotero 9+ still reads the legacy `findPDFs.resolvers` preference, but the runtime API
   * has been renamed from PDF resolvers to file resolvers. Keeping our own resolver list as
   * the source of truth avoids re-adding deleted preset sites on every restart.
   */
  restoreCustomResolversInZotero() {
    this.appendCustomResolversInZotero(this.customResolvers);
  }

  // system custom resolvers
  appendCustomResolversInZotero(
    resolvers: CustomResolver[] | Readonly<CustomResolver[]>,
  ) {
    const uniqueResolvers = this.uniqueResolvers([...resolvers]);
    this.customResolversInZotero = this.appendUnique(
      this.customResolversInZotero,
      uniqueResolvers,
    );
    this.customResolvers = this.appendUnique(
      this.customResolvers,
      uniqueResolvers,
    );
  }

  removeCustomResolversInZotero(resolvers: CustomResolver[]) {
    this.customResolversInZotero = this.customResolversInZotero.filter(
      (value) => !resolvers.find((e) => isCustomResolverEqual(e, value)),
    );
    this.customResolvers = this.customResolvers.filter(
      (value) => !resolvers.find((e) => isCustomResolverEqual(e, value)),
    );
  }

  removeAllCustomResolversInZotero() {
    this.removeCustomResolversInZotero(this.customResolvers);
  }

  private get customResolversInZotero() {
    const values = Zotero.Prefs.get(
      CustomResolverManager.zoteroCustomResolversPrefKey,
      true,
    );
    if (typeof values !== "string" || values.trim().length === 0) {
      return [];
    }
    try {
      let result = JSON.parse(values);
      if (!Array.isArray(result)) {
        result = [result];
      }
      return result as CustomResolver[];
    } catch (error) {
      ztoolkit.log(
        "Failed to parse Zotero custom file resolvers preference",
        error,
      );
      return [];
    }
  }

  private set customResolversInZotero(resolvers: CustomResolver[]) {
    Zotero.Prefs.set(
      CustomResolverManager.zoteroCustomResolversPrefKey,
      JSON.stringify(this.uniqueResolvers(resolvers)),
      true,
    );
  }

  private appendUnique(current: CustomResolver[], incoming: CustomResolver[]) {
    const result = [...current];
    for (const resolver of incoming) {
      const index = result.findIndex((value) =>
        isCustomResolverEqual(value, resolver),
      );
      if (index < 0) {
        result.push(resolver);
      } else {
        result[index] = resolver;
      }
    }
    return result;
  }

  private uniqueResolvers(resolvers: CustomResolver[]) {
    return this.appendUnique([], resolvers);
  }
}
