import { useEffect, useMemo, useState } from "react";
import { TIMEFRAME_SECONDS, type Backend, type Candle, type Timeframe } from "./api";
import { toMs } from "./format";
import {
  assessErlLive,
  computeErl,
  entryEligibility,
  freshness,
  nearestClusters,
  papertradeProfile,
  runBacktest,
  signalState,
  validateLiquidationMap,
  validateProtocolSummary,
  type BacktestResult,
  type Cluster,
  type Diagnostic,
  type EntryEligibility,
  type PayoutProfile,
  type ErlResult,
  type LiveAssessment,
  type LiveMap,
  type LiveSummary,
  type SignalState,
  type SignalSymbol,
} from "./signal";

export const SIGNAL_SYMBOLS: SignalSymbol[] = ["BTC", "ETH"];
export const LIVE_RANGE = 1 as const;

/** Builder fee of the required sensitivity scenario next to the zero-builder default (§4.6). */
export const BUILDER_SENSITIVITY = 0.005;

/**
 * Candle-only ERL pass over loaded candles; pure apart from the explicit `nowSec`. The builder
 * fee changes the payout profile, so gates, entries and fees are all recomputed, not haircut.
 */
export function analyseErl(
  candles: readonly Candle[],
  symbol: SignalSymbol,
  tf: Timeframe,
  nowSec: number,
  builderFee = 0,
): { erl: ErlResult; bt: BacktestResult; state: SignalState; prof: PayoutProfile; invalid: Diagnostic | null } {
  const timeframeSec = TIMEFRAME_SECONDS[tf];
  const prof = papertradeProfile(symbol, builderFee);
  const erl = computeErl(candles, { symbol, timeframeSec, nowSec, payoutProfile: prof });
  const bt = runBacktest(candles, erl, timeframeSec, prof);
  const invalid = erl.status === "INVALID" ? (erl.diagnostics[0] ?? { code: "INVALID_ROW", message: "Candle series rejected." }) : null;
  return { erl, bt, state: signalState(erl, bt, nowSec), prof, invalid };
}

/**
 * Rows already closed when the snapshot was fetched. A bar that was forming at fetch time holds
 * partial OHLC; it becomes usable only from a later fetch, never because the clock moved on.
 */
export function closedAtFetch<T extends { t: number }>(rows: readonly T[], tf: Timeframe, fetchedAtSec: number): T[] {
  const step = TIMEFRAME_SECONDS[tf];
  return rows.filter((b) => b.t + step <= fetchedAtSec);
}

/** Plain text for a rejected series, e.g. "Invalid candle at row 3 (INVALID_ROW)". */
export function invalidText(d: Diagnostic): string {
  return `${d.message.replace(/\.$/, "")} (${d.code})`;
}

export interface MarketSignal {
  symbol: SignalSymbol;
  candles: Candle[] | null;
  error: string;
  erl: ErlResult | null;
  bt: BacktestResult | null;
  state: SignalState | null;
  last: number | null;
  /** Open time of the newest candle from the last successful fetch. */
  lastCandleT: number | null;
  /** The last candle refresh failed; retained values are stale context only. */
  stale: boolean;
  /** First diagnostic of a rejected candle series; numeric results are then withheld. */
  invalid: Diagnostic | null;
  map: LiveMap | null;
  mapError: string;
  /** STALE / TIMESTAMP … when the map is too old for live context, regardless of candidates. */
  mapFreshness: string | null;
  clusters: { long: Cluster | null; short: Cluster | null } | null;
  live: LiveAssessment | null;
  /** Current live entry eligibility of a pending core candidate. */
  eligibility: EntryEligibility | null;
  profileLabel: string;
}

const nowSec = () => Math.floor(Date.now() / 1000);

/** Run `load` now and on an interval while the page is visible; abort on hide or unmount. */
function usePoll(load: (signal: AbortSignal) => Promise<void>, everyMs: number, deps: unknown[]) {
  useEffect(() => {
    let ctrl: AbortController | null = null,
      busy = false;
    const run = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      ctrl = new AbortController();
      try {
        await load(ctrl.signal);
      } finally {
        busy = false;
      }
    };
    const vis = () => (document.visibilityState === "visible" ? void run() : ctrl?.abort());
    void run();
    const id = setInterval(() => void run(), everyMs);
    document.addEventListener("visibilitychange", vis);
    return () => {
      ctrl?.abort();
      clearInterval(id);
      document.removeEventListener("visibilitychange", vis);
    };
  }, deps);
}

/**
 * Per-market ERL state on the signal timeframe plus the live liquidation-map layer. Candles
 * refresh every 15 s, live routes every 5 s. Late responses from a previous selection are dropped.
 */
export function useErl(backend: Backend | null, tf: Timeframe) {
  const [retry, setRetry] = useState(0);
  const [candles, setCandles] = useState<
    Record<string, { rows: Candle[] | null; error: string; fetchedAt: number }>
  >({});
  const [maps, setMaps] = useState<Record<string, { map: LiveMap | null; error: string }>>({});
  const [summary, setSummary] = useState<{ value: LiveSummary | null; error: string }>({
    value: null,
    error: "",
  });
  const [clock, setClock] = useState(nowSec);
  useEffect(() => {
    const id = setInterval(() => setClock(nowSec()), 2000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => setCandles({}), [tf]);
  usePoll(
    async (signal) => {
      if (!backend) return;
      await Promise.all(
        SIGNAL_SYMBOLS.map(async (s) => {
          try {
            const rows = await backend.candles(s, tf, 1000, signal);
            if (!rows.length) throw new Error("No candles returned");
            if (!signal.aborted)
              setCandles((m) => ({ ...m, [s]: { rows, error: "", fetchedAt: nowSec() } }));
          } catch (err) {
            if (!signal.aborted)
              setCandles((m) => ({
                ...m,
                [s]: {
                  rows: m[s]?.rows ?? null,
                  error: err instanceof Error ? err.message : "Candles unavailable",
                  fetchedAt: m[s]?.fetchedAt ?? 0,
                },
              }));
          }
        }),
      );
      if (!signal.aborted) setClock(nowSec());
    },
    15_000,
    [backend, tf, retry],
  );
  usePoll(
    async (signal) => {
      if (!backend) return;
      const results = await Promise.allSettled([
        ...SIGNAL_SYMBOLS.map((s) => backend.liquidationMap(s, LIVE_RANGE, signal)),
        backend.protocolSummary(signal),
      ]);
      if (signal.aborted) return;
      const next: Record<string, { map: LiveMap | null; error: string }> = {};
      SIGNAL_SYMBOLS.forEach((s, i) => {
        const r = results[i];
        if (r.status === "rejected") {
          const why = r.reason instanceof Error ? r.reason.message : "unavailable";
          next[s] = { map: null, error: `Liquidation map ${why}` };
          return;
        }
        const asOf = toMs(r.value.asOf);
        const v = validateLiquidationMap(r.value, s, LIVE_RANGE, asOf === null ? NaN : asOf / 1000);
        next[s] = v.ok ? { map: v.value, error: "" } : { map: null, error: `Map rejected: ${v.reason}` };
      });
      setMaps(next);
      const sr = results[SIGNAL_SYMBOLS.length];
      if (sr.status === "rejected")
        setSummary({
          value: null,
          error: `Protocol summary ${sr.reason instanceof Error ? sr.reason.message : "unavailable"}`,
        });
      else {
        const asOf = toMs(sr.value.asOf as string | number);
        const v = validateProtocolSummary(sr.value, asOf === null ? NaN : asOf / 1000);
        setSummary(v.ok ? { value: v.value, error: "" } : { value: null, error: `Summary rejected: ${v.reason}` });
      }
      setClock(nowSec());
    },
    5_000,
    [backend, retry],
  );
  const markets = useMemo<MarketSignal[]>(
    () =>
      SIGNAL_SYMBOLS.map((symbol) => {
        const c = candles[symbol];
        const m = maps[symbol];
        const map = m?.map ?? null;
        const mapFreshness = map ? freshness(map.asOfSec, clock) : null;
        const base: MarketSignal = {
          symbol,
          candles: c?.rows ?? null,
          error: c?.error ?? "",
          erl: null,
          bt: null,
          state: null,
          last: c?.rows?.at(-1)?.c ?? null,
          lastCandleT: c?.rows?.at(-1)?.t ?? null,
          stale: !!c?.error && !!c?.rows?.length,
          invalid: null,
          map,
          mapError: m?.error ?? "",
          mapFreshness,
          clusters: null,
          live: null,
          eligibility: null,
          profileLabel: papertradeProfile(symbol).label,
        };
        if (!c?.rows?.length) return base;
        const { erl, bt, state, invalid } = analyseErl(closedAtFetch(c.rows, tf, c.fetchedAt), symbol, tf, clock);
        if (invalid) return { ...base, erl, invalid };
        const price = base.last!;
        // Live cluster context only from a fresh snapshot; an expired one is never shown as live.
        const clusters = map && !mapFreshness ? nearestClusters(map, price) : null;
        const live =
          state.phase === "pending" && state.candidate
            ? assessErlLive(state.candidate, state.latestIndex, map, summary.value, clock)
            : null;
        const context = [m?.error, summary.error].filter((x): x is string => !!x);
        const eligibility =
          state.phase !== "pending"
            ? null
            : base.stale
              ? { actionable: false, blockReason: `STALE CANDLES · last refresh failed: ${base.error}` }
              : entryEligibility(live, context);
        return { ...base, erl, bt, state, clusters, live, eligibility };
      }),
    [candles, maps, summary, tf, clock],
  );
  const summaryFreshness = summary.value ? freshness(summary.value.asOfSec, clock) : null;
  return {
    markets,
    summary: summary.value,
    summaryError: summary.error || (summaryFreshness ? `Protocol summary ${summaryFreshness}` : ""),
    nowSec: clock,
    retry: () => setRetry((n) => n + 1),
  };
}
