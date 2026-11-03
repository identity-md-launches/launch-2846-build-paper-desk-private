import { useEffect, useMemo, useState } from "react";
import { TIMEFRAME_SECONDS, type Backend, type Candle, type Timeframe } from "./api";
import { toMs } from "./format";
import {
  assessErlLive,
  computeErl,
  nearestClusters,
  papertradeProfile,
  runBacktest,
  signalState,
  validateLiquidationMap,
  validateProtocolSummary,
  type BacktestResult,
  type Cluster,
  type ErlResult,
  type LiveAssessment,
  type LiveMap,
  type LiveSummary,
  type SignalState,
  type SignalSymbol,
} from "./signal";

export const SIGNAL_SYMBOLS: SignalSymbol[] = ["BTC", "ETH"];
export const LIVE_RANGE = 1 as const;

/** Candle-only ERL pass over loaded candles; pure apart from the explicit `nowSec`. */
export function analyseErl(
  candles: readonly Candle[],
  symbol: SignalSymbol,
  tf: Timeframe,
  nowSec: number,
): { erl: ErlResult; bt: BacktestResult; state: SignalState } {
  const timeframeSec = TIMEFRAME_SECONDS[tf];
  const prof = papertradeProfile(symbol);
  const erl = computeErl(candles, { symbol, timeframeSec, nowSec, payoutProfile: prof });
  const bt = runBacktest(candles, erl, timeframeSec, prof);
  return { erl, bt, state: signalState(erl, bt, nowSec) };
}

export interface MarketSignal {
  symbol: SignalSymbol;
  candles: Candle[] | null;
  error: string;
  erl: ErlResult | null;
  bt: BacktestResult | null;
  state: SignalState | null;
  last: number | null;
  map: LiveMap | null;
  mapError: string;
  clusters: { long: Cluster | null; short: Cluster | null } | null;
  live: LiveAssessment | null;
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
  const [candles, setCandles] = useState<Record<string, { rows: Candle[] | null; error: string }>>({});
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
            if (!signal.aborted) setCandles((m) => ({ ...m, [s]: { rows, error: "" } }));
          } catch (err) {
            if (!signal.aborted)
              setCandles((m) => ({
                ...m,
                [s]: { rows: m[s]?.rows ?? null, error: err instanceof Error ? err.message : "Candles unavailable" },
              }));
          }
        }),
      );
      if (!signal.aborted) setClock(nowSec());
    },
    15_000,
    [backend, tf],
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
          next[s] = { map: null, error: "Liquidation map unavailable" };
          return;
        }
        const asOf = toMs(r.value.asOf);
        const v = validateLiquidationMap(r.value, s, LIVE_RANGE, asOf === null ? NaN : asOf / 1000);
        next[s] = v.ok ? { map: v.value, error: "" } : { map: null, error: `Map rejected: ${v.reason}` };
      });
      setMaps(next);
      const sr = results[SIGNAL_SYMBOLS.length];
      if (sr.status === "rejected") setSummary({ value: null, error: "Protocol summary unavailable" });
      else {
        const asOf = toMs(sr.value.asOf as string | number);
        const v = validateProtocolSummary(sr.value, asOf === null ? NaN : asOf / 1000);
        setSummary(v.ok ? { value: v.value, error: "" } : { value: null, error: `Summary rejected: ${v.reason}` });
      }
      setClock(nowSec());
    },
    5_000,
    [backend],
  );
  const markets = useMemo<MarketSignal[]>(
    () =>
      SIGNAL_SYMBOLS.map((symbol) => {
        const c = candles[symbol];
        const m = maps[symbol];
        const base: MarketSignal = {
          symbol,
          candles: c?.rows ?? null,
          error: c?.error ?? "",
          erl: null,
          bt: null,
          state: null,
          last: c?.rows?.at(-1)?.c ?? null,
          map: m?.map ?? null,
          mapError: m?.error ?? "",
          clusters: null,
          live: null,
        };
        if (!c?.rows?.length) return base;
        const { erl, bt, state } = analyseErl(c.rows, symbol, tf, clock);
        const price = base.last!;
        const clusters = m?.map ? nearestClusters(m.map, price) : null;
        const live =
          state.phase === "pending" && state.candidate
            ? assessErlLive(state.candidate, state.latestIndex, m?.map ?? null, summary.value, clock)
            : null;
        return { ...base, erl, bt, state, clusters, live };
      }),
    [candles, maps, summary.value, tf, clock],
  );
  return { markets, summary: summary.value, summaryError: summary.error, nowSec: clock };
}
