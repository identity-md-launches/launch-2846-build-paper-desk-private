/** Deterministic test fixtures for ERL-100. Synthetic; never observed Papertrade data. */
import type { ErlCandle } from "./types";

/** A UTC midnight, so the fixtures sit on every timeframe grid. */
export const T0 = 1_699_920_000;

const bar = (i: number, o: number, h: number, l: number, c: number, step = 60): ErlCandle => ({
  t: T0 + i * step,
  o,
  h,
  l,
  c,
  v: 10,
});

/**
 * 25 flat pre-bars (body 100.00–100.02, lower wick to 99.90, upper to 100.05), a sweep to
 * 99.95 closing 100.04 on j=25, and a confirmation closing 100.06 on i=26. With 25 pre-bars,
 * the first eligible confirmation index is 25; this fixture confirms on index 26.
 * Hand values: F=100.02, J=0.05/0.07, A=0.
 */
export function longSetup(step = 60): ErlCandle[] {
  const out: ErlCandle[] = [];
  for (let i = 0; i < 25; i++) out.push(bar(i, 100, 100.05, 99.9, 100.02, step));
  out.push(bar(25, 100.02, 100.05, 99.95, 100.04, step));
  out.push(bar(26, 100.04, 100.07, 100.03, 100.06, step));
  return out;
}

/** Appends bars after a setup; each is [o,h,l,c]. */
export function extend(base: ErlCandle[], rows: [number, number, number, number][], step = 60): ErlCandle[] {
  const out = [...base];
  for (const [o, h, l, c] of rows) out.push(bar(out.length, o, h, l, c, step));
  return out;
}

/** Reflection p -> 200 - p turns a long setup into the mirrored short setup. */
export function mirror(candles: readonly ErlCandle[]): ErlCandle[] {
  return candles.map((b) => ({ ...b, o: 200 - b.o, h: 200 - b.l, l: 200 - b.h, c: 200 - b.c }));
}

export function prng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Wicky random walk with occasional sweep/reclaim shapes, for property tests. */
export function randomWalk(seed: number, n: number, step = 60, start = 100_000): ErlCandle[] {
  const r = prng(seed);
  const out: ErlCandle[] = [];
  let price = start;
  for (let i = 0; i < n; i++) {
    const o = price;
    const c = o * (1 + (r() - 0.5) * 0.0016);
    const span = o * 0.0009 * r();
    const h = Math.max(o, c) + span * r();
    const l = Math.min(o, c) - span * (r() < 0.2 ? 3 : 1) * r();
    out.push({ t: T0 + i * step, o, h, l, c, v: Math.round(r() * 100) });
    price = c;
  }
  return out;
}
