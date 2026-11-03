import type { WeightedInterval } from "./types";

/** Half-open semantics are irrelevant here: endpoints have zero measure (§4.3). */
export interface Interval {
  lo: number;
  hi: number;
}

/** `[lo,hi]` or null when the interval has zero (or negative) length. */
export function interval(lo: number, hi: number): Interval | null {
  return hi > lo ? { lo, hi } : null;
}

/** Remove `cut` from `base`, returning 0, 1 or 2 surviving pieces. */
export function subtractOne(base: Interval, cut: Interval): Interval[] {
  if (cut.hi <= base.lo || cut.lo >= base.hi) return [{ ...base }];
  const out: Interval[] = [];
  if (cut.lo > base.lo) out.push({ lo: base.lo, hi: cut.lo });
  if (cut.hi < base.hi) out.push({ lo: cut.hi, hi: base.hi });
  return out;
}

/** `base \ union(cuts)`. Sorted output; a split leaves both residues (§4.4). */
export function subtract(base: Interval, cuts: readonly Interval[]): Interval[] {
  let pieces: Interval[] = [{ ...base }];
  for (const cut of cuts) {
    if (!pieces.length) break;
    pieces = pieces.flatMap((p) => subtractOne(p, cut));
  }
  return pieces.sort((a, b) => a.lo - b.lo);
}

/**
 * Exact integral of D(x)=max{w : x in interval} over [a,b], divided by (b-a).
 * Integrates on the sorted unique endpoints; each open cell has a constant density.
 * Returns null when a>=b or inputs are not finite.
 */
export function coverage(
  ivs: readonly WeightedInterval[],
  a: number,
  b: number,
): number | null {
  if (!Number.isFinite(a) || !Number.isFinite(b) || !(b > a)) return null;
  return integral(ivs, a, b) / (b - a);
}

export function integral(
  ivs: readonly WeightedInterval[],
  a: number,
  b: number,
): number {
  const points = new Set<number>([a, b]);
  for (const iv of ivs) {
    if (iv.lo > a && iv.lo < b) points.add(iv.lo);
    if (iv.hi > a && iv.hi < b) points.add(iv.hi);
  }
  const xs = [...points].sort((x, y) => x - y);
  let sum = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    const lo = xs[i],
      hi = xs[i + 1];
    if (!(hi > lo)) continue;
    const mid = lo + (hi - lo) / 2;
    let w = 0;
    for (const iv of ivs) if (iv.lo < mid && mid < iv.hi && iv.w > w) w = iv.w;
    sum += (hi - lo) * w;
  }
  return sum;
}
