<p align="center">
  <img src="docs/icon.png" alt="POE2 Currency Overlay logo" width="128">
</p>

# POE2 Currency Overlay

A lightweight in-game price overlay for **Path of Exile 2**. Press a hotkey, get live
currency-exchange rates, arbitrage signals, and 7-day trends - press it again and it's gone.

Built with Electron. Windows-first (that's where POE2 lives).

## Features

- **Global hotkey toggle** (default `F6`) - overlay appears on top of the game
  (Windowed / Windowed Fullscreen), fetches fresh prices on every open.
- **Buckets** - each bucket is a currency you want to *buy* (Exalted, Divine, any omen,
  any essence…). Rows inside are the currencies you'd *pay with*. Add as many buckets and
  rows as you like from every category the in-game Currency Exchange trades.
- **Best-value star ★** - converts every payment route to a common exalt-equivalent cost
  and stars the cheapest, with a green `(+X%)` showing the margin over the runner-up
  (and a red `(−X%)` on every other row showing its penalty).
- **Arbitrage detection** - for each pair, compares the pair's *direct* traded rate
  against the exalt cross-rate. A gold **gap %** flags disagreement; a green **ROI %**
  shows the result of actually walking a 3-trade loop through the most liquid middle
  currency. Hover for the step-by-step route.
- **7-day sparklines** - price history per row with delta %, min/max, and per-day
  detail on hover.
- **Default currencies** - configure a set once and every new bucket is pre-seeded
  with it (minus the bucket's own base).
- **Everything hovers** - every column explains itself in a tooltip.

## Install

```bash
git clone https://github.com/POE2-VibeTools/poe2-currency-overlay
cd poe2-currency-overlay
npm install
npm start
```

`Start Overlay.vbs` launches it silently in the background (pin a shortcut to it  - 
double-clicking the shortcut while it runs toggles the overlay). To auto-start with
Windows, put a shortcut to it in `shell:startup`.

## Usage

- **F6**: toggle. **Esc**: hide. Drag the title bar to move; position is remembered.
- **+ on a bucket header**: add any exchange-tradeable currency (searchable picker).
- **+ Add bucket**: pick a base currency for a new bucket.
- **✕** (on hover): remove a row or bucket.
- **⚙**: hotkey recorder, league selector, default currencies, quit.

The overlay does **not** read game memory, inject into the game process, or send input
to the game. It is a plain always-on-top window plus public price data - nothing that
interacts with Path of Exile 2 itself. The game must be in **Windowed** or
**Windowed Fullscreen** mode (exclusive fullscreen hides any overlay).

## Data sources

Live prices currently come from the excellent [poe2scout.com](https://poe2scout.com)
public API (league list, per-item smoothed prices, and per-pair exchange snapshots with
volumes). Requests are cached and throttled; the overlay fetches only the categories
your buckets actually use.

### Roadmap: official GGG Currency Exchange API

`backend/` contains a Cloudflare Worker that will proxy the official
`service:cxapi` endpoint once GGG reopens OAuth client registration:

- The confidential client credential lives **only** in the Worker's encrypted secret
  store - it is never in this repository and never shipped to users.
- The Worker fetches **one snapshot per league every 10 minutes**, caches it at the
  edge, and serves all overlay users from that cache - upstream load on GGG's API is
  constant regardless of user count.
- Users need no account and no credential of their own.
- Until credentials are granted, the Worker transparently falls back to poe2scout.

## Configuration

Config is stored in `%APPDATA%/poe2-price-overlay/overlay-config.json`. Rates are
derived from each item's Exalted Orb value in the exchange snapshot
(`price[item] / price[base]`), with direct pair rates overlaid where the snapshot
carries them.

## License

GPL-3.0 - see [LICENSE](LICENSE). Bundles the Exiled Exchange 2 item parser, which keeps its own MIT license.
