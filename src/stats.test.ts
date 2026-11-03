import { describe, expect, it } from "vitest";
import type { Candle, Trade } from "./api";
import { bandLadder } from "./indicators";
import {
  computeStats,
  entrySigmaStats,
  settledTrades,
  sigmaBucket,
} from "./stats";
const epoch = Date.UTC(2026, 10, 1);
const trade = (id: string, pnl: number, patch: Partial<Trade> = {}): Trade => ({
  positionId: id,
  symbol: "BTC",
  isLong: true,
  kind: "Closed",
  marginUsd: 100,
  leverage: 25,
  entry: 100,
  exit: 105,
  pnlUsd: pnl,
  feeUsd: 1,
  paperMinted: 0,
  openedAt: epoch,
  closedAt: epoch + 3600_000,
  txHash: null,
  ...patch,
});
describe("computeStats", () => {
  it("returns missing metrics for empty history without NaN or fake zero percentages", () => {
    expect(computeStats([])).toMatchObject({
      count: 0,
      wins: 0,
      losses: 0,
      liquidations: 0,
      winRate: null,
      averagePnl: null,
      medianPnl: null,
      bestTrade: null,
      worstTrade: null,
      profitFactor: null,
      averageLeverage: null,
      averageHoldMs: null,
      liquidationRate: null,
      byMarket: [],
      bySide: [],
    });
  });
  it("computes all statistics from settlements without charging the fee twice", () => {
    const result = computeStats([
      trade("a", 100, { leverage: 10 }),
      trade("b", -50, {
        kind: "Liquidated",
        leverage: 20,
        symbol: "ETH",
        isLong: false,
        closedAt: epoch + 3 * 3600_000,
      }),
      trade("c", 0, { leverage: 30 }),
      trade("d", 50, { leverage: 40 }),
      trade("open", 500, { kind: "Opened", closedAt: null }),
    ]);
    expect(result).toMatchObject({
      count: 4,
      wins: 2,
      losses: 1,
      winRate: 50,
      averagePnl: 25,
      medianPnl: 25,
      profitFactor: 3,
      averageLeverage: 25,
      averageHoldMs: 1.5 * 3600_000,
      liquidations: 1,
      liquidationRate: 25,
    });
    expect(result.bestTrade?.positionId).toBe("a");
    expect(result.worstTrade?.positionId).toBe("b");
    expect(result.byMarket).toEqual([
      { label: "BTC", count: 3, pnl: 150, wins: 2, winRate: (2 / 3) * 100 },
      { label: "ETH", count: 1, pnl: -50, wins: 0, winRate: 0 },
    ]);
    expect(result.bySide.map((g) => [g.label, g.pnl])).toEqual([
      ["Long", 150],
      ["Short", -50],
    ]);
  });
  it("takes the odd median and handles only winners, only losers and break-even", () => {
    expect(
      computeStats([trade("a", 3), trade("b", 1), trade("c", 2)]).medianPnl,
    ).toBe(2);
    expect(computeStats([trade("a", 5)]).profitFactor).toBe(Infinity);
    expect(computeStats([trade("a", -5)]).profitFactor).toBe(0);
    expect(computeStats([trade("a", 0)]).profitFactor).toBeNull();
    expect(computeStats([trade("a", 0)]).winRate).toBe(0);
  });
  it("deduplicates opened and terminal events and retains the latest terminal state", () => {
    const rows = [
      trade("a", 0, { kind: "Opened", closedAt: null }),
      trade("a", 1),
      trade("a", 2, { closedAt: epoch + 7200_000 }),
      trade("a", 0, { kind: "Opened", closedAt: null }),
    ];
    expect(settledTrades(rows)).toHaveLength(1);
    expect(computeStats(rows).averagePnl).toBe(2);
  });
  it("normalizes UTC ISO, unix seconds and milliseconds and ignores negative holds", () => {
    const s = computeStats([
      trade("a", 1, {
        openedAt: epoch / 1000,
        closedAt: new Date(epoch + 120_000).toISOString(),
      }),
      trade("b", 2, { openedAt: epoch, closedAt: epoch - 1 }),
    ]);
    expect(s.averageHoldMs).toBe(120_000);
  });
  it("does not mutate input order", () => {
    const rows = Object.freeze([
      Object.freeze(trade("a", 2)),
      Object.freeze(trade("b", -1)),
    ]);
    computeStats(rows);
    expect(rows.map((t) => t.positionId)).toEqual(["a", "b"]);
  });
});
describe("sigmaBucket", () => {
  it.each([
    [-3, 0],
    [-2, 0],
    [-1.8, 1],
    [-1.5, 1],
    [-1.1, 2],
    [-1, 2],
    [-0.1, 3],
    [0, 4],
    [0.9, 4],
    [1, 5],
    [1.5, 6],
    [2, 7],
    [3, 7],
  ])("buckets %s sigma into %s", (z, index) => {
    expect(sigmaBucket(z)).toBe(index);
  });
  it("rejects nonfinite z-scores", () => {
    expect(sigmaBucket(NaN)).toBeNull();
    expect(sigmaBucket(Infinity)).toBeNull();
  });
});
describe("entrySigmaStats", () => {
  const start = epoch / 1000;
  const bars: Candle[] = Array.from({ length: 30 }, (_, i) => ({
    t: start + i * 900,
    o: 100 + i,
    h: 102 + i,
    l: 99 + i,
    c: 100 + i,
    v: 1,
  }));
  const band = bandLadder(bars.map((b) => b.c))[20]!;
  it("uses entry price and containing candle, not trade exit or the latest candle", () => {
    const entry = trade("a", 10, {
      openedAt: (start + 20 * 900 + 500) * 1000,
      entry: band.mid + 2.1 * band.sd,
    });
    const result = entrySigmaStats([entry], { BTC: bars }, "15m");
    expect(result.classified).toBe(1);
    expect(result.buckets[7]).toMatchObject({
      count: 1,
      wins: 1,
      settled: 1,
      winRate: 100,
    });
  });
  it("does not count an Opened and a settlement twice; open entries have no win rate", () => {
    const closed = trade("a", -10, {
      openedAt: (start + 20 * 900) * 1000,
      entry: band.mid,
    });
    const open = trade("b", 0, {
      openedAt: closed.openedAt,
      entry: band.mid,
      kind: "Opened",
      closedAt: null,
    });
    const result = entrySigmaStats(
      [{ ...closed, kind: "Opened" }, closed, open],
      { BTC: bars },
      "15m",
    );
    expect(result.total).toBe(2);
    expect(result.buckets[4]).toMatchObject({
      count: 2,
      settled: 1,
      winRate: 0,
    });
  });
  it("uses the latest settlement for bucket win rates, even when newer events arrive first", () => {
    const latest = trade("a", 10, {
      openedAt: (start + 20 * 900) * 1000,
      entry: band.mid,
      closedAt: epoch + 7200_000,
    });
    const older = { ...latest, pnlUsd: -5, closedAt: epoch + 3600_000 };
    const result = entrySigmaStats([latest, older], { BTC: bars }, "15m");
    expect(result.total).toBe(1);
    expect(result.buckets[4]).toMatchObject({
      count: 1,
      wins: 1,
      settled: 1,
      winRate: 100,
    });
  });
  it("leaves warmup, missing market, out-of-range and missing timestamp entries unclassified", () => {
    const rows = [
      trade("warmup", 1, { openedAt: epoch }),
      trade("outside", 1, { openedAt: epoch - 1000 }),
      trade("market", 1, { symbol: "ETH" }),
      trade("invalid", 1, { openedAt: "invalid" }),
    ];
    expect(entrySigmaStats(rows, { BTC: bars }, "15m")).toMatchObject({
      classified: 0,
      unclassified: 4,
      total: 4,
    });
  });
  it("does not borrow a candle across a gap or classify a zero-sd window", () => {
    const rows = [trade("a", 1, { openedAt: (start + 20 * 900) * 1000 })];
    expect(
      entrySigmaStats(rows, { BTC: bars.filter((_, i) => i !== 20) }, "15m")
        .unclassified,
    ).toBe(1);
    expect(
      entrySigmaStats(rows, { BTC: bars.map((b) => ({ ...b, c: 100 })) }, "15m")
        .unclassified,
    ).toBe(1);
  });
  it("uses the correct market's bands and accepts ISO entry time", () => {
    const row = trade("a", 1, {
      symbol: "ETH",
      openedAt: new Date((start + 20 * 900) * 1000).toISOString(),
      entry: band.mid * 2,
    });
    expect(
      entrySigmaStats(
        [row],
        { ETH: bars.map((b) => ({ ...b, c: b.c * 2 })) },
        "15m",
      ).buckets[4].count,
    ).toBe(1);
  });
});
