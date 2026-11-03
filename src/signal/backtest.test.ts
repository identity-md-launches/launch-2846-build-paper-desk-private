import { describe, expect, it } from "vitest";
import {
  assessErlLive,
  compareAccount,
  entryEligibility,
  computeErl,
  freshness,
  mass,
  nearestClusters,
  papertradeProfile,
  runBacktest,
  signalState,
  validateLiquidationMap,
  validateProtocolSummary,
  type ErlCandle,
  type LiveMap,
  type LiveSummary,
} from "./index";
import { extend, longSetup, mirror, randomWalk } from "./fixtures";

const prof = papertradeProfile("BTC");
const run = (c: ErlCandle[], nowSec = c.at(-1)!.t + 60) => {
  const erl = computeErl(c, { symbol: "BTC", timeframeSec: 60, nowSec });
  return { erl, bt: runBacktest(c, erl, 60, prof) };
};
const E = 100.06;

describe("backtest execution", () => {
  it("fills at the next open only and takes the target", () => {
    const c = extend(longSetup(), [[E, 100.5, 100.05, 100.4]]);
    const { bt } = run(c);
    expect(bt.trades).toHaveLength(1);
    const t = bt.trades[0];
    expect(t.fillIndex).toBe(27);
    expect(t.fill).toBe(E);
    expect(t.reason).toBe("TARGET");
    expect(t.exitPrice).toBeCloseTo(t.rawTarget, 9);
    expect(t.pnl!).toBeGreaterThan(0);
    expect(t.pnl!).toBeCloseTo(prof.leverage * 0 + t.pnl!, 12);
    expect(bt.stats.winRate).toBe(100);
    expect(bt.stats.profitFactor).toBe(Infinity);
  });
  it("is stop-first when one bar touches both stop and target", () => {
    const c = extend(longSetup(), [[E, 100.6, 99.9, 100.3]]);
    const t = run(c).bt.trades[0];
    expect(t.reason).toBe("STOP");
    expect(t.pnl!).toBeCloseTo((100 * (t.rawStop - E)) / E, 9);
    expect(t.bustStress).toBe(false);
  });
  it("flags bust stress when the stop bar reached the bust price", () => {
    const c = extend(longSetup(), [[E, 100.07, 99.0, 99.5]]);
    const { bt } = run(c);
    expect(bt.trades[0].bustStress).toBe(true);
    expect(bt.stats.stressNet).toBeCloseTo(-1, 12);
  });
  it("fills a gap beyond stop at the open, and a gap beyond bust as a full loss", () => {
    const gap = extend(longSetup(), [
      [E, 100.1, 100.04, 100.08],
      [99.9, 99.95, 99.88, 99.9],
    ]);
    const g = run(gap).bt.trades[0];
    expect(g.reason).toBe("GAP_STOP");
    expect(g.exitPrice).toBe(99.9);
    const bust = extend(longSetup(), [
      [E, 100.1, 100.04, 100.08],
      [98, 98.1, 97.9, 98],
    ]);
    const b = run(bust).bt.trades[0];
    expect(b.reason).toBe("BUST");
    expect(b.pnl).toBe(-1);
  });
  it("settles an opening gap through the target at the frozen target, before the later low", () => {
    const c = extend(longSetup(), [
      [E, 100.1, 100.04, 100.08],
      [100.6, 100.7, 99.9, 100.6],
    ]);
    const t = run(c).bt.trades[0];
    expect(t.reason).toBe("TARGET");
    expect(t.exitPrice).toBeCloseTo(t.rawTarget, 12);
    expect(t.exitPrice).toBeLessThan(100.6);
    expect(t.pnl!).toBeGreaterThan(0);
    const m = mirror(c);
    const erl = computeErl(m, { symbol: "BTC", timeframeSec: 60, nowSec: m.at(-1)!.t + 60 });
    const s = runBacktest(m, erl, 60, prof).trades[0];
    expect(s.side).toBe(-1);
    expect(s.reason).toBe("TARGET");
    expect(s.exitPrice).toBeCloseTo(s.rawTarget, 12);
    expect(s.pnl!).toBeGreaterThan(0);
  });
  it("keeps the one-position lock while a data gap leaves a trade unresolved", () => {
    const first = extend(longSetup(), [[E, 100.1, 100.04, 100.08]]);
    const second = longSetup().map((b) => ({ ...b, t: b.t + 40 * 60 }));
    const c = [...first, ...second];
    const { erl, bt } = run(c);
    expect(erl.candidates.filter((x) => x.entryAllowed).map((x) => x.index)).toEqual([26, 54]);
    expect(bt.trades).toHaveLength(1);
    expect(bt.trades[0].status).toBe("UNRESOLVED_GAP");
    expect(bt.trades[0].exitIndex).toBeNull();
    expect(bt.trades[0].exitTime).toBeNull();
    expect(bt.pending).toBeNull();
    const st = signalState(erl, bt, c.at(-1)!.t + 60);
    expect(st.phase).toBe("unresolved");
    expect(st.state).toBe("LONG");
    expect(st.stop).toBe(bt.trades[0].rawStop);
    const more = [...c, { t: c.at(-1)!.t + 60, o: E, h: 100.1, l: 100.04, c: 100.08, v: 10 }];
    const later = run(more).bt;
    expect(later.trades).toHaveLength(1);
    expect(later.trades[0].status).toBe("UNRESOLVED_GAP");
    expect(later.skipped.some((x) => x.candidate.index === 54)).toBe(true);
  });
  it("exits on a closed-bar frontier failure at the following open", () => {
    const c = extend(longSetup(), [
      [E, 100.07, 99.96, 100.0],
      [100.01, 100.02, 99.99, 100.0],
    ]);
    const t = run(c).bt.trades[0];
    expect(t.reason).toBe("FRONTIER_FAIL");
    expect(t.exitIndex).toBe(27);
    expect(t.exitPrice).toBe(100.01);
  });
  it("reports exit pending when the following bar is not yet closed", () => {
    const c = extend(longSetup(), [[E, 100.07, 99.96, 100.0]]);
    const { erl, bt } = run(c);
    expect(bt.trades[0].status).toBe("EXIT_PENDING");
    expect(signalState(erl, bt, c.at(-1)!.t + 60).state).toBe("EXIT");
    expect(bt.stats.trades).toBe(0);
    expect(bt.stats.unresolved).toBe(1);
  });
  it("closes at the open after the sixth holding bar and counts holding bars", () => {
    const hold: [number, number, number, number][] = Array.from({ length: 7 }, () => [E, 100.1, 100.04, E]);
    const t = run(extend(longSetup(), hold)).bt.trades[0];
    expect(t.reason).toBe("TIME");
    expect(t.holdingBars).toBe(6);
    expect(t.exitIndex).toBe(32);
  });
  it("skips fills beyond the 2-bp drift", () => {
    const c = extend(longSetup(), [[E * 1.0003, 100.5, 100.05, 100.4]]);
    const { bt } = run(c);
    expect(bt.trades).toHaveLength(0);
    expect(bt.skipped[0].reasons).toContain("FILL_DRIFT");
  });
  it("keeps a candidate on the latest bar pending until it expires", () => {
    const c = longSetup();
    const { erl, bt } = run(c);
    expect(bt.pending?.index).toBe(26);
    const st = signalState(erl, bt, c.at(-1)!.t + 60);
    expect(st.state).toBe("LONG");
    expect(st.phase).toBe("pending");
    expect(st.stop).toBeCloseTo(bt.pending!.rawStop, 12);
    expect(signalState(erl, bt, bt.pending!.expiresAt).state).toBe("FLAT");
    const s = run(mirror(c));
    expect(signalState(s.erl, s.bt, c.at(-1)!.t + 60).state).toBe("SHORT");
  });
  it("reports an open position while holding", () => {
    const c = extend(longSetup(), [[E, 100.1, 100.04, 100.08]]);
    const { erl, bt } = run(c);
    const st = signalState(erl, bt, c.at(-1)!.t + 60);
    expect(st.state).toBe("LONG");
    expect(st.phase).toBe("open");
    expect(st.barsSince).toBe(1);
  });
  it("enforces one position, the six-bar cooldown and no same-bar reversal", () => {
    for (const seed of [21, 22, 23, 24]) {
      const c = randomWalk(seed, 1000);
      const { bt } = run(c);
      for (let i = 1; i < bt.trades.length; i++) {
        const prev = bt.trades[i - 1];
        expect(bt.trades[i].candidate.index).toBeGreaterThanOrEqual(prev.exitIndex! + 7);
      }
      const eq = bt.equity.at(-1)?.value ?? 0;
      expect(eq).toBeCloseTo(bt.stats.net, 12);
      expect(bt.stats.maxDrawdown).toBeGreaterThanOrEqual(0);
      for (const t of bt.trades) {
        expect(t.pnl === null || t.pnl >= -1).toBe(true);
        if (t.pnl !== null && t.pnl < 0 && t.reason !== "BUST") expect(t.pnl).toBeCloseTo((100 * t.side * (t.exitPrice! - t.fill)) / t.fill, 9);
      }
    }
  });
  it("backtest prefixes never change earlier closed trades", () => {
    const c = randomWalk(31, 600);
    const full = run(c).bt.trades.filter((t) => t.status === "CLOSED");
    const half = run(c.slice(0, 300)).bt.trades.filter((t) => t.status === "CLOSED");
    expect(full.slice(0, half.length)).toEqual(half);
  });
});

describe("account comparison", () => {
  it("classifies entries with, against and outside the signal", () => {
    const c = extend(longSetup(), [
      [E, 100.1, 100.04, 100.08],
      [100.08, 100.5, 100.07, 100.4],
    ]);
    const { bt } = run(c);
    const inside = c[27].t + 10;
    const res = compareAccount(
      [
        { isLong: true, openedAtSec: inside, pnlUsd: 5 },
        { isLong: false, openedAtSec: inside, pnlUsd: -5 },
        { isLong: true, openedAtSec: c[3].t, pnlUsd: 1 },
        { isLong: true, openedAtSec: c[0].t - 600, pnlUsd: 1 },
      ],
      c,
      bt,
      60,
    );
    expect(res.with).toEqual({ count: 1, wins: 1, winRate: 100 });
    expect(res.against).toEqual({ count: 1, wins: 0, winRate: 0 });
    expect(res.none.count).toBe(1);
    expect(res.outside).toBe(1);
  });
});

const NOW = 1_800_000_000;
function map(center: number, over: Partial<LiveMap> = {}, fill?: (lo: number, hi: number) => [number, number]): LiveMap {
  const from = center * 0.99,
    to = center * 1.01;
  const w = (to - from) / 150;
  return {
    symbol: "BTC",
    rangePct: 1,
    from,
    to,
    asOfSec: NOW,
    buckets: Array.from({ length: 150 }, (_, i) => {
      const lo = from + i * w,
        hi = i === 149 ? to : from + (i + 1) * w;
      const [longUsd, shortUsd] = fill ? fill(lo, hi) : [0, 0];
      return { lo, hi, longUsd, shortUsd, longCount: longUsd ? 1 : 0, shortCount: shortUsd ? 1 : 0 };
    }),
    below: { longUsd: 5, shortUsd: 0, longCount: 1, shortCount: 0 },
    above: { longUsd: 0, shortUsd: 5, longCount: 0, shortCount: 1 },
    ...over,
  };
}
const summary: LiveSummary = {
  asOfSec: NOW,
  tvlUsd: 2e6,
  marginUsd: 5e5,
  lpUsd: 1e6,
  queueUsd: 0,
  openPositions: 40,
  lifetimeVolumeUsd: 9e8,
};

describe("live liquidation-map layer (live only)", () => {
  const c = longSetup();
  const k = computeErl(c, { symbol: "BTC", timeframeSec: 60, nowSec: c.at(-1)!.t + 60 }).candidates[0];
  const at = (cand = k) => ({ ...cand, expiresAt: NOW + 30 });
  it("validates every allowed range and rejects malformed payloads", () => {
    const m = map(E);
    expect(validateLiquidationMap(m, "BTC", 1, NOW).ok).toBe(true);
    expect(validateLiquidationMap({ ...m, rangePct: 2 }, "BTC", 2, NOW).ok).toBe(true);
    expect(validateLiquidationMap(m, "ETH", 1, NOW).ok).toBe(false);
    expect(validateLiquidationMap(m, "BTC", 5, NOW).ok).toBe(false);
    expect(validateLiquidationMap({ ...m, buckets: m.buckets.slice(1) }, "BTC", 1, NOW).ok).toBe(false);
    expect(validateLiquidationMap({ ...m, buckets: [...m.buckets, m.buckets[0]] }, "BTC", 1, NOW).ok).toBe(false);
    const gap = m.buckets.map((b, i) => (i === 40 ? { ...b, lo: b.lo + 0.01 } : b));
    expect(validateLiquidationMap({ ...m, buckets: gap }, "BTC", 1, NOW).ok).toBe(false);
    const neg = m.buckets.map((b, i) => (i === 4 ? { ...b, longUsd: -1 } : b));
    expect(validateLiquidationMap({ ...m, buckets: neg }, "BTC", 1, NOW).ok).toBe(false);
    const frac = m.buckets.map((b, i) => (i === 4 ? { ...b, longCount: 0.5 } : b));
    expect(validateLiquidationMap({ ...m, buckets: frac }, "BTC", 1, NOW).ok).toBe(false);
    expect(validateLiquidationMap({ ...m, from: m.to }, "BTC", 1, NOW).ok).toBe(false);
    expect(validateLiquidationMap({ ...m, below: { longUsd: NaN } }, "BTC", 1, NOW).ok).toBe(false);
    expect(validateLiquidationMap(null, "BTC", 1, NOW).ok).toBe(false);
  });
  it("checks freshness at the 15 s stale and 2 s future boundaries", () => {
    expect(freshness(NOW - 15, NOW)).toBeNull();
    expect(freshness(NOW - 16, NOW)).toBe("STALE");
    expect(freshness(NOW + 2, NOW)).toBeNull();
    expect(freshness(NOW + 3, NOW)).toBe("TIMESTAMP IN FUTURE");
    expect(assessErlLive(at(), 26, { ...map(E), asOfSec: NOW - 20 }, summary, NOW).status).toBe("UNKNOWN");
  });
  it("validates the protocol summary; lpUsd may be signed", () => {
    expect(validateProtocolSummary({ ...summary }, NOW).ok).toBe(true);
    expect(validateProtocolSummary({ ...summary, lpUsd: -5 }, NOW).ok).toBe(true);
    expect(validateProtocolSummary({ ...summary, tvlUsd: -1 }, NOW).ok).toBe(false);
    expect(validateProtocolSummary({ ...summary, openPositions: 1.5 }, NOW).ok).toBe(false);
  });
  it("allocates partial bucket overlap uniformly", () => {
    const m = map(100, {}, () => [300, 0]);
    const b = m.buckets[10];
    expect(mass(m, b.lo, b.lo + (b.hi - b.lo) / 3).longUsd).toBeCloseTo(100, 6);
  });
  it("gives NO MAP EVIDENCE on an all-zero path", () => {
    expect(assessErlLive(at(), 26, map(E), summary, NOW).status).toBe("NO MAP EVIDENCE");
  });
  it("vetoes concentrated adverse same-side liquidations", () => {
    const m = map(E, {}, (lo, hi) => [lo < E && hi > k.rawStop ? 50_000 : 0, 0]);
    const a = assessErlLive(at(), 26, m, summary, NOW);
    expect(a.status).toBe("VETO");
    expect(a.crowding).toBe(1);
  });
  it("does not promote a favourable-heavy map to an entry upgrade", () => {
    const m = map(E, {}, (lo, hi) => [0, lo > E && hi < k.rawTarget ? 80_000 : 0]);
    const a = assessErlLive(at(), 26, m, summary, NOW);
    expect(a.status).toBe("NO MAP VETO");
    expect(a.reasons[0]).toMatch(/not a safety rating/);
  });
  it("needs the path inside the range and the centre within 5 bps", () => {
    expect(assessErlLive(at(), 26, map(E * 1.001), summary, NOW).status).toBe("RANGE INSUFFICIENT");
    const far = { ...at(), rawTarget: E * 1.02 };
    expect(assessErlLive(far, 26, map(E), summary, NOW).status).toBe("RANGE INSUFFICIENT");
  });
  it("blocks new entries on an active queue or non-positive LP", () => {
    expect(assessErlLive(at(), 26, map(E), { ...summary, queueUsd: 1 }, NOW).status).toBe("PAYOUT RISK — NO NEW ENTRY");
    expect(assessErlLive(at(), 26, map(E), { ...summary, lpUsd: 0 }, NOW).status).toBe("PAYOUT RISK — NO NEW ENTRY");
  });
  it("is unknown when inputs are missing and never applies to history", () => {
    expect(assessErlLive(at(), 26, null, summary, NOW).status).toBe("UNKNOWN");
    expect(assessErlLive(at(), 26, map(E), null, NOW).status).toBe("UNKNOWN");
    expect(assessErlLive(at(), 27, map(E), summary, NOW).status).toBe("NOT LATEST BAR");
    expect(assessErlLive(k, 26, map(E), summary, k.expiresAt).status).toBe("NOT LATEST BAR");
  });
  it("never alters the core candidate", () => {
    const before = JSON.stringify(k);
    assessErlLive(at(), 26, map(E, {}, () => [9e5, 9e5]), summary, NOW);
    expect(JSON.stringify(k)).toBe(before);
  });
  it("finds the nearest large long cluster below and short cluster above", () => {
    const m = map(100, {}, (lo, hi) => {
      const mid = (lo + hi) / 2;
      return [mid > 99.5 && mid < 99.52 ? 60_000 : mid < 99.2 && mid > 99.18 ? 90_000 : 100, mid > 100.3 && mid < 100.32 ? 70_000 : 0];
    });
    const n = nearestClusters(m, 100);
    expect(n.long!.usd).toBe(60_000);
    expect(n.long!.distancePct).toBeLessThan(0);
    // Two adjacent 70k buckets form one run.
    expect(n.short!.usd).toBe(140_000);
    expect(nearestClusters(map(100), 100)).toEqual({ long: null, short: null });
  });
});

describe("cluster runs", () => {
  it("merges contiguous large buckets into one cluster at its peak", () => {
    const m = map(100, {}, (lo, hi) => {
      const mid = (lo + hi) / 2;
      if (mid > 99.4 && mid < 99.45) return [mid > 99.42 && mid < 99.433 ? 50_000 : 20_000, 0];
      return [0, 0];
    });
    const n = nearestClusters(m, 100);
    expect(n.long!.lo).toBeLessThan(n.long!.peak);
    expect(n.long!.hi).toBeGreaterThan(n.long!.peak);
    expect(n.long!.usd).toBeGreaterThan(50_000);
    expect(n.short).toBeNull();
  });
});

describe("entry eligibility", () => {
  const base = {
    reasons: [] as string[],
    adverseUsd: null,
    favorableUsd: null,
    nearUsd: null,
    crowding: null,
    materialUsd: null,
    asOfSec: null,
    lpAccountingVerified: false as const,
  };
  it("is actionable only for NO MAP VETO and NO MAP EVIDENCE", () => {
    expect(entryEligibility({ ...base, status: "NO MAP VETO" }).actionable).toBe(true);
    expect(entryEligibility({ ...base, status: "NO MAP EVIDENCE" }).actionable).toBe(true);
    for (const status of ["VETO", "UNKNOWN", "RANGE INSUFFICIENT", "PAYOUT RISK — NO NEW ENTRY", "NOT LATEST BAR"] as const) {
      const e = entryEligibility({ ...base, status, reasons: ["why"] });
      expect(e.actionable).toBe(false);
      expect(e.blockReason).toContain(status);
      expect(e.blockReason).toContain("why");
    }
    expect(entryEligibility(null).actionable).toBe(false);
  });
  it("adds route-level context to UNKNOWN only", () => {
    expect(entryEligibility({ ...base, status: "UNKNOWN" }, ["Protocol summary: HTTP 503"]).blockReason).toContain("HTTP 503");
    expect(entryEligibility({ ...base, status: "VETO" }, ["Protocol summary: HTTP 503"]).blockReason).not.toContain("HTTP 503");
  });
});
