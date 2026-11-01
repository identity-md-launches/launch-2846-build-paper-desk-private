# PAPER DESK design system

## Overview

PAPER DESK is a one-user trading terminal for someone who already trades Papertrade perps and wants a
dense, keyboard-first desk. The look follows the brief: a Bloomberg terminal. That means a near-black page,
orange as the only accent, warm grey text, green and red reserved for profit and loss, one monospace
family, square corners, hairline rules and dense tables. Hierarchy comes from colour (orange titles, dim
labels over bright values) and position, not from type size. Each screen is a fixed-height terminal on
desktop. Panels scroll inside themselves and the page never does.

System-wide rules: every number uses tabular figures; money is a fixed-decimal string from `src/format.ts`;
state is never shown by colour alone (sides read "Long"/"Short", PnL carries a sign, the stream state is
a word).

## Colors

Defined as custom properties on `:root` in `src/styles.css`. Hex notation throughout.

| Token | Value | Role |
| --- | --- | --- |
| `--color-bg` | `#050607` | Page, chart background, inputs, table cells |
| `--color-surface` | `#0b0c0d` | Ticket, tab bar, panel heads, table header, status bar, dialog |
| `--color-surface-raised` | `#13140f` | Hover rows and buttons, toasts, the no-backend banner |
| `--color-line` | `#2a2620` | Hairline rules, segmented-control gaps, chart scale borders |
| `--color-line-strong` | `#4a4237` | Input and button borders, disabled segment text |
| `--color-text` | `#c7bca6` | Body text and values |
| `--color-text-dim` | `#8f8676` | Labels, table headers, hints, inactive tabs |
| `--color-accent` | `#ff8c00` | Brand, selected tab and segment, panel titles, focus ring, row Close |
| `--color-accent-ink` | `#050607` | Text on accent, profit, loss and bust fills |
| `--color-profit` | `#22c55e` | Positive PnL, Long, confirmed toasts, LIVE |
| `--color-loss` | `#ef4444` | Negative PnL, Short, errors, Close all, failed toasts |
| `--color-bust` | `#ff2d78` | Bust prices, bust chart line, MOCK DATA badge |
| `--color-mid` | `#6366f1` | BB midline (the chart sets it directly) |

Chart-only colours live in code next to their use: the candle ladder in `CANDLE_COLORS`
(`src/indicators.ts`: `#7f1d1d #dc2626 #f97316 #f59e0b #84cc16 #4ade80 #16a34a #14532d`, neutral
`#6b6457` before the first full window), and the band and position-line colours in `BAND_STYLE` and
`LINE_COLORS` (`src/components/Chart.tsx`). The legend in `styles.css` (`.lg-*`) repeats the band hues.

Contrast was measured by the taste@1 probe (all text pairs pass 4.5:1, or 3:1 when large, at 320/390/1440
in mock mode). Individual ratios were not recorded.

## Typography

- Family: `--font-mono`: "IBM Plex Mono", then `ui-monospace`, SFMono-Regular, Menlo, Consolas, monospace.
  Bundled from `@fontsource/ibm-plex-mono`, latin subset, weights 400 and 600, imported in `src/main.tsx`.
  The chart canvas uses the same family and redraws once `document.fonts.ready` resolves.
- Weights: `--fw-regular` 400 and `--fw-bold` 600. No other weights or italics.
- Scale (5 sizes):

| Token | Size | Used for |
| --- | --- | --- |
| `--fs-xs` | 11px | Labels, table headers, hints, errors, kbd, status bar, stream state |
| `--fs-sm` | 12px | Body default, table cells, tabs, segments, buttons, readout |
| `--fs-md` | 13px | Header values, inputs, preview values, primary buttons, brand |
| `--fs-lg` | 16px | Leverage value; inputs on coarse pointers (prevents iOS zoom) |
| `--fs-xl` | 20px | Dialog titles |

- Line-height 1.45 on body; 1.2 on dialog titles. Natural letter-spacing everywhere.
- Capitals are written in the source, not with `text-transform`, and only for terminal chrome: the brand,
  header metric labels, tab labels, stream state and the MOCK DATA badge. Content (panel titles, table
  headers, labels, buttons) uses sentence case.
- `.num` sets `font-variant-numeric: tabular-nums` on every changing value.

## Layout

- Spacing: `--space-1` 4px, `--space-2` 8px, `--space-3` 12px, `--space-4` 16px. Controls: `--control-h`
  30px. Ticket column: `--ticket-w` 320px.
- Shell (`.app`): a flex column at `100dvh` (min 600px): header strip, tab bar, optional banner, `.main`
  (`flex: 1 1 0`), status bar. Toasts are fixed bottom-right above the status bar.
- TRADE (`.trade`): grid `minmax(0, 1fr) var(--ticket-w)`. The left column (`.trade-main`) stacks the
  chart (`minmax(300px, 1fr)`) over the positions table (`minmax(150px, 34%)`). The chart panel is its own
  grid with a `minmax(0, 1fr)` column so the readout never widens it.
- F2/F3 (`.book`): a vertical stack of table panels that scrolls.
- Tables scroll horizontally inside `.table-scroll` (focusable region) with sticky headers; the page never
  scrolls sideways.

Breakpoints (`src/styles.css`):

- **1100px and up**: fixed-height terminal as above. Verified at 1280x800, 1440x900 and 1920x1080.
- **Up to 1099px**: the shell becomes a scrolling page. Chart (300px tall), then ticket, then positions
  (table capped at 320px).
- **Up to 760px**: header wraps to brand + stream state, then metrics in a 3-column grid; tabs share the
  width and F2 shortens to "POSITIONS"; the ticket moves **above** the chart (and hides its own title) so
  the whole order flow, Review button included, is on the first phone screen; chart 240px; the readout
  wraps onto two reserved lines; the shortcut legend hides.
- **`pointer: coarse`**: inputs 40px tall at 16px, segments 34px.

## Elevation & Depth

Flat. No shadows. Depth comes from three tonal layers (`bg` → `surface` → `surface-raised`) and 1px rules.
The header is closed by a 1px accent rule. Dialogs use a 1px accent border over a `rgba(0,0,0,0.72)`
backdrop. Toasts add a 3px left rule in the status colour. The chart loading/error overlay covers the chart
host with `--color-bg`, so the layout does not move.

## Shapes

`--radius: 0` is applied to every element via the universal selector. Square corners only. Segmented
controls are cells separated by 1px gaps showing `--color-line`. Preview and confirm lists use the same
1px-gap grid. The stream dot is an 8px square.

## Components

| Component | Source | Notes |
| --- | --- | --- |
| Header strip | `src/components/Header.tsx`, `.topbar .metrics .metric .conn` | `<dl>` of six metrics; values `min-width: 11ch` so updates do not shift neighbours; `.conn-live/connecting/reconnecting` |
| F-key tabs | `src/App.tsx` (`TABS`), `.tab` | WAI-ARIA tabs: roving tabindex, arrows/Home/End, F1–F3 global; selected = accent fill |
| Segmented control | `.seg`, `.seg-fill`, `.presets`, `.seg-btn[aria-pressed]` | Timeframes, market, side (`.side`, Long fills profit, Short fills loss), leverage presets; disabled presets above the market max |
| Field | `.field`, `.label`, `.input`, `.hint`, `.error` | Labels bound with `htmlFor`; `aria-invalid` turns the border red; error text sits under its field, empty errors collapse |
| Buttons | `.btn` + `.btn-primary`, `.btn-long`, `.btn-short`, `.btn-ghost`, `.btn-danger`, `.btn-danger-solid`, `.btn-row`, `.btn-block` | Verb labels ("Review long BTC", "Close 3 positions"); hover gated by `@media (hover: hover)` |
| Dense table | `src/components/Tables.tsx`, `.table-panel .panel-head .table-scroll .grid` | Row header = market in accent; `.r` right-aligns numbers; `.empty` rows for loading and empty states; totals in `tfoot` |
| Dialog | `src/components/Dialog.tsx`, `.dialog` | Native `<dialog>` with `showModal()`: focus trap, Esc cancels, focus returns to the opener. Used for order confirm and Close all |
| Toasts | `src/components/Toasts.tsx`, `.toast-ok/pending/bad` | One polite live region; status word + action label + intent id; confirmed toasts close after 7 s, others after 14 s; dismiss button |
| Chart | `src/components/Chart.tsx`, `.chart-panel .chart-toolbar .readout .chart-host .chart-overlay .chart-legend` | Loading, error (with Retry) and ready states in the same box |
| Banner | `.banner` in `App.tsx` | Shown only when the initial load fails; links to `?mock=1` |

Focus: a global `:focus-visible` 2px accent outline (inset on inputs).

## Do's and Don'ts

- Do take colours, sizes and spacing from the `:root` tokens. A new value needs a new role token, not a raw hex.
- Do format every amount with `formatUsd`/`formatPrice`/`formatPct` from `src/format.ts`. Never use `toLocaleString` compact output or an unformatted float.
- Do put new panels in `.table-panel` + `.panel-head` + `.table-scroll`, and new tabs in `TABS` with the next F-key.
- Do keep green and red for profit/loss, long/short and success/failure only. Orange is selection and brand.
- Don't add a second font, a third weight, rounded corners, shadows or gradients.
- Don't write `style=` attributes in JSX or add inline scripts: the CSP blocks them.
- Don't let a value change the width of its container: give it tabular figures and a minimum width.
- Don't send an irreversible bulk action without a `Dialog` that states the consequence.

Recipe for another tab: add `{ id, key: "F4", label }` to `TABS` in `src/App.tsx`, add a `role="tabpanel"`
div with class `book`, and fill it with `.table-panel` sections using the `.grid` table and the format
helpers. Mock data for it goes in `src/mock.ts` behind the same `Backend` method.
