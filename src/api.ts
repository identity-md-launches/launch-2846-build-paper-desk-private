/** Read-only client. Every network request is a GET to this origin's /api. */
export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
export const TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "1h", "4h", "1d"];
export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
};
export type Timestamp = number | string;
export interface Market {
  instrumentId: number;
  symbol: string;
  mark: number;
  change24hPct: number;
  volume24hUsd: number;
}
export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}
export interface Summary {
  address: string;
  equity: number;
  pnl: number;
  paperMinted: number;
  stakingRewards: number;
  asOf: Timestamp;
}
export type PortfolioRange = "1d" | "1w" | "all";
export interface PortfolioPoint {
  t: Timestamp;
  equity: number;
  pnl: number;
}
export interface Portfolio {
  points: PortfolioPoint[];
}
export interface Position {
  positionId: string;
  symbol: string;
  isLong: boolean;
  marginUsd: number;
  leverage: number;
  sizeUsd: number;
  entry: number;
  mark: number;
  pnlUsd: number;
  pnlPct: number;
  bustPrice: number;
  openedAt: Timestamp;
}
export type TradeKind =
  "Closed" | "Liquidated" | "TakeProfit" | "StopLoss" | "Opened";
export interface Trade {
  positionId: string;
  symbol: string;
  isLong: boolean;
  kind: TradeKind;
  marginUsd: number;
  leverage: number;
  entry: number;
  exit: number | null;
  pnlUsd: number;
  feeUsd: number;
  paperMinted: number;
  openedAt: Timestamp;
  closedAt: Timestamp | null;
  txHash: string | null;
}
export interface Cashflow {
  t: Timestamp;
  kind: "Deposit" | "Withdrawal";
  amountUsd: number;
  route: string;
  status: string;
  txHash: string | null;
}
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
export interface Backend {
  readonly mock: boolean;
  markets(signal?: AbortSignal): Promise<Market[]>;
  candles(
    symbol: string,
    tf: Timeframe,
    limit: number,
    signal?: AbortSignal,
  ): Promise<Candle[]>;
  summary(address: string, signal?: AbortSignal): Promise<Summary>;
  portfolio(
    address: string,
    range: PortfolioRange,
    signal?: AbortSignal,
  ): Promise<Portfolio>;
  positions(address: string, signal?: AbortSignal): Promise<Position[]>;
  trades(
    address: string,
    cursor?: string,
    limit?: number,
    signal?: AbortSignal,
  ): Promise<Page<Trade>>;
  cashflows(
    address: string,
    cursor?: string,
    limit?: number,
    signal?: AbortSignal,
  ): Promise<Page<Cashflow>>;
}
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export const API_BASE = "/api";
async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 12_000);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      // Display status, not arbitrary server text, to keep errors concise and trustworthy.
      throw new ApiError(
        `HTTP ${res.status}`,
        res.status,
        `${API_BASE}${path}`,
      );
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}
const accountPath = (address: string) => {
  if (!/^0x[0-9a-f]{40}$/i.test(address))
    throw new Error("Use a public 0x address with 40 hexadecimal characters.");
  return `/accounts/${address.toLowerCase()}`;
};
async function emptyOnUnknown<T>(work: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return empty;
    throw err;
  }
}
export function normaliseCandles(rows: Candle[]): Candle[] {
  return rows
    .map((r) => ({
      ...r,
      t: r.t > 1e12 ? Math.floor(r.t / 1000) : Math.floor(r.t),
    }))
    .sort((a, b) => a.t - b.t)
    .filter((r, i, all) => i === 0 || r.t !== all[i - 1].t);
}
export const httpBackend: Backend = {
  mock: false,
  markets: (signal) => get<Market[]>("/markets", signal),
  candles: async (symbol, tf, limit, signal) =>
    normaliseCandles(
      await get<Candle[]>(
        `/candles?symbol=${encodeURIComponent(symbol)}&tf=${tf}&limit=${Math.min(1000, limit)}`,
        signal,
      ),
    ),
  summary: (address, signal) =>
    emptyOnUnknown(
      () => get<Summary>(`${accountPath(address)}/summary`, signal),
      {
        address,
        equity: 0,
        pnl: 0,
        paperMinted: 0,
        stakingRewards: 0,
        asOf: Date.now(),
      },
    ),
  portfolio: (address, range, signal) =>
    emptyOnUnknown(
      () =>
        get<Portfolio>(
          `${accountPath(address)}/portfolio?range=${range}`,
          signal,
        ),
      { points: [] },
    ),
  positions: (address, signal) =>
    emptyOnUnknown(
      () => get<Position[]>(`${accountPath(address)}/positions`, signal),
      [],
    ),
  trades: (address, cursor = "", limit = 75, signal) =>
    emptyOnUnknown(
      () =>
        get<Page<Trade>>(
          `${accountPath(address)}/trades?cursor=${encodeURIComponent(cursor)}&limit=${limit}`,
          signal,
        ),
      { items: [], nextCursor: null },
    ),
  cashflows: (address, cursor = "", limit = 75, signal) =>
    emptyOnUnknown(
      () =>
        get<Page<Cashflow>>(
          `${accountPath(address)}/cashflows?cursor=${encodeURIComponent(cursor)}&limit=${limit}`,
          signal,
        ),
      { items: [], nextCursor: null },
    ),
};
/** Exhaust cursor pages for complete client-side stats, filtering and CSV exports. */
export async function readAllPages<T>(
  load: (cursor: string) => Promise<Page<T>>,
  signal?: AbortSignal,
): Promise<T[]> {
  let cursor = "";
  const seen = new Set<string>();
  const rows: T[] = [];
  do {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (seen.has(cursor))
      throw new Error(
        "The backend repeated a history cursor. Retry loading the account.",
      );
    seen.add(cursor);
    const page = await load(cursor);
    rows.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  } while (true);
  return rows;
}
export function mockRequested(): boolean {
  return (
    import.meta.env.VITE_MOCK === "1" ||
    new URLSearchParams(location.search).get("mock") === "1"
  );
}
export async function getBackend(): Promise<Backend> {
  if (!mockRequested()) return httpBackend;
  return (await import("./mock")).createMockBackend();
}
