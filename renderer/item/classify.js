// classify.js - client-side structural similarity classifier for item search results.
// Groups returned listings into "highly" similar (true price comps) vs "similar" (context/upside),
// by comparing damage-mod SHAPE to the user's item. Purely structural, non-seasonal.
//
// Rules (user-confirmed):
//   1. PHYSICAL is its own class. phys present vs absent -> at most Similar, never Highly.
//   2. FORM PATTERN: matched (a % and a flat share an element) vs mismatched. Same pattern can be
//      Highly; crossing them = Similar.
//   3. ELEMENTS are fully interchangeable within 1+2 (fire == cold == lightning structurally).
//
// A damage "profile" is an array of { form: 'percent'|'flat', element: 'phys'|'fire'|'cold'|'lightning'|'chaos' }.
// Mods without a damage tag are ignored here (they're handled by strict/count filters, not the shape classifier).

(function () {
'use strict';

function sig(profile) {
  const dmg = (profile || []).filter((m) => m && m.form && m.element);
  const hasPhys = dmg.some((m) => m.element === 'phys');
  const pct = dmg.filter((m) => m.form === 'percent').map((m) => m.element).sort();
  const flat = dmg.filter((m) => m.form === 'flat').map((m) => m.element).sort();
  let pattern;
  if (!dmg.length) pattern = 'none';
  else if (!pct.length || !flat.length) pattern = 'single'; // only one form present (e.g. triple-flat)
  else pattern = JSON.stringify(pct) === JSON.stringify(flat) ? 'matched' : 'mismatched';
  return { hasPhys, pattern, count: dmg.length };
}

// classify a candidate profile relative to the user's item profile.
// returns 'highly' | 'similar' | 'other'
function classify(itemProfile, candidateProfile) {
  const a = sig(itemProfile);
  const b = sig(candidateProfile);
  if (a.pattern === 'none' && b.pattern === 'none') return 'other'; // neither is a damage item
  // Highly: same phys class AND same form pattern (elements free)
  if (a.hasPhys === b.hasPhys && a.pattern === b.pattern) return 'highly';
  // Both carry damage mods but differ on a hard dimension -> Similar
  if (a.count && b.count) return 'similar';
  return 'other';
}

const _api = { classify, sig };
if (typeof module !== 'undefined' && module.exports) module.exports = _api;
if (typeof window !== 'undefined') window.ItemClassify = _api;
})();
