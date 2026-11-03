import type { Timeframe } from "../api";
import { formatDateTime, formatPrice, formatUsdCompact } from "../format";
import { confidenceOf, DEFAULT_PARAMS, type Cluster } from "../signal";
import { invalidText, type MarketSignal } from "../useErl";

/** Required economics disclosure for the zero-builder papertrade.xyz scenario (§4.6). */
export const PROFILE_DISCLOSURE = "papertrade.xyz documented defaults · economics unverified · builder 0%";

export const SIGNAL_TIMEFRAMES: Timeframe[] = ["1m", "5m"];

const PHASE: Record<string, string> = {
  pending: "Confirmed at bar close · fill window is the next bar",
  open: "Signal plan active",
  exit: "Exit confirmed · close at the next quote",
  unresolved: "Data gap during the holding · risk unresolved · no new entry",
  flat: "No active plan",
};

function clusterText(c: Cluster | null | undefined) {
  if (!c) return "none large in ±1%";
  return `${formatPrice(c.peak)} (${c.distancePct >= 0 ? "+" : ""}${c.distancePct.toFixed(2)}%) ${formatUsdCompact(c.usd)}`;
}

/** Live-veto row text: the assessment for a pending candidate, else why live context is unknown. */
function liveText(m: MarketSignal, summaryError: string): { text: string; blocked: boolean } {
  if (m.live) {
    const reason = m.live.reasons[0];
    const extra = m.live.status === "UNKNOWN" ? [m.mapError, summaryError].filter(Boolean) : [];
    return {
      text: [m.live.status, reason, ...extra].filter(Boolean).join(" · "),
      blocked: !m.eligibility?.actionable,
    };
  }
  if (!m.map) return { text: `UNKNOWN · ${m.mapError || "liquidation map not loaded"}`, blocked: true };
  if (m.mapFreshness)
    return {
      text: `UNKNOWN · map ${m.mapFreshness} · snapshot ${formatDateTime(m.map.asOfSec * 1000)} UTC`,
      blocked: true,
    };
  if (summaryError) return { text: `No candidate on the latest bar · UNKNOWN · ${summaryError}`, blocked: false };
  return { text: "No candidate on the latest bar", blocked: false };
}

function MarketCard({
  m,
  tf,
  summaryError,
  onRetry,
}: {
  m: MarketSignal;
  tf: Timeframe;
  summaryError: string;
  onRetry: () => void;
}) {
  const st = m.state;
  const pending = st?.phase === "pending";
  const blocked = pending && !m.eligibility?.actionable;
  const code = m.invalid ? "INVALID DATA" : (st?.state ?? "FLAT");
  const headline = m.invalid
    ? "INVALID DATA"
    : blocked
      ? `Core ${code} · NO NEW ENTRY`
      : code;
  const stateClass = m.invalid || blocked ? "sig-blocked" : `sig-${code.toLowerCase()}`;
  const ref = pending ? st?.candidate?.entryRef : m.last;
  const stopPct =
    st?.stop != null && ref ? (Math.abs(ref - st.stop) / ref) * 100 : null;
  const cand = st?.phase === "flat" ? null : st?.candidate;
  const holding = st?.trade ? `${st.trade.holdingBars}/${DEFAULT_PARAMS.maxHoldBars}` : null;
  const phase = m.invalid
    ? `Candle series rejected: ${invalidText(m.invalid)} · no signal or results`
    : !st
      ? m.error
        ? `Candle request failed: ${m.error}`
        : `Loading ${tf} candles…`
      : blocked
        ? m.stale
          ? `Historical core candidate retained · ${m.eligibility?.blockReason ?? "candles stale"}`
          : "Historical core candidate retained · new entry blocked by the live layer (see Live veto)"
        : pending
          ? `${PHASE.pending} · live ${m.live?.status ?? "UNKNOWN"}`
          : PHASE[st.phase];
  const live = liveText(m, summaryError);
  const failed = !!m.error;
  return (
    <article className="sig-card" aria-labelledby={`sig-${m.symbol}`}>
      <header className="sig-head">
        <h3 id={`sig-${m.symbol}`}>{m.symbol}</h3>
        <span className={`sig-state ${stateClass}`}>{headline}</span>
        {m.stale && <span className="sig-state sig-blocked">STALE</span>}
        <p className="hint">{phase}</p>
        {failed && (
          <p className="sig-error">
            {m.stale
              ? `Candle refresh failed: ${m.error} · showing last good data to ${m.lastCandleT !== null ? formatDateTime(m.lastCandleT * 1000) : "--"} UTC`
              : `Candles unavailable: ${m.error}`}
            <button type="button" className="btn" onClick={onRetry}>
              Retry {m.symbol} candles
            </button>
          </p>
        )}
        {m.invalid && !failed && (
          <p className="sig-error">
            Results withheld for a rejected series.
            <button type="button" className="btn" onClick={onRetry}>
              Refresh {m.symbol} candles
            </button>
          </p>
        )}
      </header>
      <dl className="sig-rows">
        <div>
          <dt>Confidence</dt>
          <dd className="num">
            {cand ? `${blocked ? "core " : ""}${confidenceOf(cand.score)} · score ${cand.score.toFixed(2)}` : "--"}
          </dd>
        </div>
        <div>
          <dt>Stop</dt>
          <dd className="num">
            {stopPct === null || st?.stop == null ? (
              "--"
            ) : (
              <>
                {formatPrice(st.stop)} · {stopPct.toFixed(2)}% ·{" "}
                <span className={stopPct >= 0.5 ? "bust" : ""}>
                  {Math.round(stopPct * 100)}% of 1% bust
                </span>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>Target</dt>
          <dd className="num">{st?.target != null ? formatPrice(st.target) : "--"}</dd>
        </div>
        <div>
          <dt>Bars since</dt>
          <dd className="num">
            {st?.barsSince ?? "--"}
            {holding && <span className="hint"> · holding {holding}</span>}
          </dd>
        </div>
        <div>
          <dt>Long liq.</dt>
          <dd className="num profit">
            {!m.map ? "--" : m.mapFreshness ? <span className="hint">{m.mapFreshness}</span> : clusterText(m.clusters?.long)}
          </dd>
        </div>
        <div>
          <dt>Short liq.</dt>
          <dd className="num loss">
            {!m.map ? "--" : m.mapFreshness ? <span className="hint">{m.mapFreshness}</span> : clusterText(m.clusters?.short)}
          </dd>
        </div>
        <div className="sig-live">
          <dt>Live veto</dt>
          <dd>
            <span className={live.blocked ? "bust" : ""}>{live.text}</span>
          </dd>
        </div>
      </dl>
    </article>
  );
}

export function SignalPanel({
  markets,
  tf,
  onTf,
  asOfSec,
  summaryError,
  onRetry,
}: {
  markets: MarketSignal[];
  tf: Timeframe;
  onTf: (tf: Timeframe) => void;
  asOfSec: number | null;
  summaryError: string;
  onRetry: () => void;
}) {
  return (
    <section className="signal-panel" aria-labelledby="signal-title">
      <div className="panel-head">
        <h2 id="signal-title">ERL-100 signal</h2>
        <div className="seg" role="group" aria-label="Signal timeframe">
          {SIGNAL_TIMEFRAMES.map((t) => (
            <button
              type="button"
              key={t}
              className="seg-btn"
              aria-pressed={t === tf}
              onClick={() => onTf(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <p className="hint">Bar-closed · 100× · not a trade ticket</p>
      </div>
      <div className="sig-grid">
        {markets.map((m) => (
          <MarketCard key={m.symbol} m={m} tf={tf} summaryError={summaryError} onRetry={onRetry} />
        ))}
      </div>
      <p className="hint pad sig-foot">
        Liquidation clusters and veto: live only, no liquidation history
        {asOfSec ? ` · snapshot ${formatDateTime(asOfSec * 1000)} UTC` : ""}. A live veto,
        payout risk or unknown live data blocks a new entry but keeps the core candidate. LP
        accounting unverified. Score is a decision budget, not a probability. Payout:{" "}
        {PROFILE_DISCLOSURE} (0.5% builder sensitivity in F3).
      </p>
      <ErlExplainer />
    </section>
  );
}

export function ErlExplainer() {
  return (
    <details className="explainer">
      <summary>How ERL-100 works</summary>
      <div className="explainer-body">
        <p>
          <strong>Excursion Restitution Ledger.</strong> Each wick is price the market
          rejected; each body is price it accepted. The ledger keeps the last 24 bars’
          wicks and erases only the parts later bodies covered, weighting recent bars more.
        </p>
        <p>
          <strong>Entry.</strong> Bar j sweeps 3–25 bps past the lowest close of the prior
          12 bars and closes back above it; bar i confirms without retouching the sweep and
          closes higher. The signal confirms at the close of bar i and can fill only at the
          next bar. Shorts mirror this.
        </p>
        <p>
          <strong>Gates.</strong> Stop 2 bps beyond the sweep (5–25 bps risk). Target 3× risk,
          20–80 bps. Surviving support under the sweep ≥ 35%, overhead rejection in the target
          corridor ≤ 35%, and Papertrade’s net payout (impact holdback, 2% win fee, full
          losses) at least 1.8× the modelled risk. Score = support × (1 − obstacle) × net
          reward/risk must reach 0.80.
        </p>
        <p>
          <strong>Exit.</strong> Stop or target touch; a close back below the frontier or
          sweep low; or the sixth bar. Then six bars of cooldown. At 100×, bust sits near
          0.95% adverse, so every stop is well inside it. Entries are enabled on 1m and 5m
          only.
        </p>
        <p>
          <strong>Live layer.</strong> On the latest bar only, Papertrade’s resting liquidation
          map can veto a new entry (material same-side liquidations crowding the stop path, or
          an active payout queue). A veto, a stale or missing map, or a failed protocol summary
          shows “Core LONG · NO NEW ENTRY”: the candle-only candidate stays on the chart, but
          it is not actionable. There is no liquidation history, so backtests are candle-only.
        </p>
        <p>
          <strong>Economics.</strong> {PROFILE_DISCLOSURE}. F3 reruns the whole backtest with a
          0.5% builder fee, which changes both the payout and which candidates pass the gates.
        </p>
        <p className="hint">
          Research hypothesis with untuned defaults. No performance claim. PAPER emissions
          are valued at zero.
        </p>
      </div>
    </details>
  );
}
