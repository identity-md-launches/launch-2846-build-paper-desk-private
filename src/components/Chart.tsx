import { useCallback, useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LineData,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { TIMEFRAMES, TIMEFRAME_SECONDS, type Backend, type Candle, type Position, type Timeframe } from "../api";
import {
  bandLadder,
  bustWithinRange,
  candleColor,
  declutterSignals,
  detectSignals,
  initialRange,
  type BandPoint,
} from "../indicators";
import { formatPrice } from "../format";

const BAND_STYLE: { key: keyof Omit<BandPoint, "sd">; color: string }[] = [
  { key: "mid", color: "#6366f1" },
  { key: "up1", color: "#fca5a5" },
  { key: "up15", color: "#f87171" },
  { key: "up2", color: "#dc2626" },
  { key: "lo1", color: "#86efac" },
  { key: "lo15", color: "#4ade80" },
  { key: "lo2", color: "#16a34a" },
];

const LINE_COLORS = { entry: "#8a8578", tp: "#22c55e", sl: "#ef4444", bust: "#FF2D78" };
const CANDLE_LIMIT = 1000;

interface Props {
  backend: Backend;
  symbol: string;
  timeframe: Timeframe;
  onTimeframe: (tf: Timeframe) => void;
  /** Latest streamed mark for `symbol`; updates the forming bar. */
  mark: { price: number; at: number } | null;
  positions: Position[];
}

interface Readout {
  bar: Candle;
  band: BandPoint | null;
  live: boolean;
}

interface Level {
  price: number;
  color: string;
  style: LineStyle;
  title: string;
}

const asTime = (t: number) => t as UTCTimestamp;

export function Chart({ backend, symbol, timeframe, onTimeframe, mark, positions }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const bandRefs = useRef<ISeriesApi<"Line">[]>([]);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const anchorsRef = useRef<ISeriesApi<"Line">[]>([]);
  const barsRef = useRef<Candle[]>([]);
  const bandsRef = useRef<(BandPoint | null)[]>([]);
  const levelsRef = useRef<Level[]>([]);
  const levelsVersionRef = useRef(-1);
  const [status, setStatus] = useState<{ state: "loading" | "ready" | "error"; message?: string }>({ state: "loading" });
  const [version, setVersion] = useState(0);
  const [retry, setRetry] = useState(0);
  const [readout, setReadout] = useState<Readout | null>(null);
  const hoverRef = useRef(false);

  // Create the chart once. Resizes go through one rAF and are ignored after unmount.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let frame = 0;
    const chart = createChart(host, {
      width: Math.max(1, host.clientWidth),
      height: Math.max(1, host.clientHeight),
      layout: {
        background: { type: ColorType.Solid, color: "#050607" },
        textColor: "#C7BCA6",
        fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#5c554a", labelBackgroundColor: "#FF8C00" },
        horzLine: { color: "#5c554a", labelBackgroundColor: "#FF8C00" },
      },
      rightPriceScale: { borderColor: "#2a2620", scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { borderColor: "#2a2620", timeVisible: true, secondsVisible: false, rightOffset: 2 },
      localization: { priceFormatter: (p: number) => formatPrice(p) },
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#6b6457",
      downColor: "#6b6457",
      borderVisible: true,
      wickVisible: true,
      priceLineColor: "#FF8C00",
      priceLineStyle: LineStyle.Dotted,
    });
    const bands = BAND_STYLE.map(({ color }) =>
      chart.addSeries(LineSeries, {
        color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      }),
    );
    chartRef.current = chart;
    candleRef.current = candles;
    bandRefs.current = bands;
    markersRef.current = createSeriesMarkers(candles, []);

    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (disposed) return;
        const w = Math.floor(host.clientWidth);
        const h = Math.floor(host.clientHeight);
        if (w > 0 && h > 0) chart.resize(w, h);
      });
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    // Canvas text is drawn once with whatever font is ready; redraw when Plex Mono arrives.
    document.fonts?.ready.then(() => {
      if (!disposed) chart.applyOptions({ layout: { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" } });
    });

    chart.subscribeCrosshairMove((param) => {
      if (disposed) return;
      const bars = barsRef.current;
      if (!param.time || !param.point) {
        hoverRef.current = false;
        const i = bars.length - 1;
        setReadout(i >= 0 ? { bar: bars[i], band: bandsRef.current[i] ?? null, live: true } : null);
        return;
      }
      const i = param.logical === undefined ? -1 : Math.round(param.logical);
      if (i < 0 || i >= bars.length) return;
      hoverRef.current = true;
      setReadout({ bar: bars[i], band: bandsRef.current[i] ?? null, live: i === bars.length - 1 });
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      ro.disconnect();
      chartRef.current = null;
      candleRef.current = null;
      bandRefs.current = [];
      markersRef.current = null;
      priceLinesRef.current = [];
      anchorsRef.current = [];
      chart.remove();
    };
  }, []);

  /** Push bars, bands, candle colours and decluttered signal markers to the chart. */
  const applyAll = useCallback(() => {
    const candles = candleRef.current;
    if (!candles) return;
    const bars = barsRef.current;
    const bands = bandLadder(bars.map((b) => b.c));
    bandsRef.current = bands;
    candles.setData(
      bars.map((b, i): CandlestickData<Time> => {
        const color = candleColor(b.c, bands[i]);
        return { time: asTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c, color, borderColor: color, wickColor: color };
      }),
    );
    BAND_STYLE.forEach(({ key }, k) => {
      const data: LineData<Time>[] = [];
      bars.forEach((b, i) => {
        const band = bands[i];
        if (band) data.push({ time: asTime(b.t), value: band[key] });
      });
      bandRefs.current[k]?.setData(data);
    });
    applyMarkers();
  }, []);

  const applyMarkers = () => {
    const bars = barsRef.current;
    const signals = declutterSignals(detectSignals(bars, bandsRef.current));
    const markers: SeriesMarker<Time>[] = signals.map((s) => ({
      time: asTime(bars[s.index].t),
      position: s.side === "buy" ? "belowBar" : "aboveBar",
      shape: s.side === "buy" ? "arrowUp" : "arrowDown",
      color: s.side === "buy" ? (s.kind === "STRONG BUY" ? "#22c55e" : "#4ade80") : s.kind === "STRONG SELL" ? "#ef4444" : "#f87171",
      text: s.labeled ? s.kind : "",
      size: s.kind.startsWith("STRONG") ? 1.4 : 1,
    }));
    markersRef.current?.setMarkers(markers);
  };

  // Load candles for the selected market and timeframe. A newer request aborts the older one,
  // and a response that lands after unmount or after the selection changed is dropped.
  useEffect(() => {
    const ctrl = new AbortController();
    setStatus({ state: "loading" });
    backend
      .candles(symbol, timeframe, CANDLE_LIMIT, ctrl.signal)
      .then((rows) => {
        if (ctrl.signal.aborted || !chartRef.current) return;
        barsRef.current = rows;
        applyAll();
        const range = initialRange(rows.length, 160);
        chartRef.current.timeScale().setVisibleLogicalRange(range);
        chartRef.current.priceScale("right").applyOptions({ autoScale: true });
        const last = rows.length - 1;
        setReadout(last >= 0 ? { bar: rows[last], band: bandsRef.current[last] ?? null, live: true } : null);
        setStatus(rows.length ? { state: "ready" } : { state: "error", message: "The backend returned no candles for this market." });
        setVersion((v) => v + 1);
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setStatus({ state: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => ctrl.abort();
  }, [backend, symbol, timeframe, retry, applyAll]);

  // Fold each streamed mark into the forming bar, or open a new bar when the bucket rolls over.
  useEffect(() => {
    if (!mark || status.state !== "ready") return;
    const bars = barsRef.current;
    const candles = candleRef.current;
    if (!bars.length || !candles) return;
    const step = TIMEFRAME_SECONDS[timeframe];
    const bucket = Math.floor(mark.at / 1000 / step) * step;
    const last = bars[bars.length - 1];
    if (bucket < last.t) return;
    if (bucket > last.t) {
      bars.push({ t: bucket, o: last.c, h: Math.max(last.c, mark.price), l: Math.min(last.c, mark.price), c: mark.price, v: 0 });
      applyAll();
      setVersion((v) => v + 1);
    } else {
      last.c = mark.price;
      last.h = Math.max(last.h, mark.price);
      last.l = Math.min(last.l, mark.price);
      const closes = bars.slice(-15).map((b) => b.c);
      const band = bars.length >= 15 ? bandLadder(closes)[closes.length - 1] : null;
      bandsRef.current[bars.length - 1] = band;
      const color = candleColor(last.c, band);
      candles.update({ time: asTime(last.t), open: last.o, high: last.h, low: last.l, close: last.c, color, borderColor: color, wickColor: color });
      if (band) BAND_STYLE.forEach(({ key }, k) => bandRefs.current[k]?.update({ time: asTime(last.t), value: band[key] }));
    }
    if (!hoverRef.current) {
      const i = bars.length - 1;
      setReadout({ bar: { ...bars[i] }, band: bandsRef.current[i] ?? null, live: true });
    }
  }, [mark, status.state, timeframe, applyAll]);

  // Position price lines: entry, TP, SL, and bust only within 35% of mark. Each level also gets an
  // invisible anchor series across every bar so autoscale keeps the line on screen.
  useEffect(() => {
    const chart = chartRef.current;
    const candles = candleRef.current;
    if (!chart || !candles) return;
    const levels: Level[] = [];
    for (const p of positions) {
      if (p.symbol !== symbol) continue;
      const side = p.isLong ? "Long" : "Short";
      levels.push({ price: p.entry, color: LINE_COLORS.entry, style: LineStyle.Solid, title: `${side} entry` });
      if (p.takeProfit) levels.push({ price: p.takeProfit, color: LINE_COLORS.tp, style: LineStyle.Solid, title: "TP" });
      if (p.stopLoss) levels.push({ price: p.stopLoss, color: LINE_COLORS.sl, style: LineStyle.Solid, title: "SL" });
      if (bustWithinRange(p.bustPrice, p.mark)) {
        levels.push({ price: p.bustPrice, color: LINE_COLORS.bust, style: LineStyle.Dashed, title: "Bust" });
      }
    }
    const key = (ls: Level[]) => ls.map((l) => `${l.title}@${l.price}`).join("|");
    const bars = barsRef.current;
    if (key(levels) === key(levelsRef.current) && version === levelsVersionRef.current) return;
    levelsRef.current = levels;
    levelsVersionRef.current = version;

    priceLinesRef.current.forEach((l) => candles.removePriceLine(l));
    anchorsRef.current.forEach((s) => chart.removeSeries(s));
    priceLinesRef.current = levels.map((l) =>
      candles.createPriceLine({
        price: l.price,
        color: l.color,
        lineWidth: 1,
        lineStyle: l.style,
        axisLabelVisible: true,
        title: l.title,
      }),
    );
    anchorsRef.current = levels.map((l) => {
      const s = chart.addSeries(LineSeries, {
        color: "rgba(0,0,0,0)",
        lineVisible: false,
        pointMarkersVisible: false,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      s.setData(bars.map((b) => ({ time: asTime(b.t), value: l.price })));
      return s;
    });
  }, [positions, symbol, version]);

  const r = readout;
  const z = r?.band && r.band.sd > 0 ? (r.bar.c - r.band.mid) / r.band.sd : null;
  const change = r ? ((r.bar.c - r.bar.o) / r.bar.o) * 100 : null;

  return (
    <section className="chart-panel" aria-label={`${symbol} price chart`}>
      <div className="chart-toolbar">
        <div className="seg" role="group" aria-label="Timeframe">
          {TIMEFRAMES.map((tf) => (
            <button key={tf} type="button" className="seg-btn" aria-pressed={tf === timeframe} onClick={() => onTimeframe(tf)}>
              {tf}
            </button>
          ))}
        </div>
        <p className="readout num" aria-live="off">
          {r ? (
            <>
              <span className="ro-k">O</span> {formatPrice(r.bar.o)} <span className="ro-k">H</span> {formatPrice(r.bar.h)}{" "}
              <span className="ro-k">L</span> {formatPrice(r.bar.l)} <span className="ro-k">C</span>{" "}
              <span className={change !== null && change < 0 ? "loss" : "profit"}>{formatPrice(r.bar.c)}</span>{" "}
              <span className="ro-k">BB</span> {r.band ? formatPrice(r.band.mid) : "--"}{" "}
              <span className="ro-k">SD</span> {z === null ? "--" : `${z >= 0 ? "+" : ""}${z.toFixed(2)}`}
            </>
          ) : (
            <span className="ro-k">No bar under the crosshair</span>
          )}
        </p>
      </div>
      <div className="chart-host" ref={hostRef}>
        {status.state !== "ready" && (
          <div className="chart-overlay" role="status">
            {status.state === "loading" ? (
              <span>
                Loading {symbol} {timeframe} candles…
              </span>
            ) : (
              <span>
                Candles unavailable: {status.message}{" "}
                <button type="button" className="btn btn-ghost" onClick={() => setRetry((n) => n + 1)}>
                  Retry
                </button>
              </span>
            )}
          </div>
        )}
      </div>
      <p className="chart-legend">
        <span className="lg lg-mid">BB(15) mid</span>
        <span className="lg lg-up">Upper 1, 1.5, 2 sd</span>
        <span className="lg lg-lo">Lower 1, 1.5, 2 sd</span>
        <span className="lg lg-bust">Bust within 35%</span>
        <span className="ro-k">Times in UTC</span>
      </p>
    </section>
  );
}
