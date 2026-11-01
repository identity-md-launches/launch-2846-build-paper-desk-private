import { describe, expect, it } from "vitest";
import {
  CANDLE_COLORS,
  bandLadder,
  bustPrice,
  bustWithinRange,
  candleColor,
  declutterSignals,
  detectSignals,
  initialRange,
  notional,
  populationSd,
  sma,
  triggerPrice,
  type Bar,
  type BandPoint,
  type Signal,
} from "./indicators";

const range = (n: number, from = 1) => Array.from({ length: n }, (_, i) => i + from);

/** A ladder point built from a midline and sd, for fixtures that need exact band levels. */
const band = (mid: number, sd: number): BandPoint => ({
  mid,
  sd,
  up1: mid + sd,
  up15: mid + 1.5 * sd,
  up2: mid + 2 * sd,
  lo1: mid - sd,
  lo15: mid - 1.5 * sd,
  lo2: mid - 2 * sd,
});

describe("sma", () => {
  it("is null until the window fills, then averages the trailing window", () => {
    const out = sma(range(20), 15);
    expect(out.slice(0, 14).every((v) => v === null)).toBe(true);
    expect(out[14]).toBe(8); // mean of 1..15
    expect(out[19]).toBe(13); // mean of 6..20
  });

  it("handles a window of one and an empty series", () => {
    expect(sma([3, 5, 7], 1)).toEqual([3, 5, 7]);
    expect(sma([], 15)).toEqual([]);
  });
});

describe("populationSd", () => {
  it("divides by N, not N - 1", () => {
    // 2,4,4,4,5,5,7,9: population sd is exactly 2 (sample sd would be 2.138...).
    const out = populationSd([2, 4, 4, 4, 5, 5, 7, 9], 8);
    expect(out[7]).toBe(2);
  });

  it("matches the closed form for 1..15: sqrt((n^2 - 1) / 12)", () => {
    const out = populationSd(range(15), 15);
    expect(out[14]).toBeCloseTo(Math.sqrt((225 - 1) / 12), 12);
  });

  it("is zero over a flat window", () => {
    expect(populationSd(new Array(15).fill(42), 15)[14]).toBe(0);
  });
});

describe("bandLadder", () => {
  it("builds the 1 / 1.5 / 2 sd ladder around SMA(15) from the same closes", () => {
    const ladder = bandLadder(range(15));
    expect(ladder.slice(0, 14).every((b) => b === null)).toBe(true);
    const b = ladder[14]!;
    const sd = Math.sqrt(224 / 12);
    expect(b.mid).toBe(8);
    expect(b.sd).toBeCloseTo(sd, 12);
    expect(b.up1).toBeCloseTo(8 + sd, 12);
    expect(b.up15).toBeCloseTo(8 + 1.5 * sd, 12);
    expect(b.up2).toBeCloseTo(8 + 2 * sd, 12);
    expect(b.lo1).toBeCloseTo(8 - sd, 12);
    expect(b.lo15).toBeCloseTo(8 - 1.5 * sd, 12);
    expect(b.lo2).toBeCloseTo(8 - 2 * sd, 12);
  });

  it("rolls the window forward one close at a time", () => {
    const ladder = bandLadder(range(16));
    expect(ladder[15]!.mid).toBe(9); // mean of 2..16
  });
});

describe("candleColor", () => {
  const b = band(100, 10);
  it.each([
    [125, CANDLE_COLORS.above2, "#7f1d1d"],
    [120, CANDLE_COLORS.above2, "#7f1d1d"],
    [119.99, CANDLE_COLORS.above15, "#dc2626"],
    [115, CANDLE_COLORS.above15, "#dc2626"],
    [114.99, CANDLE_COLORS.above1, "#f97316"],
    [110, CANDLE_COLORS.above1, "#f97316"],
    [109.99, CANDLE_COLORS.aboveMid, "#f59e0b"],
    [100, CANDLE_COLORS.aboveMid, "#f59e0b"],
    [99.99, CANDLE_COLORS.belowMid, "#84cc16"],
    [90.01, CANDLE_COLORS.belowMid, "#84cc16"],
    [90, CANDLE_COLORS.below1, "#4ade80"],
    [85.01, CANDLE_COLORS.below1, "#4ade80"],
    [85, CANDLE_COLORS.below15, "#16a34a"],
    [80.01, CANDLE_COLORS.below15, "#16a34a"],
    [80, CANDLE_COLORS.below2, "#14532d"],
    [60, CANDLE_COLORS.below2, "#14532d"],
  ])("close %s buckets to %s", (close, token, hex) => {
    expect(token).toBe(hex);
    expect(candleColor(close, b)).toBe(hex);
  });

  it("uses the neutral colour before the first full window", () => {
    expect(candleColor(100, null)).toBe(CANDLE_COLORS.none);
  });

  it("splits a flat window at the midline", () => {
    expect(candleColor(100, band(100, 0))).toBe(CANDLE_COLORS.aboveMid);
    expect(candleColor(99, band(100, 0))).toBe(CANDLE_COLORS.belowMid);
  });
});

/** 50 quiet bars (high 101, low 99) against a fixed ladder: mid 100, sd 2. */
function quietBars(n = 50): Bar[] {
  return Array.from({ length: n }, (_, i) => ({ t: 1_700_000_000 + i * 900, o: 100, h: 101, l: 99, c: 100, v: 1 }));
}
const flatBands = (n = 50) => Array.from({ length: n }, () => band(100, 2)); // lo15 97, lo2 96, up15 103, up2 104

describe("detectSignals", () => {
  it("flags BUY / STRONG BUY at local lows and SELL / STRONG SELL at local highs", () => {
    const bars = quietBars();
    bars[10].l = 96.5; // under lo15 (97), above lo2 (96): BUY
    bars[20].l = 95; // under lo2: STRONG BUY
    bars[25].l = 98; // a local low that never reaches the 1.5sd band: nothing
    bars[30].h = 103.5; // over up15, under up2: SELL
    bars[40].h = 105; // over up2: STRONG SELL
    const out = detectSignals(bars, flatBands());
    expect(out.map((s) => [s.index, s.kind, s.price])).toEqual([
      [10, "BUY", 96.5],
      [20, "STRONG BUY", 95],
      [30, "SELL", 103.5],
      [40, "STRONG SELL", 105],
    ]);
  });

  it("treats exact band touches as signals (<= lower, >= upper)", () => {
    const bars = quietBars();
    bars[12].l = 97;
    bars[30].h = 104;
    const out = detectSignals(bars, flatBands());
    expect(out.map((s) => s.kind)).toEqual(["BUY", "STRONG SELL"]);
  });

  it("requires the full 5-bar lookback on both sides", () => {
    const bars = quietBars();
    bars[3].l = 90; // only 3 bars to the left
    bars[46].l = 90; // only 3 bars to the right: not confirmed yet
    expect(detectSignals(bars, flatBands())).toEqual([]);
  });

  it("ignores a band-breaking bar that is not the extreme of its window", () => {
    const bars = quietBars();
    bars[20].l = 96.5;
    bars[23].l = 95; // lower low within 5 bars, so bar 20 is not a local low
    const out = detectSignals(bars, flatBands());
    expect(out.map((s) => s.index)).toEqual([23]);
  });

  it("skips bars that have no ladder yet", () => {
    const bars = quietBars();
    bars[10].l = 90;
    const bands: (BandPoint | null)[] = flatBands();
    bands[10] = null;
    expect(detectSignals(bars, bands)).toEqual([]);
  });
});

describe("declutterSignals", () => {
  const sig = (index: number, side: "buy" | "sell", price: number): Signal => ({
    index,
    side,
    kind: side === "buy" ? "BUY" : "SELL",
    price,
    labeled: true,
  });

  it("keeps the label only on the most extreme signal of a same-side cluster", () => {
    const out = declutterSignals([
      sig(10, "buy", 96.5),
      sig(15, "buy", 95), // lowest low of the 10-15-22 chain
      sig(22, "buy", 96),
      sig(40, "buy", 97), // 18 bars after 22: its own cluster
      sig(18, "sell", 104),
      sig(25, "sell", 105), // highest high of its cluster
    ]);
    expect(out.map((s) => [s.index, s.side, s.labeled])).toEqual([
      [10, "buy", false],
      [15, "buy", true],
      [18, "sell", false],
      [22, "buy", false],
      [25, "sell", true],
      [40, "buy", true],
    ]);
  });

  it("splits clusters at exactly 2 x lookback bars apart", () => {
    const out = declutterSignals([sig(10, "buy", 95), sig(20, "buy", 94), sig(29, "buy", 96)]);
    expect(out.map((s) => s.labeled)).toEqual([true, true, false]);
  });

  it("does not let opposite-side signals merge clusters", () => {
    const out = declutterSignals([sig(10, "buy", 95), sig(12, "sell", 105)]);
    expect(out.every((s) => s.labeled)).toBe(true);
  });

  it("gives a tie to the earliest signal and does not mutate its input", () => {
    const input = [sig(10, "sell", 105), sig(14, "sell", 105)];
    const out = declutterSignals(input);
    expect(out.map((s) => s.labeled)).toEqual([true, false]);
    expect(input[1].labeled).toBe(true);
  });

  it("declutters detector output end to end", () => {
    const bars = quietBars();
    bars[10].l = 96.5; // local low in 5..15
    bars[16].l = 95; // local low in 11..21, six bars later: same cluster, more extreme
    const out = declutterSignals(detectSignals(bars, flatBands()));
    expect(out.map((s) => [s.index, s.kind, s.labeled])).toEqual([
      [10, "BUY", false],
      [16, "STRONG BUY", true],
    ]);
  });
});

describe("order math", () => {
  it("notional = margin x leverage", () => {
    expect(notional(100, 50)).toBe(5000);
    expect(notional(2.5, 1000)).toBe(2500);
  });

  it("bust = entry x (1 - 1/lev) long, entry x (1 + 1/lev) short", () => {
    expect(bustPrice(100_000, 50, true)).toBe(98_000);
    expect(bustPrice(100_000, 50, false)).toBe(102_000);
    expect(bustPrice(3000, 1000, true)).toBeCloseTo(2997, 9);
    expect(bustPrice(3000, 1, true)).toBe(0);
  });

  it("TP / SL trigger prices move with the side", () => {
    expect(triggerPrice(100, 2, true, "tp")).toBeCloseTo(102, 12);
    expect(triggerPrice(100, 2, true, "sl")).toBeCloseTo(98, 12);
    expect(triggerPrice(100, 2, false, "tp")).toBeCloseTo(98, 12);
    expect(triggerPrice(100, 2, false, "sl")).toBeCloseTo(102, 12);
  });

  it("draws bust lines only within 35% of mark", () => {
    expect(bustWithinRange(98_000, 100_000)).toBe(true);
    expect(bustWithinRange(65_000, 100_000)).toBe(true);
    expect(bustWithinRange(64_999, 100_000)).toBe(false);
    expect(bustWithinRange(0, 100_000)).toBe(false);
  });

  it("opens on the last 160 bars", () => {
    expect(initialRange(1000)).toEqual({ from: 840, to: 1001 });
    expect(initialRange(40)).toEqual({ from: 0, to: 41 });
  });
});
