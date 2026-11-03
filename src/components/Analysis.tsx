import { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  ColorType,
  LineSeries,
  createChart,
  type UTCTimestamp,
} from "lightweight-charts";
import {
  TIMEFRAMES,
  type Backend,
  type Candle,
  type PortfolioPoint,
  type PortfolioRange,
  type Timeframe,
  type Trade,
} from "../api";
import { computeStats, entrySigmaStats, type GroupStats } from "../stats";
import { formatDateTime, formatLeverage, formatUsd, toMs } from "../format";
import { pnlClass } from "./Tables";
import { Backtest } from "./Backtest";
const pct = (n: number | null) => (n === null ? "--" : `${n.toFixed(1)}%`);
const hold = (n: number | null) =>
  n === null
    ? "--"
    : n >= 86400_000
      ? `${(n / 86400_000).toFixed(1)} days`
      : n >= 3600_000
        ? `${(n / 3600_000).toFixed(1)} hours`
        : `${(n / 60_000).toFixed(1)} min`;
export function Analysis({
  backend,
  address,
  trades,
}: {
  backend: Backend;
  address: string;
  trades: Trade[] | null;
}) {
  const [range, setRange] = useState<PortfolioRange>("1w"),
    [metric, setMetric] = useState<"equity" | "pnl">("equity"),
    [tf, setTf] = useState<Timeframe>("15m");
  const [points, setPoints] = useState<PortfolioPoint[] | null>(null),
    [curveError, setCurveError] = useState("");
  const [candles, setCandles] = useState<Record<string, Candle[]>>({}),
    [bandError, setBandError] = useState(""),
    [bandsLoading, setBandsLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const stats = useMemo(() => computeStats(trades ?? []), [trades]);
  const sigma = useMemo(
    () => entrySigmaStats(trades ?? [], candles, tf),
    [trades, candles, tf],
  );
  const symbols = useMemo(
    () => [...new Set((trades ?? []).map((t) => t.symbol))].sort().join(","),
    [trades],
  );
  useEffect(() => {
    const ctrl = new AbortController();
    setPoints(null);
    setCurveError("");
    backend
      .portfolio(address, range, ctrl.signal)
      .then((p) => {
        if (!ctrl.signal.aborted) setPoints(p.points);
      })
      .catch(() => {
        if (!ctrl.signal.aborted)
          setCurveError(
            "Portfolio curve unavailable. Retry to load this range.",
          );
      });
    return () => ctrl.abort();
  }, [backend, address, range, retry]);
  useEffect(() => {
    const ctrl = new AbortController();
    setCandles({});
    setBandError("");
    setBandsLoading(true);
    if (!symbols) {
      setBandsLoading(false);
      return () => ctrl.abort();
    }
    Promise.all(
      symbols
        .split(",")
        .map(
          async (symbol) =>
            [
              symbol,
              await backend.candles(symbol, tf, 1000, ctrl.signal),
            ] as const,
        ),
    )
      .then((entries) => {
        if (!ctrl.signal.aborted) {
          setCandles(Object.fromEntries(entries));
          setBandsLoading(false);
        }
      })
      .catch(() => {
        if (!ctrl.signal.aborted) {
          setBandError(
            "Entry candle history unavailable. Retry to calculate sigma buckets.",
          );
          setBandsLoading(false);
        }
      });
    return () => ctrl.abort();
  }, [backend, symbols, tf, retry]);
  const summary: [string, string, string?][] = [
    ["Win rate", pct(stats.winRate)],
    [
      "Average PnL",
      formatUsd(stats.averagePnl, { sign: true }),
      pnlClass(stats.averagePnl),
    ],
    [
      "Median PnL",
      formatUsd(stats.medianPnl, { sign: true }),
      pnlClass(stats.medianPnl),
    ],
    [
      "Best trade",
      formatUsd(stats.bestTrade?.pnlUsd, { sign: true }),
      "profit",
    ],
    [
      "Worst trade",
      formatUsd(stats.worstTrade?.pnlUsd, { sign: true }),
      pnlClass(stats.worstTrade?.pnlUsd),
    ],
    [
      "Profit factor",
      stats.profitFactor === Infinity
        ? "∞ (no losses)"
        : (stats.profitFactor?.toFixed(2) ?? "--"),
    ],
    ["Average leverage", formatLeverage(stats.averageLeverage)],
    ["Average hold", hold(stats.averageHoldMs)],
    ["Liquidation rate", pct(stats.liquidationRate)],
  ];
  return (
    <div className="analysis">
      <section className="table-panel" aria-labelledby="curve-title">
        <div className="panel-head">
          <h2 id="curve-title">Account performance</h2>
          <div className="seg" role="group" aria-label="Portfolio metric">
            {["equity", "pnl"].map((m) => (
              <button
                type="button"
                className="seg-btn"
                aria-pressed={metric === m}
                key={m}
                onClick={() => setMetric(m as "equity" | "pnl")}
              >
                {m === "equity" ? "Equity" : "PnL"}
              </button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="Portfolio range">
            {["1d", "1w", "all"].map((r) => (
              <button
                type="button"
                className="seg-btn"
                aria-pressed={range === r}
                key={r}
                onClick={() => setRange(r as PortfolioRange)}
              >
                {r === "all" ? "All time" : r}
              </button>
            ))}
          </div>
          <p className="hint">USD · UTC</p>
        </div>
        {curveError ? (
          <div className="local-error" role="alert">
            {curveError}{" "}
            <button
              className="btn"
              type="button"
              onClick={() => setRetry((n) => n + 1)}
            >
              Retry analysis
            </button>
          </div>
        ) : (
          <PortfolioChart points={points} metric={metric} />
        )}
      </section>
      <section className="table-panel" aria-labelledby="stats-title">
        <div className="panel-head">
          <h2 id="stats-title">Trade statistics</h2>
          <p className="hint">
            {trades
              ? `${stats.count} settled positions · all history`
              : "Loading complete trade history…"}
          </p>
        </div>
        <dl className="stats-grid">
          {summary.map(([label, value, color]) => (
            <div className="stat" key={label}>
              <dt>{label}</dt>
              <dd className={`num ${color ?? ""}`}>{trades ? value : "--"}</dd>
            </div>
          ))}
        </dl>
        <p className="hint pad">
          PnL uses the backend’s reported value; fees are not subtracted again.
          Opened events are excluded. Break-even trades count in the win-rate
          denominator.
        </p>
      </section>
      <Backtest backend={backend} trades={trades} />
      <div className="analysis-groups">
        <GroupTable title="PnL by market" groups={stats.byMarket} />
        <GroupTable title="PnL by side" groups={stats.bySide} />
      </div>
      <section className="table-panel" aria-labelledby="sigma-title">
        <div className="panel-head">
          <h2 id="sigma-title">Entry in the BB(15) ladder</h2>
          <label className="inline-label">
            Candle timeframe
            <select
              aria-label="Entry analysis timeframe"
              className="input"
              value={tf}
              onChange={(e) => setTf(e.target.value as Timeframe)}
            >
              {TIMEFRAMES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="hint pad">
          Entry price vs. the containing candle’s midline and population σ. This
          includes that candle’s close, not an intrabar reconstruction.
        </p>
        {bandError ? (
          <div className="local-error" role="alert">
            {bandError}{" "}
            <button className="btn" onClick={() => setRetry((n) => n + 1)}>
              Retry analysis
            </button>
          </div>
        ) : (
          <>
            <p className="sigma-coverage" role="status">
              {bandsLoading || !trades
                ? "Loading entry candles…"
                : `${sigma.classified} / ${sigma.total} entries classified · ${sigma.unclassified} without a usable candle`}
            </p>
            <div
              className="sigma-histogram"
              aria-label="Entry sigma bucket histogram"
            >
              {sigma.buckets.map((b) => (
                <div className="sigma-row" key={b.label}>
                  <span>{b.label}</span>
                  <meter
                    min={0}
                    max={Math.max(1, ...sigma.buckets.map((x) => x.count))}
                    value={b.count}
                    aria-label={`${b.label}: ${b.count} entries`}
                  />
                  <span className="r num">{b.count}</span>
                  <span className="r num">{pct(b.winRate)} wins</span>
                </div>
              ))}
            </div>
          </>
        )}
        <p className="hint pad">
          Uses up to 1,000 candles per market. Older entries, gaps, the first 14
          bars and flat bands remain unclassified. Choose a longer timeframe for
          more history. Bucket win rates use settled positions only.
        </p>
      </section>
    </div>
  );
}
function GroupTable({
  title,
  groups,
}: {
  title: string;
  groups: GroupStats[];
}) {
  return (
    <section className="table-panel">
      <div className="panel-head">
        <h2>{title}</h2>
      </div>
      <div
        className="table-scroll"
        role="region"
        aria-label={title}
        tabIndex={0}
      >
        <table className="grid">
          <thead>
            <tr>
              <th scope="col">Group</th>
              <th className="r" scope="col">
                Trades
              </th>
              <th className="r" scope="col">
                PnL USD
              </th>
              <th className="r" scope="col">
                Win rate
              </th>
            </tr>
          </thead>
          <tbody>
            {!groups.length && (
              <tr>
                <td colSpan={4} className="empty">
                  No settled trades to analyse.
                </td>
              </tr>
            )}
            {groups.map((g) => (
              <tr key={g.label}>
                <th scope="row">{g.label}</th>
                <td className="r">{g.count}</td>
                <td className={`r ${pnlClass(g.pnl)}`}>
                  {formatUsd(g.pnl, { sign: true })}
                </td>
                <td className="r">{pct(g.winRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
function PortfolioChart({
  points,
  metric,
}: {
  points: PortfolioPoint[] | null;
  metric: "equity" | "pnl";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<PortfolioPoint | null>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host || !points?.length) return;
    const sorted = points
      .map((p) => ({ ...p, sec: Math.floor((toMs(p.t) ?? 0) / 1000) }))
      .filter((p) => p.sec > 0 && Number.isFinite(p[metric]))
      .sort((a, b) => a.sec - b.sec)
      .filter((p, i, all) => !i || p.sec !== all[i - 1].sec);
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
      localization: { priceFormatter: (n: number) => formatUsd(n) },
    });
    const series =
      metric === "equity"
        ? chart.addSeries(AreaSeries, {
            lineColor: "#ff8c00",
            topColor: "rgba(255,140,0,0.18)",
            bottomColor: "rgba(255,140,0,0)",
            lineWidth: 2,
          })
        : chart.addSeries(LineSeries, { color: "#22c55e", lineWidth: 2 });
    series.setData(
      sorted.map((p) => ({ time: p.sec as UTCTimestamp, value: p[metric] })),
    );
    chart.timeScale().fitContent();
    const ro = new ResizeObserver(() => {
      if (host.clientWidth > 0)
        chart.resize(host.clientWidth, host.clientHeight);
    });
    ro.observe(host);
    chart.subscribeCrosshairMove((p) =>
      setHover(sorted.find((s) => s.sec === Number(p.time)) ?? null),
    );
    setHover(null);
    let active = true;
    document.fonts.ready.then(() => {
      if (active)
        chart.applyOptions({
          layout: { fontFamily: "'IBM Plex Mono', monospace" },
        });
    });
    return () => {
      active = false;
      ro.disconnect();
      chart.remove();
    };
  }, [points, metric]);
  const readout = hover ?? points?.at(-1);
  return (
    <>
      <p className="curve-readout num">
        {readout
          ? `${formatDateTime(readout.t)} UTC · ${metric === "equity" ? "Equity" : "PnL"} ${formatUsd(readout[metric], { sign: metric === "pnl" })}`
          : points
            ? "No portfolio activity in this range."
            : "Loading portfolio curve…"}
      </p>
      <div
        className="portfolio-host"
        ref={ref}
        role="img"
        aria-label={`${metric === "equity" ? "Equity" : "PnL"} over time in USD. Current value ${formatUsd(readout?.[metric])}.`}
      />
      {!points?.length && (
        <p className="hint pad">
          {points
            ? "Choose another range to check for account activity."
            : "Waiting for portfolio points."}
        </p>
      )}
    </>
  );
}
