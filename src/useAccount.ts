import { useCallback, useEffect, useState } from "react";
import {
  readAllPages,
  type Backend,
  type Cashflow,
  type Position,
  type Summary,
  type Trade,
} from "./api";
import { toMs } from "./format";

export type FeedStatus = "IDLE" | "LOADING" | "LIVE" | "STALE" | "ERROR";
interface DataState {
  address: string;
  summary: Summary | null;
  positions: Position[] | null;
  trades: Trade[] | null;
  cashflows: Cashflow[] | null;
  error: string | null;
  lastFast: number;
  lastSlow: number;
  fastError: boolean;
  slowError: boolean;
  busy: boolean;
}
const empty = (address: string): DataState => ({
  address,
  summary: null,
  positions: null,
  trades: null,
  cashflows: null,
  error: null,
  lastFast: 0,
  lastSlow: 0,
  fastError: false,
  slowError: false,
  busy: true,
});
export function useAccount(backend: Backend | null, address: string) {
  const [data, setData] = useState(() => empty(address));
  const [retry, setRetry] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [visible, setVisible] = useState(
    document.visibilityState === "visible",
  );
  useEffect(() => {
    const visibility = () => {
      setVisible(document.visibilityState === "visible");
      setNow(Date.now());
    };
    document.addEventListener("visibilitychange", visibility);
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  useEffect(() => {
    setData(empty(address));
    if (!backend || !address) return;
    let disposed = false;
    let fastBusy = false,
      slowBusy = false;
    let fastCtrl: AbortController | null = null,
      slowCtrl: AbortController | null = null;
    const fast = async () => {
      if (fastBusy || document.visibilityState !== "visible") return;
      fastBusy = true;
      const ctrl = new AbortController();
      fastCtrl = ctrl;
      try {
        const [summary, positions] = await Promise.all([
          backend.summary(address, ctrl.signal),
          backend.positions(address, ctrl.signal),
        ]);
        if (!disposed && !ctrl.signal.aborted)
          setData((d) => ({
            ...d,
            summary,
            positions,
            lastFast: Date.now(),
            fastError: false,
            busy: false,
          }));
      } catch {
        if (!disposed && !ctrl.signal.aborted)
          setData((d) => ({
            ...d,
            fastError: true,
            error:
              "Account updates unavailable. Retry or check your connection.",
            busy: false,
          }));
      } finally {
        fastBusy = false;
      }
    };
    const slow = async () => {
      if (slowBusy || document.visibilityState !== "visible") return;
      slowBusy = true;
      const ctrl = new AbortController();
      slowCtrl = ctrl;
      try {
        const [trades, cashflows] = await Promise.all([
          readAllPages(
            (c) => backend.trades(address, c, 75, ctrl.signal),
            ctrl.signal,
          ),
          readAllPages(
            (c) => backend.cashflows(address, c, 75, ctrl.signal),
            ctrl.signal,
          ),
        ]);
        if (!disposed && !ctrl.signal.aborted)
          setData((d) => ({
            ...d,
            trades: trades
              .slice()
              .sort(
                (a, b) =>
                  (toMs(b.closedAt ?? b.openedAt) ?? 0) -
                  (toMs(a.closedAt ?? a.openedAt) ?? 0),
              ),
            cashflows: cashflows
              .slice()
              .sort((a, b) => (toMs(b.t) ?? 0) - (toMs(a.t) ?? 0)),
            lastSlow: Date.now(),
            slowError: false,
          }));
      } catch {
        if (!disposed && !ctrl.signal.aborted)
          setData((d) => ({
            ...d,
            slowError: true,
            error:
              "Activity history unavailable. Retry to load complete history and statistics.",
          }));
      } finally {
        slowBusy = false;
      }
    };
    const wake = () => {
      if (document.visibilityState === "visible") {
        void fast();
        void slow();
      } else {
        fastCtrl?.abort();
        slowCtrl?.abort();
      }
    };
    void fast();
    void slow();
    const fastTimer = setInterval(() => void fast(), 5000),
      slowTimer = setInterval(() => void slow(), 30_000);
    document.addEventListener("visibilitychange", wake);
    return () => {
      disposed = true;
      fastCtrl?.abort();
      slowCtrl?.abort();
      clearInterval(fastTimer);
      clearInterval(slowTimer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [backend, address, retry]);
  const current = data.address === address ? data : empty(address);
  const asOf = toMs(current.summary?.asOf);
  const status: FeedStatus = !address
    ? "IDLE"
    : current.fastError || current.slowError
      ? "ERROR"
      : !visible
        ? "STALE"
        : !current.lastFast || !current.lastSlow
          ? "LOADING"
          : now - current.lastFast > 15_000 ||
              now - current.lastSlow > 65_000 ||
              (asOf !== null && now - asOf > 15_000)
            ? "STALE"
            : "LIVE";
  return {
    ...current,
    error: current.fastError || current.slowError ? current.error : null,
    status,
    refresh: useCallback(() => setRetry((n) => n + 1), []),
  };
}
