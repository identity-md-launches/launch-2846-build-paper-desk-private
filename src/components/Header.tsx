import { useEffect, useState } from "react";
import type { Account, Me, StreamState } from "../api";
import { formatCountdown, formatUsd, shortAddress, toMs } from "../format";

interface Props {
  me: Me | null;
  account: Account | null;
  stream: StreamState;
  mock: boolean;
}

const STREAM_LABEL: Record<StreamState, string> = {
  connecting: "CONNECTING",
  live: "LIVE",
  reconnecting: "RECONNECTING",
};

export function Header({ me, account, stream, mock }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const expiresMs = toMs(me?.sessionKey.expiresAt);
  const expiringSoon = expiresMs !== null && expiresMs - now < 30 * 60_000;
  const pnl = account?.openPnl ?? null;

  return (
    <header className="topbar">
      <div className="brand">
        <img src="./favicon.svg" alt="" width="20" height="20" />
        <span className="brand-name">PAPER DESK</span>
        {mock && (
          <span className="badge badge-mock" title="Mock mode: every number on this page is synthetic">
            MOCK DATA
          </span>
        )}
      </div>
      <dl className="metrics">
        <div className="metric">
          <dt>WALLET</dt>
          <dd className="num" title={me?.wallet}>
            {shortAddress(me?.wallet)}
          </dd>
        </div>
        <div className="metric">
          <dt>EQUITY</dt>
          <dd className="num">{formatUsd(account?.equity)}</dd>
        </div>
        <div className="metric">
          <dt>AVAILABLE</dt>
          <dd className="num">{formatUsd(account?.available)}</dd>
        </div>
        <div className="metric">
          <dt>MARGIN</dt>
          <dd className="num">{formatUsd(account?.marginInUse)}</dd>
        </div>
        <div className="metric">
          <dt>OPEN PNL</dt>
          <dd className={`num ${pnl === null ? "" : pnl < 0 ? "loss" : pnl > 0 ? "profit" : ""}`}>
            {formatUsd(pnl, { sign: true })}
          </dd>
        </div>
        <div className="metric">
          <dt>SESSION KEY</dt>
          <dd className={`num ${expiringSoon ? "loss" : ""}`} title={me ? `Session key ${me.sessionKey.address}` : undefined}>
            {formatCountdown(me?.sessionKey.expiresAt, now)}
          </dd>
        </div>
      </dl>
      <p className={`conn conn-${stream}`} role="status">
        <span className="conn-dot" aria-hidden="true" />
        {STREAM_LABEL[stream]}
      </p>
    </header>
  );
}
