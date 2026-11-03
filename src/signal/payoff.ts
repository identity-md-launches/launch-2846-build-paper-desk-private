import type { CurveMode, PayoutProfile, SignalSymbol } from "./types";

/**
 * Papertrade asymmetric-impact payout, reconstructed from the documented equations
 * (docs.papertrade.xyz/how/asymmetric-impact, learn/wins-losses). Floating point, not a
 * fixed-point contract quote. Values are documentation defaults, not verified live settings.
 */
export const STANDARD: CurveMode = { a: 0.000075, z: 0.0006, k: 3.597, exponent: 2 };
export const OFF_HOURS: CurveMode = { a: 0.00003, z: 0.001, k: 6.085, exponent: 3 };
export const POSITION_MULTIPLIER: Record<SignalSymbol, number> = {
  BTC: 814.598,
  ETH: 483.979,
};

export function papertradeProfile(
  symbol: SignalSymbol,
  builderFee = 0,
): PayoutProfile {
  return {
    label: `papertrade.xyz documented defaults · ${symbol} · builder ${(builderFee * 100).toFixed(1)}%`,
    verified: false,
    leverage: 100,
    baseRate: 0.1,
    rateMultiplier: 15000,
    referenceNotional: 100000,
    positionMultiplier: POSITION_MULTIPLIER[symbol],
    winFee: 0.02,
    builderFee,
    standard: STANDARD,
    offHours: OFF_HOURS,
  };
}

/** Holdback H(p) inside (a, z); zero elsewhere. */
export function holdback(p: number, m: CurveMode): number {
  if (!(p > m.a && p < m.z)) return 0;
  const u = (p - m.a) / (m.z - m.a);
  return m.k * (m.z - m.a) * u * u * Math.pow(1 - u, m.exponent);
}

/** Retained favourable move q after the 0.2-bp deadband and the holdback. */
export function retainedMove(p: number, m: CurveMode): number {
  return Math.max(0, p - 0.00002 - holdback(p, m));
}

export function scale(q: number, prof: PayoutProfile): number {
  if (!(q > 0)) return 0;
  return (
    (1 - prof.baseRate) /
    (1 +
      1 / (q * prof.rateMultiplier) +
      prof.referenceNotional / (1e6 * q * prof.positionMultiplier))
  );
}

/** Profit as a fraction of margin for a favourable fractional move p, after win+builder fees. */
export function winFraction(p: number, mode: CurveMode, prof: PayoutProfile): number {
  if (!Number.isFinite(p) || p <= 0) return 0;
  const q = retainedMove(p, mode);
  if (q <= 0) return 0;
  return prof.leverage * q * scale(q, prof) * (1 - prof.winFee - prof.builderFee);
}

/** Conservative payout: the worse of the standard and off-hours curves (state not exposed). */
export function conservativeWin(p: number, prof: PayoutProfile): number {
  return Math.min(winFraction(p, prof.standard, prof), winFraction(p, prof.offHours, prof));
}

/**
 * Settled result as a fraction of margin for a signed directional move. Losses are unscaled
 * and carry no fee (learn/wins-losses); a loss can never exceed the full margin.
 */
export function settleFraction(move: number, prof: PayoutProfile): number {
  if (move > 0) return conservativeWin(move, prof);
  return Math.max(-1, prof.leverage * move);
}
