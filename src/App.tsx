import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  ApiError,
  TERMINAL_STATUSES,
  getBackend,
  type Account,
  type Backend,
  type ClosedTrade,
  type IntentAck,
  type IntentStatus,
  type Market,
  type Me,
  type OpenOrder,
  type Position,
  type StreamMessage,
  type StreamState,
  type Timeframe,
} from "./api";
import { Header } from "./components/Header";
import { Chart } from "./components/Chart";
import { TradeTicket, type TicketHandle } from "./components/TradeTicket";
import { HistoryTable, MarketsTable, PositionsTable } from "./components/Tables";
import { Toasts, type Toast } from "./components/Toasts";
import { formatLeverage, formatUsd, toMs } from "./format";

type Tab = "trade" | "book" | "analysis";
const TABS: { id: Tab; key: string; label: string; more?: string }[] = [
  { id: "trade", key: "F1", label: "TRADE" },
  { id: "book", key: "F2", label: "POSITIONS", more: " & HISTORY" },
  { id: "analysis", key: "F3", label: "ANALYSIS" },
];

const INTENT_POLL_MS = 1000;
const INTENT_POLL_MAX = 90;
const TOAST_TTL_MS = 7000;

function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLInputElement) return el.type !== "range" && el.type !== "checkbox" && el.type !== "radio";
  return el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
}

export function App() {
  const [backend, setBackend] = useState<Backend | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [markets, setMarkets] = useState<Market[] | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [positions, setPositions] = useState<Position[] | null>(null);
  const [history, setHistory] = useState<ClosedTrade[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stream, setStream] = useState<StreamState>("connecting");
  const [marks, setMarks] = useState<Record<string, { price: number; at: number }>>({});
  const [symbol, setSymbol] = useState("BTC");
  const [timeframe, setTimeframe] = useState<Timeframe>("15m");
  const [tab, setTab] = useState<Tab>("trade");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [closing, setClosing] = useState<Set<string>>(new Set());
  const ticketRef = useRef<TicketHandle>(null);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ trade: null, book: null, analysis: null });
  const watched = useRef(new Map<string, string>()); // intentId -> toast id
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    let live = true;
    getBackend().then((b) => live && setBackend(b));
    return () => {
      live = false;
      timers.current.forEach(clearTimeout);
    };
  }, []);

  const refresh = useCallback(
    async (which: ("account" | "positions" | "history")[]) => {
      if (!backend) return;
      await Promise.all([
        which.includes("account") && backend.account().then(setAccount),
        which.includes("positions") && backend.positions().then(setPositions),
        which.includes("history") && backend.history(200).then(setHistory),
      ]).catch(() => {
        /* the next stream push or poll retries */
      });
    },
    [backend],
  );

  // Initial load.
  useEffect(() => {
    if (!backend) return;
    let live = true;
    setLoadError(null);
    Promise.all([backend.me(), backend.markets(), backend.account(), backend.positions(), backend.history(200)])
      .then(([m, mk, a, p, h]) => {
        if (!live) return;
        setMe(m);
        setMarkets(mk);
        setAccount(a);
        setPositions(p);
        setHistory(h);
        if (mk.length && !mk.some((x) => x.symbol === "BTC")) setSymbol(mk[0].symbol);
      })
      .catch((err: unknown) => {
        if (!live) return;
        const msg = err instanceof ApiError ? `${err.path} answered ${err.message}` : err instanceof Error ? err.message : String(err);
        setLoadError(msg);
      });
    return () => {
      live = false;
    };
  }, [backend]);

  const updateToast = useCallback((id: string, patch: Partial<Toast>) => {
    setToasts((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    if (patch.status && patch.status !== "queued" && patch.status !== "sending") {
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        setToasts((ts) => ts.filter((t) => t.id !== id));
      }, patch.status === "confirmed" ? TOAST_TTL_MS : TOAST_TTL_MS * 2);
      timers.current.add(timer);
    }
  }, []);

  const settle = useCallback(
    (intentId: string, status: IntentStatus, error?: string) => {
      const toastId = watched.current.get(intentId);
      if (!toastId) return;
      if (TERMINAL_STATUSES.includes(status)) {
        watched.current.delete(intentId);
        refresh(["account", "positions", "history"]);
        setClosing(new Set());
      }
      updateToast(toastId, { status, error });
    },
    [refresh, updateToast],
  );

  // Push stream.
  useEffect(() => {
    if (!backend) return;
    const onMessage = (m: StreamMessage) => {
      switch (m.type) {
        case "mark": {
          const list = Array.isArray(m.data) ? m.data : [m.data];
          setMarks((prev) => {
            const next = { ...prev };
            for (const u of list) next[u.symbol] = { price: u.mark, at: toMs(u.t ?? null) ?? Date.now() };
            return next;
          });
          break;
        }
        case "positions":
          setPositions(m.data);
          break;
        case "account":
          setAccount(m.data);
          break;
        case "intent":
          settle(m.data.intentId, m.data.status, m.data.error);
          break;
      }
    };
    return backend.stream(onMessage, setStream);
  }, [backend, settle]);

  /** Poll an intent until it reaches a terminal status (the stream may also settle it first). */
  const track = useCallback(
    (ack: IntentAck, toastId: string) => {
      if (!backend) return;
      watched.current.set(ack.intentId, toastId);
      updateToast(toastId, { intentId: ack.intentId, status: ack.status });
      if (TERMINAL_STATUSES.includes(ack.status)) return settle(ack.intentId, ack.status);
      let tries = 0;
      const poll = () => {
        if (!watched.current.has(ack.intentId)) return;
        if (++tries > INTENT_POLL_MAX) return settle(ack.intentId, "expired", "No final status after 90 seconds. Check positions.");
        backend
          .intent(ack.intentId)
          .then((r) => {
            if (TERMINAL_STATUSES.includes(r.status)) settle(ack.intentId, r.status, r.error);
            else schedule();
          })
          .catch(schedule);
      };
      const schedule = () => {
        const timer = setTimeout(() => {
          timers.current.delete(timer);
          poll();
        }, INTENT_POLL_MS);
        timers.current.add(timer);
      };
      schedule();
    },
    [backend, settle, updateToast],
  );

  const submitIntent = useCallback(
    async (label: string, send: () => Promise<IntentAck>) => {
      const toastId = `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((ts) => [...ts.slice(-4), { id: toastId, intentId: null, label, status: "sending" }]);
      try {
        track(await send(), toastId);
      } catch (err) {
        updateToast(toastId, { status: "error", error: err instanceof Error ? err.message : String(err) });
        setClosing(new Set());
      }
    },
    [track, updateToast],
  );

  const openOrder = (o: OpenOrder) =>
    submitIntent(`Open ${o.isLong ? "long" : "short"} ${o.symbol} ${formatUsd(o.marginUsd)} at ${formatLeverage(o.leverage)}`, () =>
      backend!.openOrder(o),
    );

  const closeIds = (ids: string[]) => {
    const p = positions?.find((x) => x.positionId === ids[0]);
    setClosing((s) => new Set([...s, ...ids]));
    submitIntent(p ? `Close ${p.isLong ? "long" : "short"} ${p.symbol} ${formatUsd(p.sizeUsd)}` : "Close position", () =>
      backend!.closePositions(ids),
    );
  };

  const closeAll = () => {
    setClosing(new Set(positions?.map((p) => p.positionId) ?? []));
    return submitIntent(`Close all ${positions?.length ?? 0} positions`, () => backend!.closeAll());
  };

  const selectTab = (t: Tab, focus = false) => {
    setTab(t);
    if (focus) tabRefs.current[t]?.focus();
  };

  // Global shortcuts. F-keys work everywhere; letter keys only outside text fields and dialogs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const fIndex = ["F1", "F2", "F3"].indexOf(e.key);
      if (fIndex >= 0 && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (!document.querySelector("dialog[open]")) setTab(TABS[fIndex].id);
        return;
      }
      if (e.altKey || e.ctrlKey || e.metaKey || isTyping(e.target) || document.querySelector("dialog[open]")) return;
      const k = e.key.toLowerCase();
      if (tab !== "trade" && ["l", "s", "m", "r"].includes(k)) setTab("trade");
      if (k === "l") ticketRef.current?.setSide(true);
      else if (k === "s") ticketRef.current?.setSide(false);
      else if (k === "m") {
        e.preventDefault();
        requestAnimationFrame(() => ticketRef.current?.focusMargin());
      } else if (k === "r") requestAnimationFrame(() => ticketRef.current?.review());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab]);

  const onTabKey = (e: ReactKeyboardEvent, i: number) => {
    const n = TABS.length;
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % n;
    else if (e.key === "ArrowLeft") next = (i - 1 + n) % n;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    if (next >= 0) {
      e.preventDefault();
      selectTab(TABS[next].id, true);
    }
  };

  const symbolPositions = positions ?? [];
  const mark = marks[symbol] ?? null;
  const markPrice = mark?.price ?? markets?.find((m) => m.symbol === symbol)?.mark ?? null;
  const liveMarkets = markets?.map((m) => (marks[m.symbol] ? { ...m, mark: marks[m.symbol].price } : m)) ?? null;

  return (
    <div className="app">
      <Header me={me} account={account} stream={stream} mock={!!backend?.mock} />
      <nav className="tabs" aria-label="Workspace">
        <div role="tablist" aria-label="Workspace tabs" className="tablist">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-controls={`panel-${t.id}`}
              aria-selected={tab === t.id}
              tabIndex={tab === t.id ? 0 : -1}
              className="tab"
              onClick={() => selectTab(t.id)}
              onKeyDown={(e) => onTabKey(e, i)}
            >
              <kbd>{t.key}</kbd> {t.label}
              {t.more && <span className="tab-long">{t.more}</span>}
            </button>
          ))}
        </div>
      </nav>

      {loadError && (
        <div className="banner" role="alert">
          <p>Backend not reachable: {loadError}.</p>
          <p>
            Start the server on this origin, or <a href="?mock=1">open mock mode</a>.
          </p>
        </div>
      )}

      <main className="main">
        <div id="panel-trade" role="tabpanel" aria-labelledby="tab-trade" hidden={tab !== "trade"} className="trade">
          <div className="trade-main">
            {backend && (
              <Chart
                backend={backend}
                symbol={symbol}
                timeframe={timeframe}
                onTimeframe={setTimeframe}
                mark={mark}
                positions={symbolPositions}
              />
            )}
            <PositionsTable positions={positions} closing={closing} onClose={closeIds} onCloseAll={closeAll} compact />
          </div>
          <TradeTicket
            ref={ticketRef}
            markets={liveMarkets ?? []}
            symbol={symbol}
            onSymbol={setSymbol}
            mark={markPrice}
            account={account}
            me={me}
            onSubmit={openOrder}
          />
        </div>
        <div id="panel-book" role="tabpanel" aria-labelledby="tab-book" hidden={tab !== "book"} className="book">
          <PositionsTable positions={positions} closing={closing} onClose={closeIds} onCloseAll={closeAll} />
          <HistoryTable history={history} />
        </div>
        <div id="panel-analysis" role="tabpanel" aria-labelledby="tab-analysis" hidden={tab !== "analysis"} className="book">
          <MarketsTable markets={liveMarkets} />
        </div>
      </main>

      <footer className="statusbar">
        <p>
          <kbd>F1</kbd>-<kbd>F3</kbd> tabs <kbd>L</kbd> long <kbd>S</kbd> short <kbd>M</kbd> margin <kbd>R</kbd> review{" "}
          <kbd>Esc</kbd> cancel
        </p>
        <p className="statusbar-api">Data from /api on this origin{backend?.mock ? " (mock mode)" : ""}</p>
      </footer>
      <Toasts toasts={toasts} onDismiss={(id) => setToasts((ts) => ts.filter((t) => t.id !== id))} />
    </div>
  );
}
