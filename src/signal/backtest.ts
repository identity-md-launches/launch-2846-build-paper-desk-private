import { assessErlFill, dirBar, type FillAssessment } from "./core";
import { settleFraction } from "./payoff";
import { resolveParams } from "./validate";
import type {
  ErlCandidate,
  ErlCandle,
  ErlParams,
  ErlResult,
  PayoutProfile,
  Side,
} from "./types";

export type ExitReason =
  | "STOP"
  | "TARGET"
  | "BUST"
  | "GAP_STOP"
  | "FRONTIER_FAIL"
  | "SWEEP_FAIL"
  | "TIME";

export type TradeStatus = "CLOSED" | "OPEN" | "EXIT_PENDING" | "UNRESOLVED_GAP";

export interface SimTrade {
  candidate: ErlCandidate;
  side: Side;
  assessment: FillAssessment;
  fillIndex: number;
  fillTime: number;
  fill: number;
  rawStop: number;
  rawTarget: number;
  bust: number;
  status: TradeStatus;
  /** Bar on which the exit was confirmed (touch bar for stop/target, close bar otherwise). */
  exitIndex: number | null;
  exitTime: number | null;
  exitPrice: number | null;
  reason: ExitReason | null;
  /** Settled result as a fraction of margin (Papertrade payout on wins, full losses). */
  pnl: number | null;
  rMultiple: number | null;
  /** The stop bar also reached the approximate bust: a full-margin loss under stress. */
  bustStress: boolean;
  holdingBars: number;
}

export interface SkippedCandidate {
  candidate: ErlCandidate;
  reasons: string[];
}

export interface BacktestStats {
  trades: number;
  wins: number;
  winRate: number | null;
  profitFactor: number | null;
  avgR: number | null;
  /** Sum of settled results in margin units (1 = one full margin). */
  net: number;
  maxDrawdown: number;
  busts: number;
  bustStress: number;
  /** Net result if every bust-stress stop had busted instead. */
  stressNet: number;
  unresolved: number;
}

export interface BacktestResult {
  trades: SimTrade[];
  skipped: SkippedCandidate[];
  /** Latest-bar candidate awaiting its next-bar fill, if it would be taken. */
  pending: ErlCandidate | null;
  stats: BacktestStats;
  equity: { t: number; value: number }[];
}

/**
 * Candle-only execution simulation at 100× (§4.7, §8). Entry at the next bar's open only;
 * fixed stop/target; stop-first when a bar touches both; gap opens beyond stop fill at the
 * open and beyond bust lose the full margin; closed-bar failure and time exits fill at the
 * next open. One position per symbol, no pyramiding, six-bar cooldown after each exit.
 */
export function runBacktest(
  candles: readonly ErlCandle[],
  erl: ErlResult,
  timeframeSec: number,
  prof: PayoutProfile,
  params?: Partial<ErlParams>,
): BacktestResult {
  const p = resolveParams(params);
  const Δ = timeframeSec;
  const n = erl.closedCount;
  const trades: SimTrade[] = [];
  const skipped: SkippedCandidate[] = [];
  let pending: ErlCandidate | null = null;
  let nextAllowed = 0;
  for (const cand of erl.candidates) {
    if (!cand.entryAllowed) continue;
    if (cand.index < nextAllowed) {
      skipped.push({ candidate: cand, reasons: ["POSITION_OR_COOLDOWN"] });
      continue;
    }
    const fi = cand.index + 1;
    if (fi >= n) {
      pending = cand;
      break;
    }
    if (candles[fi].t !== cand.t + Δ) {
      skipped.push({ candidate: cand, reasons: ["GAP_AT_FILL"] });
      continue;
    }
    const fill = candles[fi].o;
    const a = assessErlFill(cand, fill, null, prof, p);
    if (!a.ok) {
      skipped.push({ candidate: cand, reasons: a.reasons });
      continue;
    }
    const trade = simulate(candles, n, cand, a, fi, Δ, p, prof);
    trades.push(trade);
    if (trade.exitIndex === null || trade.status === "OPEN" || trade.status === "EXIT_PENDING") {
      nextAllowed = Infinity;
      break;
    }
    nextAllowed = trade.exitIndex + p.cooldownBars + 1;
  }
  return { trades, skipped, pending, ...summarise(trades) };
}

function simulate(
  candles: readonly ErlCandle[],
  n: number,
  cand: ErlCandidate,
  a: FillAssessment,
  fi: number,
  Δ: number,
  p: ErlParams,
  prof: PayoutProfile,
): SimTrade {
  const s = cand.side;
  const t: SimTrade = {
    candidate: cand,
    side: s,
    assessment: a,
    fillIndex: fi,
    fillTime: candles[fi].t,
    fill: a.fill,
    rawStop: cand.rawStop,
    rawTarget: a.rawTarget,
    bust: a.bust,
    status: "OPEN",
    exitIndex: null,
    exitTime: null,
    exitPrice: null,
    reason: null,
    pnl: null,
    rMultiple: null,
    bustStress: false,
    holdingBars: 0,
  };
  const Sx = s * t.rawStop,
    Tx = s * t.rawTarget,
    Bx = s * t.bust;
  const close = (k: number, at: number, price: number, reason: ExitReason) => {
    t.status = "CLOSED";
    t.exitIndex = k;
    t.exitTime = at;
    t.exitPrice = price;
    t.reason = reason;
    t.pnl = reason === "BUST" ? -1 : settleFraction((s * (price - t.fill)) / t.fill, prof);
    t.rMultiple = t.pnl / a.R;
    return t;
  };
  for (let h = 1; h <= p.maxHoldBars; h++) {
    const k = fi + h - 1;
    if (k >= n) return t;
    if (h > 1 && candles[k].t !== candles[k - 1].t + Δ) {
      t.status = "UNRESOLVED_GAP";
      t.exitIndex = k - 1;
      return t;
    }
    t.holdingBars = h;
    const d = dirBar(candles[k], s);
    if (h > 1 && d.O <= Bx) return close(k, candles[k].t, t.bust, "BUST");
    if (h > 1 && d.O <= Sx) return close(k, candles[k].t, candles[k].o, "GAP_STOP");
    if (d.L <= Sx) {
      t.bustStress = d.L <= Bx;
      return close(k, candles[k].t + Δ, t.rawStop, "STOP");
    }
    if (d.U >= Tx) return close(k, candles[k].t + Δ, t.rawTarget, "TARGET");
    let reason: ExitReason | null = null;
    if (d.C < s * cand.frontier) reason = "FRONTIER_FAIL";
    else if (d.C <= s * cand.sweepExtreme) reason = "SWEEP_FAIL";
    else if (h === p.maxHoldBars) reason = "TIME";
    if (reason) {
      const next = k + 1;
      t.exitIndex = k;
      t.reason = reason;
      if (next >= n) {
        t.status = "EXIT_PENDING";
        return t;
      }
      if (candles[next].t !== candles[k].t + Δ) {
        t.status = "UNRESOLVED_GAP";
        return t;
      }
      const o = candles[next].o;
      if (s * o <= Bx) return close(k, candles[next].t, t.bust, "BUST");
      return close(k, candles[next].t, o, reason);
    }
  }
  return t;
}

export function summarise(trades: readonly SimTrade[]): Pick<BacktestResult, "stats" | "equity"> {
  const done = trades.filter((t) => t.status === "CLOSED" && t.pnl !== null);
  const wins = done.filter((t) => t.pnl! > 0);
  const gain = wins.reduce((s, t) => s + t.pnl!, 0);
  const loss = done.filter((t) => t.pnl! < 0).reduce((s, t) => s - t.pnl!, 0);
  let eq = 0,
    peak = 0,
    maxDrawdown = 0;
  const equity: { t: number; value: number }[] = [];
  for (const t of done) {
    eq += t.pnl!;
    peak = Math.max(peak, eq);
    maxDrawdown = Math.max(maxDrawdown, peak - eq);
    equity.push({ t: t.exitTime!, value: eq });
  }
  const stressed = done.filter((t) => t.bustStress);
  return {
    stats: {
      trades: done.length,
      wins: wins.length,
      winRate: done.length ? (wins.length / done.length) * 100 : null,
      profitFactor: !done.length ? null : loss === 0 ? (gain > 0 ? Infinity : null) : gain / loss,
      avgR: done.length ? done.reduce((s, t) => s + t.rMultiple!, 0) / done.length : null,
      net: eq,
      maxDrawdown,
      busts: done.filter((t) => t.reason === "BUST").length,
      bustStress: stressed.length,
      stressNet: eq + stressed.reduce((s, t) => s + (-1 - t.pnl!), 0),
      unresolved: trades.length - done.length,
    },
    equity,
  };
}

export type SignalStateCode = "LONG" | "SHORT" | "FLAT" | "EXIT";

export interface SignalState {
  state: SignalStateCode;
  /** "pending" while a just-confirmed candidate awaits its next-bar fill. */
  phase: "pending" | "open" | "exit" | "flat";
  candidate: ErlCandidate | null;
  trade: SimTrade | null;
  stop: number | null;
  target: number | null;
  /** Bars from the confirming bar to the latest closed bar; null when no signal yet. */
  barsSince: number | null;
  latestIndex: number;
  ambiguousNow: boolean;
}

/** Current state per market from the latest closed bar. Pure: nowSec is passed in. */
export function signalState(
  erl: ErlResult,
  bt: BacktestResult,
  nowSec: number,
): SignalState {
  const last = erl.closedCount - 1;
  const lastCand = erl.candidates.filter((c) => c.entryAllowed).at(-1) ?? null;
  const base: SignalState = {
    state: "FLAT",
    phase: "flat",
    candidate: lastCand,
    trade: null,
    stop: null,
    target: null,
    barsSince: lastCand ? last - lastCand.index : null,
    latestIndex: last,
    ambiguousNow: erl.bars[last]?.signal === "AMBIGUOUS",
  };
  if (bt.pending && nowSec < bt.pending.expiresAt)
    return {
      ...base,
      state: bt.pending.side === 1 ? "LONG" : "SHORT",
      phase: "pending",
      candidate: bt.pending,
      stop: bt.pending.rawStop,
      target: bt.pending.rawTarget,
      barsSince: last - bt.pending.index,
    };
  const tr = bt.trades.at(-1);
  if (!tr) return base;
  const since = last - tr.candidate.index;
  if (tr.status === "OPEN")
    return {
      ...base,
      state: tr.side === 1 ? "LONG" : "SHORT",
      phase: "open",
      candidate: tr.candidate,
      trade: tr,
      stop: tr.rawStop,
      target: tr.rawTarget,
      barsSince: since,
    };
  if (tr.status === "EXIT_PENDING" || tr.exitIndex === last)
    return {
      ...base,
      state: "EXIT",
      phase: "exit",
      candidate: tr.candidate,
      trade: tr,
      barsSince: since,
    };
  return base;
}
