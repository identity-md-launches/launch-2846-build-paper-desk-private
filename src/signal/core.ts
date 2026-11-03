import { coverage, interval, subtract, type Interval } from "./intervals";
import { conservativeWin, papertradeProfile } from "./payoff";
import { checkCandles, resolveParams, validateParams } from "./validate";
import type {
  ErlBar,
  ErlCandidate,
  ErlCandle,
  ErlOptions,
  ErlParams,
  ErlResult,
  FrozenLedger,
  GateCode,
  PayoutProfile,
  Side,
  SideEval,
  WeightedInterval,
} from "./types";

/** Directional view of one bar (§4.3). "Up" is favourable for side s. */
export interface DirBar {
  O: number;
  C: number;
  L: number;
  U: number;
  body: Interval | null;
  lowerWick: Interval | null;
  upperWick: Interval | null;
}

export function dirBar(b: ErlCandle, s: Side): DirBar {
  const O = s * b.o,
    C = s * b.c;
  const L = Math.min(s * b.l, s * b.h),
    U = Math.max(s * b.l, s * b.h);
  const bl = Math.min(O, C),
    bh = Math.max(O, C);
  return {
    O,
    C,
    L,
    U,
    body: interval(bl, bh),
    lowerWick: interval(L, bl),
    upperWick: interval(bh, U),
  };
}

/**
 * The surviving ledger for a confirmation at i with sweep j=i-1 (§4.4). Cohort k=j-n..j-1;
 * each wick loses only the parts covered by later closed bodies m with k<m<=i.
 */
export function buildLedger(
  bars: readonly ErlCandle[],
  i: number,
  s: Side,
  ledgerBars: number,
): FrozenLedger {
  const j = i - 1;
  const first = j - ledgerBars;
  const dir = bars.slice(first, i + 1).map((b) => dirBar(b, s));
  const lower: WeightedInterval[] = [];
  const upper: WeightedInterval[] = [];
  for (let k = first; k < j; k++) {
    const w = (k - first + 1) / ledgerBars;
    const cuts: Interval[] = [];
    for (let m = k + 1; m <= i; m++) {
      const body = dir[m - first].body;
      if (body) cuts.push(body);
    }
    const d = dir[k - first];
    if (d.lowerWick)
      for (const piece of subtract(d.lowerWick, cuts)) lower.push({ ...piece, w });
    if (d.upperWick)
      for (const piece of subtract(d.upperWick, cuts)) upper.push({ ...piece, w });
  }
  return { lower, upper };
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export interface Economics {
  r: number;
  targetFrac: number;
  Tx: number;
  A: number | null;
  W: number;
  R: number;
  netRR: number;
}

/** Stop/target/payoff for directional entry X against directional stop Sx (§4.6). */
export function economics(
  X: number,
  Sx: number,
  E: number,
  ledger: FrozenLedger,
  p: ErlParams,
  prof: PayoutProfile,
): Economics {
  const r = (X - Sx) / E;
  const targetFrac = clamp(p.targetRiskMultiple * r, p.targetMin, p.targetMax);
  const Tx = X + targetFrac * E;
  const A = coverage(ledger.upper, X, Tx);
  const W = conservativeWin(targetFrac, prof);
  const R = prof.leverage * (r + p.latencyReserve);
  return { r, targetFrac, Tx, A, W, R, netRR: W / R };
}

function evaluateSide(
  bars: readonly ErlCandle[],
  i: number,
  s: Side,
  p: ErlParams,
  prof: PayoutProfile,
): { ev: SideEval; ledger: FrozenLedger | null; sweepExtreme: number } {
  const j = i - 1;
  const bi = bars[i],
    bj = bars[j];
  const di = dirBar(bi, s),
    dj = dirBar(bj, s);
  let F = Infinity;
  for (let k = j - p.frontierBars; k < j; k++) F = Math.min(F, s * bars[k].c);
  const penetration = (F - dj.L) / bj.c;
  const failed: GateCode[] = [];
  if (!(penetration >= p.sweepMin && penetration <= p.sweepMax)) failed.push("SWEEP_DEPTH");
  if (!(dj.C >= F + p.reclaimBuffer * bj.c)) failed.push("SWEEP_RECLAIM");
  if (!((dj.U - dj.L) / bj.c <= p.rangeMax)) failed.push("SWEEP_RANGE");
  if (!(di.L > dj.L)) failed.push("CONFIRM_RETOUCH");
  if (!(di.C >= dj.C + p.confirmMin * bi.c)) failed.push("CONFIRM_PROGRESS");
  if (!(di.C >= F + p.reclaimBuffer * bi.c)) failed.push("CONFIRM_RECLAIM");
  if (!((di.U - di.L) / bi.c <= p.rangeMax)) failed.push("CONFIRM_RANGE");
  const base: SideEval = {
    side: s,
    frontier: s * F,
    penetration,
    J: null,
    A: null,
    r: null,
    targetFrac: null,
    W: null,
    R: null,
    netRR: null,
    score: null,
    rawStop: null,
    rawTarget: null,
    failed,
    passed: false,
  };
  const sweepExtreme = s * dj.L;
  if (failed.length) return { ev: base, ledger: null, sweepExtreme };
  const E = bi.c,
    X = s * E;
  const Sx = dj.L - p.stopPad * E;
  const ledger = buildLedger(bars, i, s, p.ledgerBars);
  const J = coverage(ledger.lower, dj.L, F);
  const eco = economics(X, Sx, E, ledger, p, prof);
  const score = J === null || eco.A === null ? NaN : J * (1 - eco.A) * eco.netRR;
  const ev: SideEval = {
    ...base,
    J,
    A: eco.A,
    r: eco.r,
    targetFrac: eco.targetFrac,
    W: eco.W,
    R: eco.R,
    netRR: eco.netRR,
    score,
    rawStop: s * Sx,
    rawTarget: s * eco.Tx,
  };
  const nums = [J, eco.A, eco.r, eco.W, eco.R, eco.netRR, score, Sx, eco.Tx];
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) {
    ev.failed = ["NONFINITE"];
    return { ev, ledger, sweepExtreme };
  }
  if (!(eco.r >= p.riskMin && eco.r <= p.riskMax)) failed.push("RISK_BOUNDS");
  if (!(J! >= p.supportMin)) failed.push("SUPPORT");
  if (!(eco.A! <= p.obstacleMax)) failed.push("OBSTACLE");
  if (!(eco.netRR >= p.netRRMin)) failed.push("NET_RR");
  if (!(score >= p.budgetMin)) failed.push("BUDGET");
  ev.failed = failed;
  ev.passed = failed.length === 0;
  return { ev, ledger, sweepExtreme };
}

/**
 * ERL-100 candle-only core. Deterministic and causal: bar i uses only bars <= i, so any prefix
 * of the input yields exactly the prefix of the output. A signal confirms at the close of bar i.
 */
export function computeErl(
  candles: readonly ErlCandle[],
  opts: ErlOptions,
): ErlResult {
  const p = resolveParams(opts.params);
  const prof = opts.payoutProfile ?? papertradeProfile(opts.symbol);
  const paramErrors = validateParams(p);
  if (paramErrors.length)
    return {
      status: "INVALID",
      closedCount: 0,
      bars: [],
      candidates: [],
      diagnostics: paramErrors.map((message) => ({ code: "BAD_PARAMS", message })),
    };
  const check = checkCandles(candles, opts.timeframeSec, opts.nowSec);
  if (!check.ok)
    return { status: "INVALID", closedCount: 0, bars: [], candidates: [], diagnostics: check.diagnostics };
  const Δ = opts.timeframeSec;
  const entryAllowed = p.allowedEntryTf.includes(Δ);
  const diagnostics = [...check.diagnostics];
  if (!entryAllowed)
    diagnostics.push({
      code: "TF_ENTRY_DISABLED",
      message: "100× entry policy is disabled on this timeframe; geometry only.",
    });
  const warmup = p.ledgerBars + 1;
  if (check.closed < warmup + 1)
    diagnostics.push({ code: "INSUFFICIENT", message: `Needs ${warmup + 1} closed bars.` });
  const bars: ErlBar[] = [];
  const candidates: ErlCandidate[] = [];
  for (let i = 0; i < check.closed; i++) {
    const b = candles[i];
    const eligible = i - check.segmentStart[i] >= warmup;
    const row: ErlBar = {
      index: i,
      t: b.t,
      confirmedAt: b.t + Δ,
      eligible,
      long: null,
      short: null,
      signal: "NONE",
    };
    if (eligible) {
      const L = evaluateSide(candles, i, 1, p, prof);
      const S = evaluateSide(candles, i, -1, p, prof);
      row.long = L.ev;
      row.short = S.ev;
      if (L.ev.failed.includes("NONFINITE") || S.ev.failed.includes("NONFINITE"))
        row.signal = "INVALID";
      else if (L.ev.passed && S.ev.passed) row.signal = "AMBIGUOUS";
      else if (L.ev.passed || S.ev.passed) {
        const win = L.ev.passed ? L : S;
        const ev = win.ev;
        row.signal = ev.side === 1 ? "LONG" : "SHORT";
        candidates.push({
          index: i,
          t: b.t,
          side: ev.side,
          confirmedAt: b.t + Δ,
          earliestFillAt: b.t + Δ,
          expiresAt: b.t + 2 * Δ,
          entryRef: b.c,
          rawStop: ev.rawStop!,
          rawTarget: ev.rawTarget!,
          frontier: ev.frontier,
          sweepExtreme: win.sweepExtreme,
          r: ev.r!,
          targetFrac: ev.targetFrac!,
          J: ev.J!,
          A: ev.A!,
          W: ev.W!,
          R: ev.R!,
          netRR: ev.netRR!,
          score: ev.score!,
          ledger: win.ledger!,
          entryAllowed,
        });
      }
    }
    bars.push(row);
  }
  return { status: "OK", closedCount: check.closed, bars, candidates, diagnostics };
}

export type Confidence = "LOW" | "MEDIUM" | "HIGH";

/** Display band for the ERL budget. The score is not a calibrated probability. */
export function confidenceOf(score: number, budgetMin = 0.8): Confidence {
  if (score >= budgetMin * 2) return "HIGH";
  if (score >= budgetMin * 1.25) return "MEDIUM";
  return "LOW";
}

export interface FillAssessment {
  ok: boolean;
  reasons: string[];
  fill: number;
  r: number;
  targetFrac: number;
  rawTarget: number;
  A: number | null;
  W: number;
  R: number;
  netRR: number;
  score: number;
  bust: number;
  bustVerified: boolean;
}

/**
 * Execution adaptation (§4.7): keep the raw stop fixed, recompute risk, target, corridor and
 * economics at the actual fill against the frozen pre-entry ledger. Never edits the candidate.
 */
export function assessErlFill(
  cand: ErlCandidate,
  fill: number,
  bustPrice: number | null,
  prof: PayoutProfile,
  params?: Partial<ErlParams>,
): FillAssessment {
  const p = resolveParams(params);
  const s = cand.side;
  const reasons: string[] = [];
  const X = s * fill,
    Sx = s * cand.rawStop;
  const eco = economics(X, Sx, fill, cand.ledger, p, prof);
  const score = eco.A === null ? NaN : cand.J * (1 - eco.A) * eco.netRR;
  if (!(fill > 0) || !Number.isFinite(fill)) reasons.push("FILL_INVALID");
  if (Math.abs(fill - cand.entryRef) / cand.entryRef > p.maxFillDrift) reasons.push("FILL_DRIFT");
  if (X <= Sx) reasons.push("FILL_PAST_STOP");
  if (!(eco.r >= p.riskMin && eco.r <= p.riskMax)) reasons.push("RISK_BOUNDS");
  if (!(eco.A !== null && eco.A <= p.obstacleMax)) reasons.push("OBSTACLE");
  if (!(eco.netRR >= p.netRRMin)) reasons.push("NET_RR");
  if (!(score >= p.budgetMin)) reasons.push("BUDGET");
  const bustVerified = bustPrice !== null && Number.isFinite(bustPrice);
  const bust = bustVerified ? bustPrice! : fill * (1 - s * p.approxBust);
  const clear = p.bustClearance * fill;
  if (s === 1 ? !(cand.rawStop > bust + clear) : !(cand.rawStop < bust - clear))
    reasons.push("BUST_CLEARANCE");
  return {
    ok: reasons.length === 0,
    reasons,
    fill,
    r: eco.r,
    targetFrac: eco.targetFrac,
    rawTarget: s * eco.Tx,
    A: eco.A,
    W: eco.W,
    R: eco.R,
    netRR: eco.netRR,
    score,
    bust,
    bustVerified,
  };
}
