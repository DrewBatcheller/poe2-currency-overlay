// trade2.js - main-process PoE2 trade API client with a self-configuring rate limiter.
// Unauthenticated search + fetch (v1). Routes through Electron `net` so the session cookie
// jar is available later for live-search/whispers without changing this layer.
// Rate limits are learned from the server's X-Rate-Limit-* headers (confirmed live 2026-07-20:
// search = 5/10s,15/60s,30/300s; fetch = its own bucket). We enforce client-side sliding
// windows per policy and honor server-reported bans + 429 Retry-After.

const { net } = require('electron');

const HOST = 'https://www.pathofexile.com';
const UA = 'poe2-price-overlay (+https://github.com/POE2-VibeTools/poe2-currency-overlay)';
const FETCH_CHUNK = 10; // GGG fetch endpoint accepts up to 10 ids per call

// ---- rate limiter -----------------------------------------------------------
// One enforcer per server policy name. Conservative by design: we throttle BELOW
// GGG's advertised budget (margin of one request per rule) so the app can never be
// the reason an account gets escalation-banned, and we seed sane defaults before
// the first response teaches us the real rules (a fresh-start burst would otherwise
// fire unthrottled). Server-reported request counts are backfilled so requests made
// by other tools on the same IP (or before an app restart) are respected too.
const limiters = new Map();
const nowMs = () => Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// pre-learned defaults (observed live 2026-07: search 5/10s,15/60s,30/300s) minus margin
const DEFAULT_RULES = [{ max: 4, window: 10 }, { max: 12, window: 60 }, { max: 25, window: 300 }];
let onWaitHook = null; // (policy, waitMs) => void - lets the UI show "waiting Ns"

function getLimiter(policy) {
  let l = limiters.get(policy);
  if (!l) { l = { rules: DEFAULT_RULES.slice(), hits: [], bannedUntil: 0 }; limiters.set(policy, l); }
  return l;
}
function parseRules(s) {
  // "5:10:60,15:60:300" -> margin-reduced [{max:4, window:10}, {max:14, window:60}]
  return (s || '').split(',').filter(Boolean).map((p) => {
    const [max, window] = p.split(':').map(Number);
    return { max: Math.max(1, max - 1), window };
  });
}

async function waitForSlot(policy) {
  const lim = getLimiter(policy);
  for (;;) {
    const t = nowMs();
    if (lim.bannedUntil > t) {
      // the LOUDEST case (a 429, or the server reporting a ban) was the only one
      // that slept without telling anyone - the UI just said "Searching..." for
      // the length of the ban. Announce it like any other wait, flagged so the
      // UI can word it as a real rate limit rather than routine queuing.
      const banWait = lim.bannedUntil - t + 50;
      if (onWaitHook) { try { onWaitHook(policy, banWait, true); } catch {} }
      await sleep(banWait);
      continue;
    }
    const maxWin = lim.rules.reduce((m, r) => Math.max(m, r.window), 0);
    if (maxWin) lim.hits = lim.hits.filter((ts) => t - ts < maxWin * 1000);
    let wait = 0;
    for (const r of lim.rules) {
      const inWin = lim.hits.filter((ts) => t - ts < r.window * 1000);
      if (inWin.length >= r.max) {
        // the (max)-th newest hit inside the window must age out before we may send
        const mustExpire = inWin[inWin.length - r.max];
        wait = Math.max(wait, mustExpire + r.window * 1000 - t + 50);
      }
    }
    if (wait <= 0) { lim.hits.push(t); return; }
    if (onWaitHook && wait > 1200) { try { onWaitHook(policy, wait, false); } catch {} }
    await sleep(wait);
  }
}

function setOnWait(cb) { onWaitHook = cb; }

function ingestHeaders(fallbackPolicy, headers) {
  const policy = headers['x-rate-limit-policy'] || fallbackPolicy;
  const lim = getLimiter(policy);
  const ruleStr = headers['x-rate-limit-ip'];
  if (ruleStr) lim.rules = parseRules(ruleStr);
  const state = headers['x-rate-limit-ip-state'];
  if (state && ruleStr) {
    const rules = ruleStr.split(',').map((p) => p.split(':').map(Number)); // [max,window,ban]
    const parts = state.split(',').map((p) => p.split(':').map(Number));  // [used,window,ban]
    const t = nowMs();
    for (let i = 0; i < parts.length; i++) {
      const [used, window, ban] = parts[i];
      if (ban > 0) lim.bannedUntil = Math.max(lim.bannedUntil, t + ban * 1000);
      // the server saw more requests in this window than we tracked (another tool on
      // this IP, or an app restart) - backfill synthetic hits so we slow down for them
      const tracked = lim.hits.filter((ts) => t - ts < window * 1000).length;
      for (let k = tracked; k < used; k++) lim.hits.push(t);
    }
  }
  return policy;
}

// ---- raw request via Electron net -------------------------------------------
function raw(method, path, bodyObj) {
  return new Promise((resolve, reject) => {
    const body = bodyObj ? JSON.stringify(bodyObj) : null;
    const request = net.request({ method, url: HOST + path, useSessionCookies: true });
    request.setHeader('User-Agent', UA);
    request.setHeader('Accept', 'application/json');
    if (body) request.setHeader('Content-Type', 'application/json');
    request.on('response', (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        const headers = {};
        for (const k of Object.keys(res.headers)) {
          const v = res.headers[k];
          headers[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
        }
        resolve({ status: res.statusCode, headers, body: data });
      });
    });
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

async function call(method, path, bodyObj, policy) {
  await waitForSlot(policy);
  let r = await raw(method, path, bodyObj);
  ingestHeaders(policy, r.headers);
  if (r.status === 429) {
    const retry = Number(r.headers['retry-after'] || 5);
    getLimiter(policy).bannedUntil = nowMs() + retry * 1000;
    await waitForSlot(policy);
    r = await raw(method, path, bodyObj);
    ingestHeaders(policy, r.headers);
  }
  let json = null;
  try { json = JSON.parse(r.body); } catch { /* non-json error page */ }
  return { status: r.status, json, body: r.body };
}

// ---- public API -------------------------------------------------------------
// query = a full trade2 search body { query:{...}, sort:{...} }
async function search(league, query) {
  const r = await call('POST', `/api/trade2/search/poe2/${encodeURIComponent(league)}`, query, 'trade-search-request-limit');
  if (r.status !== 200) {
    const msg = (r.json && r.json.error && r.json.error.message) || r.body || `HTTP ${r.status}`;
    throw new Error(`trade2 search failed (${r.status}): ${msg}`);
  }
  return r.json; // { id, total, result:[ids], complexity }
}

// fetch full listing data for result ids (chunked to 10/call, rate-limited)
async function fetchListings(ids, queryId) {
  const out = [];
  for (let i = 0; i < ids.length; i += FETCH_CHUNK) {
    const chunk = ids.slice(i, i + FETCH_CHUNK).join(',');
    const r = await call('GET', `/api/trade2/fetch/${chunk}?query=${queryId}`, null, 'trade-fetch-request-limit');
    if (r.status !== 200) {
      const msg = (r.json && r.json.error && r.json.error.message) || `HTTP ${r.status}`;
      throw new Error(`trade2 fetch failed (${r.status}): ${msg}`);
    }
    out.push(...((r.json && r.json.result) || []));
  }
  return out;
}

// convenience: search then fetch the first `limit` listings in one call
async function searchAndFetch(league, query, limit = 20) {
  const s = await search(league, query);
  const ids = (s.result || []).slice(0, limit);
  const listings = ids.length ? await fetchListings(ids, s.id) : [];
  return { id: s.id, total: s.total, listings };
}

// Is the session logged in to pathofexile.com? Weighted Sum groups are rejected for
// anonymous users ("Query is too complex... Logging in will increase this limit"), so a
// minimal weight2 probe doubles as an auth check. Cached until invalidated.
let authState = null;
let authInFlight = null; // dedup concurrent probes - both the tab-open check and
// the first search can ask at once, and each probe is a real hit on the SEARCH
// endpoint's tiny budget (5/10s). Collapse them to one request.
async function authCheck(league, force = false) {
  if (authState !== null && !force) return authState;
  if (authInFlight && !force) return authInFlight;
  authInFlight = doAuthCheck(league).finally(() => { authInFlight = null; });
  return authInFlight;
}
async function doAuthCheck(league) {
  const probe = {
    query: {
      status: { option: 'online' },
      stats: [{
        type: 'weight2', value: { min: 1 },
        filters: [
          { id: 'explicit.stat_3032590688', value: { weight: 1 } },
          { id: 'explicit.stat_4067062424', value: { weight: 1 } },
        ],
      }],
    },
    sort: { price: 'asc' },
  };
  const r = await call('POST', `/api/trade2/search/poe2/${encodeURIComponent(league)}`, probe, 'trade-search-request-limit');
  authState = r.status === 200;
  return authState;
}

// current league ids, e.g. ["Runes of Aldur", "HC Runes of Aldur", "Standard", ...]
async function leagues() {
  const r = await call('GET', '/api/trade2/data/leagues', null, 'trade-data-request-limit');
  if (r.status !== 200 || !r.json) throw new Error(`trade2 leagues failed (${r.status})`);
  return (r.json.result || []).map((l) => l.id);
}

module.exports = { search, fetchListings, searchAndFetch, leagues, authCheck, setOnWait };
