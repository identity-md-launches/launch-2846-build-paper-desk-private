import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  getBackend,
  TIMEFRAMES,
  TIMEFRAME_SECONDS,
  type Backend,
  type Market,
  type Timeframe,
  type Trade,
} from "./api";
import { addressFromUrl, updateAddressUrl } from "./address";
import { useAccount } from "./useAccount";
import { computeStats } from "./stats";
import {
  formatPrice,
  formatPct,
  formatUsd,
  formatUsdCompact,
  toMs,
} from "./format";
import { Header } from "./components/Header";
import { Chart } from "./components/Chart";
import { Analysis } from "./components/Analysis";
import { SignalPanel } from "./components/SignalPanel";
import { useErl } from "./useErl";
import {
  CashflowsTable,
  pnlClass,
  PositionsTable,
  TradesTable,
} from "./components/Tables";

type Tab = "account" | "history" | "analysis";
const TABS: { id: Tab; key: string; label: string }[] = [
  { id: "account", key: "F1", label: "ACCOUNT" },
  { id: "history", key: "F2", label: "HISTORY" },
  { id: "analysis", key: "F3", label: "ANALYSIS" },
];
const token = (n: number | undefined) =>
  n === undefined
    ? "--"
    : n.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
export function App() {
  const [backend, setBackend] = useState<Backend | null>(null);
  const [address, setAddress] = useState(addressFromUrl);
  const [tab, setTab] = useState<Tab>("account");
  const [symbol, setSymbol] = useState("BTC"),
    [timeframe, setTimeframe] = useState<Timeframe>("15m");
  const [markets, setMarkets] = useState<Market[] | null>(null),
    [quoteTime, setQuoteTime] = useState(0),
    [marketError, setMarketError] = useState("");
  const [overlays, setOverlays] = useState(true),
    [focusTrade, setFocusTrade] = useState<{
      trade: Trade;
      key: number;
    } | null>(null);
  const [quoteRetry, setQuoteRetry] = useState(0);
  const [signalLayer, setSignalLayer] = useState(true),
    [signalTf, setSignalTf] = useState<Timeframe>("1m");
  // The signal panel lives on the account F1 view; nothing polls before an address loads.
  const erl = useErl(address ? backend : null, signalTf);
  const signalPanel = (
    <SignalPanel
      markets={erl.markets}
      tf={signalTf}
      onTf={setSignalTf}
      asOfSec={erl.markets.find((m) => m.map)?.map?.asOfSec ?? null}
    />
  );
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const account = useAccount(backend, address);
  const stats = useMemo(
    () => computeStats(account.trades ?? []),
    [account.trades],
  );
  useEffect(() => {
    let alive = true;
    getBackend().then((b) => {
      if (alive) setBackend(b);
    });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    const initial = addressFromUrl();
    if (initial) updateAddressUrl(initial, true);
    const pop = () => {
      setAddress(addressFromUrl());
      setFocusTrade(null);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const loadAddress = useCallback((next: string) => {
    if (new URLSearchParams(location.search).get("address") !== (next || null))
      updateAddressUrl(next);
    setAddress(next);
    setFocusTrade(null);
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.altKey || e.metaKey || e.ctrlKey) return;
      const i = ["F1", "F2", "F3"].indexOf(e.key);
      if (i !== -1) {
        e.preventDefault();
        setTab(TABS[i].id);
        tabRefs.current[i]?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    setMarkets(null);
    setMarketError("");
    if (!backend || !address) return;
    let active = true,
      busy = false;
    let ctrl: AbortController | null = null;
    const load = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      ctrl = new AbortController();
      const signal = ctrl.signal;
      try {
        const rows = await backend.markets(signal);
        if (active && !signal.aborted) {
          setMarkets(rows);
          setQuoteTime(Date.now());
          setMarketError("");
        }
      } catch {
        if (active && !signal.aborted)
          setMarketError(
            "Market quotes unavailable. Candle history may still be available.",
          );
      } finally {
        busy = false;
      }
    };
    const visibility = () => {
      if (document.visibilityState === "visible") void load();
      else ctrl?.abort();
    };
    void load();
    const id = setInterval(() => void load(), 5000);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      active = false;
      ctrl?.abort();
      clearInterval(id);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [backend, address, quoteRetry]);
  const inspectTrade = (trade: Trade) => {
    setSymbol(trade.symbol);
    setOverlays(true);
    setTab("account");
    const opened = toMs(trade.openedAt);
    if (opened !== null) {
      const age = Math.max(0, (Date.now() - opened) / 1000);
      if (age / TIMEFRAME_SECONDS[timeframe] > 970)
        setTimeframe(
          TIMEFRAMES.find((tf) => age / TIMEFRAME_SECONDS[tf] <= 970) ?? "1d",
        );
    }
    setFocusTrade({ trade, key: Date.now() });
  };
  const onTabKey = (e: ReactKeyboardEvent, i: number) => {
    const next =
      e.key === "ArrowRight"
        ? (i + 1) % 3
        : e.key === "ArrowLeft"
          ? (i + 2) % 3
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? 2
              : -1;
    if (next >= 0) {
      e.preventDefault();
      setTab(TABS[next].id);
      tabRefs.current[next]?.focus();
    }
  };
  const openPnl = account.positions?.reduce((s, p) => s + p.pnlUsd, 0);
  const hasNoActivity =
    account.summary &&
    account.positions &&
    account.trades &&
    account.cashflows &&
    !account.positions.length &&
    !account.trades.length &&
    !account.cashflows.length;
  const mark = markets?.find((m) => m.symbol === symbol);
  const metrics: [string, string, string?][] = [
    ["Equity", formatUsd(account.summary?.equity)],
    [
      "All-time PnL",
      formatUsd(account.summary?.pnl, { sign: true }),
      pnlClass(account.summary?.pnl),
    ],
    ["Open PnL", formatUsd(openPnl, { sign: true }), pnlClass(openPnl)],
    ["PAPER minted", token(account.summary?.paperMinted)],
    [
      "Win rate",
      account.trades && stats.winRate !== null
        ? `${stats.winRate.toFixed(1)}%`
        : "--",
    ],
    ["Trade count", account.trades ? String(stats.count) : "--"],
    [
      "Liquidations",
      account.trades ? String(stats.liquidations) : "--",
      stats.liquidations ? "bust" : "",
    ],
  ];
  return (
    <div className="app">
      <a className="skip-link" href="#workspace">
        Skip to account workspace
      </a>
      <Header
        address={address}
        onLoad={loadAddress}
        status={account.status}
        mock={!!backend?.mock}
        asOf={account.summary?.asOf}
      />
      <nav className="tabs" aria-label="Workspace">
        <div className="tablist" role="tablist" aria-label="Workspace tabs">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-controls={`panel-${t.id}`}
              aria-selected={tab === t.id}
              tabIndex={tab === t.id ? 0 : -1}
              className="tab"
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => onTabKey(e, i)}
            >
              <kbd>{t.key}</kbd> {t.label}
            </button>
          ))}
        </div>
        <p className="nav-note">Synthetic perps · BTC / ETH · All times UTC</p>
      </nav>
      <main id="workspace" className="main" tabIndex={-1}>
        {!address ? (
          <>
            <section
              className="empty-workspace"
              id={`panel-${tab}`}
              role="tabpanel"
              aria-labelledby={`tab-${tab}`}
            >
              <div className="empty-intro">
                <p className="terminal-prompt" aria-hidden="true">
                  &gt;_
                </p>
                <h2 id="empty-title">Inspect a Papertrade account.</h2>
                <p>
                  Paste a public wallet address above to view positions, trades
                  and performance with the BB(15) sigma ladder.
                </p>
                <button
                  className="btn"
                  type="button"
                  onClick={() =>
                    document.getElementById("account-address")?.focus()
                  }
                >
                  Enter an address <span aria-hidden="true">↑</span>
                </button>
                <p className="hint">
                  Read only. No wallet connection or signing.
                </p>
              </div>
              <div className="empty-capabilities">
                <div>
                  <span className="section-code">01</span>
                  <h3>Account</h3>
                  <p>Positions, entries and the ERL-100 signal on the chart.</p>
                </div>
                <div>
                  <span className="section-code">02</span>
                  <h3>History</h3>
                  <p>Filter activity and export trades or cashflows.</p>
                </div>
                <div>
                  <span className="section-code">03</span>
                  <h3>Analysis</h3>
                  <p>Equity, statistics and a 100× ERL-100 backtest.</p>
                </div>
              </div>
              <p className="empty-mode">
                {backend?.mock ? (
                  "Mock mode is enabled. Any valid address generates a synthetic account."
                ) : (
                  <>
                    A same-origin data service supplies account activity.{" "}
                    <a href="?mock=1">Open mock mode</a> to explore with
                    synthetic data.
                  </>
                )}
              </p>
            </section>
            {TABS.filter((item) => item.id !== tab).map((item) => (
              <div
                key={item.id}
                id={`panel-${item.id}`}
                role="tabpanel"
                aria-labelledby={`tab-${item.id}`}
                hidden
              />
            ))}
          </>
        ) : (
          <>
            {account.error && (
              <div className="banner" role="alert">
                <p>{account.error}</p>
                <button className="btn" onClick={account.refresh}>
                  Retry account
                </button>
                {!backend?.mock && (
                  <a href={`?mock=1&address=${address}`}>Open mock mode</a>
                )}
              </div>
            )}
            {hasNoActivity && (
              <div className="no-activity" role="status">
                <strong>No activity for this account.</strong>
                <p>
                  No positions, trades, deposits or withdrawals were found.
                  Paste another public address to inspect a different account.
                </p>
              </div>
            )}
            <div
              id="panel-account"
              role="tabpanel"
              aria-labelledby="tab-account"
              hidden={tab !== "account"}
            >
              {tab === "account" && (
                <>
                  <dl className="metrics">
                    {metrics.map(([label, value, color]) => (
                      <div className="metric" key={label}>
                        <dt>{label}</dt>
                        <dd className={`num ${color ?? ""}`}>{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="account-subline">
                    <p className="hint">
                      Staking rewards{" "}
                      <span className="num">
                        {token(account.summary?.stakingRewards)} PAPER
                      </span>
                    </p>
                    <p className="hint">
                      Win rate / counts use settled positions from complete
                      trade history.
                    </p>
                  </div>
                  {signalPanel}
                  <div className="market-toolbar">
                    <div className="seg" role="group" aria-label="Market">
                      {["BTC", "ETH"].map((s) => (
                        <button
                          type="button"
                          key={s}
                          className="seg-btn"
                          aria-pressed={symbol === s}
                          onClick={() => {
                            setSymbol(s);
                            setFocusTrade(null);
                          }}
                        >
                          {s}
                          <span className="ro-k"> / USD</span>
                        </button>
                      ))}
                    </div>
                    <p className="market-price num">
                      {formatPrice(mark?.mark)}{" "}
                      <span className={pnlClass(mark?.change24hPct)}>
                        {formatPct(mark?.change24hPct)}{" "}
                        <span className="ro-k">24h</span>
                      </span>
                    </p>
                    <p className="hint market-volume">
                      Vol {formatUsdCompact(mark?.volume24hUsd)} · Hyperliquid
                      mid
                    </p>
                    <label className="overlay-toggle">
                      <input
                        type="checkbox"
                        checked={overlays}
                        onChange={(e) => setOverlays(e.target.checked)}
                      />
                      Account overlays
                    </label>
                    <label className="overlay-toggle">
                      <input
                        type="checkbox"
                        checked={signalLayer}
                        onChange={(e) => setSignalLayer(e.target.checked)}
                      />
                      Signal
                    </label>
                  </div>
                  {marketError && (
                    <p className="local-error">
                      {marketError}{" "}
                      <button
                        className="btn"
                        onClick={() => setQuoteRetry((n) => n + 1)}
                      >
                        Retry quotes
                      </button>
                    </p>
                  )}
                  {backend && (
                    <Chart
                      backend={backend}
                      symbol={symbol}
                      timeframe={timeframe}
                      onTimeframe={setTimeframe}
                      mark={mark ? { price: mark.mark, at: quoteTime } : null}
                      positions={account.positions ?? []}
                      trades={account.trades ?? []}
                      overlays={overlays}
                      focusTrade={focusTrade}
                      signal={signalLayer}
                    />
                  )}
                  <PositionsTable positions={account.positions} />
                  <TradesTable
                    trades={account.trades}
                    onTrade={inspectTrade}
                    recent
                  />
                </>
              )}
            </div>
            <div
              id="panel-history"
              role="tabpanel"
              aria-labelledby="tab-history"
              hidden={tab !== "history"}
            >
              {tab === "history" && (
                <div className="history">
                  <TradesTable
                    key={address}
                    address={address}
                    trades={account.trades}
                    onTrade={inspectTrade}
                  />
                  <CashflowsTable
                    key={`cash-${address}`}
                    address={address}
                    cashflows={account.cashflows}
                  />
                </div>
              )}
            </div>
            <div
              id="panel-analysis"
              role="tabpanel"
              aria-labelledby="tab-analysis"
              hidden={tab !== "analysis"}
            >
              {tab === "analysis" && backend && (
                <Analysis
                  key={address}
                  backend={backend}
                  address={address}
                  trades={account.trades}
                />
              )}
            </div>
          </>
        )}
      </main>
      <footer className="statusbar">
        <p>
          <kbd>F1</kbd> Account <kbd>F2</kbd> History <kbd>F3</kbd> Analysis
        </p>
        <p>
          {backend?.mock
            ? "Synthetic data · Mock mode"
            : "Papertrade · Read-only account data"}{" "}
          <span className="footer-source">· Same-origin /api</span>
        </p>
      </footer>
    </div>
  );
}
