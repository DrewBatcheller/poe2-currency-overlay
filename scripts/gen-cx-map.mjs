// gen-cx-map.mjs - generates the two static data files that let the app run the
// currency tab entirely on GGG's public Currency Exchange CDN:
//
//   cx-map.json      metadata item id -> apiId        (pair/rate keying)
//   cx-catalog.json  apiId -> { text, icon, category } (names, icons, picker)
//
// Sources: RePoE-poe2 base_items (metadata id -> name, icon art, item class) and,
// for apiId continuity with existing user configs, the poe2scout catalog's ids
// (generation-time only - the APP no longer talks to poe2scout). Items poe2scout
// never knew get slugged apiIds. Re-run per league: node scripts/gen-cx-map.mjs
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const LEAGUE = process.argv[2] || "Runes of Aldur";
const UA = { "User-Agent": "poe2-price-overlay (map generator)" };

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: UA }, (r) => {
      if (r.statusCode !== 200) { reject(new Error(`HTTP ${r.statusCode} ${url}`)); r.resume(); return; }
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => resolve(JSON.parse(d)));
    }).on("error", reject);
  });
}
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const slug = (s) => norm(s).replace(/ /g, "-");

// friendly picker categories from game item classes
const CLASS_LABEL = {
  StackableCurrency: "currency", Omen: "omen", SoulCore: "soulcore",
  UncutSkillGem: "gem", UncutSupportGem: "gem", UncutSpiritGem: "gem",
  DelveStackableSocketableCurrency: "socketable", Idol: "idol",
};

const baseItems = await get("https://repoe-fork.github.io/poe2/base_items.min.json");

// apiId continuity: reuse poe2scout ids where they exist (generation-time only)
const nameToApi = new Map();
try {
  const cats = (await get(`https://api.poe2scout.com/poe2/Leagues/${encodeURIComponent(LEAGUE)}/Items/Categories`)).CurrencyCategories.map((c) => c.ApiId);
  for (const cat of cats) {
    try {
      const d = await get(`https://api.poe2scout.com/poe2/Leagues/${encodeURIComponent(LEAGUE)}/Currencies/ByCategory?category=${encodeURIComponent(cat)}&perPage=250&dataPoints=7`);
      for (const i of d.Items || []) if (i.Text && i.ApiId && !nameToApi.has(norm(i.Text))) nameToApi.set(norm(i.Text), { apiId: i.ApiId, category: i.CategoryApiId });
    } catch (e) { console.error(`  category ${cat}: ${e.message}`); }
  }
  console.log(`poe2scout id continuity: ${nameToApi.size} names`);
} catch (e) {
  console.error(`poe2scout unavailable (${e.message}) - slug ids only`);
}

// the set of items that actually trade on the exchange (last complete hour)
const hour = Math.floor(Date.now() / 1000 / 3600) * 3600 - 3600;
const cx = await get(`https://web.poecdn.com/api/currency-exchange/poe2/${hour}`);
const traded = new Set();
for (const m of cx.markets || []) for (const p of m.market_pair || []) traded.add(p);
console.log(`exchange-traded items (all leagues, ${hour}): ${traded.size}`);

const map = {};
const catalog = {};
let fromScout = 0, slugged = 0, unknownMeta = 0;
for (const meta of traded) {
  const info = baseItems[meta];
  if (!info || !info.name) { unknownMeta++; continue; }
  const scout = nameToApi.get(norm(info.name));
  const apiId = scout ? scout.apiId : slug(info.name);
  scout ? fromScout++ : slugged++;
  map[meta] = apiId;
  const art = info.visual_identity && info.visual_identity.dds_file;
  catalog[apiId] = {
    text: info.name,
    icon: art ? `https://web.poecdn.com/image/${art.replace(/\.dds$/, "")}.png` : null,
    category: (scout && scout.category) || CLASS_LABEL[info.item_class] || "other",
  };
}
fs.writeFileSync(path.join(ROOT, "cx-map.json"), JSON.stringify(map));
fs.writeFileSync(path.join(ROOT, "cx-catalog.json"), JSON.stringify(catalog));
console.log(`cx-map.json: ${Object.keys(map).length} metadata ids (${fromScout} continuity ids, ${slugged} slugged, ${unknownMeta} not in base_items)`);
console.log(`cx-catalog.json: ${Object.keys(catalog).length} items`);
for (const probe of ["Metadata/Items/Currency/CurrencyAddModToRare", "Metadata/Items/Currency/CurrencyModValues", "Metadata/Items/Currency/CurrencyRerollRare", "Metadata/Items/Currency/CurrencyRemoveMod"]) {
  const a = map[probe];
  console.log(" ", probe, "->", a, "::", a && catalog[a] ? `${catalog[a].text} [${catalog[a].category}]` : "MISSING");
}
