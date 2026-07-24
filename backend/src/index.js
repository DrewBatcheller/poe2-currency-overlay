/**
 * POE2 Currency Overlay - edge proxy.
 *
 * GET /v1/snapshot?league=<name>   → currency-exchange snapshot (JSON)
 * GET /v1/leagues                  → league list (JSON)
 * GET /v1/health                   → { ok, upstream: "ggg" | "poe2scout" }
 *
 * Upstream selection:
 *   - If GGG_CLIENT_ID / GGG_CLIENT_SECRET secrets are configured, fetches the
 *     official Currency Exchange API (service:cxapi) via client_credentials.
 *   - Otherwise falls back to poe2scout's public API.
 *
 * All responses are cached at the edge for CACHE_TTL seconds, so upstream load
 * is one request per league per TTL window regardless of user count. The
 * confidential credential exists only in the Worker secret store; clients never
 * receive or need it.
 */

const CACHE_TTL = 600; // seconds - one upstream fetch per league per 10 minutes
const UA = 'OAuth poe2-currency-overlay/1.0 (https://github.com/POE2-VibeTools/poe2-currency-overlay)';

const GGG_TOKEN_URL = 'https://www.pathofexile.com/oauth/token';
// NOTE: verify exact CX endpoint path against developer docs when credentials arrive.
const GGG_CX_URL = (league) =>
  `https://api.pathofexile.com/currency-exchange/poe2/${encodeURIComponent(league)}`;

const SCOUT = 'https://poe2scout.com/api';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method !== 'GET') return json({ error: 'GET only' }, 405);

    // Serve from edge cache first.
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), request);
    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    let resp;
    try {
      if (url.pathname === '/v1/health') {
        resp = json({ ok: true, upstream: hasGGG(env) ? 'ggg' : 'poe2scout' });
      } else if (url.pathname.startsWith('/scout/')) {
        // transparent cached passthrough of the poe2scout API (same paths the
        // overlay uses directly) - whitelisted to the read-only routes we need
        const rest = url.pathname.slice('/scout'.length);
        if (!(rest.startsWith('/poe2/') || rest === '/Realms')) {
          return json({ error: 'path not allowed' }, 403);
        }
        const r = await fetch(`https://api.poe2scout.com${rest}${url.search}`, {
          headers: { 'user-agent': UA }
        });
        resp = await passthrough(r);
      } else if (url.pathname === '/v1/leagues') {
        resp = await leagues();
      } else if (url.pathname === '/v1/snapshot') {
        const league = url.searchParams.get('league');
        if (!league) return json({ error: 'league query param required' }, 400);
        resp = hasGGG(env) ? await gggSnapshot(env, league) : await scoutSnapshot(league);
      } else {
        return json({ error: 'not found' }, 404);
      }
    } catch (e) {
      return json({ error: String(e) }, 502);
    }

    if (resp.ok) ctx.waitUntil(cache.put(cacheKey, resp.clone()));
    return resp;
  }
};

function hasGGG(env) {
  return Boolean(env.GGG_CLIENT_ID && env.GGG_CLIENT_SECRET);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'cache-control': `public, max-age=${CACHE_TTL}`
    }
  });
}

async function passthrough(upstreamResp) {
  const body = await upstreamResp.text();
  return new Response(body, {
    status: upstreamResp.status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'cache-control': `public, max-age=${CACHE_TTL}`
    }
  });
}

// ---------- poe2scout fallback ----------

async function leagues() {
  const r = await fetch(`${SCOUT}/poe2/Leagues`, { headers: { 'user-agent': UA } });
  return passthrough(r);
}

async function scoutSnapshot(league) {
  const r = await fetch(
    `${SCOUT}/poe2/Leagues/${encodeURIComponent(league)}/SnapshotPairs`,
    { headers: { 'user-agent': UA } }
  );
  return passthrough(r);
}

// ---------- official GGG upstream (activates when secrets are set) ----------

let tokenCache = { token: null, exp: 0 };

async function gggToken(env) {
  if (tokenCache.token && Date.now() < tokenCache.exp - 60_000) return tokenCache.token;
  const r = await fetch(GGG_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.GGG_CLIENT_ID,
      client_secret: env.GGG_CLIENT_SECRET,
      scope: 'service:cxapi'
    })
  });
  if (!r.ok) throw new Error(`token endpoint ${r.status}`);
  const d = await r.json();
  tokenCache = { token: d.access_token, exp: Date.now() + d.expires_in * 1000 };
  return tokenCache.token;
}

async function gggSnapshot(env, league) {
  const token = await gggToken(env);
  const r = await fetch(GGG_CX_URL(league), {
    headers: { authorization: `Bearer ${token}`, 'user-agent': UA }
  });
  return passthrough(r);
}
