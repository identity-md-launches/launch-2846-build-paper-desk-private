# PAPER DESK design system

## Overview

PAPER DESK is a read-only Papertrade account viewer for people inspecting public perps activity. It retains the existing Bloomberg terminal direction: near-black surfaces, orange chrome, warm gray text, one bundled monospace family, square corners, dense tables and hairline rules. The public-address form is the primary interaction. Account metrics lead the loaded workspace; chart, positions and recent trades follow in that order.

This revision uses a naturally scrolling page on desktop and mobile. Data tables scroll horizontally within named, focusable regions. There is no order ticket, trading dialog, connected-wallet state or signing flow. Changing data never implies authority to trade.

## Colors

The canonical tokens are in `:root` in `src/styles.css`; components reuse them. Chart canvas colors are specified in `src/components/Chart.tsx`, `src/components/Analysis.tsx`, `src/chartOverlays.ts` and the unchanged `src/indicators.ts`.

| Token | Value | Use |
| --- | --- | --- |
| `--color-bg` | `#050607` | Page, inputs, chart backgrounds, primary-action ink |
| `--color-surface` | `#0b0c0d` | Tab bar, table headers, panel headings, footer |
| `--color-surface-raised` | `#13140f` | Hover and selected segments, data/error notices |
| `--color-line` | `#2a2620` | Panel/table rules and chart scale borders |
| `--color-line-strong` | `#4a4237` | Field, button and badge outlines |
| `--color-text` | `#c7bca6` | Body text and numeric values |
| `--color-text-dim` | `#8f8676` | Labels, hints, inactive controls and secondary metadata |
| `--color-accent` | `#ff8c00` | Brand, primary Load button, selected tab, panel headings, focus |
| `--color-accent-ink` | `#050607` | Text on orange fills |
| `--color-profit` | `#22c55e` | Positive PnL, long entries, LIVE |
| `--color-loss` | `#ef4444` | Negative PnL, short entries and errors |
| `--color-bust` | `#ff2d78` | Liquidation/bust levels, LIQ text and explicit mock badge |
| `--color-mid` | `#6366f1` | Existing BB midline reference color |

Chart rules are preserved: BB mid `#6366f1`; upper bands `#fca5a5`, `#f87171`, `#dc2626`; lower bands `#86efac`, `#4ade80`, `#16a34a`. Entry levels are `#8a8578`, bust levels `#FF2D78`, and exit squares `#c7bca6`. The eight candle colors remain in `CANDLE_COLORS` in `src/indicators.ts`, including dark outer-bucket colors. Those candle colors are visual encodings, not text colors. The midline's text legend uses the lighter `#a5a6ff` for readable text.

Equity uses an orange area series with an 18%-to-zero alpha fill over the chart background. PnL uses a green line. Histogram meters use orange. This area fill indicates chart magnitude; it is not a general surface treatment.

Rendered measurements in Chromium against `#050607`: orange brand 8.69:1, dim text 5.64:1, profit 8.90:1, loss 5.39:1, bust 5.70:1. The observed Load-button hover pair, `#050607` on `#ffa333`, measured 10.18:1. See `artifacts/accessibility.json` for the exact sampled pairs. Canvas content, every hover background and physical-device rendering are not exhaustively contrast-audited.

## Typography

- `--font-mono`: **IBM Plex Mono**, then `ui-monospace`, `SFMono-Regular`, Menlo, Consolas, monospace. `src/main.tsx` imports the local Latin 400 and 600 font CSS from the existing dependency; WOFF/WOFF2 assets ship in `dist/assets`.
- Weights: `--fw-regular: 400`, `--fw-bold: 600`. Headings, strong text and the primary button use 600, matching the bundled face. No synthesized third weight is needed.
- Sizes: `--fs-xs: 11px` (labels, hints, table headings, status); `--fs-sm: 12px` (body, tables, controls); `--fs-md: 13px` (panel headings and mobile values/brand); `--fs-lg: 16px` (metric values, desktop brand and mobile text inputs); `--fs-xl: 20px` (empty-state heading/prompt).
- Body line-height is 1.5; h1 and the empty-state heading use 1.2. Natural letter-spacing throughout. Introductory copy has a 65ch maximum measure and balances its heading.
- `.num` and `.grid` use tabular figures. USD/price/percent formatting is centralized in `src/format.ts`; dates always use UTC getters. Critical addresses are also rendered as full, selectable text with `overflow-wrap: anywhere`.
- Uppercase is retained for terminal chrome: the brand, F-key tab names, status and MOCK DATA badge. Labels and explanatory content use sentence case.

The monochrome prose treatment deliberately follows the requested Bloomberg look and existing system. The taste probe's generic “no monospace prose” preference remains an explicit visual-direction exception, not a claim that the probe passed it.

## Layout

The base spacing tokens are 4, 8, 12 and 16px (`--space-1` through `--space-4`). Larger section gaps and empty-state spacing follow that 4px grid. Controls have a 34px base minimum height. The app uses a flex column with `min-height: 100dvh`; the footer follows content instead of covering it. The loaded workspace uses the available viewport width; the empty introduction caps at 1100px.

- **Above 1150px:** brand/utilities share the first header line. Address label, field/actions and recent-address controls share the next line. Seven account metrics form one strip. The market controls, readout and chart fill the workspace width.
- **At 1150px and below:** address tools move below the main field row. Metrics become four columns. Market utilities wrap, and the optional navigation note hides.
- **At 760px and below:** the header wraps to product identity/status, descriptor, labeled full-width 44px address input, Load/Clear actions, and recent/nickname controls. Tabs share the width with 44px targets. Metrics use three columns; chart toolbar/readout wrap into reserved space. Main text inputs use 16px; analysis filter selects also use 16px. History filters wrap from two columns to one as needed. Analysis grouping tables stack; statistics use two columns.
- **At 380px and below:** metrics use two columns, the market-volume line takes a full row, and histogram columns tighten.

The address dropdown can shrink beside the nickname control, fixing the observed 2px overflow at 320px. Full hashes stay complete in the table scroller rather than being ellipsized. Each table has a nearby horizontal-scroll cue naming its details. The sigma histogram uses a four-column CSS grid: bucket, native meter, count and settled win rate.

Price-chart height is `clamp(310px, 48vh, 600px)` on desktop and 310px on mobile. Portfolio-chart height is 300px on desktop and 260px on mobile. A ResizeObserver updates each canvas. The price-chart loading/error layer holds its existing chart space.

Chromium reflow checks covered 320, 390, 760, 1024 and 1440 CSS-pixel widths across all three loaded screens, plus the initial 390px empty state. These are viewport checks, not native 200% browser zoom or a physical phone test.

## Elevation & Depth

The interface is flat. Tonal surfaces and 1px separators carry structure; there are no ambient drop shadows. A selected segment uses an inset 2px orange underline as its state indicator. The selected tab uses an orange fill. The address nickname editor is a native `<details>` disclosure with a bordered, solid-surface editing area; it is a nonmodal disclosure, not a focus-trapping dialog.

Chart overlays use the existing canvas layer. Loading/error copy occupies an absolutely positioned chart layer. The focused-trade message sits in normal flow with orange rules and a Reset view button. No sticky toolbar covers account data.

## Shapes

`--radius: 0` is applied globally. Buttons, fields, table cells, meters and badges remain square. The status dot is a 6px square. Chart markers have deliberately different shapes: entry arrows, exit squares and literal ✕ LIQ text for liquidations. Indicator arrows and their labels retain the existing decluttering behavior.

## Components

| Component/pattern | Source | Behavior and states |
| --- | --- | --- |
| Address header | `src/components/Header.tsx`, `.addressbar`, `.address-tools` | Visible label, paste/typing, Enter load, Esc clear, inline validation and focus, recent-ten native dropdown, optional nickname disclosure, storage-unavailable notice |
| Address helpers | `src/address.ts` | Exact-length validation, lowercase normalization, safe history parsing/deduplication, URL updates |
| Feed status | `src/useAccount.ts`, `.conn-*` | Text plus square status cue; IDLE/LOADING/LIVE/STALE/ERROR; visibility-aware polling, stale snapshot detection and retry |
| Workspace tabs | `src/App.tsx`, `.tab` | F1/F2/F3, WAI-ARIA selected state, roving tabindex, arrows/Home/End; only the active loaded content mounts |
| Summary strip | `src/App.tsx`, `.metrics` | Seven values with explicit labels; unavailable data reads `--`; separate PAPER staking-reward line |
| Market chart | `src/components/Chart.tsx` | Existing BB ladder/candle/signal behavior, six timeframes, mark updates, crosshair readout, loading/error/retry, focused-trade zoom/reset |
| Account markers | `src/chartOverlays.ts` | Timestamp-aligned entries and exits, deduplicated settlements, pink X/LIQ; off-range event coverage is disclosed; toggle also removes position lines/anchors |
| Segmented controls | `.seg`, `.seg-btn` | Native buttons with `aria-pressed`; market, timeframe, curve metric and range selections |
| Data tables | `src/components/Tables.tsx` | Semantic headers, focusable horizontal scroll, loading/empty states; trade row pointer action has an equivalent native market button |
| History filters/pages/CSV | `src/components/Tables.tsx`, `src/csv.ts` | Named native selects, explicit reset, 75-row independent pagination, disabled page boundaries; CSV exports all matching rows |
| Analysis | `src/components/Analysis.tsx`, `src/stats.ts` | Area/line curve, range and metric controls, nine statistics, two group tables, eight sigma buckets and coverage disclosure; local errors/retry |
| Empty/error notices | `src/App.tsx`, `.empty-workspace`, `.banner`, `.no-activity` | Empty selection explains what to paste; an unknown account has no-activity copy; service failures retain last successful data and provide recovery |

Every interactive element has a visible 2px orange focus outline with 2px offset. There is a first-focusable skip link. Native controls handle ordinary keyboard behavior; readout changes do not announce every price tick. Address errors use an alert region; account status and filter/page results use polite status semantics. State also has text/signs/shapes, not color alone.

Hover styling is gated by `hover: hover`; enabled controls brighten when pressed. Only background/color transitions run (100ms ease-out), opt-in under `prefers-reduced-motion: no-preference`. Forced-colors mode uses the system Highlight focus color. No entrance or endless animation exists.

## Do's and Don'ts

- Reuse `.table-panel`, `.panel-head`, `.table-scroll`, `.grid` and the existing field/button tokens for new read-only views.
- Keep the public address and primary Load action near the top. Keep full identifiers available and use local assets.
- Preserve indicator math, candle colors and signal semantics in `src/indicators.ts`; overlay work belongs in the separate overlay helper/component.
- Route data reads through the GET-only `Backend` interface. Keep synthetic data visibly identified; show unavailable data honestly.
- Put explanatory limits beside the statistic they affect, especially incomplete candle coverage and intrabar context.
- Do not add wallet infrastructure, mutation methods, external runtime requests, inline scripts, inline JSX styles, rounded-card styling or a new font family.

To add another read-only panel, place a semantic section inside the relevant existing tab, reuse the table/chart primitives and formatting helpers, add its typed GET method and mock implementation if needed, and check its loading/empty/error states at 320 and 390px. Required CSP and static relative assets remain system invariants.

Design-guidance attribution and the supplied licenses are retained in `artifacts/design-guidance-NOTICE.md` and `artifacts/design-guidance-LICENSE`.
