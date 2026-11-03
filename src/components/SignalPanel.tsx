import type { Timeframe } from "../api";
import { formatDateTime, formatPrice, formatUsdCompact } from "../format";
import { confidenceOf, DEFAULT_PARAMS, type Cluster } from "../signal";
import type { MarketSignal } from "../useErl";

export const SIGNAL_TIMEFRAMES: Timeframe[] = ["1m", "5m"];

const PHASE: Record<string, string> = {
  pending: "Confirmed at bar close · fill window is the next bar",
  open: "Signal plan active",
  exit: "Exit confirmed · close at the next quote",
  flat: "No active plan",
};

function clusterText(c: Cluster | null | undefined) {
  if (!c) return "none large in ±1%";
  return `${formatPrice(c.peak)} (${c.distancePct >= 0 ? "+" : ""}${c.distancePct.toFixed(2)}%) ${formatUsdCompact(c.usd)}`;
}

function MarketCard({ m, tf }: { m: MarketSignal; tf: Timeframe }) {
  const st = m.state;
  const code = st?.state ?? "FLAT";
  const ref = st?.phase === "pending" ? st.candidate?.entryRef : m.last;
  const stopPct =
    st?.stop != null && ref ? (Math.abs(ref - st.stop) / ref) * 100 : null;
  const cand = st?.phase === "flat" ? null : st?.candidate;
  const holding = st?.trade ? `${st.trade.holdingBars}/${DEFAULT_PARAMS.maxHoldBars}` : null;
  const liveLabel = m.live
    ? m.live.status
    : m.map
      ? "No candidate on the latest bar"
      : "UNKNOWN";
  return (
    <article className="sig-card" aria-labelledby={`sig-${m.symbol}`}>
      <header className="sig-head">
        <h3 id={`sig-${m.symbol}`}>{m.symbol}</h3>
        <span className={`sig-state sig-${code.toLowerCase()}`}>{code}</span>
        <p className="hint">{st ? PHASE[st.phase] : m.error || `Loading ${tf} candles…`}</p>
      </header>
      <dl className="sig-rows">
        <div>
          <dt>Confidence</dt>
          <dd className="num">
            {cand ? `${confidenceOf(cand.score)} · score ${cand.score.toFixed(2)}` : "--"}
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
          <dd className="num profit">{m.map ? clusterText(m.clusters?.long) : "--"}</dd>
        </div>
        <div>
          <dt>Short liq.</dt>
          <dd className="num loss">{m.map ? clusterText(m.clusters?.short) : "--"}</dd>
        </div>
        <div className="sig-live">
          <dt>Live veto</dt>
          <dd>
            <span className={m.live?.status === "VETO" || m.live?.status.startsWith("PAYOUT") ? "bust" : ""}>
              {liveLabel}
            </span>
            {m.mapError && <span className="hint"> · {m.mapError}</span>}
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
}: {
  markets: MarketSignal[];
  tf: Timeframe;
  onTf: (tf: Timeframe) => void;
  asOfSec: number | null;
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
          <MarketCard key={m.symbol} m={m} tf={tf} />
        ))}
      </div>
      <p className="hint pad sig-foot">
        Liquidation clusters and veto: live only, no liquidation history
        {asOfSec ? ` · snapshot ${formatDateTime(asOfSec * 1000)} UTC` : ""}. LP accounting
        unverified. Score is a decision budget, not a probability.
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
        <p className="hint">
          Research hypothesis with untuned defaults. No performance claim. PAPER emissions
          are valued at zero.
        </p>
      </div>
    </details>
  );
}
