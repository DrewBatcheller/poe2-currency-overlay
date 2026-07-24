// build-item-tab.mjs - bundles the vendored EE2 parser + item-tab glue into
// renderer/item-tab.bundle.js. Runs automatically via prestart/predist; the rest
// of the app stays build-free vanilla JS.
//
//   node scripts/build-item-tab.mjs            one-shot build
//   node scripts/build-item-tab.mjs --watch    rebuild on change (dev)
import { build, context } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const options = {
  entryPoints: [path.join(root, "renderer", "item", "ee2-entry.ts")],
  outfile: path.join(root, "renderer", "item-tab.bundle.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  sourcemap: "linked",
  alias: {
    // vendored EE2 sources keep their upstream "@/..." imports
    "@": path.join(root, "renderer", "vendor", "ee2", "src"),
  },
  define: {
    // the vendored data loader fetches `${BASE_URL}data/...`; served by the
    // ee2:// protocol registered in main.js
    "import.meta.env.BASE_URL": JSON.stringify("ee2://root/"),
  },
  logLevel: "info",
};

if (process.argv.includes("--watch")) {
  const ctx = await context(options);
  await ctx.watch();
  console.log("[build-item-tab] watching...");
} else {
  await build(options);
}
