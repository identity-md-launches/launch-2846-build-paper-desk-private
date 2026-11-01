# PAPER DESK

A private, single-user trading terminal front end for Papertrade (papertrade.xyz), a synthetic perps
exchange on HyperEVM priced at Hyperliquid's BBO mid with up to 1000x leverage.

The app is a static React + TypeScript + Vite build with lightweight-charts v5. It is **only a client of
your own backend**: every request goes to same-origin relative paths under `/api`. It never calls
Papertrade, Hyperliquid or any third party, never loads remote scripts, fonts or analytics, never uses
`eval` or inline scripts, and never holds or asks for a private key, seed phrase or wallet. Signing is
done by the backend's session key.

## Install, preview, rebuild

```sh
npm ci                 # install from package-lock.json
npm run dev            # dev server against a backend proxied at /api
npm run dev:mock       # dev server with synthetic data (VITE_MOCK=1)
npm test               # vitest unit tests (indicators, formatting, ticket validation, backoff)
npm run typecheck      # tsc --noEmit
npm run build          # typecheck, then production export to dist/
npm run preview        # serve dist/ locally (add ?mock=1 to the URL to run without a backend)
```

`dist/` is committed. It uses relative asset URLs (`base: "./"` in `vite.config.ts`), so it can be served
from any subpath, an IPFS gateway or an ENS name. There is no client-side routing: one page, three tabs.

In production, serve `dist/` from the **same origin** as the backend so `/api/*` and the WebSocket at
`/api/stream` resolve to it. Opened on a host with no backend, the desk shows a "Backend not reachable"
banner with a link to mock mode.

## Mock mode

Mock mode runs the full UI with no server. Turn it on with:

- `VITE_MOCK=1` at build or dev time (`npm run dev:mock`), or
- `?mock=1` in the page URL (works on the committed export).

`src/mock.ts` implements the same `Backend` interface as the HTTP client: deterministic seeded candles
for BTC and ETH on every timeframe, three open positions (one with TP/SL), 14 closed trades, an account
that revalues on every mark tick, intents that queue for about 1.4 s and then confirm, and a stream that
pushes `mark`, `positions`, `account` and `intent` messages once a second. The header shows **MOCK DATA**
whenever it is active. Mock code is loaded with a dynamic `import()`, so it is a separate chunk that the
live app never downloads.

## Backend contract

The typed client lives in `src/api.ts`. Timestamps may be unix seconds, unix milliseconds or ISO strings;
candle `t` values in milliseconds are normalised to seconds.

| Method | Path | Response |
| --- | --- | --- |
| GET | `/api/me` | `{user, wallet, sessionKey:{address, expiresAt}, limits:{maxMarginUsd, maxLeverage}}` |
| GET | `/api/markets` | `[{instrumentId, symbol, mark, change24hPct, longOi, shortOi, maxLeverage}]` |
| GET | `/api/candles?symbol=BTC&tf=15m&limit=1000` | `[{t,o,h,l,c,v}]`, `tf` in `1m 5m 15m 1h 4h 1d` |
| GET | `/api/account` | `{equity, available, marginInUse, openPnl, queuedBalance}` |
| GET | `/api/positions` | `[{positionId, symbol, isLong, sizeUsd, marginUsd, leverage, entry, mark, pnlUsd, pnlPct, bustPrice, openedAt}]` plus optional `takeProfit`, `stopLoss` prices |
| GET | `/api/history?limit=200` | `[{positionId, symbol, isLong, sizeUsd, leverage, entry, exit, pnlUsd, fees, openedAt, closedAt}]` |
| POST | `/api/orders/open` | body `{symbol, isLong, marginUsd, leverage, takeProfitPct?, stopLossPct?}` → `{intentId, status}` |
| POST | `/api/orders/close` | body `{positionIds:[...]}` → `{intentId, status}` |
| POST | `/api/orders/close-all` | → `{intentId, status}` |
| GET | `/api/intents/:id` | `{status: queued\|confirmed\|failed\|reverted\|expired\|cancelled, error?}` |
| WS | `/api/stream` | `{type:'mark'\|'positions'\|'account'\|'intent', data}` |

Notes for backend implementers:

- Requests send `credentials: "same-origin"`; authenticate with a cookie on the same origin.
- Errors: any non-2xx status. A JSON body `{error}` or `{message}` is shown to the user.
- `mark` stream data may be one `{symbol, mark, t?}` or an array of them. `intent` data is
  `{intentId, status, error?}`.
- `takeProfitPct` / `stopLossPct` are percent **price moves from entry** (not percent of margin). The
  ticket rejects a stop loss at or beyond the bust distance (`100 / leverage` %).
- The chart draws TP and SL lines only when `/api/positions` returns `takeProfit` / `stopLoss` prices.
- After an order the client polls `/api/intents/:id` once a second (90 tries at most) unless the stream
  settles the intent first.
- The WebSocket reconnects with backoff from 500 ms doubling to 15 s with up to 20% jitter. The header
  reads CONNECTING, LIVE or RECONNECTING.

## Content-Security-Policy

`index.html` ships this meta tag, unchanged in `dist/index.html`:

```
default-src 'self'; connect-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self';
font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'
```

The first five directives are the required policy; the last four only tighten it. To make it work:

- IBM Plex Mono (latin 400 and 600, from `@fontsource/ibm-plex-mono`) is bundled as woff2/woff files in
  `dist/assets`. `assetsInlineLimit: 0` keeps fonts out of `data:` URIs.
- All CSS is one external stylesheet. No `style=` attributes are written in JSX.
- Vite's dev server injects an inline React-refresh script, so a dev-only plugin in `vite.config.ts`
  strips the CSP tag while serving. `vite build` keeps it.
- `connect-src 'self'` covers `ws:`/`wss:` to the same host in current browsers.
- Prefer sending the same policy as an HTTP header from your server too. `frame-ancestors` only works as
  a header.

## Features

- **Header strip**: shortened wallet (full address on hover), equity, available, margin in use, open PnL,
  session key expiry countdown (red under 30 minutes), stream state.
- **F1 TRADE**: chart, open-positions table with per-row Close and a confirmed Close all, and the order
  ticket (market, long/short, margin, log-scale leverage slider 1 to 1000x with presets 10/50/100/250/500/1000,
  optional TP/SL percent, live notional and bust preview, then a confirm dialog that restates side, size,
  margin, leverage, entry and bust price). Intent status shows in toasts.
- **F2 POSITIONS & HISTORY**: full positions table and closed trades with net PnL, fees and win rate.
- **F3 ANALYSIS**: market overview (mark, 24h change, long/short OI, long share, max leverage). The tab is
  reserved for more analysis tools.
- **Keyboard**: F1–F3 tabs (arrow keys, Home and End inside the tab bar), `L` long, `S` short, `M` focus
  margin, `R` review, `Enter` in the ticket reviews, `Esc` cancels a dialog.

### Chart (`src/components/Chart.tsx`, math in `src/indicators.ts`)

- Candlesticks with vertical and horizontal grid lines hidden, timeframes 1m to 1d, initial zoom on the
  last 160 bars, and a crosshair readout (OHLC, BB midline, z-score in sd).
- BB(15): SMA(15) midline `#6366f1`, ±1, 1.5 and 2 population sd. Upper bands are red shades, lower bands
  green shades, all 1px.
- Candle body, border and wick colour by where the close sits in the ladder: `>= +2sd #7f1d1d`,
  `+1.5..+2 #dc2626`, `+1..+1.5 #f97316`, `mid..+1 #f59e0b`, `-1..mid #84cc16`, `-1.5..-1 #4ade80`,
  `-2..-1.5 #16a34a`, `<= -2sd #14532d`.
- Signals at local extremes with a 5-bar lookback on each side: BUY when the low is at or below the lower
  1.5sd band (STRONG BUY at 2sd), SELL when the high is at or above the upper 1.5sd band (STRONG SELL at
  2sd). Within a same-side cluster (bars closer than 10) only the most extreme signal keeps its label.
- Position lines: entry grey solid, TP green, SL red, bust `#FF2D78` dashed only within 35% of mark. Each
  level has an invisible line series across every bar so autoscale keeps it on screen.
- Resize goes through a ResizeObserver and one animation frame, both ignored after unmount. Candle
  requests are aborted when the market or timeframe changes. Streamed marks update only the forming bar.

## Project layout

```
index.html            CSP, title, description, og tags, favicon
public/               favicon.svg, og.png (1200x630 capture of the mock desk)
src/api.ts            types, HTTP client, WebSocket with backoff, mock switch
src/mock.ts           synthetic backend for mock mode
src/indicators.ts     SMA, population sd, band ladder, colours, signals, declutter, order math
src/format.ts         fixed-decimal money, prices (sub-penny), percent, time
src/leverage.ts       log-scale slider mapping, ticket validation
src/components/       Header, Chart, TradeTicket, Tables, Dialog, Toasts
src/*.test.ts         vitest suites
dist/                 committed production export
DESIGN.md             design system of the implemented UI
artifacts/validation.md  checks run, results and limitations
```

## Validation

Commands run on the final source (full record in `artifacts/validation.md`):

| Command | Result |
| --- | --- |
| `npm run typecheck` | passed, no errors |
| `npm test` | 2 files, 60 tests passed |
| `npm run build` | passed; JS 366.6 kB (118.2 kB gzip), CSS 13.1 kB, mock chunk 4.9 kB |
| Playwright interaction script (Chromium, export served under `/preview/`) | 39 of 39 checks passed |
| taste@1 probe on `dist/` | 15/16: `render` fails only on the expected 404s from `/api` on a static host with no backend |
| taste@1 probe on `dist/?mock=1` | 16/16 |

Not performed: WebKit/Safari (no WebKit build on this machine), screen reader, native 200% zoom, a
physical device, and a test against a real backend (none was supplied).
