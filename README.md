# PAPER DESK

A **read-only account viewer for Papertrade** (papertrade.xyz), the synthetic perps exchange on HyperEVM priced at Hyperliquid mid. Paste any public EVM address to inspect its BTC (instrumentId `0`) and ETH (instrumentId `1`) activity, with the existing BB(15) sigma ladder overlaid. Version 3 adds **ERL-100 (Excursion Restitution Ledger)**, an original bar-closed entry/exit indicator for 100× BTC and ETH trades on Papertrade, with a live liquidation-map veto and a Papertrade-rules backtest.

There is no wallet connection, signing, session key, order ticket or transaction action. The browser sends only GET requests to its own origin under `/api`. Fonts, scripts and images are bundled locally. A backend implementing the contract below is needed for real account data; the static export does not contain or operate that service.

## Install, preview and rebuild

The existing package manifest, lockfile and Vite configuration are preserved.

```sh
npm ci
npm run dev             # frontend development; /api must be served on this origin
npm run dev:mock        # development with synthetic data
npm run typecheck
npm test
npm run build           # typecheck + Vite production export
npm run preview         # preview dist; open ?mock=1 without a backend
```

`dist/index.html` and all required assets are included alongside the source and existing `package-lock.json`. Vite's `base: "./"` produces relative asset URLs for subpath hosting, IPFS gateways or an ENS name. Navigation uses a single page with tabs; no rewrite rules are needed. For real data, serve `/api/*` on the same origin as the export. The existing development configuration does not proxy `/api` to another server.

## Address bar and mock mode

- Paste or type `0x` followed by exactly 40 hexadecimal characters. Validation is case-insensitive; loaded addresses are trimmed and normalized to lowercase.
- **Enter** loads the account and writes `?address=…` to the URL, preserving `?mock=1` when present. Shared URLs and browser Back/Forward restore the selected account.
- **Esc** in the address bar, or **Clear**, clears the account and query parameter.
- The dropdown stores the last ten unique addresses in this browser's `localStorage`. **Name address** adds or edits an optional nickname. If storage is unavailable, the current visit still works. No account is automatically loaded from storage.
- **`?mock=1`** enables a separate, locally bundled synthetic backend for any valid address. `VITE_MOCK=1` also enables it at development/build time. The visible **MOCK DATA** badge always identifies this mode.

Mock mode also serves deterministic synthetic liquidation maps (150 buckets around the mock mark, all five ranges, re-seeded every 30 s) and a protocol summary with an empty queue. They are synthetic and are not Papertrade liquidity. Mock data is deterministic per address: BTC/ETH candles on all six timeframes, three open positions, 158 settled positions plus three Opened events, 83 cashflows (including a pending withdrawal), and portfolio curves. Prices move modestly on quote polls. Synthetic transactions have no invented transaction hash. Mock mode makes no API or third-party requests.

An unknown or empty account shows **“No activity for this account.”** A backend failure shows **ERROR**, keeps the last successful data and offers a retry; it never silently substitutes mock data.

## Screens

**F1 ACCOUNT** shows equity, all-time PnL, open PnL, PAPER minted, win rate, settled trade count and liquidation count. Select BTC/ETH and a timeframe, toggle account overlays, then inspect open positions and recent trades. Selecting a trade row (or its keyboard-accessible market button) scrolls to and zooms the chart around the entry/exit. If necessary, it chooses a longer timeframe to bring that trade into the available 1,000 candles.

The existing indicator engine and its tests are unchanged: SMA(15), population standard deviation, the ±1/1.5/2σ ladder, candle colors, five-bar extreme signals, ten-bar same-side decluttering and initial 160-bar view. Indicator signals remain visible when account overlays are hidden.

Account overlays add a green up arrow below long-entry bars, red down arrow above short-entry bars, small neutral exit squares, and hot-pink `#FF2D78` **✕ LIQ** liquidation markers. Because lightweight-charts v5 has no X-shaped built-in marker, liquidations use a zero-size square with the literal X and LIQ text. Open-position entry lines are gray and solid; bust lines are hot pink and dashed only within 35% of mark. The existing invisible anchors keep position levels in autoscale. A counter reports events inside loaded candle history; events outside it are never snapped to an unrelated bar.

Above the market toolbar, the always-visible **ERL-100 signal** panel shows, per market, the current state (**LONG / SHORT / FLAT / EXIT**), a confidence band with the ERL score, the stop in price and percent and as a share of the 1% bust distance at 100×, the target, bars since the signal and holding bar, the nearest large long and short liquidation clusters from the live map, and the live veto status. Its own 1m/5m selector picks the signal timeframe. **How ERL-100 works** opens a short explainer. The **Signal** checkbox beside Account overlays draws the ERL layer on the chart: small orange ERL entry arrows on the confirming bar, small exit squares, dashed stop and dotted target lines across each holding window and an **ERL stop** price line for the current plan. The Bollinger ladder, its markers and account overlays stay as they were. On 15m and longer, candidates are drawn as small grey circles only, because the 100× entry policy is limited to 1m and 5m.

**F2 HISTORY** provides separate 75-row pages for trades and cashflows. Market, side and outcome filters compose for trades; cashflows have kind and status filters. Outcome includes Win/Loss and the backend event kinds. Each CSV exports **all matching loaded history**, across pages, with raw amounts, UTC dates and full hashes when supplied. Cells are quoted and formula-like text is escaped for spreadsheets.

**F3 ANALYSIS** provides an equity area curve or PnL line curve with `1d`, `1w` and `all` ranges. Pure functions in `src/stats.ts` calculate win rate, mean/median PnL, best/worst trade, profit factor, average leverage/hold time, liquidation rate and PnL groups by market/side. The entry histogram uses each entry price relative to the containing candle's BB(15), with a selectable candle timeframe and per-bucket settled win rate.

The **ERL-100 backtest at 100×** section runs the indicator on the loaded candles (BTC/ETH, 1m/5m, up to 1,000 bars). It shows trade count, win rate, profit factor, average R, net result and max drawdown as a percent of one fixed margin, busts, a bust-stress result, an equity curve and the latest 25 simulated trades. It also compares the viewed account's settled entries with the signal: entries made **with** the signal in force, **against** it, or with **no signal in force**, each with its win rate. Entries outside the loaded candles are counted separately.

**F1–F3** work globally. Inside the tab bar, arrows, Home and End use roving focus. Times and CSV dates are always **UTC**.

## ERL-100 indicator

The specification is the v3 research report (`artifacts/papertrade-research.md` from the research job, §4–§6). The implementation lives in `src/signal/` as deterministic pure TypeScript. No function reads a clock, the network, storage or the DOM: `nowSec` is passed in.

- `intervals.ts`: interval subtraction and the exact piecewise integral of the max-weight density.
- `payoff.ts`: Papertrade's documented asymmetric-impact payout (deadband, standard and off-hours holdbacks, scale curve, 2% win fee, optional 0.5% builder fee). Losses are taken in full. The research payout table is reproduced to 0.0001 percentage points.
- `validate.ts`: candle validation (finite positive OHLC, ordering, regular grid, gaps start new segments, still-forming bars excluded by `t+Δ <= nowSec`) and frozen default parameters.
- `core.ts`: `computeErl`. Each wick is rejected territory and each body is accepted territory. A 24-bar ledger keeps the parts of wicks that later closed bodies have not covered, with linear recency weights. A sweep on bar j penetrates the 12-bar closing frontier by 3–25 bps and closes back above it. Bar i confirms with no retouch and at least 1 bp of progress. Stop sits 2 bps beyond the sweep (5–25 bps risk), and the target is 3× risk (20–80 bps). Entry gates: support coverage J ≥ 0.35, overhead obstacle A ≤ 0.35, net payout/risk ≥ 1.8 and score `J·(1−A)·netRR ≥ 0.80`. **A signal confirms at the close of bar i** and can fill only at the next bar's open. Both sides qualifying gives AMBIGUOUS. `assessErlFill` re-checks a fill against the frozen ledger: 2-bp drift limit, and the stop must sit 30 bps inside bust.
- `backtest.ts`: one position per market, next-open fills, stop-first when a bar touches both levels, gap-past-stop fills at the open, gap-past-bust loses the full margin, and an opening gap through the target settles at the frozen target (never the better open). Exits are frontier/sweep failure at the close (filled at the next open) or time after six holding bars, followed by a six-bar cooldown. A position interrupted by missing candles stays UNRESOLVED_GAP with no exit; it keeps the one-position lock, so no new candidate is taken until its exit is observed. `signalState` derives LONG/SHORT/FLAT/EXIT from the latest closed bar (phase `unresolved` for gap risk).
- `live.ts`: **live only, no liquidation history.** Validates the map (exactly 150 contiguous buckets, matching symbol/range, 15 s staleness / 2 s future limits) and the protocol summary. The veto applies only to a candidate on the latest closed bar within its entry window. It vetoes material same-side mass crowding the adverse path or sitting within 5 bps of entry, and blocks new entries while the payout queue is active or LP ≤ 0. Results are NO MAP VETO (never "safe"), NO MAP EVIDENCE, RANGE INSUFFICIENT or UNKNOWN. `nearestClusters` reports the nearest contiguous run of large buckets on each side of price. `entryEligibility` keeps the core candidate separate from current live entry eligibility: only NO MAP VETO and NO MAP EVIDENCE leave a pending candidate actionable. VETO, UNKNOWN (missing, stale or failed map/summary), RANGE INSUFFICIENT and PAYOUT RISK show “Core LONG · NO NEW ENTRY” with the reason.
- `compare.ts`: classifies account entries as with, against or without a signal in force.

How the site uses it:

- The signal panel and the chart layer both analyse only candles that were already closed when the feed snapshot was fetched (`closedAtFetch`), so a bar that was forming at fetch time is never treated as closed. The chart reconciles with `/api/candles` every 15 s and 1.5 s after each bar roll; quote samples only shape the forming bar.
- Chart entry arrows come from the immutable confirmed candidates. Simulated exits and skipped fills are drawn as separate markers, so a later fill rejection never removes an arrow.
- A failed candle refresh keeps the last good values marked STALE, with the error, the last good bar time and a retry button; a pending candidate then shows NO NEW ENTRY. A rejected series (for example a negative volume) shows INVALID DATA and the first diagnostic on F1, and F3 withholds all numbers.
- Live cluster context is shown only from a map at most 15 s old; otherwise the rows read STALE with the snapshot time.
- Economics are labelled “papertrade.xyz documented defaults · economics unverified · builder 0%”. F3 reruns the whole backtest with a 0.5% builder fee (`papertradeProfile(symbol, 0.005)`), so entry gates and fees are recomputed, and shows both columns.

ERL-100 is a research hypothesis with untuned defaults. The score is a decision budget, not a probability, and no performance claim is made. PAPER emissions are valued at zero. 1,000 1m bars are about 16.7 hours and 1,000 5m bars about 3.5 days, which is too short to validate an edge.

## Read-only backend contract

Every request is an explicit GET with `Accept: application/json` and `credentials: "same-origin"`. The client has no request body, WebSocket, intent or mutation method. The typed contract is in `src/api.ts`.

| GET path | Response |
| --- | --- |
| `/api/markets` | `[{instrumentId, symbol, mark, change24hPct, volume24hUsd}]` |
| `/api/candles?symbol=BTC&tf=15m&limit=1000` | `[{t,o,h,l,c,v}]` |
| `/api/markets/:symbol/liquidation-map?range=1` | `{symbol, rangePct, from, to, asOf, buckets:[150 × {lo,hi,longUsd,shortUsd,longCount,shortCount}], below:{…}, above:{…}}`; range `1\|2\|5\|10\|25`, live snapshot only |
| `/api/protocol/summary` | `{asOf, tvlUsd, marginUsd, lpUsd, queueUsd, openPositions, lifetimeVolumeUsd}` |
| `/api/accounts/:address/summary` | `{address, equity, pnl, paperMinted, stakingRewards, asOf}` |
| `/api/accounts/:address/portfolio?range=1d` | `{points:[{t,equity,pnl}]}` |
| `/api/accounts/:address/positions` | `[{positionId,symbol,isLong,marginUsd,leverage,sizeUsd,entry,mark,pnlUsd,pnlPct,bustPrice,openedAt}]` |
| `/api/accounts/:address/trades?cursor=&limit=75` | `{items:[{positionId,symbol,isLong,kind,marginUsd,leverage,entry,exit,pnlUsd,feeUsd,paperMinted,openedAt,closedAt,txHash}],nextCursor}` |
| `/api/accounts/:address/cashflows?cursor=&limit=75` | `{items:[{t,kind,amountUsd,route,status,txHash}],nextCursor}` |

- Candle timeframe: `1m`, `5m`, `15m`, `1h`, `4h`, `1d`. Candle `t` is a bar-open Unix timestamp in seconds; millisecond values are normalized, sorted and deduplicated on receipt.
- Other timestamps may be Unix seconds, milliseconds or ISO strings. Send ISO strings with a timezone. `portfolio` ranges are `1d`, `1w`, `all`.
- Trade kinds: `Closed`, `Liquidated`, `TakeProfit`, `StopLoss`, `Opened`. An Opened event may have `exit: null`, `closedAt: null`; an unavailable `txHash` may be `null`. Trade PnL is used as reported; fees are displayed but not subtracted a second time.
- Cashflow kinds: `Deposit`, `Withdrawal`. `route` and `status` are display strings. End pagination with `nextCursor: null` (an empty string is also treated as the end). Cursors are opaque and URL-encoded.
- The client follows all cursor pages before replacing the history snapshot, sorts events newest first and rejects repeated cursors. Pagination/filtering/CSV/statistics then operate over this complete snapshot. Very large accounts consequently require memory proportional to their returned history.
- Empty accounts may return empty arrays/pages and a zero summary. Account endpoint **404s** are normalized to empty results; other non-2xx responses remain errors. Market/candle 404s are errors. Individual HTTP requests time out after 12 seconds and can be aborted when the address changes or the tab hides.
- The ERL panel polls BTC and ETH candles on its timeframe every **15 seconds**, and the liquidation maps (`range=1`) plus the protocol summary every **5 seconds**, only while an address is loaded and the page is visible. Map and summary JSON is validated at runtime before use. `asOf` is normalised to Unix seconds once at the client boundary. A failed or invalid live route shows live status **UNKNOWN** and is never replaced by mock data.
- Summary and positions poll every **5 seconds**; trades and cashflows every **30 seconds**. Market quotes also poll every 5 seconds. Requests pause while the document is hidden and both account groups refresh on return. In-flight groups do not overlap.
- The header reads **LIVE** after both account groups succeed; **STALE** while hidden, after 15 seconds without a fast snapshot, after 65 seconds without history, or if summary `asOf` is over 15 seconds old; **ERROR** after an account-group failure. **IDLE** and **LOADING** describe initial states. Chart/portfolio errors have local recovery controls.

### Statistical definitions and limits

Statistics deduplicate by `positionId` and keep the latest terminal event. Opened events do not count as settled trades. Win rate uses profitable settlements divided by all settlements, including break-even trades. Profit factor is total positive PnL divided by absolute total negative PnL: infinity for profit without losses, zero for losses without profit, and unavailable when neither exists. Average hold uses valid nonnegative close-minus-open times.

The sigma histogram deduplicates entry events, uses the entry's market and exact containing timeframe bucket, and never borrows a candle across a gap. Its win rates exclude unsettled entries. Up to 1,000 candles per market are available through this contract; older entries, warmup bars, missing bars and zero-deviation windows remain visibly **unclassified**. A longer timeframe can increase coverage. The containing candle's final close is included in its band calculation; this is historical candle context, not an intrabar replay or a backtest of what was knowable at the exact entry instant. Entries beyond the longest returned history cannot be reconstructed by this frontend.

`paperMinted` and `stakingRewards` are displayed as PAPER quantities; monetary fields/curves are USD. All-time PnL and equity come from the summary endpoint, independently of computed trade statistics.

## Content Security Policy and assets

The production HTML retains:

```text
default-src 'self'; connect-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'
```

IBM Plex Mono Latin 400/600 is bundled from the existing font dependency as WOFF/WOFF2. Production has external CSS/JS, no inline script, no remote assets or analytics. The unchanged development-only Vite plugin strips the CSP for React refresh; the production export retains it. Local favicon, description, title, Open Graph metadata and a refreshed 1200×630 read-only share image are included.

## Validation

Actual results and the six-domain Better Interface review are in [artifacts/validation.md](artifacts/validation.md).

| Check | Result |
| --- | --- |
| `npm run typecheck` / `npm run build` | Passed; production export in `dist/` |
| `npm test` | 165 tests passed in 7 files: 77 ERL-100 tests in `src/signal/` (including the unresolved-gap lock, the target-gap open and live entry eligibility), 3 view-helper tests in `src/erlView.test.ts` (closed-at-fetch rows, invalid-series diagnostic, recomputed 0.5% builder scenario), plus the 88 existing tests unchanged |
| Chromium scenario run on the export with intercepted `/api` routes and a fixed page clock (`test/scratch/scen.mjs`, revision 2) | Live VETO and summary HTTP 503 both show “Core LONG · NO NEW ENTRY” with the reason; clear map shows actionable LONG; a candle 503 after 16.5 s shows STALE, HTTP 503, the last good bar time and a retry that recovers; a 120 s old map shows STALE clusters and UNKNOWN; a negative-volume row shows INVALID DATA (INVALID_ROW) on F1 and an alert with no numbers on F3; F3 shows the builder 0% / 0.5% table; the chart keeps its confirmed ERL arrow after the next fill is skipped for drift; the chart reports the same LONG as the panel after a bar roll, with no reload. No page overflow at 390 or 1440 on F1 and F3; no console errors apart from the intended 404/503 fixtures |
| Earlier interaction suite (`test/scratch/interactions.mjs`, previous round) | 40/40 passed at 390 and 1440 wide; not rerun in this revision |
| Pinned taste probe on the empty export, this revision | 15/16; the one failure is monospace prose, kept for the requested Bloomberg look |

Real backend integration, a physical device, a screen reader and Safari/WebKit remain unverified. Axe was not rerun for v3; `artifacts/accessibility.json` is the v2 record.
