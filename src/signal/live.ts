/**
 * Optional live layer (§5). LIVE ONLY — NO LIQUIDATION HISTORY. Applies only to the latest
 * completed bar's candidate; it can veto an entry, never create one or alter a historical marker.
 * Papertrade liquidations settle against the LP; they are not forced orders on Hyperliquid.
 */
import type { ErlCandidate, SignalSymbol } from "./types";

export type LiquidationRange = 1 | 2 | 5 | 10 | 25;
export const LIQUIDATION_RANGES: readonly LiquidationRange[] = [1, 2, 5, 10, 25];
export interface LiqAmounts {
  longUsd: number;
  shortUsd: number;
  longCount: number;
  shortCount: number;
}
export interface LiquidationBucket extends LiqAmounts {
  lo: number;
  hi: number;
}
/** Validated map; asOf normalised to Unix seconds at the client boundary. */
export interface LiveMap {
  symbol: SignalSymbol;
  rangePct: LiquidationRange;
  from: number;
  to: number;
  asOfSec: number;
  buckets: LiquidationBucket[];
  below: LiqAmounts;
  above: LiqAmounts;
}
export interface LiveSummary {
  asOfSec: number;
  tvlUsd: number;
  marginUsd: number;
  lpUsd: number;
  queueUsd: number;
  openPositions: number;
  lifetimeVolumeUsd: number;
}

export const BUCKETS = 150;
export const MAX_AGE_SEC = 15;
export const MAX_FUTURE_SEC = 2;

type Check<T> = { ok: true; value: T } | { ok: false; reason: string };
const fin = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const nonNeg = (n: unknown) => fin(n) && n >= 0;
const count = (n: unknown) => nonNeg(n) && Number.isInteger(n);

function amounts(x: unknown): x is LiqAmounts {
  const a = x as LiqAmounts;
  return (
    !!a &&
    nonNeg(a.longUsd) &&
    nonNeg(a.shortUsd) &&
    count(a.longCount) &&
    count(a.shortCount)
  );
}

export function freshness(asOfSec: number, nowSec: number): string | null {
  if (!fin(asOfSec) || asOfSec <= 0) return "TIMESTAMP INVALID";
  if (asOfSec - nowSec > MAX_FUTURE_SEC) return "TIMESTAMP IN FUTURE";
  if (nowSec - asOfSec > MAX_AGE_SEC) return "STALE";
  return null;
}

/** Runtime validation of an untrusted liquidation-map payload (§5 exact validity). */
export function validateLiquidationMap(
  raw: unknown,
  symbol: SignalSymbol,
  range: LiquidationRange,
  asOfSec: number,
): Check<LiveMap> {
  const m = raw as Record<string, unknown>;
  if (!m || typeof m !== "object") return { ok: false, reason: "MALFORMED" };
  if (m.symbol !== symbol) return { ok: false, reason: "SYMBOL MISMATCH" };
  if (m.rangePct !== range) return { ok: false, reason: "RANGE MISMATCH" };
  const from = m.from,
    to = m.to;
  if (!fin(from) || !fin(to) || !(from < to)) return { ok: false, reason: "BOUNDS INVALID" };
  if (!fin(asOfSec) || asOfSec <= 0) return { ok: false, reason: "TIMESTAMP INVALID" };
  const buckets = m.buckets;
  if (!Array.isArray(buckets) || buckets.length !== BUCKETS)
    return { ok: false, reason: "BUCKET COUNT" };
  const tol = 1e-8 * Math.max(Math.abs(from), Math.abs(to), 1);
  let edge = from;
  for (const b of buckets as LiquidationBucket[]) {
    if (!b || !fin(b.lo) || !fin(b.hi) || !(b.hi > b.lo)) return { ok: false, reason: "BUCKET WIDTH" };
    if (Math.abs(b.lo - edge) > tol) return { ok: false, reason: "BUCKET GAP OR OVERLAP" };
    if (!amounts(b)) return { ok: false, reason: "BUCKET AMOUNTS" };
    edge = b.hi;
  }
  if (Math.abs(edge - to) > tol) return { ok: false, reason: "BUCKETS DO NOT SPAN RANGE" };
  if (!amounts(m.below) || !amounts(m.above)) return { ok: false, reason: "TOTALS INVALID" };
  return {
    ok: true,
    value: {
      symbol,
      rangePct: range,
      from,
      to,
      asOfSec,
      buckets: (buckets as LiquidationBucket[]).map((b) => ({
        lo: b.lo,
        hi: b.hi,
        longUsd: b.longUsd,
        shortUsd: b.shortUsd,
        longCount: b.longCount,
        shortCount: b.shortCount,
      })),
      below: { ...(m.below as LiqAmounts) },
      above: { ...(m.above as LiqAmounts) },
    },
  };
}

export function validateProtocolSummary(raw: unknown, asOfSec: number): Check<LiveSummary> {
  const s = raw as Record<string, unknown>;
  if (!s || typeof s !== "object") return { ok: false, reason: "MALFORMED" };
  if (!fin(asOfSec) || asOfSec <= 0) return { ok: false, reason: "TIMESTAMP INVALID" };
  for (const k of ["tvlUsd", "marginUsd", "queueUsd", "lifetimeVolumeUsd"])
    if (!nonNeg(s[k])) return { ok: false, reason: `${k} INVALID` };
  if (!count(s.openPositions)) return { ok: false, reason: "openPositions INVALID" };
  // lpUsd may be signed pending backend accounting clarification.
  if (!fin(s.lpUsd)) return { ok: false, reason: "lpUsd INVALID" };
  return {
    ok: true,
    value: {
      asOfSec,
      tvlUsd: s.tvlUsd as number,
      marginUsd: s.marginUsd as number,
      lpUsd: s.lpUsd as number,
      queueUsd: s.queueUsd as number,
      openPositions: s.openPositions as number,
      lifetimeVolumeUsd: s.lifetimeVolumeUsd as number,
    },
  };
}

/** Uniform-within-bucket mass in raw prices [a,b] (approximate; §5). */
export function mass(map: LiveMap, a: number, b: number): { longUsd: number; shortUsd: number } {
  const lo = Math.min(a, b),
    hi = Math.max(a, b);
  let longUsd = 0,
    shortUsd = 0;
  for (const k of map.buckets) {
    const w = Math.max(0, Math.min(k.hi, hi) - Math.max(k.lo, lo)) / (k.hi - k.lo);
    longUsd += w * k.longUsd;
    shortUsd += w * k.shortUsd;
  }
  return { longUsd, shortUsd };
}

export type LiveStatus =
  | "NO MAP VETO"
  | "VETO"
  | "NO MAP EVIDENCE"
  | "UNKNOWN"
  | "RANGE INSUFFICIENT"
  | "PAYOUT RISK — NO NEW ENTRY"
  | "NOT LATEST BAR";

export interface LiveParams {
  centerTolerance: number;
  nearBand: number;
  crowdingMax: number;
  materialFloorUsd: number;
  materialMarginShare: number;
}
export const DEFAULT_LIVE: Readonly<LiveParams> = Object.freeze({
  centerTolerance: 0.0005,
  nearBand: 0.0005,
  crowdingMax: 0.75,
  materialFloorUsd: 10000,
  materialMarginShare: 0.01,
});

export interface LiveAssessment {
  status: LiveStatus;
  reasons: string[];
  adverseUsd: number | null;
  favorableUsd: number | null;
  nearUsd: number | null;
  crowding: number | null;
  materialUsd: number | null;
  asOfSec: number | null;
  /** Always shown: positive lpUsd with no queue is a coarse screen only. */
  lpAccountingVerified: false;
}

/**
 * Deterministic live veto for the latest completed bar's candidate (§5). Never "safe":
 * the best outcome is NO MAP VETO. Missing/stale inputs give UNKNOWN.
 */
export function assessErlLive(
  cand: ErlCandidate,
  latestIndex: number,
  map: LiveMap | null,
  summary: LiveSummary | null,
  nowSec: number,
  liveParams?: Partial<LiveParams>,
): LiveAssessment {
  const lp = { ...DEFAULT_LIVE, ...liveParams };
  const out: LiveAssessment = {
    status: "UNKNOWN",
    reasons: [],
    adverseUsd: null,
    favorableUsd: null,
    nearUsd: null,
    crowding: null,
    materialUsd: null,
    asOfSec: map?.asOfSec ?? null,
    lpAccountingVerified: false,
  };
  if (cand.index !== latestIndex || !(nowSec < cand.expiresAt)) {
    out.status = "NOT LATEST BAR";
    out.reasons.push("Live map applies only to the latest completed bar within its entry window.");
    return out;
  }
  if (!map) return { ...out, reasons: ["Liquidation map missing or invalid."] };
  if (!summary) return { ...out, reasons: ["Protocol summary missing or invalid."] };
  const mapAge = freshness(map.asOfSec, nowSec);
  if (mapAge) return { ...out, reasons: [`Liquidation map ${mapAge}.`] };
  const sumAge = freshness(summary.asOfSec, nowSec);
  if (sumAge) return { ...out, reasons: [`Protocol summary ${sumAge}.`] };
  const E = cand.entryRef,
    s = cand.side;
  const center = (map.from + map.to) / 2;
  if (Math.abs(center - E) / E > lp.centerTolerance)
    return { ...out, status: "RANGE INSUFFICIENT", reasons: ["Map centre is more than 5 bps from entry."] };
  const lo = Math.min(cand.rawStop, cand.rawTarget),
    hi = Math.max(cand.rawStop, cand.rawTarget);
  if (lo < map.from || hi > map.to)
    return { ...out, status: "RANGE INSUFFICIENT", reasons: ["Stop-to-target path is outside the map range."] };
  if (summary.queueUsd > 0 || summary.lpUsd <= 0)
    return {
      ...out,
      status: "PAYOUT RISK — NO NEW ENTRY",
      reasons: [summary.queueUsd > 0 ? "Payout queue is active." : "LP balance is not positive."],
    };
  const adv = mass(map, E, cand.rawStop);
  const fav = mass(map, E, cand.rawTarget);
  const nearEdge = E - s * lp.nearBand * E;
  // Clip the near band to the adverse band.
  const nearEnd = s === 1 ? Math.max(nearEdge, cand.rawStop) : Math.min(nearEdge, cand.rawStop);
  const near = mass(map, E, nearEnd);
  const Ad = s === 1 ? adv.longUsd : adv.shortUsd;
  const Fav = s === 1 ? fav.shortUsd : fav.longUsd;
  const Near = s === 1 ? near.longUsd : near.shortUsd;
  const materialUsd = Math.max(lp.materialFloorUsd, lp.materialMarginShare * summary.marginUsd);
  const crowding = Ad + Fav > 0 ? Ad / (Ad + Fav) : null;
  const res = { ...out, adverseUsd: Ad, favorableUsd: Fav, nearUsd: Near, crowding, materialUsd };
  const all = mass(map, lo, hi);
  if (all.longUsd + all.shortUsd === 0)
    return { ...res, status: "NO MAP EVIDENCE", reasons: ["No liquidation mass on the stop-to-target path."] };
  const reasons: string[] = [];
  if (Ad >= materialUsd && crowding !== null && crowding >= lp.crowdingMax)
    reasons.push("Material same-side liquidations crowd the adverse path.");
  if (Near >= materialUsd) reasons.push("Material same-side liquidations within 5 bps of entry.");
  return reasons.length
    ? { ...res, status: "VETO", reasons }
    : { ...res, status: "NO MAP VETO", reasons: ["No veto fired. This is not a safety rating."] };
}

export interface Cluster {
  /** Bounds of the contiguous run of large buckets. */
  lo: number;
  hi: number;
  /** Centre of the run's largest bucket. */
  peak: number;
  usd: number;
  count: number;
  /** Signed distance of the peak from price, percent. */
  distancePct: number;
}

/**
 * Nearest large resting liquidation cluster on each side of price: long liquidations sit below
 * price, short liquidations above. A cluster is a contiguous run of buckets each holding at
 * least max(floorUsd, share × that side's in-range total); `below`/`above` totals are never placed.
 */
export function nearestClusters(
  map: LiveMap,
  price: number,
  floorUsd = 10000,
  share = 0.02,
): { long: Cluster | null; short: Cluster | null } {
  const pick = (key: "longUsd" | "shortUsd", below: boolean): Cluster | null => {
    const total = map.buckets.reduce((s, b) => s + b[key], 0);
    const min = Math.max(floorUsd, share * total);
    const runs: Cluster[] = [];
    let run: Cluster | null = null,
      peakUsd = 0;
    for (const b of map.buckets) {
      const mid = (b.lo + b.hi) / 2;
      const side = below ? mid < price : mid > price;
      if (!side || !(b[key] >= min && b[key] > 0)) {
        if (run) runs.push(run);
        run = null;
        continue;
      }
      const n = key === "longUsd" ? b.longCount : b.shortCount;
      if (!run) {
        run = { lo: b.lo, hi: b.hi, peak: mid, usd: 0, count: 0, distancePct: 0 };
        peakUsd = 0;
      }
      run.hi = b.hi;
      run.usd += b[key];
      run.count += n;
      if (b[key] > peakUsd) {
        peakUsd = b[key];
        run.peak = mid;
      }
    }
    if (run) runs.push(run);
    let best: Cluster | null = null;
    for (const r of runs) {
      r.distancePct = ((r.peak - price) / price) * 100;
      if (!best || Math.abs(r.distancePct) < Math.abs(best.distancePct)) best = r;
    }
    return best;
  };
  return { long: pick("longUsd", true), short: pick("shortUsd", false) };
}
