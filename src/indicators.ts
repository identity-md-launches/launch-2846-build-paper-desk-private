// Pure indicator math for the chart. No DOM, no chart library: everything here is unit tested
// in indicators.test.ts on fixed fixtures.

export interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export const BB_PERIOD = 15;
export const SIGNAL_LOOKBACK = 5;
/** Sigma steps of the band ladder. */
export const LADDER = [1, 1.5, 2] as const;

/** Simple moving average; null until `period` values are available. */
export function sma(values: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Population standard deviation (divide by N) over the trailing `period` values. */
export function populationSd(values: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0) return out;
  for (let i = period - 1; i < values.length; i++) {
    let mean = 0;
    for (let j = i - period + 1; j <= i; j++) mean += values[j];
    mean /= period;
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) sq += (values[j] - mean) ** 2;
    out[i] = Math.sqrt(sq / period);
  }
  return out;
}

export interface BandPoint {
  mid: number;
  sd: number;
  up1: number;
  up15: number;
  up2: number;
  lo1: number;
  lo15: number;
  lo2: number;
}

/** BB(period) ladder: SMA midline plus/minus 1, 1.5 and 2 population sd of the same closes. */
export function bandLadder(closes: readonly number[], period = BB_PERIOD): (BandPoint | null)[] {
  const mids = sma(closes, period);
  const sds = populationSd(closes, period);
  return mids.map((mid, i) => {
    const sd = sds[i];
    if (mid === null || sd === null) return null;
    return {
      mid,
      sd,
      up1: mid + sd,
      up15: mid + 1.5 * sd,
      up2: mid + 2 * sd,
      lo1: mid - sd,
      lo15: mid - 1.5 * sd,
      lo2: mid - 2 * sd,
    };
  });
}

export const CANDLE_COLORS = {
  above2: "#7f1d1d",
  above15: "#dc2626",
  above1: "#f97316",
  aboveMid: "#f59e0b",
  belowMid: "#84cc16",
  below1: "#4ade80",
  below15: "#16a34a",
  below2: "#14532d",
  /** Bars before the first full BB window have no ladder to bucket against. */
  none: "#6b6457",
} as const;

/**
 * Where a close sits in the ladder. Outer bounds are inclusive on both sides
 * (>= +2sd, <= -2sd, >= +1.5sd, <= -1.5sd ...), and a close exactly at the midline is "aboveMid".
 * A flat window (sd = 0) puts every close at the midline side it falls on.
 */
export function candleColor(close: number, band: BandPoint | null): string {
  if (!band) return CANDLE_COLORS.none;
  const { mid, sd } = band;
  if (sd === 0) return close >= mid ? CANDLE_COLORS.aboveMid : CANDLE_COLORS.belowMid;
  const z = (close - mid) / sd;
  if (z >= 2) return CANDLE_COLORS.above2;
  if (z >= 1.5) return CANDLE_COLORS.above15;
  if (z >= 1) return CANDLE_COLORS.above1;
  if (z >= 0) return CANDLE_COLORS.aboveMid;
  if (z <= -2) return CANDLE_COLORS.below2;
  if (z <= -1.5) return CANDLE_COLORS.below15;
  if (z <= -1) return CANDLE_COLORS.below1;
  return CANDLE_COLORS.belowMid;
}

export type SignalKind = "BUY" | "STRONG BUY" | "SELL" | "STRONG SELL";

export interface Signal {
  index: number;
  side: "buy" | "sell";
  kind: SignalKind;
  /** The bar low for buys, the bar high for sells. */
  price: number;
  /** True when this signal keeps its text label after decluttering. */
  labeled: boolean;
}

/**
 * Signals at confirmed local extremes. A bar is a local low when its low is the lowest low of the
 * `lookback` bars on each side (so the last `lookback` bars cannot signal yet), and a local high
 * likewise. BUY when that low is at or below the lower 1.5sd band, STRONG BUY at or below 2sd;
 * SELL / STRONG SELL mirror it on the upper bands with the bar high.
 */
export function detectSignals(
  bars: readonly Bar[],
  bands: readonly (BandPoint | null)[],
  lookback = SIGNAL_LOOKBACK,
): Signal[] {
  const out: Signal[] = [];
  for (let i = lookback; i < bars.length - lookback; i++) {
    const band = bands[i];
    if (!band) continue;
    let isLow = true;
    let isHigh = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (bars[j].l < bars[i].l) isLow = false;
      if (bars[j].h > bars[i].h) isHigh = false;
    }
    if (isLow && bars[i].l <= band.lo15) {
      out.push({ index: i, side: "buy", kind: bars[i].l <= band.lo2 ? "STRONG BUY" : "BUY", price: bars[i].l, labeled: true });
    }
    if (isHigh && bars[i].h >= band.up15) {
      out.push({ index: i, side: "sell", kind: bars[i].h >= band.up2 ? "STRONG SELL" : "SELL", price: bars[i].h, labeled: true });
    }
  }
  return out;
}

/**
 * Declutter: same-side signals closer than 2 x lookback bars chain into one cluster. Only the most
 * extreme signal of each cluster (lowest low for buys, highest high for sells; the earliest wins a
 * tie) keeps its text label. Returns new objects sorted by bar index.
 */
export function declutterSignals(signals: readonly Signal[], lookback = SIGNAL_LOOKBACK): Signal[] {
  const gap = 2 * lookback;
  const result: Signal[] = [];
  for (const side of ["buy", "sell"] as const) {
    const same = signals.filter((s) => s.side === side).sort((a, b) => a.index - b.index);
    let cluster: Signal[] = [];
    const flush = () => {
      if (!cluster.length) return;
      let best = cluster[0];
      for (const s of cluster) {
        if (side === "buy" ? s.price < best.price : s.price > best.price) best = s;
      }
      for (const s of cluster) result.push({ ...s, labeled: s === best });
      cluster = [];
    };
    for (const s of same) {
      if (cluster.length && s.index - cluster[cluster.length - 1].index >= gap) flush();
      cluster.push(s);
    }
    flush();
  }
  return result.sort((a, b) => a.index - b.index || (a.side === "buy" ? -1 : 1));
}

/** Notional exposure of an order. */
export function notional(marginUsd: number, leverage: number): number {
  return marginUsd * leverage;
}

/** Bust price: entry x (1 - 1/leverage) for a long, entry x (1 + 1/leverage) for a short. */
export function bustPrice(entry: number, leverage: number, isLong: boolean): number {
  return isLong ? entry * (1 - 1 / leverage) : entry * (1 + 1 / leverage);
}

/** Take-profit / stop-loss trigger price for a percent price move from entry. */
export function triggerPrice(entry: number, pct: number, isLong: boolean, kind: "tp" | "sl"): number {
  const up = (kind === "tp") === isLong;
  return entry * (1 + ((up ? 1 : -1) * pct) / 100);
}

/** Bust lines are drawn only when the bust price sits within this fraction of mark. */
export const BUST_PROXIMITY = 0.35;

export function bustWithinRange(bust: number, mark: number, range = BUST_PROXIMITY): boolean {
  if (!(mark > 0) || !(bust > 0)) return false;
  return Math.abs(bust - mark) / mark <= range;
}

/** Index range of the initial zoom: the last `bars` bars. */
export function initialRange(length: number, bars = 160): { from: number; to: number } {
  return { from: Math.max(0, length - bars), to: Math.max(0, length - 1) + 2 };
}
