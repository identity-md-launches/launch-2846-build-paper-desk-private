# PAPER DESK v2 validation

Complete for the stated frontend scope. These are worker-run checks, not independent certification. A real backend and Safari/WebKit remain unverified.

## Scope and assumptions

The existing React/TypeScript/Vite/lightweight-charts project was revised into a read-only public-account viewer. The indicator source and its 40 tests are byte-for-byte unchanged. The existing package manifest, dependency lockfile and build configuration are unchanged. Trading components and their session/intent/mutation infrastructure were deleted. The only ignore-file change is an explicit, named artifact allowlist with a 2,097,152-byte total path budget; this makes the requested evidence survive the environment's default artifact exclusion.

The supplied backend contract is a typed GET-only client; this assignment did not include a running production service. HTTP integration tests intercept same-origin requests. Mock interaction tests execute the actual exported mock backend and clearly display MOCK DATA. Screenshot addresses are arbitrary synthetic fixtures, not requester accounts or operating credentials.

USD fields are dollars; PAPER minted/staking rewards are PAPER quantities. Trade counts/statistics mean settled positions. Opened events remain in history but do not count as settlements. All cursor pages load before replacing the history snapshot. Entry sigma analysis only classifies entries with an exact candle and warmup history in the 1,000-candle response; limits and historical-close context are explained beside the histogram.

## Commands and actual results

Dependencies and check tooling were installed outside the repository. To respect the repository's no-node_modules rule, the unchanged manifest/lockfile, source, public assets and existing configuration were copied into a temporary staging directory. Its checked production export was copied back in full, and obsolete earlier bundle files were removed. No dependency archive or registry mirror is delivered.

| Check | Actual result |
| --- | --- |
| `npm ci --prefix /tmp/paper-desk-tools --cache /tmp/paper-desk-npm-cache --no-audit --no-fund` | Passed; installed locked dependencies outside the repository |
| `npm run typecheck --prefix /tmp/paper-desk-tools` | Passed, exit 0 |
| `npm test --prefix /tmp/paper-desk-tools` | Passed: 4 files, 88 tests; 40 indicator, 26 statistics, 12 formatting, 10 address/API/overlay/CSV tests |
| `npm run build --prefix /tmp/paper-desk-tools` | Passed, exit 0; includes `tsc --noEmit`; Vite transformed 48 modules |
| Final production bundle | Main JS 382.47 kB / 123.44 kB gzip; mock JS 4.29 kB / 2.19 kB gzip; CSS 18.04 kB / 4.35 kB gzip; four required local font assets |
| `PLAYWRIGHT_BROWSERS_PATH=/tmp/paper-desk-browsers node test/scratch/interactions.mjs` | Passed, exit 0: 31/31 browser checks against the export under `/preview/` |
| `PLAYWRIGHT_BROWSERS_PATH=/tmp/paper-desk-browsers node test/scratch/review.mjs` | Ran successfully; four axe-reviewed states, zero violations, rendered contrast/reflow/focus checks, screenshots and account-state taste probe |
| `IMD_PLAYWRIGHT=/tmp/paper-desk-browser/node_modules/playwright/index.mjs node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste` (with browser path as above) | Ran from repository root on `dist/`: 15/16 passed; sole exception: monospace prose |
| Same pinned probe on served export with `?mock=1&address=…` | 15/16 passed; same exception; repeated-copy finding fixed |
| Source/diff/export audit | GET-only client; protected configuration/dependencies and original indicators unchanged; relative production assets; runtime files complete |

Final assets are `dist/assets/index-rKXbbi9M.js`, `dist/assets/index-DRHMmjtw.css`, `dist/assets/mock-DfIKwihr.js` and the existing IBM Plex Mono font files. Refreshed `public/og.png` and `dist/og.png` are identical, 1200×630, 38,180 bytes each. They show the read-only product rather than the removed trade ticket.

The 31-check browser suite covers:

- Empty selection, first-screen product/action at 390px, invalid-address error/focus, Enter/lowercase URL, Escape/Clear, Back/Forward, malformed-URL recovery, ten-address ordering, nicknames, reload persistence and unavailable localStorage.
- Summary, positions/recent trades, BTC/ETH, all six timeframes, independent overlay toggle, trade scroll/focus/zoom and reset.
- Complete cursor history, independent 75-row pagination, composed market/side/outcome filters, empty-filter recovery, cashflow filters and both CSV downloads including all matching rows and UTC headers.
- Equity/PnL switching, all portfolio ranges, statistics and eight-bucket sigma analysis; reflow at 320, 390, 760, 1024 and 1440px across all three screens.
- GET-only same-origin HTTP paths, multiple cursor pages, 5s/30s polling, no requests while hidden, refresh on visibility return, stale timestamps, ERROR/retry recovery and unknown-404/known-empty accounts.
- Bundled fonts, no third-party requests, no mock API traffic and no console/script/resource/CSP failures in the primary mock flow.

Polling uses Playwright's virtual clock, without real-time 30-second waits. The assigned browser tool also navigated the actual subpath export, inspected semantic snapshots, toggled overlays and captured the finished chart. Its final console inspection reported zero errors and zero warnings.

## Better Interface coverage

All six supplied domains were read and applied during implementation. The authoritative direction was “Keep the Bloomberg look,” the incumbent tokens/type and the unchanged chart engine. The site is a public-account research terminal; orange rules, warm monospace data and flat tables carry that idea.

| Domain | Coverage | Evidence and limits |
| --- | --- | --- |
| Accessibility | Checked | Native semantics, names, inline errors, skip link, roving tabs/F-keys, keyboard trade buttons, focus/forced-colors screenshots; axe on empty selection and F1/F2/F3 reports zero violations. Not a screen-reader test. Axe leaves manual items for canvas contrast and one F3 ARIA attribute. |
| Layout | Checked | Actual export at 320/390/760/1024/1440, all tabs; table-only horizontal scroll, full addresses, 390px primary action above fold; no page overflow after fix. Native 200% zoom and physical devices unperformed. |
| Writing | Checked | Address directions beside control, specific filter/CSV labels, honest mock/empty/error/stale copy, no-activity message for 404/empty accounts, explicit candle coverage and reported-PnL definitions. English only. |
| Typography | Checked | One local family, 400/600 faces, five sizes, tabular figures, UTC, 16px main mobile inputs, complete identifiers. Probe confirms bounded sizes and two weights. Monospace prose follows explicit visual direction. |
| Colors | Checked | Existing palette; measured solid rendered text pairs pass 4.5:1, as does probe sample. Ratios: accent 8.69, dim 5.64, profit 8.90, loss 5.39, bust 5.70. Canvas/alpha compositions and every possible background/state are not exhaustively audited. |
| UI | Checked | Hover/focus/pressed/disabled/loading/empty/error/retry states, native disclosure, selected controls, overlays, downloads and pagination. Reduced-motion probe finds no endless animation or transition-all. Forced colors inspected. No theme, modal or staged entrance exists. |

## Findings, corrections and rechecks

| Severity/domain | Final source | Observation | Correction and recheck |
| --- | --- | --- | --- |
| High/accessibility | `src/App.tsx:253` | Empty selection referenced a nonexistent tabpanel; expanded cold-state axe reported `aria-valid-attr-value` on `#tab-account`. | Active empty tabpanel plus hidden targets for other tabs. Final cold axe returns zero violations; navigation suite passes. |
| High/layout | `src/styles.css:1215` | At 320px, nickname disclosure reached x=321.64; document scroll width was 322px. | Recent dropdown uses `flex:1; min-width:0`. Final all-tab checks show exact viewport scroll widths and zero clipped controls at 320/390/760/1440; interaction suite also checks 1024. |
| Medium/accessibility | `src/components/Tables.tsx:172` | Wrapped select labels were ambiguous to label-based automation once populated. | Explicit accessible names for Market/Side/Outcome/Kind/Status. Final composed filters, cashflows and CSV interactions pass; snapshots/axe reviewed. |
| Medium/typography | `src/styles.css:62` | Initial defaults requested weight 700, but bundled faces are 400/600. | Explicit 600 for h1/strong/b; final probe reports two weights. |
| Medium/writing | `src/components/Tables.tsx:43`, `:238`, `:460` | Same scroll sentence under each account table triggered repetition. | Table-specific short cues. Final account probe passes repetition. |
| Medium/metadata | `public/og.png`, `index.html:13` | Old description/share image advertised removed trading flow. | Read-only metadata and local product capture. Both probes pass share; PNG dimensions and source/export identity checked. |
| Medium/writing | `src/useAccount.ts:92` | Initial-failure copy could imply a prior successful snapshot. | Error simply states updates unavailable and offers retry/check connection. Final error/recovery interactions pass. |

No unresolved implementation finding from these checks remains. Both taste probes still fail **type-faces** because they treat monospace prose as undesirable. This is a documented visual-direction exception: “Keep the Bloomberg look,” bundled IBM Plex Mono and the original terminal type treatment. Neither probe is reported as 16/16.

## Retained evidence

- `interactions.json`: individual 31-check results and WebKit launch limitation.
- `accessibility.json`: axe outcomes, sampled rendered contrast, focus properties, viewport/scroller widths.
- `taste-empty.json`, `taste-account.json`: actual probe arrays.
- `screenshots/390-empty.png`: product, address field and Load account on the first 390×844 screen.
- `screenshots/390-account.png`, `390-analysis.png`: loaded mobile states.
- `screenshots/1440-account.png`, `1440-history.png`, `1440-analysis.png`: rendered desktop screens.
- `screenshots/liquidation-chart.png`: actual canvas X/LIQ and focused-trade view.
- `screenshots/390-focus.png`, `390-forced-colors.png`: visible address focus, including forced colors.
- `bundle-budget.json`: conservative full-tree submission count and export inventory. `.gitignore` includes only the named review files/screenshots with a 2 MiB artifact path budget. Its existing dependency/cache exclusions remain intact.

Scratch scaffolding is ephemeral. Only the useful evidence above was copied into `artifacts/`; obsolete captures and the large full-history scratch image are not delivered.

## Remaining limitations

- No real Papertrade account service was supplied or operated. HTTP behavior uses intercepted responses; mock mode is local and explicitly synthetic.
- WebKit was downloaded and launch attempted. Required shared libraries are missing, beginning with `libgtk-4.so.1`; Safari is **not verified**. This machine limitation requires no requester credential or decision.
- No physical-device, screen-reader or browser-native 200% zoom session. Viewport reflow, forced colors and reduced motion were checked in Chromium.
- Axe's incomplete/manual items and canvas compositions are not full accessibility conformance evidence. Manual color samples and the probe complement that limitation.
- The 1,000-candle contract bounds sigma classification/chart placement; unavailable context is visibly unclassified/off-range. Very large histories use proportional client memory.
- Publication/hosting is outside this job. Source, unchanged lockfile and complete static export are the deliverable.
