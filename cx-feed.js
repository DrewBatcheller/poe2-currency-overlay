// cx-feed.js - GGG's public Currency Exchange CDN as the currency pair source.
// (web.poecdn.com/api/currency-exchange/poe2/<hourTs>, no auth - announced public
// by GGG 2026-07). Hourly digests of EXECUTED in-game exchange trades per market:
// volume_traded per side, lowest/highest stock and ratio. The current hour is
// always empty; completed hours are immutable (cached indefinitely).
//
// Output matches poe2scout's getPairMap shape so the renderer needs no changes:
//   { "a|b": { [a]: <value proxy>, [b]: <value proxy>, __vol } }
// where marketPairVal(a,b) = pd[a]/pd[b] = units of b per 1 a. Summing each side's
// executed volume across hours and storing them CROSSED (pd[a]=volB, pd[b]=volA)
// makes that ratio the volume-weighted average executed rate.
const https = require('https');
const path = require('path');

const CX_MAP = require(path.join(__dirname, 'cx-map.json')); // metadata id -> apiId
const UA = 'poe2-price-overlay (+https://github.com/POE2-VibeTools/poe2-currency-overlay)';
const HOURS_WINDOW = 3;    // volume-weight the last N complete hours
const hourCache = new Map(); // hourTs -> markets[] (immutable once fetched)

function getJson(pathname) {
  return new Promise((resolve, reject) => {
    https.get({ host: 'web.poecdn.com', path: pathname, headers: { 'User-Agent': UA } }, (r) => {
      if (r.statusCode !== 200) { r.resume(); reject(new Error(`CX HTTP ${r.statusCode}`)); return; }
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function fetchHour(ts) {
  if (hourCache.has(ts)) return hourCache.get(ts);
  const j = await getJson(`/api/currency-exchange/poe2/${ts}`);
  const markets = Array.isArray(j.markets) ? j.markets : [];
  hourCache.set(ts, markets);
  // completed hours are immutable; cap the cache anyway
  if (hourCache.size > 48) hourCache.delete(hourCache.keys().next().value);
  return markets;
}

// pair map for one league, aggregated over the last HOURS_WINDOW complete hours
async function getCxPairMap(league) {
  const nowHour = Math.floor(Date.now() / 1000 / 3600) * 3600;
  const hours = [];
  for (let i = 1; i <= HOURS_WINDOW; i++) hours.push(nowHour - i * 3600);
  const results = await Promise.allSettled(hours.map(fetchHour));
  const got = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (!got.length) throw new Error(results[0].reason ? results[0].reason.message : 'CX unavailable');

  // Adaptive freshness: the price should be as CURRENT as liquidity allows. Walk
  // hours newest -> oldest per pair and STOP as soon as the accumulated volume is
  // meaningful - liquid pairs (div/ex trades millions per hour) price off the
  // latest hour alone instead of a laggy multi-hour blend; thin pairs (mirrors)
  // keep accumulating so one lopsided fill doesn't set the rate.
  const LIQUID_MIN = 20; // units on the scarcer side = enough to trust the hour
  const perHour = new Map(); // "a|b" -> [{a: volA, b: volB} per hour, newest first]
  for (let h = 0; h < got.length; h++) {
    for (const m of got[h]) {
      if (m.league !== league || !m.market_pair || m.market_pair.length !== 2) continue;
      const [metaA, metaB] = m.market_pair;
      const a = CX_MAP[metaA], b = CX_MAP[metaB];
      if (!a || !b || a === b) continue;
      const va = (m.volume_traded && m.volume_traded[metaA]) || 0;
      const vb = (m.volume_traded && m.volume_traded[metaB]) || 0;
      if (!(va > 0) || !(vb > 0)) continue;
      const key = [a, b].sort().join('|');
      let hours = perHour.get(key);
      if (!hours) { hours = []; perHour.set(key, hours); }
      (hours[h] = hours[h] || { [a]: 0, [b]: 0 })[a] += va;
      hours[h][b] += vb;
      // GGG also publishes the RANGE of ratios that actually cleared this hour
      // (lowest_ratio/highest_ratio are the two sides of one ratio, e.g.
      // 1 omen : 97 ex and 1 omen : 40 ex). A wide band means the pair is
      // volatile - any single quoted rate for it is unreliable, which is
      // exactly what an arbitrage route needs to disclose.
      const lr = m.lowest_ratio || {}, hr = m.highest_ratio || {};
      let r1 = lr[metaA] > 0 && lr[metaB] > 0 ? lr[metaB] / lr[metaA] : null; // b per 1 a
      let r2 = hr[metaA] > 0 && hr[metaB] > 0 ? hr[metaB] / hr[metaA] : null;
      if (r1 || r2) {
        // normalise to the KEY's orientation ("second per 1 first"), since the
        // market's own pair order is arbitrary
        if (key.split('|')[0] !== a) {
          r1 = r1 ? 1 / r1 : null;
          r2 = r2 ? 1 / r2 : null;
        }
        const e = hours[h];
        const lo = Math.min(r1 == null ? Infinity : r1, r2 == null ? Infinity : r2);
        const hi = Math.max(r1 || 0, r2 || 0);
        if (Number.isFinite(lo)) e.__lo = e.__lo == null ? lo : Math.min(e.__lo, lo);
        if (hi > 0) e.__hi = e.__hi == null ? hi : Math.max(e.__hi, hi);
      }
    }
  }

  const map = {};
  for (const [key, hours] of perHour) {
    const [a, b] = key.split('|');
    let sa = 0, sb = 0, lo = null, hi = null, hoursUsed = 0;
    for (const e of hours) {
      if (!e) continue;
      sa += e[a];
      sb += e[b];
      hoursUsed++;
      if (e.__lo != null) lo = lo == null ? e.__lo : Math.min(lo, e.__lo);
      if (e.__hi != null) hi = hi == null ? e.__hi : Math.max(hi, e.__hi);
      if (Math.min(sa, sb) >= LIQUID_MIN) break; // fresh enough, stop blending
    }
    if (!(sa > 0) || !(sb > 0)) continue;
    // crossed volumes: pd[a]/pd[b] = volB/volA = executed b per 1 a
    map[key] = { [a]: sb, [b]: sa, __vol: sa + sb, __hours: hoursUsed };
    if (lo != null && hi > 0) { map[key].__lo = lo; map[key].__hi = hi; }
  }
  return map;
}

module.exports = { getCxPairMap };
