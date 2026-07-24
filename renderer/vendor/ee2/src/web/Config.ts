// [EE2-VENDOR TRIMMED] Replaces renderer/src/web/Config.ts.
//
// The upstream Config.ts is an app-state module. It was trimmed to a pure,
// dependency-free accessor because the vendored parser + trade-query subtree
// consumes only a tiny slice of it:
//   - Parser.ts / magic-name.ts read   AppConfig().language
//   - trade/common.ts reads            AppConfig<PriceCheckWidget>("price-check").apiLatencySeconds
//   - trade/common.ts re-exports        poeWebApi  (as getTradeEndpoint)
//
// REMOVED (all present upstream, none reachable from the pure subtree):
//   - `vue` imports (reactive/shallowRef/toRaw) and the reactive `_config` ref
//   - Electron IPC (`Host` from @/web/background/IPC) and every host-sync fn:
//     updateConfig, saveConfig, pushHostConfig, initConfig, getConfigForHost
//   - DOM access (document.documentElement.style.fontSize)
//   - the widget registry + all widget-type imports + @ipc/types
//   - defaultConfig() and the full upgradeConfig() migration ladder
//   - the TipsFrequency enum and the exhaustive Config interface
//
// The config is a plain module-level object. The host app should call
// setAppConfig() once (e.g. with the user's real language/realm) before parsing;
// otherwise it defaults to English / pc-ggg. No value is auto-persisted anywhere.

export interface VendorAppConfig {
  language: "en" | "ru" | "cmn-Hant" | "ko" | "ja" | "de" | "es" | "pt" | "fr";
  realm: "pc-ggg" | "pc-garena";
  preferredTradeSite: "default" | "www";
  // widgets are looked up by wmType; only price-check.apiLatencySeconds is read
  // by the vendored subtree (trade/common.ts rate-limit desync fix).
  widgets: Array<Record<string, unknown>>;
}

let _config: VendorAppConfig = {
  language: "en",
  realm: "pc-ggg",
  preferredTradeSite: "default",
  widgets: [{ wmType: "price-check", apiLatencySeconds: 2 }],
};

/** Host injector: merge real config values before running parse/trade logic. */
export function setAppConfig(config: Partial<VendorAppConfig>): void {
  _config = { ..._config, ...config };
}

export function AppConfig(): VendorAppConfig;
export function AppConfig<T>(type: string): T | undefined;
export function AppConfig(type?: string): unknown {
  if (!type) {
    return _config;
  }
  return _config.widgets.find((w) => w.wmType === type);
}

// Verbatim from upstream Config.ts (drives trade/common.ts getTradeEndpoint).
export function poeWebApi() {
  const { realm, preferredTradeSite, language } = _config;
  if (preferredTradeSite === "www") {
    return "www.pathofexile.com";
  }
  switch (language) {
    case "en":
      return "www.pathofexile.com";
    case "ru":
      return "ru.pathofexile.com";
    case "cmn-Hant":
      return realm === "pc-garena" ? "pathofexile.tw" : "www.pathofexile.com";
    case "ko":
      return "poe.kakaogames.com";
    case "ja":
      return "jp.pathofexile.com";
    case "de":
      return "de.pathofexile.com";
    case "es":
      return "es.pathofexile.com";
    case "pt":
      return "br.pathofexile.com";
    case "fr":
      return "fr.pathofexile.com";
  }
}
