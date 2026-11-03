import { useEffect, useState } from "react";
import type { Cashflow, Position, Trade, TradeKind } from "../api";
import {
  formatDateTime,
  formatLeverage,
  formatPct,
  formatPrice,
  formatUsd,
} from "../format";
import { cashflowsCsv, downloadCsv, tradesCsv } from "../csv";
export const pnlClass = (n: number | null | undefined) =>
  n && n > 0 ? "profit" : n && n < 0 ? "loss" : "";
const number = (n: number) =>
  Number.isFinite(n)
    ? n.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : "--";
export function PositionsTable({
  positions,
}: {
  positions: Position[] | null;
}) {
  const list = positions ?? [];
  return (
    <section className="table-panel" aria-labelledby="positions-title">
      <div className="panel-head">
        <h2 id="positions-title">
          Open positions{" "}
          <span className="count">{positions ? list.length : "--"}</span>
        </h2>
        <p
          className={`num ${pnlClass(list.reduce((s, p) => s + p.pnlUsd, 0))}`}
        >
          Open PnL{" "}
          {positions
            ? formatUsd(
                list.reduce((s, p) => s + p.pnlUsd, 0),
                { sign: true },
              )
            : "--"}
        </p>
      </div>
      <p className="table-hint">
        Positions: scroll for entry, mark and bust details · UTC
      </p>
      <div
        className="table-scroll"
        role="region"
        tabIndex={0}
        aria-label="Open positions table"
      >
        <table className="grid">
          <thead>
            <tr>
              {[
                "Market",
                "Side",
                "Size USD",
                "Margin USD",
                "Leverage",
                "Entry",
                "Mark",
                "PnL USD",
                "PnL %",
                "Bust",
                "Opened UTC",
              ].map((v, i) => (
                <th key={v} scope="col" className={i > 1 ? "r" : ""}>
                  {v}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!positions && (
              <tr>
                <td colSpan={11} className="empty">
                  Loading open positions…
                </td>
              </tr>
            )}
            {positions && !list.length && (
              <tr>
                <td colSpan={11} className="empty">
                  No open positions for this account.
                </td>
              </tr>
            )}
            {list.map((p) => (
              <tr key={p.positionId}>
                <th scope="row">{p.symbol}</th>
                <td className={p.isLong ? "profit" : "loss"}>
                  {p.isLong ? "Long" : "Short"}
                </td>
                <td className="r">{formatUsd(p.sizeUsd)}</td>
                <td className="r">{formatUsd(p.marginUsd)}</td>
                <td className="r">{formatLeverage(p.leverage)}</td>
                <td className="r">{formatPrice(p.entry)}</td>
                <td className="r">{formatPrice(p.mark)}</td>
                <td className={`r ${pnlClass(p.pnlUsd)}`}>
                  {formatUsd(p.pnlUsd, { sign: true })}
                </td>
                <td className={`r ${pnlClass(p.pnlPct)}`}>
                  {formatPct(p.pnlPct)}
                </td>
                <td className="r bust">{formatPrice(p.bustPrice)}</td>
                <td className="r">{formatDateTime(p.openedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
export function TradesTable({
  trades,
  onTrade,
  recent = false,
  address = "",
}: {
  trades: Trade[] | null;
  onTrade: (t: Trade) => void;
  recent?: boolean;
  address?: string;
}) {
  const [market, setMarket] = useState("all"),
    [side, setSide] = useState("all"),
    [outcome, setOutcome] = useState("all"),
    [page, setPage] = useState(0);
  const list = (trades ?? []).filter(
    (t) =>
      (market === "all" || t.symbol === market) &&
      (side === "all" || (t.isLong ? "long" : "short") === side) &&
      (outcome === "all" ||
        (outcome === "Win" && t.kind !== "Opened" && t.pnlUsd > 0) ||
        (outcome === "Loss" && t.kind !== "Opened" && t.pnlUsd < 0) ||
        t.kind === outcome),
  );
  const totalPages = Math.max(1, Math.ceil(list.length / 75));
  useEffect(() => setPage(0), [market, side, outcome, address]);
  const currentPage = Math.min(page, totalPages - 1);
  const shown = recent
    ? list.slice(0, 8)
    : list.slice(currentPage * 75, (currentPage + 1) * 75);
  const title = recent ? "recent-trades-title" : "trades-title";
  return (
    <section className="table-panel" aria-labelledby={title}>
      <div className="panel-head">
        <h2 id={title}>
          {recent ? "Recent trades" : "Trades"}{" "}
          <span className="count">{trades ? list.length : "--"}</span>
        </h2>
        {!recent && (
          <button
            className="btn"
            type="button"
            disabled={!list.length}
            onClick={() =>
              downloadCsv(`paper-desk-${address}-trades.csv`, tradesCsv(list))
            }
          >
            Export trades CSV
          </button>
        )}
        <p className="hint">Select a trade to inspect its chart</p>
      </div>
      {!recent && (
        <div className="filters">
          <label>
            Market
            <select
              aria-label="Market"
              className="input"
              value={market}
              onChange={(e) => setMarket(e.target.value)}
            >
              <option value="all">All markets</option>
              {[...new Set((trades ?? []).map((t) => t.symbol))]
                .sort()
                .map((s) => (
                  <option key={s}>{s}</option>
                ))}
            </select>
          </label>
          <label>
            Side
            <select
              aria-label="Side"
              className="input"
              value={side}
              onChange={(e) => setSide(e.target.value)}
            >
              <option value="all">All sides</option>
              <option value="long">Long</option>
              <option value="short">Short</option>
            </select>
          </label>
          <label>
            Outcome
            <select
              aria-label="Outcome"
              className="input"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
            >
              <option value="all">All outcomes</option>
              {[
                "Win",
                "Loss",
                "Closed",
                "Liquidated",
                "TakeProfit",
                "StopLoss",
                "Opened",
              ].map((k) => (
                <option key={k} value={k}>
                  {kindLabel(k as TradeKind)}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => {
              setMarket("all");
              setSide("all");
              setOutcome("all");
            }}
          >
            Reset filters
          </button>
          <p className="hint" role="status">
            {list.length} matching events
          </p>
        </div>
      )}
      <p className="table-hint">Trade details extend horizontally · UTC</p>
      <div
        className="table-scroll"
        role="region"
        tabIndex={0}
        aria-label={recent ? "Recent trades table" : "Trades table"}
      >
        <table className="grid">
          <thead>
            <tr>
              {[
                "Market / chart",
                "Side",
                "Outcome",
                "Margin USD",
                "Leverage",
                "Entry",
                "Exit",
                "PnL USD",
                "Fee USD",
                "PAPER",
                "Opened UTC",
                "Closed UTC",
                ...(!recent ? ["Transaction hash"] : []),
              ].map((v, i) => (
                <th scope="col" key={v} className={i > 2 ? "r" : ""}>
                  {v}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!trades && (
              <tr>
                <td colSpan={recent ? 12 : 13} className="empty">
                  Loading complete trade history…
                </td>
              </tr>
            )}
            {trades && !shown.length && (
              <tr>
                <td colSpan={recent ? 12 : 13} className="empty">
                  {trades.length
                    ? "No trades match these filters. Reset filters to see all activity."
                    : "No trading activity for this account."}
                </td>
              </tr>
            )}
            {shown.map((t, i) => (
              <tr
                className="trade-row"
                key={`${t.positionId}-${t.kind}-${i}`}
                onClick={() => onTrade(t)}
              >
                <th scope="row">
                  <button
                    className="trade-link"
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onTrade(t);
                    }}
                    aria-label={`View ${t.symbol} ${t.isLong ? "long" : "short"} ${kindLabel(t.kind)} trade opened ${formatDateTime(t.openedAt)} UTC`}
                  >
                    {t.symbol} <span aria-hidden="true">↗</span>
                  </button>
                </th>
                <td className={t.isLong ? "profit" : "loss"}>
                  {t.isLong ? "Long" : "Short"}
                </td>
                <td className={t.kind === "Liquidated" ? "bust" : ""}>
                  {kindLabel(t.kind)}
                </td>
                <td className="r">{formatUsd(t.marginUsd)}</td>
                <td className="r">{formatLeverage(t.leverage)}</td>
                <td className="r">{formatPrice(t.entry)}</td>
                <td className="r">
                  {t.kind === "Opened" ? "--" : formatPrice(t.exit)}
                </td>
                <td className={`r ${pnlClass(t.pnlUsd)}`}>
                  {t.kind === "Opened"
                    ? "--"
                    : formatUsd(t.pnlUsd, { sign: true })}
                </td>
                <td className="r">{formatUsd(t.feeUsd)}</td>
                <td className="r">{number(t.paperMinted)}</td>
                <td className="r">{formatDateTime(t.openedAt)}</td>
                <td className="r">{formatDateTime(t.closedAt)}</td>
                {!recent && (
                  <td className="hash">{t.txHash ?? "Not supplied"}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!recent && (
        <Pagination
          page={currentPage}
          pages={totalPages}
          count={list.length}
          onPage={setPage}
          label="Trades"
        />
      )}
    </section>
  );
}
export function kindLabel(kind: TradeKind): string {
  return kind === "TakeProfit"
    ? "Take profit"
    : kind === "StopLoss"
      ? "Stop loss"
      : kind;
}
function Pagination({
  page,
  pages,
  count,
  onPage,
  label,
}: {
  page: number;
  pages: number;
  count: number;
  onPage: (n: number) => void;
  label: string;
}) {
  return (
    <nav className="pagination" aria-label={`${label} pagination`}>
      <button
        type="button"
        className="btn"
        disabled={!page}
        onClick={() => onPage(page - 1)}
      >
        Previous
      </button>
      <p className="hint" role="status">
        Page {page + 1} / {pages} · {count} events · 75 per page
      </p>
      <button
        type="button"
        className="btn"
        disabled={page + 1 >= pages}
        onClick={() => onPage(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}
export function CashflowsTable({
  cashflows,
  address,
}: {
  cashflows: Cashflow[] | null;
  address: string;
}) {
  const [page, setPage] = useState(0),
    [kind, setKind] = useState("all"),
    [status, setStatus] = useState("all");
  useEffect(() => setPage(0), [kind, status, address]);
  const list = (cashflows ?? []).filter(
    (c) =>
      (kind === "all" || c.kind === kind) &&
      (status === "all" || c.status === status),
  );
  const pages = Math.max(1, Math.ceil(list.length / 75)),
    currentPage = Math.min(page, pages - 1);
  return (
    <section className="table-panel" aria-labelledby="cashflows-title">
      <div className="panel-head">
        <h2 id="cashflows-title">
          Cashflows{" "}
          <span className="count">{cashflows ? list.length : "--"}</span>
        </h2>
        <button
          type="button"
          className="btn"
          disabled={!list.length}
          onClick={() =>
            downloadCsv(
              `paper-desk-${address}-cashflows.csv`,
              cashflowsCsv(list),
            )
          }
        >
          Export cashflows CSV
        </button>
      </div>
      <div className="filters">
        <label>
          Kind
          <select
            aria-label="Kind"
            className="input"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="all">All cashflows</option>
            <option>Deposit</option>
            <option>Withdrawal</option>
          </select>
        </label>
        <label>
          Status
          <select
            aria-label="Status"
            className="input"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">All statuses</option>
            {[...new Set((cashflows ?? []).map((c) => c.status))]
              .sort()
              .map((s) => (
                <option key={s}>{s}</option>
              ))}
          </select>
        </label>
      </div>
      <p className="table-hint">
        Cashflows: scroll for route and transaction details · UTC
      </p>
      <div
        className="table-scroll"
        role="region"
        tabIndex={0}
        aria-label="Cashflows table"
      >
        <table className="grid">
          <thead>
            <tr>
              {[
                "Time UTC",
                "Kind",
                "Amount USD",
                "Route",
                "Status",
                "Transaction hash",
              ].map((s) => (
                <th key={s} scope="col">
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!cashflows && (
              <tr>
                <td colSpan={6} className="empty">
                  Loading complete cashflow history…
                </td>
              </tr>
            )}
            {cashflows && !list.length && (
              <tr>
                <td colSpan={6} className="empty">
                  {cashflows.length
                    ? "No cashflows match these filters."
                    : "No deposits or withdrawals for this account."}
                </td>
              </tr>
            )}
            {list
              .slice(currentPage * 75, (currentPage + 1) * 75)
              .map((c, i) => (
                <tr key={`${c.t}-${i}`}>
                  <th scope="row">{formatDateTime(c.t)}</th>
                  <td>{c.kind}</td>
                  <td className="r">{formatUsd(c.amountUsd)}</td>
                  <td>{c.route}</td>
                  <td>{c.status}</td>
                  <td className="hash">{c.txHash ?? "Not supplied"}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <Pagination
        page={currentPage}
        pages={pages}
        count={list.length}
        onPage={setPage}
        label="Cashflows"
      />
    </section>
  );
}
