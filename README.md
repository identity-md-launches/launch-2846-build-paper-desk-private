# PAPER DESK

A **read-only account viewer for Papertrade** (papertrade.xyz), the synthetic perps exchange on HyperEVM priced at Hyperliquid mid. Paste any public EVM address to inspect its BTC (instrumentId `0`) and ETH (instrumentId `1`) activity, with the existing BB(15) sigma ladder overlaid.

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

Mock data is deterministic per address: BTC/ETH candles on all six timeframes, three open positions, 158 settled positions plus three Opened events, 83 cashflows (including a pending withdrawal), and portfolio curves. Prices move modestly on quote polls. Synthetic transactions have no invented transaction hash. Mock mode makes no API or third-party requests.

An unknown or empty account shows **“No activity for this account.”** A backend failure shows **ERROR**, keeps the last successful data and offers a retry; it never silently substitutes mock data.

## Screens

**F1 ACCOUNT** shows equity, all-time PnL, open PnL, PAPER minted, win rate, settled trade count and liquidation count. Select BTC/ETH and a timeframe, toggle account overlays, then inspect open positions and recent trades. Selecting a trade row (or its keyboard-accessible market button) scrolls to and zooms the chart around the entry/exit. If necessary, it chooses a longer timeframe to bring that trade into the available 1,000 candles.

The existing indicator engine and its tests are unchanged: SMA(15), population standard deviation, the ±1/1.5/2σ ladder, candle colors, five-bar extreme signals, ten-bar same-side decluttering and initial 160-bar view. Indicator signals remain visible when account overlays are hidden.

Account overlays add a green up arrow below long-entry bars, red down arrow above short-entry bars, small neutral exit squares, and hot-pink `#FF2D78` **✕ LIQ** liquidation markers. Because lightweight-charts v5 has no X-shaped built-in marker, liquidations use a zero-size square with the literal X and LIQ text. Open-position entry lines are gray and solid; bust lines are hot pink and dashed only within 35% of mark. The existing invisible anchors keep position levels in autoscale. A counter reports events inside loaded candle history; events outside it are never snapped to an unrelated bar.

**F2 HISTORY** provides separate 75-row pages for trades and cashflows. Market, side and outcome filters compose for trades; cashflows have kind and status filters. Outcome includes Win/Loss and the backend event kinds. Each CSV exports **all matching loaded history**, across pages, with raw amounts, UTC dates and full hashes when supplied. Cells are quoted and formula-like text is escaped for spreadsheets.

**F3 ANALYSIS** provides an equity area curve or PnL line curve with `1d`, `1w` and `all` ranges. Pure functions in `src/stats.ts` calculate win rate, mean/median PnL, best/worst trade, profit factor, average leverage/hold time, liquidation rate and PnL groups by market/side. The entry histogram uses each entry price relative to the containing candle's BB(15), with a selectable candle timeframe and per-bucket settled win rate.

**F1–F3** work globally. Inside the tab bar, arrows, Home and End use roving focus. Times and CSV dates are always **UTC**.

## Read-only backend contract

Every request is an explicit GET with `Accept: application/json` and `credentials: "same-origin"`. The client has no request body, WebSocket, intent or mutation method. The typed contract is in `src/api.ts`.

| GET path | Response |
| --- | --- |
| `/api/markets` | `[{instrumentId, symbol, mark, change24hPct, volume24hUsd}]` |
| `/api/candles?symbol=BTC&tf=15m&limit=1000` | `[{t,o,h,l,c,v}]` |
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

Actual results and the six-domain Better Interface review are in [artifacts/validation.md](artifacts/validation.md). The worker ran the production build and typecheck, the unchanged indicator suite plus new statistics/interaction-related unit tests, browser interaction checks against the export under `/preview/`, and the pinned taste probe. Screenshots and compact machine-readable results are included in `artifacts/`.

| Check | Result |
| --- | --- |
| `npm run typecheck` and `npm run build` | Passed; complete production export included |
| `npm test` | 88 tests passed in 4 files, including 40 unchanged indicator tests |
| Chromium interactions on the production export | 31/31 passed, including GET-only paths, visibility-aware polling and CSV downloads |
| Axe on empty selection and all three loaded screens | Zero violations; manual-review items remain documented |
| Pinned taste probe, empty and mock-account states | 15/16 each; monospace prose retained for the requested Bloomberg look |

Build/test commands ran in a temporary copy with the unchanged manifest and lockfile, keeping installed dependencies out of the repository. The complete checked export was copied into `dist/`.

Real backend integration, a physical device, a screen reader and Safari/WebKit remain unverified. WebKit was installed but could not launch because this machine lacks its required shared libraries. The HTTP integration checks used intercepted same-origin responses; the mock checks used the actual exported mock implementation.
