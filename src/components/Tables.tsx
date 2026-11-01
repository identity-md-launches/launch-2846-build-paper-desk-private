import { useState } from "react";
import type { ClosedTrade, Market, Position } from "../api";
import { formatDateTime, formatLeverage, formatPct, formatPrice, formatUsd, formatUsdCompact } from "../format";
import { Dialog } from "./Dialog";

const pnlClass = (n: number) => (n > 0 ? "profit" : n < 0 ? "loss" : "");

interface PositionsProps {
  positions: Position[] | null;
  closing: Set<string>;
  onClose: (ids: string[]) => void;
  onCloseAll: () => Promise<void>;
  compact?: boolean;
}

export function PositionsTable({ positions, closing, onClose, onCloseAll, compact }: PositionsProps) {
  const [confirmAll, setConfirmAll] = useState(false);
  const titleId = compact ? "positions-title-trade" : "positions-title";
  const [sending, setSending] = useState(false);
  const list = positions ?? [];
  const totalPnl = list.reduce((s, p) => s + p.pnlUsd, 0);
  const totalMargin = list.reduce((s, p) => s + p.marginUsd, 0);

  return (
    <section className={`table-panel ${compact ? "table-panel-compact" : ""}`} aria-labelledby={titleId}>
      <div className="panel-head">
        <h2 id={titleId} className="panel-title">
          Open positions <span className="count num">{positions ? list.length : "--"}</span>
        </h2>
        <button
          type="button"
          className="btn btn-danger"
          disabled={!list.length}
          onClick={() => setConfirmAll(true)}
        >
          Close all
        </button>
      </div>
      <div className="table-scroll" role="region" tabIndex={0} aria-label="Open positions table">
        <table className="grid">
          <thead>
            <tr>
              <th scope="col">Market</th>
              <th scope="col">Side</th>
              <th scope="col" className="r">Size</th>
              <th scope="col" className="r">Margin</th>
              <th scope="col" className="r">Lev</th>
              <th scope="col" className="r">Entry</th>
              <th scope="col" className="r">Mark</th>
              <th scope="col" className="r">PnL</th>
              <th scope="col" className="r">PnL %</th>
              <th scope="col" className="r">Bust</th>
              <th scope="col" className="r">Opened</th>
              <th scope="col" className="r">
                <span className="sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {positions === null && (
              <tr>
                <td colSpan={12} className="empty">
                  Loading positions…
                </td>
              </tr>
            )}
            {positions !== null && !list.length && (
              <tr>
                <td colSpan={12} className="empty">
                  No open positions. Use the order ticket to open one.
                </td>
              </tr>
            )}
            {list.map((p) => (
              <tr key={p.positionId}>
                <th scope="row">{p.symbol}</th>
                <td className={p.isLong ? "profit" : "loss"}>{p.isLong ? "Long" : "Short"}</td>
                <td className="r num">{formatUsd(p.sizeUsd)}</td>
                <td className="r num">{formatUsd(p.marginUsd)}</td>
                <td className="r num">{formatLeverage(p.leverage)}</td>
                <td className="r num">{formatPrice(p.entry)}</td>
                <td className="r num">{formatPrice(p.mark)}</td>
                <td className={`r num ${pnlClass(p.pnlUsd)}`}>{formatUsd(p.pnlUsd, { sign: true })}</td>
                <td className={`r num ${pnlClass(p.pnlPct)}`}>{formatPct(p.pnlPct)}</td>
                <td className="r num bust">{formatPrice(p.bustPrice)}</td>
                <td className="r num">{formatDateTime(p.openedAt)}</td>
                <td className="r">
                  <button
                    type="button"
                    className="btn btn-row"
                    disabled={closing.has(p.positionId)}
                    aria-label={`Close ${p.isLong ? "long" : "short"} ${p.symbol} ${formatUsd(p.sizeUsd)}`}
                    onClick={() => onClose([p.positionId])}
                  >
                    {closing.has(p.positionId) ? "Closing…" : "Close"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          {list.length > 1 && (
            <tfoot>
              <tr>
                <th scope="row" colSpan={3}>
                  Total
                </th>
                <td className="r num">{formatUsd(totalMargin)}</td>
                <td colSpan={3} />
                <td className={`r num ${pnlClass(totalPnl)}`}>{formatUsd(totalPnl, { sign: true })}</td>
                <td colSpan={4} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <Dialog open={confirmAll} title={`Close all ${list.length} positions?`} onClose={() => !sending && setConfirmAll(false)}>
        <p className="dialog-text num">
          Every open position closes at market. Open PnL of{" "}
          <span className={pnlClass(totalPnl)}>{formatUsd(totalPnl, { sign: true })}</span> is realised and{" "}
          {formatUsd(totalMargin)} of margin is released.
        </p>
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" autoFocus disabled={sending} onClick={() => setConfirmAll(false)}>
            Keep positions
          </button>
          <button
            type="button"
            className="btn btn-danger-solid"
            disabled={sending}
            onClick={async () => {
              setSending(true);
              try {
                await onCloseAll();
              } finally {
                setSending(false);
                setConfirmAll(false);
              }
            }}
          >
            {sending ? "Sending…" : `Close ${list.length} positions`}
          </button>
        </div>
      </Dialog>
    </section>
  );
}

export function HistoryTable({ history }: { history: ClosedTrade[] | null }) {
  const list = history ?? [];
  const net = list.reduce((s, t) => s + t.pnlUsd, 0);
  const fees = list.reduce((s, t) => s + t.fees, 0);
  const wins = list.filter((t) => t.pnlUsd > 0).length;
  return (
    <section className="table-panel" aria-labelledby="history-title">
      <div className="panel-head">
        <h2 id="history-title" className="panel-title">
          Trade history <span className="count num">{history ? list.length : "--"}</span>
        </h2>
        {list.length > 0 && (
          <p className="summary num">
            Net <span className={pnlClass(net)}>{formatUsd(net, { sign: true })}</span> Fees {formatUsd(fees)} Win rate{" "}
            {((wins / list.length) * 100).toFixed(1)}%
          </p>
        )}
      </div>
      <div className="table-scroll" role="region" tabIndex={0} aria-label="Trade history table">
        <table className="grid">
          <thead>
            <tr>
              <th scope="col">Market</th>
              <th scope="col">Side</th>
              <th scope="col" className="r">Size</th>
              <th scope="col" className="r">Lev</th>
              <th scope="col" className="r">Entry</th>
              <th scope="col" className="r">Exit</th>
              <th scope="col" className="r">PnL</th>
              <th scope="col" className="r">Fees</th>
              <th scope="col" className="r">Opened</th>
              <th scope="col" className="r">Closed</th>
            </tr>
          </thead>
          <tbody>
            {history === null && (
              <tr>
                <td colSpan={10} className="empty">
                  Loading history…
                </td>
              </tr>
            )}
            {history !== null && !list.length && (
              <tr>
                <td colSpan={10} className="empty">
                  No closed trades yet. Closed positions are listed here.
                </td>
              </tr>
            )}
            {list.map((t, i) => (
              <tr key={`${t.positionId}-${i}`}>
                <th scope="row">{t.symbol}</th>
                <td className={t.isLong ? "profit" : "loss"}>{t.isLong ? "Long" : "Short"}</td>
                <td className="r num">{formatUsd(t.sizeUsd)}</td>
                <td className="r num">{formatLeverage(t.leverage)}</td>
                <td className="r num">{formatPrice(t.entry)}</td>
                <td className="r num">{formatPrice(t.exit)}</td>
                <td className={`r num ${pnlClass(t.pnlUsd)}`}>{formatUsd(t.pnlUsd, { sign: true })}</td>
                <td className="r num">{formatUsd(t.fees)}</td>
                <td className="r num">{formatDateTime(t.openedAt)}</td>
                <td className="r num">{formatDateTime(t.closedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function MarketsTable({ markets }: { markets: Market[] | null }) {
  return (
    <section className="table-panel" aria-labelledby="analysis-title">
      <div className="panel-head">
        <h2 id="analysis-title" className="panel-title">
          Market overview
        </h2>
      </div>
      <div className="table-scroll" role="region" tabIndex={0} aria-label="Market overview table">
        <table className="grid">
          <thead>
            <tr>
              <th scope="col">Market</th>
              <th scope="col" className="r">Mark</th>
              <th scope="col" className="r">24h</th>
              <th scope="col" className="r">Long OI</th>
              <th scope="col" className="r">Short OI</th>
              <th scope="col" className="r">Long share</th>
              <th scope="col" className="r">Max lev</th>
            </tr>
          </thead>
          <tbody>
            {markets === null && (
              <tr>
                <td colSpan={7} className="empty">
                  Loading markets…
                </td>
              </tr>
            )}
            {(markets ?? []).map((m) => {
              const total = m.longOi + m.shortOi;
              return (
                <tr key={m.symbol}>
                  <th scope="row">{m.symbol}</th>
                  <td className="r num">{formatPrice(m.mark)}</td>
                  <td className={`r num ${pnlClass(m.change24hPct)}`}>{formatPct(m.change24hPct)}</td>
                  <td className="r num">{formatUsdCompact(m.longOi)}</td>
                  <td className="r num">{formatUsdCompact(m.shortOi)}</td>
                  <td className="r num">{total > 0 ? `${((m.longOi / total) * 100).toFixed(1)}%` : "--"}</td>
                  <td className="r num">{formatLeverage(m.maxLeverage)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hint pad">Analysis tools will be added to this tab. Today it lists the markets the backend reports.</p>
    </section>
  );
}
