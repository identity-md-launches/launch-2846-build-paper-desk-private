import type {
  Backend,
  Candle,
  Cashflow,
  Market,
  Page,
  PortfolioPoint,
  Position,
  Summary,
  Timeframe,
  Trade,
} from "./api";
import { TIMEFRAME_SECONDS } from "./api";

const hash = (s: string) =>
  [...s].reduce(
    (n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0,
    2166136261,
  );
function random(seed: number) {
  let s = seed || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const round = (n: number) => Math.round(n * 100) / 100;
const delay = (signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const aborted = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", aborted);
      resolve();
    }, 140);
    signal?.addEventListener("abort", aborted, { once: true });
  });

/** Synthetic fixtures only; generated separately for every pasted public address. No network. */
export function createMockBackend(): Backend {
  const epoch = Math.floor(Date.now() / 900_000) * 900_000;
  const baseMarks: Record<string, number> = { BTC: 97425.5, ETH: 3412.8 };
  const candleCache = new Map<string, Candle[]>();
  const accounts = new Map<
    string,
    {
      trades: Trade[];
      positions: Position[];
      cashflows: Cashflow[];
      summary: Summary;
    }
  >();
  const mark = (symbol: string) =>
    round(
      baseMarks[symbol] *
        (1 + Math.sin(Math.floor(Date.now() / 5000) / 20) * 0.0002),
    );
  const bars = (symbol: string, tf: Timeframe): Candle[] => {
    const key = `${symbol}:${tf}`;
    const step = TIMEFRAME_SECONDS[tf];
    const last = Math.floor(Date.now() / 1000 / step) * step;
    const cached = candleCache.get(key);
    if (cached?.at(-1)?.t === last) return cached;
    const r = random(hash(key));
    const vol = 0.00065 * Math.sqrt(step / 60);
    const closes = [baseMarks[symbol]];
    for (let i = 1; i < 1000; i++)
      closes.unshift(closes[0] * (1 + (r() - 0.5) * vol * 2));
    const result = closes.map((c, i): Candle => {
      const o = closes[Math.max(0, i - 1)];
      const span = c * vol * (0.15 + r() * 0.5);
      return {
        t: last - (999 - i) * step,
        o,
        h: Math.max(o, c) + span,
        l: Math.min(o, c) - span * r(),
        c,
        v: round(20 + r() * 180),
      };
    });
    candleCache.set(key, result);
    return result;
  };
  const account = (address: string) => {
    const cached = accounts.get(address);
    if (cached) return cached;
    const r = random(hash(address));
    const trades: Trade[] = [];
    for (let i = 0; i < 158; i++) {
      const symbol = r() > 0.42 ? "BTC" : "ETH",
        isLong = r() > 0.45;
      const openedAt = epoch - (i * 81 + 30 + Math.floor(r() * 30)) * 60_000;
      const hold = (6 + Math.floor(r() * 160)) * 60_000;
      const closedAt = Math.min(epoch - 60_000, openedAt + hold);
      const candle =
        bars(symbol, "15m").find(
          (b) => b.t === Math.floor(openedAt / 900_000) * 900,
        )?.c ?? baseMarks[symbol];
      const entry = round(candle * (1 + (r() - 0.5) * 0.003));
      const marginUsd = round(100 + r() * 900),
        leverage = [10, 20, 25, 50, 75, 100][Math.floor(r() * 6)];
      const roll = r(),
        kind =
          roll < 0.08
            ? "Liquidated"
            : roll < 0.25
              ? "TakeProfit"
              : roll < 0.4
                ? "StopLoss"
                : "Closed";
      const feeUsd = round(marginUsd * leverage * 0.0001);
      const gross =
        kind === "Liquidated"
          ? -marginUsd
          : kind === "StopLoss"
            ? -marginUsd * (0.08 + r() * 0.36)
            : marginUsd * (r() < 0.69 ? 0.04 + r() * 0.68 : -r() * 0.35);
      const exit = round(
        entry * (1 + ((isLong ? 1 : -1) * gross) / (marginUsd * leverage)),
      );
      trades.push({
        positionId: `mock-position-${i}`,
        symbol,
        isLong,
        kind,
        marginUsd,
        leverage,
        entry,
        exit,
        pnlUsd: round(gross - feeUsd),
        feeUsd,
        paperMinted: round(Math.max(0, gross) * 0.08),
        openedAt,
        closedAt,
        txHash: null,
      });
    }
    const positions: Position[] = ["BTC", "ETH", "BTC"].map((symbol, i) => {
      const isLong = i !== 2,
        leverage = [100, 50, 75][i],
        marginUsd = [850, 420, 1200][i];
      const entry = round(
        baseMarks[symbol] *
          (1 + (i === 0 ? -0.0018 : i === 1 ? 0.0012 : 0.0025)),
      );
      const openedAt = epoch - (i + 1) * 55 * 60_000;
      trades.push({
        positionId: `mock-open-${i}`,
        symbol,
        isLong,
        kind: "Opened",
        marginUsd,
        leverage,
        entry,
        exit: null,
        pnlUsd: 0,
        feeUsd: round(marginUsd * leverage * 0.00005),
        paperMinted: 0,
        openedAt,
        closedAt: null,
        txHash: null,
      });
      return {
        positionId: `mock-open-${i}`,
        symbol,
        isLong,
        marginUsd,
        leverage,
        sizeUsd: marginUsd * leverage,
        entry,
        mark: mark(symbol),
        pnlUsd: 0,
        pnlPct: 0,
        bustPrice: round(entry * (1 + (isLong ? -1 : 1) / leverage)),
        openedAt,
      };
    });
    trades.sort(
      (a, b) =>
        Number(b.closedAt ?? b.openedAt) - Number(a.closedAt ?? a.openedAt),
    );
    const cashflows: Cashflow[] = Array.from({ length: 83 }, (_, i) => ({
      t: epoch - (i * 165 + 15) * 60_000,
      kind: i % 5 === 0 ? "Withdrawal" : "Deposit",
      amountUsd: round(50 + r() * 450),
      route: i % 3 === 0 ? "HyperEVM bridge" : "Papertrade balance",
      status: i === 0 ? "Pending" : "Completed",
      txHash: null,
    }));
    const pnl = round(
      trades
        .filter((t) => t.kind !== "Opened")
        .reduce((s, t) => s + t.pnlUsd, 0),
    );
    const summary: Summary = {
      address,
      equity: round(25000 + pnl),
      pnl,
      paperMinted: round(trades.reduce((s, t) => s + t.paperMinted, 0)),
      stakingRewards: round(30 + r() * 160),
      asOf: Date.now(),
    };
    const result = { trades, positions, cashflows, summary };
    accounts.set(address, result);
    return result;
  };
  const positions = (address: string) =>
    account(address).positions.map((p) => {
      const price = mark(p.symbol),
        pnlUsd = round(
          ((p.sizeUsd * (price - p.entry)) / p.entry) * (p.isLong ? 1 : -1),
        );
      return {
        ...p,
        mark: price,
        pnlUsd,
        pnlPct: (pnlUsd / p.marginUsd) * 100,
      };
    });
  const page = <T>(items: T[], cursor = "", limit = 75): Page<T> => {
    const start = Number(cursor) || 0;
    return {
      items: items.slice(start, start + limit),
      nextCursor: start + limit < items.length ? String(start + limit) : null,
    };
  };
  return {
    mock: true,
    async markets(signal) {
      await delay(signal);
      return ["BTC", "ETH"].map((symbol, instrumentId): Market => ({
        instrumentId,
        symbol,
        mark: mark(symbol),
        change24hPct: symbol === "BTC" ? 1.87 : -0.64,
        volume24hUsd: symbol === "BTC" ? 184250320 : 92410850,
      }));
    },
    async candles(symbol, tf, limit, signal) {
      await delay(signal);
      return bars(symbol, tf)
        .slice(-limit)
        .map((b) => ({ ...b }));
    },
    async summary(address, signal) {
      await delay(signal);
      const a = account(address);
      return {
        ...a.summary,
        equity: round(
          a.summary.equity +
            positions(address).reduce((s, p) => s + p.pnlUsd, 0),
        ),
        asOf: Date.now(),
      };
    },
    async positions(address, signal) {
      await delay(signal);
      return positions(address);
    },
    async trades(address, cursor, limit, signal) {
      await delay(signal);
      return page(account(address).trades, cursor, limit);
    },
    async cashflows(address, cursor, limit, signal) {
      await delay(signal);
      return page(account(address).cashflows, cursor, limit);
    },
    async portfolio(address, range, signal) {
      await delay(signal);
      const a = account(address);
      const duration =
        range === "1d"
          ? 86400_000
          : range === "1w"
            ? 7 * 86400_000
            : 10 * 86400_000;
      const start = epoch - duration;
      const points: PortfolioPoint[] = Array.from({ length: 150 }, (_, i) => {
        const t = start + Math.floor((duration * i) / 149);
        const pnl = a.trades
          .filter((tr) => tr.closedAt !== null && Number(tr.closedAt) <= t)
          .reduce((s, tr) => s + tr.pnlUsd, 0);
        const open = Math.sin(i / 6) * 35;
        return { t, equity: round(25000 + pnl + open), pnl: round(pnl + open) };
      });
      points[points.length - 1] = {
        t: Date.now(),
        equity: round(
          a.summary.equity +
            positions(address).reduce((s, p) => s + p.pnlUsd, 0),
        ),
        pnl: a.summary.pnl,
      };
      return { points };
    },
  };
}
