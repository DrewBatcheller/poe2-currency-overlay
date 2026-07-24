/**
 * Local fake of the live-service feed, for testing the app's source switchover.
 *
 *   node scripts/dev-feed-server.js         # listens on http://127.0.0.1:8787
 *
 * Then launch the overlay with the manifest override:
 *   POE2_FEED_MANIFEST=http://127.0.0.1:8787/feed.json npm start
 *
 * Serves:
 *   /feed.json   -> { apiBase: "http://127.0.0.1:8787" }   (the "switch is ON" manifest)
 *   /v1/health   -> { ok: true, upstream: "fake-local" }
 *   /scout/*     -> proxied to https://api.poe2scout.com/* (so real data flows through)
 *
 * Kill the server and hit ⟳ in the overlay to watch it fall back to the public API.
 */
const http = require('http');

const PORT = 8787;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('content-type', 'application/json');

  try {
    if (url.pathname === '/feed.json') {
      res.end(JSON.stringify({ apiBase: `http://127.0.0.1:${PORT}` }));
    } else if (url.pathname === '/v1/health') {
      res.end(JSON.stringify({ ok: true, upstream: 'fake-local' }));
    } else if (url.pathname.startsWith('/scout/')) {
      const rest = url.pathname.slice('/scout'.length);
      const upstream = await fetch(`https://api.poe2scout.com${rest}${url.search}`, {
        headers: { 'user-agent': 'poe2-overlay dev-feed-server (local test)' }
      });
      res.statusCode = upstream.status;
      res.end(await upstream.text());
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not found' }));
    }
    console.log(`${new Date().toISOString()} ${req.method} ${url.pathname} -> ${res.statusCode}`);
  } catch (e) {
    res.statusCode = 502;
    res.end(JSON.stringify({ error: String(e) }));
    console.error('proxy error:', e.message);
  }
});

server.listen(PORT, '127.0.0.1', () =>
  console.log(`dev feed server: http://127.0.0.1:${PORT} (feed manifest at /feed.json)`)
);
