# poe2-overlay-api (Cloudflare Worker)

Edge proxy for the POE2 Currency Overlay. Serves cached currency-exchange data so
that every overlay user hits the edge cache, not the upstream API.

## Endpoints

| Route | Description |
|---|---|
| `GET /v1/leagues` | League list |
| `GET /v1/snapshot?league=<name>` | Currency-exchange pair snapshot |
| `GET /v1/health` | Shows which upstream is active (`ggg` or `poe2scout`) |

## Credential handling

- The confidential GGG OAuth client credential is stored **only** in Cloudflare's
  encrypted secret store (`wrangler secret put GGG_CLIENT_ID` / `GGG_CLIENT_SECRET`).
- It is never committed, never logged, and never sent to overlay clients.
- Clients receive only cached JSON price data; there is nothing sensitive to leak.
- Until GGG grants credentials, the worker automatically serves the poe2scout
  public API instead - same response shapes, zero client changes needed later.

## Load profile

Responses are edge-cached for 10 minutes per league. Upstream sees at most
**1 request per league per 10 minutes** (plus rare token refreshes), independent of
how many overlay users exist.

## Deploy

```bash
cd backend
npx wrangler login
npx wrangler deploy
# when GGG credentials arrive:
npx wrangler secret put GGG_CLIENT_ID
npx wrangler secret put GGG_CLIENT_SECRET
```
