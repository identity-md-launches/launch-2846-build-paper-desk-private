// Typed client for our own backend. Every request is a same-origin relative path under /api;
// the app never talks to Papertrade, Hyperliquid or any third party, and never handles a key.

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

/** Timestamps are accepted as unix seconds, unix milliseconds or ISO strings (see format.toMs). */
export type Timestamp = number | string;

export interface Me {
  user: string;
  wallet: string;
  sessionKey: { address: string; expiresAt: Timestamp };
  limits: { maxMarginUsd: number; maxLeverage: number };
}

export interface Market {
  instrumentId: number | string;
  symbol: string;
  mark: number;
  change24hPct: number;
  longOi: number;
  shortOi: number;
  maxLeverage: number;
}

export interface Candle {
  /** Bar open time, unix seconds (milliseconds are normalised on receipt). */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface Account {
  equity: number;
  available: number;
  marginInUse: number;
  openPnl: number;
  queuedBalance: number;
}

export interface Position {
  positionId: string;
  symbol: string;
  isLong: boolean;
  sizeUsd: number;
  marginUsd: number;
  leverage: number;
  entry: number;
  mark: number;
  pnlUsd: number;
  pnlPct: number;
  bustPrice: number;
  openedAt: Timestamp;
  /** Optional trigger prices; the chart draws TP / SL lines only when the backend sends them. */
  takeProfit?: number | null;
  stopLoss?: number | null;
}

export interface ClosedTrade {
  positionId: string;
  symbol: string;
  isLong: boolean;
  sizeUsd: number;
  leverage: number;
  entry: number;
  exit: number;
  pnlUsd: number;
  fees: number;
  openedAt: Timestamp;
  closedAt: Timestamp;
}

export interface OpenOrder {
  symbol: string;
  isLong: boolean;
  marginUsd: number;
  leverage: number;
  takeProfitPct?: number;
  stopLossPct?: number;
}

export type IntentStatus = "queued" | "confirmed" | "failed" | "reverted" | "expired" | "cancelled";
export const TERMINAL_STATUSES: IntentStatus[] = ["confirmed", "failed", "reverted", "expired", "cancelled"];

export interface IntentAck {
  intentId: string;
  status: IntentStatus;
}

export interface Intent {
  status: IntentStatus;
  error?: string;
}

export type MarkUpdate = { symbol: string; mark: number; t?: Timestamp };

export type StreamMessage =
  | { type: "mark"; data: MarkUpdate | MarkUpdate[] }
  | { type: "positions"; data: Position[] }
  | { type: "account"; data: Account }
  | { type: "intent"; data: Intent & { intentId: string } };

export type StreamState = "connecting" | "live" | "reconnecting";

export interface Backend {
  readonly mock: boolean;
  me(): Promise<Me>;
  markets(): Promise<Market[]>;
  candles(symbol: string, tf: Timeframe, limit: number, signal?: AbortSignal): Promise<Candle[]>;
  account(): Promise<Account>;
  positions(): Promise<Position[]>;
  history(limit: number): Promise<ClosedTrade[]>;
  openOrder(order: OpenOrder): Promise<IntentAck>;
  closePositions(positionIds: string[]): Promise<IntentAck>;
  closeAll(): Promise<IntentAck>;
  intent(intentId: string): Promise<Intent>;
  /** Opens the push stream; returns a function that closes it for good. */
  stream(onMessage: (m: StreamMessage) => void, onState: (s: StreamState) => void): () => void;
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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "same-origin",
    headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) },
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      detail = body.error ?? body.message ?? "";
    } catch {
      /* not JSON */
    }
    throw new ApiError(detail || `HTTP ${res.status}`, res.status, `${API_BASE}${path}`);
  }
  return (await res.json()) as T;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

/** Reconnect delay: 500ms doubling to a 15s ceiling, with up to 20% jitter. */
export function backoffDelay(attempt: number, random = Math.random): number {
  const base = Math.min(15000, 500 * 2 ** attempt);
  return Math.round(base * (1 - 0.2 * random()));
}

function normaliseCandles(rows: Candle[]): Candle[] {
  return rows
    .map((r) => ({ ...r, t: r.t > 1e12 ? Math.floor(r.t / 1000) : r.t }))
    .sort((a, b) => a.t - b.t)
    .filter((r, i, all) => i === 0 || r.t !== all[i - 1].t);
}

function openStream(onMessage: (m: StreamMessage) => void, onState: (s: StreamState) => void): () => void {
  let ws: WebSocket | null = null;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const connect = () => {
    if (closed) return;
    onState(attempt === 0 ? "connecting" : "reconnecting");
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${scheme}://${location.host}${API_BASE}/stream`);
    ws.onopen = () => {
      attempt = 0;
      onState("live");
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as StreamMessage;
        if (msg && typeof msg === "object" && "type" in msg) onMessage(msg);
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
      ws = null;
      if (closed) return;
      onState("reconnecting");
      timer = setTimeout(connect, backoffDelay(attempt++));
    };
    ws.onerror = () => ws?.close();
  };

  connect();
  return () => {
    closed = true;
    clearTimeout(timer);
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
  };
}

export const httpBackend: Backend = {
  mock: false,
  me: () => request<Me>("/me"),
  markets: () => request<Market[]>("/markets"),
  candles: async (symbol, tf, limit, signal) =>
    normaliseCandles(
      await request<Candle[]>(
        `/candles?symbol=${encodeURIComponent(symbol)}&tf=${tf}&limit=${limit}`,
        { signal },
      ),
    ),
  account: () => request<Account>("/account"),
  positions: () => request<Position[]>("/positions"),
  history: (limit) => request<ClosedTrade[]>(`/history?limit=${limit}`),
  openOrder: (order) => post<IntentAck>("/orders/open", order),
  closePositions: (positionIds) => post<IntentAck>("/orders/close", { positionIds }),
  closeAll: () => post<IntentAck>("/orders/close-all"),
  intent: (intentId) => request<Intent>(`/intents/${encodeURIComponent(intentId)}`),
  stream: openStream,
};

/** Mock mode: VITE_MOCK=1 at build time, or ?mock=1 in the page URL. */
export function mockRequested(): boolean {
  if (import.meta.env.VITE_MOCK === "1") return true;
  try {
    return new URLSearchParams(location.search).get("mock") === "1";
  } catch {
    return false;
  }
}

export async function getBackend(): Promise<Backend> {
  if (!mockRequested()) return httpBackend;
  const { createMockBackend } = await import("./mock");
  return createMockBackend();
}
