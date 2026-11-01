// Mock mode: an in-browser stand-in for the /api backend so the UI runs without a server.
// Everything here is synthetic and the header labels the session MOCK DATA.

import {
  TIMEFRAME_SECONDS,
  type Account,
  type Backend,
  type Candle,
  type ClosedTrade,
  type Intent,
  type IntentAck,
  type Market,
  type Me,
  type OpenOrder,
  type Position,
  type StreamMessage,
  type StreamState,
  type Timeframe,
} from "./api";
import { bustPrice, triggerPrice } from "./indicators";

/** Mulberry32: small deterministic PRNG so candles are stable across reloads. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

const SEED_MARKETS: Market[] = [
  { instrumentId: 0, symbol: "BTC", mark: 97240.5, change24hPct: 1.84, longOi: 4_812_330.12, shortOi: 3_905_118.4, maxLeverage: 1000 },
  { instrumentId: 1, symbol: "ETH", mark: 3412.07, change24hPct: -0.62, longOi: 2_140_905.55, shortOi: 2_388_210.9, maxLeverage: 1000 },
];

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const round2 = (n: number) => Math.round(n * 100) / 100;

export function createMockBackend(): Backend {
  const rand = prng(20261101);
  const marks = new Map(SEED_MARKETS.map((m) => [m.symbol, m.mark]));
  const startBalance = 10_000;
  let realised = 412.38;
  let queued = 0;
  let seq = 3;
  const now = Date.now();
  const listeners = new Set<(m: StreamMessage) => void>();
  const intents = new Map<string, Intent>();
  const candleCache = new Map<string, Candle[]>();

  const mkPosition = (
    id: string,
    symbol: string,
    isLong: boolean,
    marginUsd: number,
    leverage: number,
    entry: number,
    openedAt: number,
    tpPct?: number,
    slPct?: number,
  ): Position => ({
    positionId: id,
    symbol,
    isLong,
    marginUsd,
    leverage,
    sizeUsd: marginUsd * leverage,
    entry,
    mark: entry,
    pnlUsd: 0,
    pnlPct: 0,
    bustPrice: bustPrice(entry, leverage, isLong),
    openedAt,
    takeProfit: tpPct ? triggerPrice(entry, tpPct, isLong, "tp") : null,
    stopLoss: slPct ? triggerPrice(entry, slPct, isLong, "sl") : null,
  });

  let positions: Position[] = [
    mkPosition("p-1", "BTC", true, 250, 50, 96610.25, now - 3.2 * 3600_000, 1.5, 0.8),
    mkPosition("p-2", "ETH", false, 120, 25, 3448.9, now - 50 * 60_000, undefined, 2),
    mkPosition("p-3", "BTC", false, 60, 200, 97480.0, now - 12 * 60_000),
  ];

  const history: ClosedTrade[] = Array.from({ length: 14 }, (_, i) => {
    const symbol = i % 3 === 1 ? "ETH" : "BTC";
    const isLong = i % 2 === 0;
    const leverage = [10, 25, 50, 100, 250, 500][i % 6];
    const margin = [50, 80, 120, 200, 40, 25][i % 6];
    const base = symbol === "BTC" ? 96000 + i * 115 : 3380 + i * 6.5;
    const move = (((i * 37) % 11) - 4.5) / 1000;
    const exit = base * (1 + move);
    const sizeUsd = margin * leverage;
    const fees = round2(sizeUsd * 0.0004);
    const pnl = round2(sizeUsd * (isLong ? move : -move) - fees);
    const closedAt = now - (i + 1) * 5.5 * 3600_000;
    return {
      positionId: `h-${i + 1}`,
      symbol,
      isLong,
      sizeUsd,
      leverage,
      entry: base,
      exit,
      pnlUsd: Math.max(pnl, -margin),
      fees,
      openedAt: closedAt - (20 + i * 9) * 60_000,
      closedAt,
    };
  });

  const revalue = () => {
    positions = positions.map((p) => {
      const mark = marks.get(p.symbol) ?? p.mark;
      const move = (mark - p.entry) / p.entry;
      const pnlUsd = Math.max(p.sizeUsd * (p.isLong ? move : -move), -p.marginUsd);
      return { ...p, mark, pnlUsd: round2(pnlUsd), pnlPct: (pnlUsd / p.marginUsd) * 100 };
    });
  };

  const account = (): Account => {
    const marginInUse = positions.reduce((s, p) => s + p.marginUsd, 0);
    const openPnl = positions.reduce((s, p) => s + p.pnlUsd, 0);
    const equity = startBalance + realised + openPnl;
    return {
      equity: round2(equity),
      available: round2(Math.max(0, startBalance + realised - marginInUse - queued)),
      marginInUse: round2(marginInUse),
      openPnl: round2(openPnl),
      queuedBalance: round2(queued),
    };
  };

  const emit = (m: StreamMessage) => listeners.forEach((l) => l(m));

  const closeIds = (ids: string[]) => {
    for (const p of positions.filter((x) => ids.includes(x.positionId))) {
      const fees = round2(p.sizeUsd * 0.0004);
      realised += p.pnlUsd - fees;
      history.unshift({
        positionId: p.positionId,
        symbol: p.symbol,
        isLong: p.isLong,
        sizeUsd: p.sizeUsd,
        leverage: p.leverage,
        entry: p.entry,
        exit: p.mark,
        pnlUsd: round2(p.pnlUsd - fees),
        fees,
        openedAt: p.openedAt,
        closedAt: Date.now(),
      });
    }
    positions = positions.filter((x) => !ids.includes(x.positionId));
  };

  /** Queue an intent, settle it after a short delay, and push every change on the stream. */
  const runIntent = (work: () => string | null, reserve = 0): IntentAck => {
    const intentId = `int-${Date.now().toString(36)}-${(seq++).toString(36)}`;
    intents.set(intentId, { status: "queued" });
    queued += reserve;
    emit({ type: "intent", data: { intentId, status: "queued" } });
    emit({ type: "account", data: account() });
    setTimeout(() => {
      queued = Math.max(0, queued - reserve);
      const error = work();
      const result: Intent = error ? { status: "failed", error } : { status: "confirmed" };
      intents.set(intentId, result);
      revalue();
      emit({ type: "intent", data: { intentId, ...result } });
      emit({ type: "positions", data: positions });
      emit({ type: "account", data: account() });
    }, 1400);
    return { intentId, status: "queued" };
  };

  const genCandles = (symbol: string, tf: Timeframe, limit: number): Candle[] => {
    const key = `${symbol}:${tf}`;
    const step = TIMEFRAME_SECONDS[tf];
    const cached = candleCache.get(key);
    const nowSec = Math.floor(Date.now() / 1000);
    const lastOpen = Math.floor(nowSec / step) * step;
    if (cached && cached[cached.length - 1].t === lastOpen) return cached.slice(-limit);
    const r = prng(symbol.charCodeAt(0) * 7919 + step);
    const vol = 0.00045 * Math.sqrt(step / 60);
    const end = marks.get(symbol) ?? 100;
    // Walk backwards from the current mark so the last close meets the live price.
    const closes: number[] = [end];
    let drift = 0;
    for (let i = 1; i < limit; i++) {
      drift = drift * 0.9 + gaussian(r) * vol * 0.08;
      const shock = r() < 0.015 ? gaussian(r) * vol * 3 : 0;
      closes.unshift(closes[0] * (1 - drift - gaussian(r) * vol - shock));
    }
    const out: Candle[] = closes.map((c, i) => {
      const o = i === 0 ? c * (1 + gaussian(r) * vol * 0.3) : closes[i - 1];
      const span = Math.abs(gaussian(r)) * vol * c * 0.6;
      return {
        t: lastOpen - (limit - 1 - i) * step,
        o,
        h: Math.max(o, c) + span * r(),
        l: Math.min(o, c) - span * r(),
        c,
        v: Math.round((50 + r() * 400) * (step / 60) ** 0.5 * 100) / 100,
      };
    });
    candleCache.set(key, out);
    return out;
  };

  return {
    mock: true,
    async me(): Promise<Me> {
      await delay(120);
      return {
        user: "desk",
        wallet: "0x7a3fE0c9B21d44a6e85f0C3a91b2D7e4c5A8f912",
        sessionKey: { address: "0x51cB09aE77d3F1e2b0a4C68D9e3f2A1b7c6D4e05", expiresAt: Date.now() + 11 * 3600_000 + 42 * 60_000 },
        limits: { maxMarginUsd: 2500, maxLeverage: 1000 },
      };
    },
    async markets() {
      await delay(100);
      return SEED_MARKETS.map((m) => ({ ...m, mark: marks.get(m.symbol) ?? m.mark }));
    },
    async candles(symbol, tf, limit, signal) {
      await delay(180);
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return genCandles(symbol, tf, Math.min(limit, 1000));
    },
    async account() {
      await delay(90);
      revalue();
      return account();
    },
    async positions() {
      await delay(90);
      revalue();
      return positions;
    },
    async history(limit) {
      await delay(110);
      return history.slice(0, limit);
    },
    async openOrder(order: OpenOrder) {
      await delay(150);
      const reserve = order.marginUsd;
      return runIntent(() => {
        if (order.marginUsd > account().available + reserve) return "Margin exceeds available balance";
        const entry = marks.get(order.symbol);
        if (!entry) return `Unknown market ${order.symbol}`;
        positions = [
          mkPosition(`p-${seq++}`, order.symbol, order.isLong, order.marginUsd, order.leverage, entry, Date.now(), order.takeProfitPct, order.stopLossPct),
          ...positions,
        ];
        return null;
      }, reserve);
    },
    async closePositions(ids) {
      await delay(150);
      return runIntent(() => {
        if (!positions.some((p) => ids.includes(p.positionId))) return "Position already closed";
        closeIds(ids);
        return null;
      });
    },
    async closeAll() {
      await delay(150);
      return runIntent(() => {
        if (!positions.length) return "No open positions";
        closeIds(positions.map((p) => p.positionId));
        return null;
      });
    },
    async intent(intentId) {
      await delay(80);
      return intents.get(intentId) ?? { status: "expired", error: "Unknown intent" };
    },
    stream(onMessage, onState: (s: StreamState) => void) {
      listeners.add(onMessage);
      onState("connecting");
      const open = setTimeout(() => onState("live"), 300);
      const tick = setInterval(() => {
        for (const [symbol, mark] of marks) {
          const next = mark * (1 + gaussian(rand) * 0.00035);
          marks.set(symbol, next);
          onMessage({ type: "mark", data: { symbol, mark: next, t: Date.now() } });
        }
        revalue();
        onMessage({ type: "positions", data: positions });
        onMessage({ type: "account", data: account() });
      }, 1000);
      return () => {
        clearTimeout(open);
        clearInterval(tick);
        listeners.delete(onMessage);
      };
    },
  };
}
