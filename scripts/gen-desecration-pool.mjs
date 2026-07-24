// gen-desecration-pool.mjs - builds renderer/item/desecration-pool.json: every mod
// family desecration can offer (regular item pool + the three Abyssal liches'
// desecrated-exclusive pool), per side, with per-tier level / spawn-weights / roll
// range. The Desecrate tab resolves an item's eligible pool at runtime from its
// base's tags (first matching spawn-weight tag wins - the game's own semantics)
// and computes hit probabilities from the weight shares.
// Re-run per league/patch: node scripts/gen-desecration-pool.mjs
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "renderer", "item", "desecration-pool.json");

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "poe2-price-overlay (desecration pool generator)" } }, (r) => {
      if (r.statusCode !== 200) { reject(new Error(`HTTP ${r.statusCode} ${url}`)); r.resume(); return; }
      const chunks = [];
      r.on("data", (c) => chunks.push(c));
      r.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
    }).on("error", reject);
  });
}

// spawn-weight tags that mean "an equippable item can roll this"
const EQUIP_TAGS = new Set([
  "ring", "amulet", "belt", "boots", "gloves", "helmet", "body_armour", "focus", "quiver",
  "shield", "str_shield", "dex_shield", "int_shield", "str_dex_shield", "str_int_shield", "dex_int_shield",
  "armour", "str_armour", "dex_armour", "int_armour", "str_dex_armour", "str_int_armour", "dex_int_armour", "str_dex_int_armour",
  "energy_shield", "evasion", "not_str", "not_dex", "not_int",
  "wand", "staff", "warstaff", "sceptre", "bow", "crossbow",
  "claw", "dagger", "spear", "flail", "mace", "axe", "sword", "talisman",
  "weapon", "one_hand_weapon", "two_hand_weapon", "melee", "caster", "ranged", "marksman",
  // regular jewels (Emerald/Ruby/Sapphire/Diamond) - desecratable via Preserved Cranium.
  // Time-Lost/radius jewels are deliberately excluded: poe2db states the jewel
  // desecrated-exclusive pool "only rolls on regular jewels, not Time-Lost jewels".
  "strjewel", "dexjewel", "intjewel",
]);

const cleanBrackets = (s) => String(s || "").replace(/\[([^\]|]+)\|([^\]]+)\]/g, "$2").replace(/\[([^\]]+)\]/g, "$1");
const normTemplate = (s) => cleanBrackets(s)
  .replace(/\(-?\d+(?:\.\d+)?--?\d+(?:\.\d+)?\)/g, "#")
  .replace(/-?\d+(?:\.\d+)?/g, "#")
  .replace(/^\+#/, "#")
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();

// EE2 matcher template -> trade stat hash (same mapping the range generator uses)
const statLines = fs.readFileSync(path.join(ROOT, "renderer", "vendor", "ee2", "data", "en", "stats.ndjson"), "utf8").split("\n");
const matcherToHash = new Map();
for (const line of statLines) {
  if (!line.trim()) continue;
  const stat = JSON.parse(line);
  const ids = (stat.trade && stat.trade.ids) || {};
  const hash = ["explicit", "implicit", "fractured", "desecrated", "crafted", "rune", "enchant"]
    .map((k) => ids[k] && ids[k][0]).find(Boolean);
  if (!hash) continue;
  const h = hash.split(".").pop();
  for (const m of stat.matchers || []) {
    for (const key of [m.string, m.advanced]) {
      if (key) {
        const n = normTemplate(key);
        if (!matcherToHash.has(n)) matcherToHash.set(n, h);
      }
    }
  }
}

const mods = await get("https://repoe-fork.github.io/poe2/mods.min.json");
const families = new Map(); // group|side|template -> family
let skippedNoHash = 0;
for (const mod of Object.values(mods)) {
  const side = mod.generation_type;
  if (side !== "prefix" && side !== "suffix") continue;
  // Regular jewels keep their normal explicit mods in domain "misc", not "item";
  // desecration reveals those alongside the jewel desecrated-exclusive pool, so
  // pull misc mods too when they carry a real jewel spawn tag.
  const JEWEL_TAGS = new Set(["strjewel", "dexjewel", "intjewel"]);
  const isJewelMisc = mod.domain === "misc" && (mod.spawn_weights || []).some((s) => JEWEL_TAGS.has(s.tag) && s.weight > 0);
  if (mod.domain !== "item" && mod.domain !== "desecrated" && !isJewelMisc) continue;
  if (mod.is_essence_only) continue;
  if (!mod.stats || !mod.stats.length || !mod.text) continue;
  const sw = (mod.spawn_weights || []).map((s) => [s.tag, s.weight]);
  // Otherworldly = the ALTERED-bone pool (poe2db "Otherworldly ... Modifiers").
  // In the raw data these carry their item-type tags at weight 0 plus a
  // breach_desecration:1 that only the Altered context activates. Re-weight the
  // present equip tags to 1 (our uniform model) so they keep per-item-type gating
  // and mix into the Altered route like any other family.
  const isOther = sw.some(([tag, w]) => tag === "breach_desecration" && w > 0);
  if (!isOther && !sw.some(([tag, w]) => w > 0 && EQUIP_TAGS.has(tag))) continue;
  const swUse = isOther
    ? (() => { const t = [...new Set(sw.map(([tag]) => tag).filter((tag) => EQUIP_TAGS.has(tag)))]; return (t.length ? t : ["default"]).map((tag) => [tag, 1]); })()
    : sw;
  const dFlag = isOther ? 2 : (mod.domain === "desecrated" ? 1 : 0);

  const lines = cleanBrackets(mod.text).split("\n").map((l) => l.trim()).filter(Boolean);
  const hashes = lines.map((l) => matcherToHash.get(normTemplate(l)) || null);
  if (!hashes.some(Boolean)) { skippedNoHash++; continue; }
  const stats = mod.stats.filter((s) => typeof s.min === "number" && typeof s.max === "number");
  let lo = Infinity, hi = -Infinity;
  for (const s of stats) { lo = Math.min(lo, s.min); hi = Math.max(hi, s.max); }

  const template = lines.map((l) => normTemplate(l)).join(" / ");
  const key = `${(mod.groups && mod.groups[0]) || mod.type}|${side}|${template}`;
  let fam = families.get(key);
  if (!fam) {
    fam = {
      g: (mod.groups && mod.groups[0]) || mod.type,
      s: side === "prefix" ? "p" : "s",
      d: dFlag, // 0 = base mod, 1 = regular desecration-exclusive, 2 = otherworldly (Altered)
      name: mod.name || "",
      text: lines.join(" / "),
      hashes: hashes,
      tiers: [],
    };
    families.set(key, fam);
  }
  fam.tiers.push({ lvl: mod.required_level || 1, sw: swUse, lo: Number.isFinite(lo) ? lo : null, hi: Number.isFinite(hi) ? hi : null });
}

for (const fam of families.values()) {
  fam.tiers.sort((a, b) => b.lvl - a.lvl); // index 0 = highest tier (T1)
}

// Trade-stat hashes reachable via a special context, for the item-search picker's
// "Greater Runes" (soul) and "Otherworldly Mods" pills. A mod counts if it has a
// positive weight under the context tag; its stat lines map to trade hashes.
function collectHashes(tagName) {
  const set = new Set();
  for (const mod of Object.values(mods)) {
    if (mod.generation_type !== "prefix" && mod.generation_type !== "suffix") continue;
    if (!mod.text || !mod.stats || !mod.stats.length) continue;
    if (!(mod.spawn_weights || []).some((s) => s.tag === tagName && s.weight > 0)) continue;
    for (const line of cleanBrackets(mod.text).split("\n").map((l) => l.trim()).filter(Boolean)) {
      const h = matcherToHash.get(normTemplate(line));
      if (h) set.add(h);
    }
  }
  return [...set];
}
const out = {
  generated: new Date().toISOString().slice(0, 10),
  families: [...families.values()],
  soul: collectHashes("soul"),
  otherworldly: collectHashes("breach_desecration"),
};
fs.writeFileSync(OUT, JSON.stringify(out));
const fs2 = out.families;
console.log(`desecration-pool.json: ${fs2.length} families (${fs2.filter((f) => f.d === 1).length} desecration-exclusive, ${fs2.filter((f) => f.d === 2).length} otherworldly/Altered), ${fs2.reduce((n, f) => n + f.tiers.length, 0)} tiers, ${skippedNoHash} skipped (no trade hash), ${Math.round(fs.statSync(OUT).size / 1024)}KB`);
// probes: gloves-relevant families
const probe = (re) => {
  const f = fs2.find((f) => re.test(f.text) && f.s === "p");
  if (f) console.log(` ${f.text} [${f.s}] d=${f.d} tiers=${f.tiers.map((t) => t.lvl).join(",")}`);
};
probe(/maximum Mana/);
probe(/maximum Life/);
console.log(" lich sample:", fs2.filter((f) => f.d).slice(0, 3).map((f) => `${f.name}: ${f.text.slice(0, 50)}`).join(" | "));
