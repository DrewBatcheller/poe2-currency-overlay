// gen-mod-ranges.mjs - builds renderer/item/mod-ranges.json: the full realistic roll
// range of every mod PER ITEM CATEGORY, spanning lowest tier's min to highest tier's
// max (what craftofexile shows). Source: RePoE-fork's PoE2 mods export (every mod
// tier with stats min/max + spawn-weight tags), matched to EE2's stat matchers to
// key by trade stat hash. Output: { "<tradeCategory>|<statHash>": [lo, hi] }.
// Re-run per league: node scripts/gen-mod-ranges.mjs
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "renderer", "item", "mod-ranges.json");

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "poe2-price-overlay (range generator)" } }, (r) => {
      if (r.statusCode !== 200) { reject(new Error(`HTTP ${r.statusCode} ${url}`)); r.resume(); return; }
      const chunks = [];
      r.on("data", (c) => chunks.push(c));
      r.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
    }).on("error", reject);
  });
}

// spawn-weight tag -> our trade2 categories. Broad tags overshoot on purpose:
// slightly-too-wide slider bounds are harmless, missing bounds are not.
const ARMOUR4 = ["armour.helmet", "armour.chest", "armour.gloves", "armour.boots"];
const SHIELDS = ["armour.shield", "armour.buckler"];
const ONE_HAND = ["weapon.onesword", "weapon.oneaxe", "weapon.onemace", "weapon.claw", "weapon.dagger", "weapon.spear", "weapon.flail"];
const TWO_HAND = ["weapon.twosword", "weapon.twoaxe", "weapon.twomace", "weapon.warstaff"];
const CASTER = ["weapon.wand", "weapon.sceptre", "weapon.staff"];
const RANGED = ["weapon.bow", "weapon.crossbow"];
const TAG_CATS = {
  ring: ["accessory.ring"], amulet: ["accessory.amulet"], belt: ["accessory.belt"],
  boots: ["armour.boots"], gloves: ["armour.gloves"], helmet: ["armour.helmet"], body_armour: ["armour.chest"],
  focus: ["armour.focus"], quiver: ["armour.quiver"],
  shield: SHIELDS, str_shield: SHIELDS, str_dex_shield: SHIELDS, str_int_shield: SHIELDS,
  armour: [...ARMOUR4, ...SHIELDS, "armour.focus"],
  str_armour: ARMOUR4, dex_armour: ARMOUR4, int_armour: ARMOUR4,
  str_dex_armour: ARMOUR4, str_int_armour: ARMOUR4, dex_int_armour: ARMOUR4, str_dex_int_armour: ARMOUR4,
  energy_shield: [...ARMOUR4, ...SHIELDS, "armour.focus"], evasion: [...ARMOUR4, ...SHIELDS],
  not_str: ARMOUR4, not_dex: ARMOUR4, not_int: ARMOUR4,
  wand: ["weapon.wand"], staff: ["weapon.staff"], warstaff: ["weapon.warstaff"], sceptre: ["weapon.sceptre"],
  bow: ["weapon.bow"], crossbow: ["weapon.crossbow"], quiver2: ["armour.quiver"],
  claw: ["weapon.claw"], dagger: ["weapon.dagger"], spear: ["weapon.spear"], flail: ["weapon.flail"],
  mace: ["weapon.onemace", "weapon.twomace"], axe: ["weapon.oneaxe", "weapon.twoaxe"], sword: ["weapon.onesword", "weapon.twosword"],
  talisman: ["weapon.talisman"], fishing_rod: ["weapon.rod"],
  weapon: [...ONE_HAND, ...TWO_HAND, ...CASTER, ...RANGED],
  one_hand_weapon: [...ONE_HAND, "weapon.wand", "weapon.sceptre"],
  two_hand_weapon: [...TWO_HAND, "weapon.staff", ...RANGED],
  melee: [...ONE_HAND, ...TWO_HAND],
  caster: CASTER, ranged: RANGED, marksman: RANGED,
};

const cleanBrackets = (s) => String(s || "").replace(/\[([^\]|]+)\|([^\]]+)\]/g, "$2").replace(/\[([^\]]+)\]/g, "$1");
// "(5-8)" / "(-3--1)" / bare numbers -> '#'; normalize for matcher comparison
const normTemplate = (s) => cleanBrackets(s)
  .replace(/\(-?\d+(?:\.\d+)?--?\d+(?:\.\d+)?\)/g, "#")
  .replace(/-?\d+(?:\.\d+)?/g, "#")
  .replace(/^\+#/, "#")
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();

// EE2 matcher template -> trade stat hash
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
console.log(`matcher templates: ${matcherToHash.size}`);

const mods = await get("https://repoe-fork.github.io/poe2/mods.min.json");
const ranges = new Map(); // "cat|hash" -> [lo, hi]
let usedMods = 0, unmatchedLines = 0;
const unmatchedSample = new Set();
for (const mod of Object.values(mods)) {
  const genOk = mod.generation_type === "prefix" || mod.generation_type === "suffix";
  const domOk = mod.domain === "item" || mod.domain === "desecrated";
  if (!genOk || !domOk || !mod.stats || !mod.stats.length || !mod.text) continue;
  const cats = new Set();
  for (const sw of mod.spawn_weights || []) {
    if (sw.weight > 0) for (const c of TAG_CATS[sw.tag] || []) cats.add(c);
  }
  if (mod.domain === "desecrated" && !cats.size) {
    // desecrated mods often carry only broad tags; apply to everything equippable
    for (const c of [...ARMOUR4, ...SHIELDS, ...ONE_HAND, ...TWO_HAND, ...CASTER, ...RANGED, "accessory.ring", "accessory.amulet", "accessory.belt", "armour.focus", "armour.quiver"]) cats.add(c);
  }
  if (!cats.size) continue;

  const lines = cleanBrackets(mod.text).split("\n").map((l) => l.trim()).filter(Boolean);
  const stats = mod.stats.filter((s) => typeof s.min === "number" && typeof s.max === "number");
  if (!stats.length) continue;
  let any = false;
  lines.forEach((line, i) => {
    const hash = matcherToHash.get(normTemplate(line));
    if (!hash) { unmatchedLines++; if (unmatchedSample.size < 8) unmatchedSample.add(line); return; }
    // pair stats to lines when counts align; otherwise the line takes the union
    const contributing = lines.length === stats.length ? [stats[i]] : stats;
    let lo = Infinity, hi = -Infinity;
    for (const s of contributing) { lo = Math.min(lo, s.min); hi = Math.max(hi, s.max); }
    if (!(hi >= lo)) return;
    any = true;
    for (const cat of cats) {
      const key = `${cat}|${hash}`;
      const e = ranges.get(key);
      if (!e) ranges.set(key, [lo, hi]);
      else { e[0] = Math.min(e[0], lo); e[1] = Math.max(e[1], hi); }
    }
  });
  if (any) usedMods++;
}

const out = {};
for (const [k, v] of ranges) out[k] = v;
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`mod-ranges.json: ${ranges.size} category|stat ranges from ${usedMods} mods (${unmatchedLines} unmatched lines)`);
console.log("unmatched samples:", [...unmatchedSample].slice(0, 5).join(" | "));
// sanity probes: spell damage on staff vs amulet; cast speed on staff
const probe = (cat, hash, label) => console.log(` ${label}:`, JSON.stringify(out[`${cat}|${hash}`] || "MISSING"));
probe("weapon.staff", "stat_2974417149", "staff spell dmg");
probe("accessory.amulet", "stat_2974417149", "amulet spell dmg");
probe("weapon.staff", "stat_2891184298", "staff cast speed");
probe("accessory.amulet", "stat_2891184298", "amulet cast speed");
probe("armour.boots", "stat_2250533757", "boots move speed");
