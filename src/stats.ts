import type { Candle, Trade, Timeframe } from "./api";
import { TIMEFRAME_SECONDS } from "./api";
import { bandLadder } from "./indicators";
import { toMs } from "./format";

/** A position can appear as both Opened and settled; count its last settlement once. */
export function settledTrades(trades: readonly Trade[]): Trade[] {
  const byId = new Map<string, Trade>();
  for (const t of trades) {
    if (t.kind === "Opened") continue;
    const prev = byId.get(t.positionId);
    if (!prev || (toMs(t.closedAt) ?? 0) >= (toMs(prev.closedAt) ?? 0))
      byId.set(t.positionId, t);
  }
  return [...byId.values()];
}
export interface GroupStats {
  label: string;
  count: number;
  pnl: number;
  wins: number;
  winRate: number | null;
}
export interface TradeStats {
  count: number;
  wins: number;
  losses: number;
  winRate: number | null;
  averagePnl: number | null;
  medianPnl: number | null;
  bestTrade: Trade | null;
  worstTrade: Trade | null;
  profitFactor: number | null;
  averageLeverage: number | null;
  averageHoldMs: number | null;
  liquidations: number;
  liquidationRate: number | null;
  byMarket: GroupStats[];
  bySide: GroupStats[];
}
const mean = (v: number[]): number | null =>
  v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
export function computeStats(input: readonly Trade[]): TradeStats {
  const trades = settledTrades(input);
  const pnls = trades
    .map((t) => t.pnlUsd)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const wins = trades.filter((t) => t.pnlUsd > 0).length;
  const losses = trades.filter((t) => t.pnlUsd < 0).length;
  const grossProfit = pnls.filter((n) => n > 0).reduce((a, b) => a + b, 0);
  const grossLoss = -pnls.filter((n) => n < 0).reduce((a, b) => a + b, 0);
  const liquidations = trades.filter((t) => t.kind === "Liquidated").length;
  const group = (label: (t: Trade) => string): GroupStats[] =>
    [...new Set(trades.map(label))].sort().map((key) => {
      const list = trades.filter((t) => label(t) === key);
      const won = list.filter((t) => t.pnlUsd > 0).length;
      return {
        label: key,
        count: list.length,
        pnl: list.reduce((s, t) => s + t.pnlUsd, 0),
        wins: won,
        winRate: (won / list.length) * 100,
      };
    });
  const holds = trades.flatMap((t) => {
    const opened = toMs(t.openedAt),
      closed = toMs(t.closedAt);
    return opened !== null && closed !== null && closed >= opened
      ? [closed - opened]
      : [];
  });
  const sorted = trades
    .filter((t) => Number.isFinite(t.pnlUsd))
    .slice()
    .sort((a, b) => a.pnlUsd - b.pnlUsd);
  return {
    count: trades.length,
    wins,
    losses,
    winRate: trades.length ? (wins / trades.length) * 100 : null,
    averagePnl: mean(pnls),
    medianPnl: pnls.length
      ? (pnls[Math.floor((pnls.length - 1) / 2)] +
          pnls[Math.floor(pnls.length / 2)]) /
        2
      : null,
    bestTrade: sorted.at(-1) ?? null,
    worstTrade: sorted[0] ?? null,
    profitFactor: grossLoss
      ? grossProfit / grossLoss
      : grossProfit
        ? Infinity
        : null,
    averageLeverage: mean(
      trades.map((t) => t.leverage).filter((n) => Number.isFinite(n) && n > 0),
    ),
    averageHoldMs: mean(holds),
    liquidations,
    liquidationRate: trades.length
      ? (liquidations / trades.length) * 100
      : null,
    byMarket: group((t) => t.symbol),
    bySide: group((t) => (t.isLong ? "Long" : "Short")),
  };
}
export const SIGMA_BUCKETS = [
  "≤ −2σ",
  "−2 to −1.5σ",
  "−1.5 to −1σ",
  "−1 to 0σ",
  "0 to +1σ",
  "+1 to +1.5σ",
  "+1.5 to +2σ",
  "≥ +2σ",
] as const;
export function sigmaBucket(z: number): number | null {
  if (!Number.isFinite(z)) return null;
  if (z <= -2) return 0;
  if (z <= -1.5) return 1;
  if (z <= -1) return 2;
  if (z < 0) return 3;
  if (z >= 2) return 7;
  if (z >= 1.5) return 6;
  if (z >= 1) return 5;
  return 4;
}
export interface SigmaBucket {
  label: string;
  count: number;
  wins: number;
  settled: number;
  winRate: number | null;
}
export interface SigmaStats {
  buckets: SigmaBucket[];
  classified: number;
  unclassified: number;
  total: number;
}
/** Entry price against the containing candle's BB(15). Never borrow the next candle or a gap. */
export function entrySigmaStats(
  trades: readonly Trade[],
  candles: Readonly<Record<string, readonly Candle[]>>,
  tf: Timeframe,
): SigmaStats {
  const entries = new Map(settledTrades(trades).map((t) => [t.positionId, t]));
  for (const t of trades) {
    if (!entries.has(t.positionId)) entries.set(t.positionId, t);
  }
  const buckets: SigmaBucket[] = SIGMA_BUCKETS.map((label) => ({
    label,
    count: 0,
    wins: 0,
    settled: 0,
    winRate: null,
  }));
  const lookup = new Map<string, Map<number, { mid: number; sd: number }>>();
  for (const [symbol, bars] of Object.entries(candles)) {
    const sorted = bars.slice().sort((a, b) => a.t - b.t);
    const bands = bandLadder(sorted.map((b) => b.c));
    lookup.set(
      symbol,
      new Map(
        sorted.flatMap((bar, i) => (bands[i] ? [[bar.t, bands[i]!]] : [])),
      ),
    );
  }
  let classified = 0;
  for (const trade of entries.values()) {
    const ms = toMs(trade.openedAt);
    if (ms === null) continue;
    const step = TIMEFRAME_SECONDS[tf];
    const band = lookup
      .get(trade.symbol)
      ?.get(Math.floor(ms / 1000 / step) * step);
    if (!band || band.sd <= 0) continue;
    const bucket = sigmaBucket((trade.entry - band.mid) / band.sd);
    if (bucket === null) continue;
    const b = buckets[bucket];
    b.count++;
    classified++;
    if (trade.kind !== "Opened") {
      b.settled++;
      if (trade.pnlUsd > 0) b.wins++;
    }
  }
  for (const b of buckets)
    b.winRate = b.settled ? (b.wins / b.settled) * 100 : null;
  return {
    buckets,
    classified,
    unclassified: entries.size - classified,
    total: entries.size,
  };
}
