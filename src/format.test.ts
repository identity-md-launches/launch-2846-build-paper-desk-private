import { describe, expect, it } from "vitest";
import {
  formatCountdown,
  formatLeverage,
  formatPct,
  formatPrice,
  formatUsd,
  formatUsdCompact,
  parseAmount,
  shortAddress,
  toMs,
} from "./format";
import { backoffDelay } from "./api";
import { LEVERAGE_PRESETS, leverageToSlider, sliderToLeverage, validateTicket } from "./leverage";

describe("formatPrice", () => {
  it("chooses decimals by magnitude", () => {
    expect(formatPrice(97123.5)).toBe("97,123.50");
    expect(formatPrice(3412.0712)).toBe("3,412.07");
    expect(formatPrice(1.23456)).toBe("1.2346");
    expect(formatPrice(0.5)).toBe("0.5000");
  });

  it("keeps four significant digits below a penny", () => {
    expect(formatPrice(0.00001234)).toBe("0.00001234");
    expect(formatPrice(0.004215)).toBe("0.004215");
  });

  it("prints missing values as --", () => {
    expect(formatPrice(null)).toBe("--");
    expect(formatPrice(NaN)).toBe("--");
  });
});

describe("formatUsd", () => {
  it("is a fixed two-decimal grouped string", () => {
    expect(formatUsd(1234567.891)).toBe("$1,234,567.89");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(-12.5)).toBe("-$12.50");
    expect(formatUsd(3, { sign: true })).toBe("+$3.00");
  });

  it("never rounds a sub-penny amount to $0.00", () => {
    expect(formatUsd(0.0042)).toBe("$0.004200");
    expect(formatUsd(-0.0001)).toBe("-$0.0001000");
  });

  it("never falls back to exponent notation", () => {
    expect(formatUsd(1e22)).toBe("$10,000,000,000,000,000,000,000.00");
  });

  it("does not print -$0.00", () => {
    expect(formatUsd(-0)).toBe("$0.00");
  });

  it("compacts large amounts with fixed decimals", () => {
    expect(formatUsdCompact(12_345_678)).toBe("$12.35M");
    expect(formatUsdCompact(1_200_000_000)).toBe("$1.20B");
    expect(formatUsdCompact(845_100)).toBe("$845.10K");
    expect(formatUsdCompact(999.5)).toBe("$999.50");
  });
});

describe("misc formatting", () => {
  it("formats percent and leverage", () => {
    expect(formatPct(1.234)).toBe("+1.23%");
    expect(formatPct(-0.4)).toBe("-0.40%");
    expect(formatPct(-0.004)).toBe("0.00%");
    expect(formatLeverage(50)).toBe("50x");
    expect(formatLeverage(2.5)).toBe("2.5x");
  });

  it("shortens addresses", () => {
    expect(shortAddress("0x7a3fE0c9B21d44a6e85f0C3a91b2D7e4c5A8f912")).toBe("0x7a3f…f912");
  });

  it("normalises seconds, milliseconds and ISO time", () => {
    expect(toMs(1_700_000_000)).toBe(1_700_000_000_000);
    expect(toMs(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(toMs("2026-11-01T00:00:00Z")).toBe(Date.UTC(2026, 10, 1));
    expect(toMs("nope")).toBeNull();
  });

  it("counts down to session key expiry", () => {
    const now = 1_800_000_000_000;
    expect(formatCountdown(now + (11 * 3600 + 4 * 60) * 1000, now)).toBe("11h 04m");
    expect(formatCountdown(now + (3 * 86400 + 2 * 3600) * 1000, now)).toBe("3d 02h");
    expect(formatCountdown(now + 45_000, now)).toBe("45s");
    expect(formatCountdown(now - 1, now)).toBe("expired");
  });

  it("parses typed amounts", () => {
    expect(parseAmount("1,250.5")).toBe(1250.5);
    expect(parseAmount(" $300 ")).toBe(300);
    expect(parseAmount(".5")).toBe(0.5);
    expect(parseAmount("abc")).toBeNaN();
    expect(parseAmount("")).toBeNaN();
  });
});

describe("leverage slider", () => {
  it("spans 1x to the max on a log scale", () => {
    expect(sliderToLeverage(0, 1000)).toBe(1);
    expect(sliderToLeverage(1000, 1000)).toBe(1000);
    expect(sliderToLeverage(500, 1000)).toBe(32); // sqrt(1000)
  });

  it("round-trips the presets it can represent exactly", () => {
    for (const p of [10, 50, 100, 1000]) expect(sliderToLeverage(leverageToSlider(p, 1000), 1000)).toBe(p);
    expect(LEVERAGE_PRESETS).toEqual([10, 50, 100, 250, 500, 1000]);
  });

  it("clamps to the market maximum", () => {
    expect(sliderToLeverage(1000, 200)).toBe(200);
    expect(leverageToSlider(500, 200)).toBe(1000);
  });
});

describe("validateTicket", () => {
  const limits = { available: 1000, maxMarginUsd: 500, maxLeverage: 1000 };
  const ok = { marginUsd: 100, leverage: 50, takeProfitPct: null, stopLossPct: null };

  it("accepts a valid order", () => {
    expect(validateTicket(ok, limits)).toEqual({});
  });

  it("explains margin problems as the fix", () => {
    expect(validateTicket({ ...ok, marginUsd: NaN }, limits).marginUsd).toBe("Enter a margin above $0.");
    expect(validateTicket({ ...ok, marginUsd: 600 }, limits).marginUsd).toMatch(/at most \$500\.00/);
    expect(validateTicket({ ...ok, marginUsd: 400 }, { ...limits, available: 300 }).marginUsd).toMatch(/available/);
  });

  it("rejects a stop loss beyond the bust distance", () => {
    expect(validateTicket({ ...ok, leverage: 100, stopLossPct: 1 }, limits).stopLossPct).toMatch(/less than 1\.000%/);
    expect(validateTicket({ ...ok, leverage: 100, stopLossPct: 0.5 }, limits)).toEqual({});
  });
});

describe("stream backoff", () => {
  it("doubles from 500ms to a 15s ceiling with bounded jitter", () => {
    expect(backoffDelay(0, () => 0)).toBe(500);
    expect(backoffDelay(3, () => 0)).toBe(4000);
    expect(backoffDelay(10, () => 0)).toBe(15000);
    expect(backoffDelay(10, () => 1)).toBe(12000);
  });
});
