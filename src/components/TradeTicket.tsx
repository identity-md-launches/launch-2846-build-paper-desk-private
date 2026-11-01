import { forwardRef, useImperativeHandle, useRef, useState, type FormEvent } from "react";
import type { Account, Market, Me, OpenOrder } from "../api";
import { bustPrice, notional, triggerPrice } from "../indicators";
import { formatLeverage, formatPct, formatPrice, formatUsd, parseAmount } from "../format";
import {
  LEVERAGE_PRESETS,
  SLIDER_STEPS,
  leverageToSlider,
  sliderToLeverage,
  validateTicket,
  type TicketErrors,
} from "../leverage";
import { Dialog } from "./Dialog";

interface Props {
  markets: Market[];
  symbol: string;
  onSymbol: (s: string) => void;
  mark: number | null;
  account: Account | null;
  me: Me | null;
  onSubmit: (order: OpenOrder) => Promise<void>;
}

export interface TicketHandle {
  setSide: (isLong: boolean) => void;
  focusMargin: () => void;
  review: () => void;
}

const optionalPct = (s: string): number | null => (s.trim() === "" ? null : parseAmount(s));

export const TradeTicket = forwardRef<TicketHandle, Props>(function TradeTicket(
  { markets, symbol, onSymbol, mark, account, me, onSubmit },
  ref,
) {
  const [isLong, setIsLong] = useState(true);
  const [marginText, setMarginText] = useState("100");
  const [leverage, setLeverage] = useState(50);
  const [tpText, setTpText] = useState("");
  const [slText, setSlText] = useState("");
  const [errors, setErrors] = useState<TicketErrors>({});
  const [confirming, setConfirming] = useState<OpenOrder | null>(null);
  const [confirmEntry, setConfirmEntry] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const marginRef = useRef<HTMLInputElement>(null);
  const levRef = useRef<HTMLInputElement>(null);
  const tpRef = useRef<HTMLInputElement>(null);
  const slRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const market = markets.find((m) => m.symbol === symbol);
  const maxLev = Math.max(1, Math.min(1000, market?.maxLeverage ?? 1000, me?.limits.maxLeverage ?? 1000));
  const lev = Math.min(leverage, maxLev);
  const margin = parseAmount(marginText);
  const tp = optionalPct(tpText);
  const sl = optionalPct(slText);
  const entry = mark ?? market?.mark ?? null;
  const size = Number.isFinite(margin) ? notional(margin, lev) : null;
  const bust = entry ? bustPrice(entry, lev, isLong) : null;
  const tpPrice = entry && tp && tp > 0 ? triggerPrice(entry, tp, isLong, "tp") : null;
  const slPrice = entry && sl && sl > 0 ? triggerPrice(entry, sl, isLong, "sl") : null;
  const ready = !!(market && account && me && entry);

  const review = () => {
    if (!ready || !account || !me) return;
    const input = { marginUsd: margin, leverage: lev, takeProfitPct: tp, stopLossPct: sl };
    const found = validateTicket(input, {
      available: account.available,
      maxMarginUsd: me.limits.maxMarginUsd,
      maxLeverage: maxLev,
    });
    setErrors(found);
    if (found.marginUsd) return marginRef.current?.focus();
    if (found.leverage) return levRef.current?.focus();
    if (found.takeProfitPct) return tpRef.current?.focus();
    if (found.stopLossPct) return slRef.current?.focus();
    setConfirmEntry(entry);
    setConfirming({
      symbol,
      isLong,
      marginUsd: margin,
      leverage: lev,
      ...(tp !== null ? { takeProfitPct: tp } : {}),
      ...(sl !== null ? { stopLossPct: sl } : {}),
    });
  };

  useImperativeHandle(ref, () => ({
    setSide: setIsLong,
    focusMargin: () => marginRef.current?.focus(),
    review,
  }));

  const onFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    review();
  };

  const send = async () => {
    if (!confirming) return;
    setSending(true);
    try {
      await onSubmit(confirming);
    } finally {
      setSending(false);
      setConfirming(null);
    }
  };

  const sideWord = isLong ? "long" : "short";
  const c = confirming;
  const cBust = c && confirmEntry ? bustPrice(confirmEntry, c.leverage, c.isLong) : null;

  return (
    <aside className="ticket" aria-labelledby="ticket-title">
      <h2 id="ticket-title" className="panel-title">
        Order ticket
      </h2>
      <form ref={formRef} onSubmit={onFormSubmit} noValidate>
        <div className="field">
          <span className="label" id="market-label">
            Market
          </span>
          <div className="seg seg-fill" role="group" aria-labelledby="market-label">
            {(markets.length ? markets : [{ symbol }]).map((m) => (
              <button
                key={m.symbol}
                type="button"
                className="seg-btn"
                aria-pressed={m.symbol === symbol}
                onClick={() => onSymbol(m.symbol)}
              >
                {m.symbol}
              </button>
            ))}
          </div>
          <p className="hint num">
            Mark {formatPrice(entry)}{" "}
            {market && <span className={market.change24hPct < 0 ? "loss" : "profit"}>{formatPct(market.change24hPct)} 24h</span>}
          </p>
        </div>

        <div className="field">
          <span className="label" id="side-label">
            Side
          </span>
          <div className="seg seg-fill side" role="group" aria-labelledby="side-label">
            <button type="button" className="seg-btn side-long" aria-pressed={isLong} onClick={() => setIsLong(true)}>
              Long
            </button>
            <button type="button" className="seg-btn side-short" aria-pressed={!isLong} onClick={() => setIsLong(false)}>
              Short
            </button>
          </div>
        </div>

        <div className="field">
          <label className="label" htmlFor="margin">
            Margin (USD)
          </label>
          <input
            ref={marginRef}
            id="margin"
            className="input num"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            value={marginText}
            aria-invalid={!!errors.marginUsd}
            aria-describedby="margin-hint margin-err"
            onChange={(e) => setMarginText(e.target.value)}
          />
          <p id="margin-hint" className="hint num">
            Available {formatUsd(account?.available)}, limit {formatUsd(me?.limits.maxMarginUsd)}
          </p>
          <p id="margin-err" className="error">
            {errors.marginUsd}
          </p>
        </div>

        <div className="field">
          <div className="label-row">
            <label className="label" htmlFor="leverage">
              Leverage
            </label>
            <span className="lev-value num">{formatLeverage(lev)}</span>
          </div>
          <input
            ref={levRef}
            id="leverage"
            type="range"
            className="range"
            min={0}
            max={SLIDER_STEPS}
            step={1}
            value={leverageToSlider(lev, maxLev)}
            aria-valuetext={`${lev}x`}
            aria-describedby="lev-err"
            onChange={(e) => setLeverage(sliderToLeverage(Number(e.target.value), maxLev))}
          />
          <div className="presets" role="group" aria-label="Leverage presets">
            {LEVERAGE_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                className="seg-btn"
                aria-pressed={lev === p}
                disabled={p > maxLev}
                onClick={() => setLeverage(p)}
              >
                {p}x
              </button>
            ))}
          </div>
          <p id="lev-err" className="error">
            {errors.leverage}
          </p>
        </div>

        <div className="field-pair">
          <div className="field">
            <label className="label" htmlFor="tp">
              Take profit %
            </label>
            <input
              ref={tpRef}
              id="tp"
              className="input num"
              inputMode="decimal"
              autoComplete="off"
              placeholder="1.5"
              value={tpText}
              aria-invalid={!!errors.takeProfitPct}
              aria-describedby="tp-err"
              onChange={(e) => setTpText(e.target.value)}
            />
            <p id="tp-err" className="error">
              {errors.takeProfitPct}
            </p>
          </div>
          <div className="field">
            <label className="label" htmlFor="sl">
              Stop loss %
            </label>
            <input
              ref={slRef}
              id="sl"
              className="input num"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.5"
              value={slText}
              aria-invalid={!!errors.stopLossPct}
              aria-describedby="sl-err"
              onChange={(e) => setSlText(e.target.value)}
            />
            <p id="sl-err" className="error">
              {errors.stopLossPct}
            </p>
          </div>
        </div>

        <dl className="preview num" aria-label="Order preview">
          <div>
            <dt>Notional</dt>
            <dd>{formatUsd(size)}</dd>
          </div>
          <div>
            <dt>Entry (mark)</dt>
            <dd>{formatPrice(entry)}</dd>
          </div>
          <div>
            <dt>Bust price</dt>
            <dd className="bust">{formatPrice(bust)}</dd>
          </div>
          <div>
            <dt>Bust distance</dt>
            <dd>{(100 / lev).toFixed(3)}%</dd>
          </div>
          <div>
            <dt>TP price</dt>
            <dd className="profit">{tpPrice ? formatPrice(tpPrice) : "Off"}</dd>
          </div>
          <div>
            <dt>SL price</dt>
            <dd className="loss">{slPrice ? formatPrice(slPrice) : "Off"}</dd>
          </div>
        </dl>

        <button type="submit" className={`btn btn-primary btn-block ${isLong ? "btn-long" : "btn-short"}`} disabled={!ready}>
          Review {sideWord} {symbol}
        </button>
        {!ready && <p className="hint">The ticket opens once the account and market have loaded.</p>}
      </form>

      <Dialog open={!!c} title={c ? `Open ${c.isLong ? "long" : "short"} ${c.symbol}?` : ""} onClose={() => !sending && setConfirming(null)}>
        {c && (
          <>
            <dl className="confirm-list num">
              <div>
                <dt>Side</dt>
                <dd className={c.isLong ? "profit" : "loss"}>{c.isLong ? "Long" : "Short"}</dd>
              </div>
              <div>
                <dt>Size (notional)</dt>
                <dd>{formatUsd(notional(c.marginUsd, c.leverage))}</dd>
              </div>
              <div>
                <dt>Margin</dt>
                <dd>{formatUsd(c.marginUsd)}</dd>
              </div>
              <div>
                <dt>Leverage</dt>
                <dd>{formatLeverage(c.leverage)}</dd>
              </div>
              <div>
                <dt>Entry (est. mark)</dt>
                <dd>{formatPrice(confirmEntry)}</dd>
              </div>
              <div>
                <dt>Bust price</dt>
                <dd className="bust">{formatPrice(cBust)}</dd>
              </div>
              <div>
                <dt>Take profit</dt>
                <dd>{c.takeProfitPct ? `${c.takeProfitPct}% at ${formatPrice(triggerPrice(confirmEntry ?? 0, c.takeProfitPct, c.isLong, "tp"))}` : "Off"}</dd>
              </div>
              <div>
                <dt>Stop loss</dt>
                <dd>{c.stopLossPct ? `${c.stopLossPct}% at ${formatPrice(triggerPrice(confirmEntry ?? 0, c.stopLossPct, c.isLong, "sl"))}` : "Off"}</dd>
              </div>
            </dl>
            <p className="hint">
              Fills at the mark when the backend executes. A {(100 / c.leverage).toFixed(3)}% move against you loses the full margin.
            </p>
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setConfirming(null)} disabled={sending}>
                Cancel
              </button>
              <button
                type="button"
                className={`btn btn-primary ${c.isLong ? "btn-long" : "btn-short"}`}
                onClick={send}
                disabled={sending}
                autoFocus
              >
                {sending ? "Sending…" : `Open ${c.isLong ? "long" : "short"} ${formatLeverage(c.leverage)}`}
              </button>
            </div>
          </>
        )}
      </Dialog>
    </aside>
  );
});
