import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normaliseAddress,
  readRecent,
  RECENT_KEY,
  rememberAddress,
} from "./address";
import {
  httpBackend,
  normaliseCandles,
  readAllPages,
  type Candle,
  type Trade,
} from "./api";
import { accountMarkers } from "./chartOverlays";
import { csv } from "./csv";
const address = `0x${"Ab".repeat(20)}`;
afterEach(() => vi.unstubAllGlobals());
describe("address validation and history", () => {
  it("validates exact hex length, trims whitespace and normalizes case", () => {
    expect(normaliseAddress(`  ${address} `)).toBe(address.toLowerCase());
    for (const bad of [
      "",
      "0x",
      address + "0",
      address.slice(0, -1),
      `0x${"g".repeat(40)}`,
      "name.eth",
      address + "\nother",
    ])
      expect(normaliseAddress(bad)).toBeNull();
  });
  it("keeps last 10 unique addresses with nickname persistence and promotion", () => {
    let list = [{ address: address.toLowerCase(), nickname: "My desk" }];
    for (let i = 1; i < 12; i++)
      list = rememberAddress(list, `0x${i.toString(16).padStart(40, "0")}`);
    expect(list).toHaveLength(10);
    expect(list[0].address.endsWith("0b")).toBe(true);
    list = rememberAddress(list, address.toLowerCase(), "Research");
    list = rememberAddress(list, address.toLowerCase());
    expect(list[0].nickname).toBe("Research");
    expect(list).toHaveLength(10);
  });
  it("handles corrupt/unavailable storage and sanitizes duplicates", () => {
    expect(readRecent({ getItem: () => "bad json" })).toEqual([]);
    expect(
      readRecent({
        getItem: () => {
          throw Error("blocked");
        },
      }),
    ).toEqual([]);
    expect(
      readRecent({
        getItem: (key) =>
          key === RECENT_KEY
            ? JSON.stringify([
                { address, nickname: "Desk" },
                { address: address.toLowerCase() },
                { address: "nope" },
              ])
            : null,
      }),
    ).toEqual([{ address: address.toLowerCase(), nickname: "Desk" }]);
  });
});
describe("GET-only backend contract", () => {
  it("uses the exact account paths and never sends a request body", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", fetcher);
    await httpBackend.markets();
    await httpBackend.candles("BTC", "15m", 1000);
    await httpBackend.summary(address);
    await httpBackend.portfolio(address, "all");
    await httpBackend.positions(address);
    await httpBackend.trades(address, "next+=", 75);
    await httpBackend.cashflows(address);
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual([
      "/api/markets",
      "/api/candles?symbol=BTC&tf=15m&limit=1000",
      `/api/accounts/${address.toLowerCase()}/summary`,
      `/api/accounts/${address.toLowerCase()}/portfolio?range=all`,
      `/api/accounts/${address.toLowerCase()}/positions`,
      `/api/accounts/${address.toLowerCase()}/trades?cursor=next%2B%3D&limit=75`,
      `/api/accounts/${address.toLowerCase()}/cashflows?cursor=&limit=75`,
    ]);
    for (const call of fetcher.mock.calls) {
      expect(call[1].method).toBe("GET");
      expect(call[1].body).toBeUndefined();
    }
  });
  it("treats 404 account responses as an empty account but retains server errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404 }),
    );
    expect((await httpBackend.summary(address)).equity).toBe(0);
    expect(await httpBackend.positions(address)).toEqual([]);
    expect((await httpBackend.trades(address)).items).toEqual([]);
    expect((await httpBackend.cashflows(address)).items).toEqual([]);
    expect((await httpBackend.portfolio(address, "1d")).points).toEqual([]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503 }),
    );
    await expect(httpBackend.summary(address)).rejects.toThrow("HTTP 503");
  });
  it("reads all cursor pages and rejects a cursor loop or cancelled work", async () => {
    const calls: string[] = [];
    const result = await readAllPages(async (c) => {
      calls.push(c);
      return c
        ? { items: [3], nextCursor: null }
        : { items: [1, 2], nextCursor: "next" };
    });
    expect(result).toEqual([1, 2, 3]);
    expect(calls).toEqual(["", "next"]);
    await expect(
      readAllPages(async () => ({ items: [], nextCursor: "loop" })),
    ).rejects.toThrow("repeated");
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      readAllPages(async () => ({ items: [], nextCursor: null }), ctrl.signal),
    ).rejects.toThrow("Aborted");
  });
  it("normalizes, orders and deduplicates candle times", () => {
    const c = (t: number): Candle => ({ t, o: 1, h: 2, l: 0, c: 1, v: 1 });
    expect(
      normaliseCandles([c(1800000001000), c(1800000000), c(1800000000000)]).map(
        (c) => c.t,
      ),
    ).toEqual([1800000000, 1800000001]);
  });
});
describe("chart account overlays", () => {
  const start = 1793491200;
  const bars = Array.from({ length: 20 }, (_, i) => ({
    t: start + 900 * i,
    o: 100,
    h: 102,
    l: 98,
    c: 101,
    v: 1,
  }));
  const trade = (id: string, kind: Trade["kind"], isLong = true): Trade => ({
    positionId: id,
    symbol: "BTC",
    isLong,
    kind,
    marginUsd: 100,
    leverage: 10,
    entry: 100,
    exit: 101,
    pnlUsd: 1,
    feeUsd: 0,
    paperMinted: 0,
    openedAt: (start + 500) * 1000,
    closedAt: (start + 1800) * 1000,
    txHash: null,
  });
  it("draws long/short entries, exits and hot-pink X LIQ at matching candle times", () => {
    const result = accountMarkers(
      bars,
      [trade("l", "Closed"), trade("s", "Liquidated", false)],
      [],
      "BTC",
      "15m",
    );
    expect(result).toMatchObject({ visible: 4, total: 4 });
    expect(result.markers[0]).toMatchObject({
      shape: "arrowUp",
      position: "belowBar",
      color: "#22c55e",
    });
    expect(result.markers[1]).toMatchObject({
      shape: "arrowDown",
      position: "aboveBar",
      color: "#ef4444",
    });
    expect(
      result.markers.some((m) => m.text === "✕ LIQ" && m.color === "#FF2D78"),
    ).toBe(true);
    expect(
      result.markers.some((m) => m.shape === "square" && m.size === 0.55),
    ).toBe(true);
  });
  it("deduplicates entry events, excludes other markets and reports unavailable timestamps", () => {
    const result = accountMarkers(
      bars,
      [
        trade("a", "Opened"),
        trade("a", "Closed"),
        { ...trade("other", "Closed"), symbol: "ETH" },
        { ...trade("old", "Opened"), openedAt: 1 },
      ],
      [],
      "BTC",
      "15m",
    );
    expect(result).toMatchObject({ visible: 2, total: 3 });
  });
});
describe("CSV", () => {
  it("quotes separators, escapes quotes and prevents spreadsheet formulas without changing negative numbers", () => {
    expect(csv([["a,b", 'say "hi"', "=1+1", "\t@SUM(A1)", -12.5, null]])).toBe(
      '\uFEFF"a,b","say ""hi""","\'=1+1","\'\t@SUM(A1)","-12.5",""',
    );
  });
});
