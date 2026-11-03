import { describe, expect, it } from "vitest";
import {
  formatDateTime,
  formatLeverage,
  formatPct,
  formatPrice,
  formatUsd,
  formatUsdCompact,
  shortAddress,
  toMs,
} from "./format";

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
    expect(shortAddress("0x7a3fE0c9B21d44a6e85f0C3a91b2D7e4c5A8f912")).toBe(
      "0x7a3f…f912",
    );
  });

  it("normalises seconds, milliseconds and ISO time", () => {
    expect(toMs(1_700_000_000)).toBe(1_700_000_000_000);
    expect(toMs(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(toMs("2026-11-01T00:00:00Z")).toBe(Date.UTC(2026, 10, 1));
    expect(toMs("nope")).toBeNull();
  });

  it("always formats UTC regardless of the browser timezone", () => {
    expect(formatDateTime("2026-11-03T05:06:00-05:00")).toBe(
      "2026-11-03 10:06",
    );
    expect(formatDateTime(null)).toBe("--");
  });
});
