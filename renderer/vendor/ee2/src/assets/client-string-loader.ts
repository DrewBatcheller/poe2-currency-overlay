// [EE2-VENDOR PATCH] Replaces the upstream dynamic-import loader.
//
// Upstream:
//   await import(`${import.meta.env.BASE_URL}data/${lang}/client_strings.js`)
// A runtime-templated dynamic import cannot be statically bundled, and dynamic ESM
// import over a custom Electron scheme from a file:// page is unsupported. This app
// ships English only, so the "en" dictionary is imported statically (esbuild inlines
// it into the bundle). Both CLIENT_STRINGS and CLIENT_STRINGS_REF resolve to "en".
// If more languages are ever shipped, add them to the map below - the signature is
// unchanged from upstream.
import { TranslationDict } from "./data/interfaces";
import en from "../../data/en/client_strings.js";

const DICTS: Record<string, TranslationDict> = { en };

export async function loadClientStrings(
  lang: string,
): Promise<TranslationDict> {
  const dict = DICTS[lang] ?? DICTS.en;
  return dict;
}
