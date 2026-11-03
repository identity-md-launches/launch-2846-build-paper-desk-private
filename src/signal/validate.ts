import type { Diagnostic, ErlCandle, ErlParams } from "./types";

export const DEFAULT_PARAMS: Readonly<ErlParams> = Object.freeze({
  ledgerBars: 24,
  frontierBars: 12,
  sweepMin: 0.0003,
  sweepMax: 0.0025,
  reclaimBuffer: 0.0001,
  confirmMin: 0.0001,
  stopPad: 0.0002,
  riskMin: 0.0005,
  riskMax: 0.0025,
  rangeMax: 0.004,
  targetRiskMultiple: 3,
  targetMin: 0.002,
  targetMax: 0.008,
  supportMin: 0.35,
  obstacleMax: 0.35,
  netRRMin: 1.8,
  budgetMin: 0.8,
  latencyReserve: 0.0002,
  maxHoldBars: 6,
  cooldownBars: 6,
  allowedEntryTf: Object.freeze([60, 300]),
  maxFillDrift: 0.0002,
  bustClearance: 0.003,
  approxBust: 0.0095,
});

export function resolveParams(p?: Partial<ErlParams>): ErlParams {
  return { ...DEFAULT_PARAMS, ...p };
}

/** Returns problems with a parameter set; empty means valid (§4.5). */
export function validateParams(p: ErlParams): string[] {
  const errs: string[] = [];
  const numeric = Object.entries(p).filter(([, v]) => typeof v === "number");
  for (const [k, v] of numeric)
    if (!Number.isFinite(v as number)) errs.push(`${k} is not finite`);
  for (const k of ["ledgerBars", "frontierBars", "maxHoldBars", "cooldownBars"] as const)
    if (!Number.isInteger(p[k]) || p[k] <= 0) errs.push(`${k} must be a positive integer`);
  if (p.frontierBars > p.ledgerBars) errs.push("frontierBars must be <= ledgerBars");
  if (!(p.sweepMin > 0 && p.sweepMin <= p.sweepMax)) errs.push("sweep bounds are not ordered");
  if (!(p.riskMin > 0 && p.riskMin <= p.riskMax)) errs.push("risk bounds are not ordered");
  if (!(p.targetMin > 0 && p.targetMin <= p.targetMax)) errs.push("target bounds are not ordered");
  for (const k of ["supportMin", "obstacleMax"] as const)
    if (!(p[k] >= 0 && p[k] <= 1)) errs.push(`${k} must be within [0,1]`);
  for (const k of ["netRRMin", "budgetMin", "targetRiskMultiple", "rangeMax"] as const)
    if (!(p[k] > 0)) errs.push(`${k} must be positive`);
  for (const k of ["reclaimBuffer", "confirmMin", "stopPad", "latencyReserve"] as const)
    if (!(p[k] >= 0)) errs.push(`${k} must be non-negative`);
  if (!(p.riskMax + p.latencyReserve < 0.0095))
    errs.push("riskMax + latencyReserve must stay below the approximate 0.95% bust");
  return errs;
}

export interface CandleCheck {
  ok: boolean;
  /** Length of the closed, usable prefix (forming bars excluded). */
  closed: number;
  /** For each closed index, the first index of its contiguous segment. */
  segmentStart: number[];
  diagnostics: Diagnostic[];
}

const finitePos = (n: number) => typeof n === "number" && Number.isFinite(n) && n > 0;

/**
 * Validates immutable candles (§4.2). `t` is the bar open in Unix seconds. A bar is usable only
 * if t+Δ <= nowSec; closure is never inferred from being the last row. Invalid rows, duplicate,
 * out-of-order or off-grid timestamps reject the whole series. Missing intervals split segments.
 */
export function checkCandles(
  candles: readonly ErlCandle[],
  timeframeSec: number,
  nowSec: number,
): CandleCheck {
  const diagnostics: Diagnostic[] = [];
  const fail = (d: Diagnostic): CandleCheck => ({
    ok: false,
    closed: 0,
    segmentStart: [],
    diagnostics: [...diagnostics, d],
  });
  if (!Number.isInteger(timeframeSec) || timeframeSec <= 0 || !Number.isFinite(nowSec))
    return fail({ code: "BAD_PARAMS", message: "Timeframe or evaluation time is invalid." });
  if (!candles.length) return fail({ code: "EMPTY", message: "No candles." });
  const segmentStart: number[] = [];
  let closed = 0;
  for (let i = 0; i < candles.length; i++) {
    const b = candles[i];
    const { o, h, l, c, v, t } = b;
    if (
      !Number.isInteger(t) ||
      ![o, h, l, c].every(finitePos) ||
      !(typeof v === "number" && Number.isFinite(v) && v >= 0) ||
      !(l <= Math.min(o, c) && Math.max(o, c) <= h)
    )
      return fail({ code: "INVALID_ROW", message: `Invalid candle at row ${i}.`, index: i });
    if (t % timeframeSec !== 0)
      return fail({ code: "OFF_GRID", message: `Row ${i} is off the ${timeframeSec}s grid.`, index: i });
    if (i > 0) {
      const prev = candles[i - 1].t;
      if (t === prev)
        return fail({ code: "DUPLICATE_TIME", message: `Duplicate time at row ${i}.`, index: i });
      if (t < prev)
        return fail({ code: "OUT_OF_ORDER", message: `Row ${i} is out of order.`, index: i });
    }
    if (t + timeframeSec > nowSec) {
      // A forming bar can only be at the end of an ascending series.
      diagnostics.push({
        code: "FORMING_EXCLUDED",
        message: `${candles.length - i} forming bar(s) excluded.`,
        index: i,
      });
      break;
    }
    if (i > 0 && t - candles[i - 1].t !== timeframeSec) {
      diagnostics.push({ code: "GAP_SEGMENT", message: `Gap before row ${i}; new segment.`, index: i });
      segmentStart.push(i);
    } else segmentStart.push(i === 0 ? 0 : segmentStart[i - 1]);
    closed = i + 1;
  }
  return { ok: true, closed, segmentStart, diagnostics };
}
