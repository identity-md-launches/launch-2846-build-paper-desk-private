import { useEffect, useMemo, useRef, useState } from "react";
import { ColorType, LineSeries, createChart, type UTCTimestamp } from "lightweight-charts";
import { TIMEFRAME_SECONDS, type Backend, type Candle, type Timeframe, type Trade } from "../api";
import { formatDateTime, formatPrice, toMs } from "../format";
import { settledTrades } from "../stats";
import { compareAccount, type AlignmentGroup, type BacktestStats as Stats, type SignalSymbol } from "../signal";
import { analyseErl, BUILDER_SENSITIVITY, invalidText } from "../useErl";
import { ErlExplainer, PROFILE_DISCLOSURE, SIGNAL_TIMEFRAMES } from "./SignalPanel";

const pct = (n: number | null) => (n === null ? "--" : `${n.toFixed(1)}%`);
const margins = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;
const sign = (n: number | null) => (n === null ? "" : n > 0 ? "profit" : n < 0 ? "loss" : "");

export function Backtest({ backend, trades }: { backend: Backend; trades: Trade[] | null }) {
  const [symbol, setSymbol] = useState<SignalSymbol>("BTC"),
    [tf, setTf] = useState<Timeframe>("5m");
  const [candles, setCandles] = useState<Candle[] | null>(null),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const ctrl = new AbortController();
    setCandles(null);
    setError("");
    backend
      .candles(symbol, tf, 1000, ctrl.signal)
      .then((rows) => !ctrl.signal.aborted && setCandles(rows))
      .catch(() => !ctrl.signal.aborted && setError("Candles unavailable for the backtest."));
    return () => ctrl.abort();
  }, [backend, symbol, tf, retry]);
  const runs = useMemo(() => {
    if (!candles?.length) return null;
    const now = Math.floor(Date.now() / 1000);
    // The sensitivity reruns the whole pass with a 0.5% builder fee: gates and fees both change.
    return {
      base: analyseErl(candles, symbol, tf, now),
      builder: analyseErl(candles, symbol, tf, now, BUILDER_SENSITIVITY),
    };
  }, [candles, symbol, tf]);
  const invalid = runs?.base.invalid ?? null;
  const result = invalid ? null : (runs?.base ?? null);
  const alignment = useMemo(() => {
    if (!result || !candles || !trades) return null;
    const entries = settledTrades(trades)
      .filter((t) => t.symbol === symbol)
      .map((t) => ({
        isLong: t.isLong,
        openedAtSec: (toMs(t.openedAt) ?? NaN) / 1000,
        pnlUsd: t.pnlUsd,
      }));
    return compareAccount(entries, candles, result.bt, TIMEFRAME_SECONDS[tf]);
  }, [result, candles, trades, symbol, tf]);
  const s = result?.bt.stats;
  const b = invalid ? null : (runs?.builder.bt.stats ?? null);
  const span = candles?.length
    ? `${formatDateTime(candles[0].t * 1000)} – ${formatDateTime(candles.at(-1)!.t * 1000)} UTC`
    : "";
  const cells: [string, string, string?][] = s
    ? [
        ["Trades", String(s.trades)],
        ["Win rate", pct(s.winRate)],
        [
          "Profit factor",
          s.profitFactor === null ? "--" : s.profitFactor === Infinity ? "∞ (no losses)" : s.profitFactor.toFixed(2),
        ],
        ["Average R", s.avgR === null ? "--" : `${s.avgR >= 0 ? "+" : ""}${s.avgR.toFixed(2)}R`, sign(s.avgR)],
        ["Net, % of margin", margins(s.net), sign(s.net)],
        ["Max drawdown", `${(s.maxDrawdown * 100).toFixed(1)}%`],
        ["Busts", String(s.busts), s.busts ? "bust" : ""],
        ["Bust-stress net", margins(s.stressNet), sign(s.stressNet)],
      ]
    : [];
  return (
    <section className="table-panel" aria-labelledby="bt-title">
      <div className="panel-head">
        <h2 id="bt-title">ERL-100 backtest at 100×</h2>
        <div className="seg" role="group" aria-label="Backtest market">
          {(["BTC", "ETH"] as const).map((m) => (
            <button type="button" key={m} className="seg-btn" aria-pressed={symbol === m} onClick={() => setSymbol(m)}>
              {m}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Backtest timeframe">
          {SIGNAL_TIMEFRAMES.map((t) => (
            <button type="button" key={t} className="seg-btn" aria-pressed={tf === t} onClick={() => setTf(t)}>
              {t}
            </button>
          ))}
        </div>
        <p className="hint">{span || "Loading candles…"}</p>
      </div>
      {error || invalid ? (
        <div className="local-error" role="alert">
          {error ||
            `Candle series rejected: ${invalidText(invalid!)}. No signals or backtest results are computed from rejected data.`}{" "}
          <button className="btn" type="button" onClick={() => setRetry((n) => n + 1)}>
            {error ? "Retry backtest" : "Reload candles"}
          </button>
        </div>
      ) : (
        <>
          <p className="hint pad">
            Payout: {PROFILE_DISCLOSURE}. Candle-only core, no live filters (no liquidation
            history exists).
          </p>
          <dl className="stats-grid">
            {(cells.length ? cells : [["Trades", "--"] as [string, string]]).map(([label, value, color]) => (
              <div className="stat" key={label}>
                <dt>{label}</dt>
                <dd className={`num ${color ?? ""}`}>{value}</dd>
              </div>
            ))}
          </dl>
          <BuilderSensitivity base={s ?? null} builder={b} />
          <EquityCurve points={result?.bt.equity ?? null} />
          <p className="hint pad">
            Fixed margin per trade; results are percent of one margin. Next-bar-open fills,
            stop-first when a bar touches both levels, gaps past stop fill at the open, past
            the ≈0.95% bust lose the whole margin. Wins pay Papertrade’s documented impact curve
            (worse of standard/off-hours) after the 2% win fee; losses are taken in full. PAPER
            valued at zero. {s?.unresolved ? `${s.unresolved} unresolved at the data edge.` : ""}
            {" "}
            {result?.bt.skipped.length ?? 0} candidates skipped (cooldown, drift or re-check).
            About {tf === "1m" ? "16.7 hours" : "3.5 days"} of data: too short to validate an edge.
          </p>
          <AlignmentTable groups={alignment} />
          <div className="table-scroll" role="region" aria-label="Backtest trades" tabIndex={0}>
            <table className="grid">
              <caption className="sr-only">Most recent simulated ERL-100 trades</caption>
              <thead>
                <tr>
                  <th scope="col">Signal (UTC)</th>
                  <th scope="col">Side</th>
                  <th className="r" scope="col">Fill</th>
                  <th className="r" scope="col">Stop</th>
                  <th className="r" scope="col">Exit</th>
                  <th scope="col">Reason</th>
                  <th className="r" scope="col">Result</th>
                  <th className="r" scope="col">R</th>
                </tr>
              </thead>
              <tbody>
                {!result?.bt.trades.length && (
                  <tr>
                    <td colSpan={8} className="empty">
                      {candles ? "No ERL-100 trades in the loaded candles." : "Loading candles…"}
                    </td>
                  </tr>
                )}
                {result?.bt.trades
                  .slice(-25)
                  .reverse()
                  .map((t) => (
                    <tr key={t.candidate.index}>
                      <th scope="row">{formatDateTime(t.candidate.confirmedAt * 1000)}</th>
                      <td className={t.side === 1 ? "profit" : "loss"}>{t.side === 1 ? "Long" : "Short"}</td>
                      <td className="r">{formatPrice(t.fill)}</td>
                      <td className="r">{formatPrice(t.rawStop)}</td>
                      <td className="r">{t.exitPrice === null ? "--" : formatPrice(t.exitPrice)}</td>
                      <td className={t.reason === "BUST" ? "bust" : ""}>
                        {t.status === "CLOSED" ? t.reason : t.status.replace("_", " ")}
                      </td>
                      <td className={`r ${sign(t.pnl)}`}>{t.pnl === null ? "--" : margins(t.pnl)}</td>
                      <td className="r">{t.rMultiple === null ? "--" : t.rMultiple.toFixed(2)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <ErlExplainer />
    </section>
  );
}

function BuilderSensitivity({ base, builder }: { base: Stats | null; builder: Stats | null }) {
  const rows: [string, (x: Stats) => string][] = [
    ["Trades", (x) => String(x.trades)],
    ["Win rate", (x) => pct(x.winRate)],
    ["Average R", (x) => (x.avgR === null ? "--" : `${x.avgR >= 0 ? "+" : ""}${x.avgR.toFixed(2)}R`)],
    ["Net, % of margin", (x) => margins(x.net)],
    ["Max drawdown", (x) => `${(x.maxDrawdown * 100).toFixed(1)}%`],
  ];
  return (
    <div className="table-scroll" role="region" aria-label="Builder-fee sensitivity" tabIndex={0}>
      <table className="grid grid-compact">
        <caption className="table-caption">
          Builder-fee sensitivity · each column reruns entry gates and fees
        </caption>
        <thead>
          <tr>
            <th scope="col">Metric</th>
            <th className="r" scope="col">Builder 0%</th>
            <th className="r" scope="col">Builder 0.5%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, f]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td className="r">{base ? f(base) : "--"}</td>
              <td className="r">{builder ? f(builder) : "--"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AlignmentTable({
  groups,
}: {
  groups: { with: AlignmentGroup; against: AlignmentGroup; none: AlignmentGroup; outside: number } | null;
}) {
  const rows: [string, AlignmentGroup | undefined][] = [
    ["With the signal", groups?.with],
    ["Against the signal", groups?.against],
    ["No signal in force", groups?.none],
  ];
  return (
    <div className="table-scroll" role="region" aria-label="Account entries versus ERL-100" tabIndex={0}>
      <table className="grid grid-compact">
        <caption className="table-caption">
          Viewed account’s entries vs. ERL-100
          {groups ? ` · ${groups.outside} outside the loaded candles` : ""}
        </caption>
        <thead>
          <tr>
            <th scope="col">Entry</th>
            <th className="r" scope="col">Trades</th>
            <th className="r" scope="col">Wins</th>
            <th className="r" scope="col">Win rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, g]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td className="r">{g ? g.count : "--"}</td>
              <td className="r">{g ? g.wins : "--"}</td>
              <td className="r">{g ? pct(g.winRate) : "--"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EquityCurve({ points }: { points: { t: number; value: number }[] | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host || !points?.length) return;
    const chart = createChart(host, {
      width: host.clientWidth,
      height: host.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: "#050607" },
        textColor: "#c7bca6",
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: "#171819" } },
      timeScale: { timeVisible: true, borderColor: "#2a2620" },
      rightPriceScale: { borderColor: "#2a2620" },
      localization: { priceFormatter: (n: number) => `${(n * 100).toFixed(0)}%` },
    });
    const series = chart.addSeries(LineSeries, { color: "#ff8c00", lineWidth: 2 });
    const data = points
      .map((p) => ({ time: p.t as UTCTimestamp, value: p.value }))
      .filter((p, i, all) => i === all.length - 1 || all[i + 1].time !== p.time);
    series.setData(data);
    chart.timeScale().fitContent();
    const ro = new ResizeObserver(() => {
      if (host.clientWidth > 0) chart.resize(host.clientWidth, host.clientHeight);
    });
    ro.observe(host);
    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [points]);
  const last = points?.at(-1)?.value;
  return (
    <>
      <p className="curve-readout num">
        {points?.length
          ? `Cumulative result ${margins(last ?? 0)} of one margin after ${points.length} closed trades`
          : "No closed simulated trades yet."}
      </p>
      {!!points?.length && (
        <div
          className="portfolio-host bt-host"
          ref={ref}
          role="img"
          aria-label={`ERL-100 backtest equity curve, ending at ${margins(last ?? 0)} of one margin.`}
        />
      )}
    </>
  );
}
