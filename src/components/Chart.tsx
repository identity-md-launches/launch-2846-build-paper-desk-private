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
import {
  TIMEFRAMES,
  TIMEFRAME_SECONDS,
  type Backend,
  type Candle,
  type Position,
  type Timeframe,
  type Trade,
} from "../api";
import {
  bandLadder,
  bustWithinRange,
  candleColor,
  declutterSignals,
  detectSignals,
  initialRange,
  type BandPoint,
} from "../indicators";
import { accountMarkers } from "../chartOverlays";
import { analyseErl, closedAtFetch } from "../useErl";
import { formatDateTime, formatPrice } from "../format";

const BAND_STYLE: { key: keyof Omit<BandPoint, "sd">; color: string }[] = [
  { key: "mid", color: "#6366f1" },
  { key: "up1", color: "#fca5a5" },
  { key: "up15", color: "#f87171" },
  { key: "up2", color: "#dc2626" },
  { key: "lo1", color: "#86efac" },
  { key: "lo15", color: "#4ade80" },
  { key: "lo2", color: "#16a34a" },
];

const LINE_COLORS = { entry: "#8a8578", bust: "#FF2D78" };
const CANDLE_LIMIT = 1000;

interface Props {
  backend: Backend;
  symbol: string;
  timeframe: Timeframe;
  onTimeframe: (tf: Timeframe) => void;
  /** Latest polled mark for `symbol`; updates the forming bar. */
  mark: { price: number; at: number } | null;
  positions: Position[];
  trades: Trade[];
  overlays: boolean;
  focusTrade: { trade: Trade; key: number } | null;
  /** Draw the ERL-100 layer: holding-window stop/target, entry/exit markers, current stop. */
  signal: boolean;
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

export function Chart({
  backend,
  symbol,
  timeframe,
  onTimeframe,
  mark,
  positions,
  trades,
  overlays,
  focusTrade,
  signal,
}: Props) {
  const sectionRef = useRef<HTMLElement>(null);
  const overlayRef = useRef({ positions, trades, overlays, symbol, timeframe, signal });
  overlayRef.current = { positions, trades, overlays, symbol, timeframe, signal };
  const erlLinesRef = useRef<ISeriesApi<"Line">[]>([]);
  const erlPriceLineRef = useRef<IPriceLine | null>(null);
  const [erlNote, setErlNote] = useState("");
  /** Market and timeframe of the bars in barsRef; the ERL layer never reads mismatched bars. */
  const loadedKeyRef = useRef("");
  const [overlayCount, setOverlayCount] = useState({ visible: 0, total: 0 });
  const [focusMessage, setFocusMessage] = useState("");
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const bandRefs = useRef<ISeriesApi<"Line">[]>([]);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const anchorsRef = useRef<ISeriesApi<"Line">[]>([]);
  const barsRef = useRef<Candle[]>([]);
  /**
   * Last validated feed snapshot, closed bars only, never touched by quote sampling. The ERL
   * layer reads only this, so it matches the signal panel's bar-closed candles.
   */
  const feedRef = useRef<Candle[]>([]);
  const [reconcile, setReconcile] = useState(0);
  const reconcileTimer = useRef<number | undefined>(undefined);
  const bandsRef = useRef<(BandPoint | null)[]>([]);
  const levelsRef = useRef<Level[]>([]);
  const levelsVersionRef = useRef(-1);
  const [status, setStatus] = useState<{
    state: "loading" | "ready" | "error";
    message?: string;
  }>({ state: "loading" });
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
      rightPriceScale: {
        borderColor: "#2a2620",
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor: "#2a2620",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 2,
      },
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
    erlLinesRef.current = [
      { color: "#ff8c00", lineStyle: LineStyle.Dashed },
      { color: "#c7bca6", lineStyle: LineStyle.Dotted },
    ].map((o) =>
      chart.addSeries(LineSeries, {
        ...o,
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
      if (!disposed)
        chart.applyOptions({
          layout: { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" },
        });
    });

    chart.subscribeCrosshairMove((param) => {
      if (disposed) return;
      const bars = barsRef.current;
      if (!param.time || !param.point) {
        hoverRef.current = false;
        const i = bars.length - 1;
        setReadout(
          i >= 0
            ? { bar: bars[i], band: bandsRef.current[i] ?? null, live: true }
            : null,
        );
        return;
      }
      const i = param.logical === undefined ? -1 : Math.round(param.logical);
      if (i < 0 || i >= bars.length) return;
      hoverRef.current = true;
      setReadout({
        bar: bars[i],
        band: bandsRef.current[i] ?? null,
        live: i === bars.length - 1,
      });
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      ro.disconnect();
      chartRef.current = null;
      candleRef.current = null;
      bandRefs.current = [];
      erlLinesRef.current = [];
      erlPriceLineRef.current = null;
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
        return {
          time: asTime(b.t),
          open: b.o,
          high: b.h,
          low: b.l,
          close: b.c,
          color,
          borderColor: color,
          wickColor: color,
        };
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
      color:
        s.side === "buy"
          ? s.kind === "STRONG BUY"
            ? "#22c55e"
            : "#4ade80"
          : s.kind === "STRONG SELL"
            ? "#ef4444"
            : "#f87171",
      text: s.labeled ? s.kind : "",
      size: s.kind.startsWith("STRONG") ? 1.4 : 1,
    }));
    const o = overlayRef.current;
    const account = accountMarkers(
      bars,
      o.trades,
      o.positions,
      o.symbol,
      o.timeframe,
    );
    setOverlayCount({ visible: account.visible, total: account.total });
    const erl =
      loadedKeyRef.current === `${o.symbol}:${o.timeframe}`
        ? erlLayer(feedRef.current, o.signal, o.symbol, o.timeframe)
        : [];
    const base = o.overlays ? [...markers, ...account.markers] : markers;
    const all = [...base, ...erl];
    markersRef.current?.setMarkers(
      all.sort((a, b) => Number(a.time) - Number(b.time)),
    );
  };

  /** ERL markers, holding-window lines and the current stop price line; [] when hidden. */
  const erlLayer = (
    bars: Candle[],
    on: boolean,
    sym: string,
    tf: Timeframe,
  ): SeriesMarker<Time>[] => {
    const candles = candleRef.current;
    const [stopSeries, targetSeries] = erlLinesRef.current;
    if (erlPriceLineRef.current && candles) {
      candles.removePriceLine(erlPriceLineRef.current);
      erlPriceLineRef.current = null;
    }
    if (!on || (sym !== "BTC" && sym !== "ETH") || !bars.length) {
      stopSeries?.setData([]);
      targetSeries?.setData([]);
      setErlNote(on ? "ERL-100 covers BTC and ETH only." : "");
      return [];
    }
    const { erl, bt, state } = analyseErl(bars, sym, tf, Math.floor(Date.now() / 1000));
    const out: SeriesMarker<Time>[] = [];
    const stop: LineData<Time>[] = [],
      target: LineData<Time>[] = [];
    const windows = bt.trades.map((t) => ({
      from: t.candidate.index,
      to: t.exitIndex ?? erl.closedCount - 1,
      stop: t.rawStop,
      target: t.rawTarget,
    }));
    if (bt.pending)
      windows.push({
        from: bt.pending.index,
        to: bt.pending.index,
        stop: bt.pending.rawStop,
        target: bt.pending.rawTarget,
      });
    bars.forEach((b, i) => {
      const w = windows.find((x) => i >= x.from && i <= x.to);
      stop.push(w ? { time: asTime(b.t), value: w.stop } : ({ time: asTime(b.t) } as LineData<Time>));
      target.push(w ? { time: asTime(b.t), value: w.target } : ({ time: asTime(b.t) } as LineData<Time>));
    });
    stopSeries?.setData(stop);
    targetSeries?.setData(target);
    const entryAllowed = !erl.diagnostics.some((d) => d.code === "TF_ENTRY_DISABLED");
    if (!entryAllowed) {
      for (const c of erl.candidates)
        out.push({
          time: asTime(c.t),
          position: c.side === 1 ? "belowBar" : "aboveBar",
          shape: "circle",
          color: "#8f8676",
          size: 0.5,
        });
      setErlNote(`ERL-100 entries are 1m/5m only; ${tf} shows geometry only.`);
      return out;
    }
    // Entry arrows come from the immutable confirmed candidates, so a later fill skip or
    // execution result can never remove or move them (§4.8). Execution is drawn separately.
    for (const c of erl.candidates) {
      if (!c.entryAllowed) continue;
      out.push({
        time: asTime(c.t),
        position: c.side === 1 ? "belowBar" : "aboveBar",
        shape: c.side === 1 ? "arrowUp" : "arrowDown",
        color: "#ff8c00",
        size: 0.6,
        text: "ERL",
      });
    }
    for (const t of bt.trades) {
      if (t.exitIndex !== null && t.status === "CLOSED")
        out.push({
          time: asTime(bars[t.exitIndex].t),
          position: t.side === 1 ? "aboveBar" : "belowBar",
          shape: "square",
          color: t.pnl !== null && t.pnl > 0 ? "#22c55e" : "#c7bca6",
          size: 0.5,
        });
    }
    // Simulated fills rejected at the next bar (drift, re-check, gap): a small grey dot on the
    // fill bar, separate from the candidate's arrow.
    const skippedFills = bt.skipped.filter((k) => !k.reasons.includes("POSITION_OR_COOLDOWN"));
    for (const k of skippedFills) {
      const fi = k.candidate.index + 1;
      if (fi < bars.length)
        out.push({
          time: asTime(bars[fi].t),
          position: k.candidate.side === 1 ? "belowBar" : "aboveBar",
          shape: "circle",
          color: "#8f8676",
          size: 0.4,
        });
    }
    if (state.stop !== null && candles)
      erlPriceLineRef.current = candles.createPriceLine({
        price: state.stop,
        color: "#ff8c00",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "ERL stop",
      });
    const confirmed = erl.candidates.filter((c) => c.entryAllowed).length;
    setErlNote(
      erl.status === "INVALID"
        ? `ERL-100 · candle series rejected (${erl.diagnostics[0]?.code ?? "INVALID"}) · no signals`
        : `ERL-100 candle-only core · ${confirmed} confirmed signals in loaded ${tf} candles · ${bt.trades.length} simulated fills, ${skippedFills.length} fills skipped · current ${state.state}`,
    );
    return out;
  };

  useEffect(() => {
    applyMarkers();
  }, [trades, positions, overlays, version, signal]);

  useEffect(() => {
    if (
      !focusTrade ||
      status.state !== "ready" ||
      focusTrade.trade.symbol !== symbol
    )
      return;
    const bars = barsRef.current;
    const entry =
      Number(
        new Date(
          typeof focusTrade.trade.openedAt === "number"
            ? focusTrade.trade.openedAt < 1e12
              ? focusTrade.trade.openedAt * 1000
              : focusTrade.trade.openedAt
            : focusTrade.trade.openedAt,
        ),
      ) / 1000;
    const index = bars.findIndex(
      (b) => entry >= b.t && entry < b.t + TIMEFRAME_SECONDS[timeframe],
    );
    if (index < 0) {
      setFocusMessage(
        "This entry is outside the 1,000 available candles. Try a longer timeframe.",
      );
      return;
    }
    const endMs = focusTrade.trade.closedAt;
    const end =
      endMs === null
        ? entry
        : Number(
            new Date(
              typeof endMs === "number"
                ? endMs < 1e12
                  ? endMs * 1000
                  : endMs
                : endMs,
            ),
          ) / 1000;
    const endIndex = bars.findIndex(
      (b) => end >= b.t && end < b.t + TIMEFRAME_SECONDS[timeframe],
    );
    chartRef.current
      ?.timeScale()
      .setVisibleLogicalRange({
        from: Math.max(0, index - 25),
        to: Math.min(bars.length + 2, Math.max(index + 25, endIndex + 15)),
      });
    setFocusMessage(
      `Inspecting ${focusTrade.trade.symbol} ${focusTrade.trade.isLong ? "long" : "short"} entry · ${formatDateTime(focusTrade.trade.openedAt)} UTC`,
    );
    sectionRef.current?.scrollIntoView({ block: "start" });
    sectionRef.current?.focus({ preventScroll: true });
  }, [focusTrade, symbol, timeframe, version, status.state]);

  // Load candles for the selected market and timeframe. A newer request aborts the older one,
  // and a response that lands after unmount or after the selection changed is dropped.
  useEffect(() => {
    const ctrl = new AbortController();
    setStatus({ state: "loading" });
    setFocusMessage("");
    backend
      .candles(symbol, timeframe, CANDLE_LIMIT, ctrl.signal)
      .then((rows) => {
        if (ctrl.signal.aborted || !chartRef.current) return;
        // Quote sampling mutates the forming bar, so the chart gets copies of the feed rows.
        barsRef.current = rows.map((b) => ({ ...b }));
        feedRef.current = closedAtFetch(rows, timeframe, Math.floor(Date.now() / 1000));
        loadedKeyRef.current = `${symbol}:${timeframe}`;
        applyAll();
        const range = initialRange(rows.length, 160);
        chartRef.current.timeScale().setVisibleLogicalRange(range);
        chartRef.current.priceScale("right").applyOptions({ autoScale: true });
        const last = rows.length - 1;
        setReadout(
          last >= 0
            ? {
                bar: rows[last],
                band: bandsRef.current[last] ?? null,
                live: true,
              }
            : null,
        );
        setStatus(
          rows.length
            ? { state: "ready" }
            : {
                state: "error",
                message: "The backend returned no candles for this market.",
              },
        );
        setVersion((v) => v + 1);
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setStatus({
          state: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      });
    return () => ctrl.abort();
  }, [backend, symbol, timeframe, retry, applyAll]);

  // Reconcile with the candle feed every 15 s and shortly after each bar roll: closed OHLC
  // always comes from /api/candles, quote samples only shape the forming bar.
  useEffect(() => {
    if (status.state !== "ready") return;
    const id = window.setInterval(() => setReconcile((n) => n + 1), 15_000);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(reconcileTimer.current);
    };
  }, [status.state]);
  useEffect(() => {
    if (!reconcile || document.visibilityState !== "visible") return;
    const { symbol: sym, timeframe: tf } = overlayRef.current;
    const key = `${sym}:${tf}`;
    if (loadedKeyRef.current !== key) return;
    const ctrl = new AbortController();
    backend
      .candles(sym, tf, CANDLE_LIMIT, ctrl.signal)
      .then((rows) => {
        const chart = chartRef.current;
        if (ctrl.signal.aborted || !chart || loadedKeyRef.current !== key || !rows.length) return;
        feedRef.current = closedAtFetch(rows, tf, Math.floor(Date.now() / 1000));
        const bars = rows.map((b) => ({ ...b }));
        const sampled = barsRef.current.at(-1);
        // Keep a forming bar the feed has not opened yet.
        if (sampled && sampled.t > bars[bars.length - 1].t) bars.push(sampled);
        const range = chart.timeScale().getVisibleLogicalRange();
        const shift = bars.length - barsRef.current.length;
        barsRef.current = bars;
        applyAll();
        if (range) chart.timeScale().setVisibleLogicalRange({ from: range.from + shift, to: range.to + shift });
      })
      .catch(() => {
        // A failed reconcile keeps the previous feed snapshot; the main load shows hard errors.
      });
    return () => ctrl.abort();
  }, [reconcile, backend, applyAll]);

  // Fold each polled mark into the forming bar, or open a new bar when the bucket rolls over.
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
      bars.push({
        t: bucket,
        o: last.c,
        h: Math.max(last.c, mark.price),
        l: Math.min(last.c, mark.price),
        c: mark.price,
        v: 0,
      });
      applyAll();
      setVersion((v) => v + 1);
      // The just-closed bar is shown from sampled quotes until the feed's completed bar arrives.
      window.clearTimeout(reconcileTimer.current);
      reconcileTimer.current = window.setTimeout(() => setReconcile((n) => n + 1), 1500);
    } else {
      last.c = mark.price;
      last.h = Math.max(last.h, mark.price);
      last.l = Math.min(last.l, mark.price);
      const closes = bars.slice(-15).map((b) => b.c);
      const band =
        bars.length >= 15 ? bandLadder(closes)[closes.length - 1] : null;
      bandsRef.current[bars.length - 1] = band;
      const color = candleColor(last.c, band);
      candles.update({
        time: asTime(last.t),
        open: last.o,
        high: last.h,
        low: last.l,
        close: last.c,
        color,
        borderColor: color,
        wickColor: color,
      });
      if (band)
        BAND_STYLE.forEach(({ key }, k) =>
          bandRefs.current[k]?.update({
            time: asTime(last.t),
            value: band[key],
          }),
        );
    }
    if (!hoverRef.current) {
      const i = bars.length - 1;
      setReadout({
        bar: { ...bars[i] },
        band: bandsRef.current[i] ?? null,
        live: true,
      });
    }
  }, [mark, status.state, timeframe, applyAll]);

  // Position price lines: entry and bust only within 35% of mark. Each level also gets an
  // invisible anchor series across every bar so autoscale keeps the line on screen.
  useEffect(() => {
    const chart = chartRef.current;
    const candles = candleRef.current;
    if (!chart || !candles) return;
    const levels: Level[] = [];
    for (const p of overlays ? positions : []) {
      if (p.symbol !== symbol) continue;
      const side = p.isLong ? "Long" : "Short";
      levels.push({
        price: p.entry,
        color: LINE_COLORS.entry,
        style: LineStyle.Solid,
        title: `${side} entry`,
      });
      if (bustWithinRange(p.bustPrice, p.mark)) {
        levels.push({
          price: p.bustPrice,
          color: LINE_COLORS.bust,
          style: LineStyle.Dashed,
          title: "Bust",
        });
      }
    }
    const key = (ls: Level[]) =>
      ls.map((l) => `${l.title}@${l.price}`).join("|");
    const bars = barsRef.current;
    if (
      key(levels) === key(levelsRef.current) &&
      version === levelsVersionRef.current
    )
      return;
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
  }, [positions, symbol, version, overlays]);

  const r = readout;
  const z =
    r?.band && r.band.sd > 0 ? (r.bar.c - r.band.mid) / r.band.sd : null;
  const change = r ? ((r.bar.c - r.bar.o) / r.bar.o) * 100 : null;

  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      id="market-chart"
      className="chart-panel"
      aria-label={`${symbol} price chart`}
    >
      <div className="chart-toolbar">
        <div className="seg" role="group" aria-label="Timeframe">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              type="button"
              className="seg-btn"
              aria-pressed={tf === timeframe}
              onClick={() => onTimeframe(tf)}
            >
              {tf}
            </button>
          ))}
        </div>
        <p className="readout num" aria-live="off">
          {r ? (
            <>
              <span className="ro-k">O</span> {formatPrice(r.bar.o)}{" "}
              <span className="ro-k">H</span> {formatPrice(r.bar.h)}{" "}
              <span className="ro-k">L</span> {formatPrice(r.bar.l)}{" "}
              <span className="ro-k">C</span>{" "}
              <span
                className={change !== null && change < 0 ? "loss" : "profit"}
              >
                {formatPrice(r.bar.c)}
              </span>{" "}
              <span className="ro-k">BB</span>{" "}
              {r.band ? formatPrice(r.band.mid) : "--"}{" "}
              <span className="ro-k">SD</span>{" "}
              {z === null ? "--" : `${z >= 0 ? "+" : ""}${z.toFixed(2)}`}
            </>
          ) : (
            <span className="ro-k">No bar under the crosshair</span>
          )}
        </p>
      </div>
      {focusMessage && (
        <p className="focus-message" role="status">
          {focusMessage}{" "}
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => {
              chartRef.current
                ?.timeScale()
                .setVisibleLogicalRange(
                  initialRange(barsRef.current.length, 160),
                );
              setFocusMessage("");
            }}
          >
            Reset view
          </button>
        </p>
      )}
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
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setRetry((n) => n + 1)}
                >
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
      {signal && (
        <p className="overlay-legend erl-legend">
          <span className="erl-key">▲▼ ERL entry</span>
          <span>■ ERL exit</span>
          <span className="lg lg-erl">Stop</span>
          <span className="lg lg-erl-t">Target</span>
          <span className="hint">{erlNote}</span>
        </p>
      )}
      <p className="overlay-legend">
        <span className="profit">▲ Long entry</span>
        <span className="loss">▼ Short entry</span>
        <span>■ Exit</span>
        <span className="bust">✕ LIQ</span>
        <span className="hint">
          {overlays
            ? `${overlayCount.visible}/${overlayCount.total} account events in loaded candles`
            : "Account overlays hidden"}
        </span>
      </p>
    </section>
  );
}
