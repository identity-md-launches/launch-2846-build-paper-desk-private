import { describe, expect, it } from "vitest";
import { extend, longSetup } from "./signal/fixtures";
import { analyseErl, BUILDER_SENSITIVITY, closedAtFetch, invalidText } from "./useErl";

describe("ERL view helpers", () => {
  it("keeps only rows closed at fetch time", () => {
    const rows = longSetup();
    const last = rows.at(-1)!;
    expect(closedAtFetch(rows, "1m", last.t + 59)).toHaveLength(rows.length - 1);
    expect(closedAtFetch(rows, "1m", last.t + 60)).toHaveLength(rows.length);
  });
  it("surfaces a rejected series instead of a zero-trade success", () => {
    const rows = longSetup().map((b, i) => (i === 3 ? { ...b, v: -1 } : b));
    const r = analyseErl(rows, "BTC", "1m", rows.at(-1)!.t + 60);
    expect(r.erl.status).toBe("INVALID");
    expect(r.invalid?.code).toBe("INVALID_ROW");
    expect(r.invalid?.index).toBe(3);
    expect(invalidText(r.invalid!)).toContain("INVALID_ROW");
    const ok = analyseErl(longSetup(), "BTC", "1m", longSetup().at(-1)!.t + 60);
    expect(ok.invalid).toBeNull();
  });
  it("recomputes the 0.5% builder scenario through the payout profile", () => {
    const rows = extend(longSetup(), [[100.06, 100.5, 100.05, 100.4]]);
    const now = rows.at(-1)!.t + 60;
    const base = analyseErl(rows, "BTC", "1m", now);
    const b = analyseErl(rows, "BTC", "1m", now, BUILDER_SENSITIVITY);
    expect(base.prof.builderFee).toBe(0);
    expect(b.prof.builderFee).toBe(0.005);
    expect(b.prof.label).toContain("builder 0.5%");
    expect(base.bt.trades[0].pnl!).toBeGreaterThan(0);
    expect(b.bt.trades[0].pnl!).toBeCloseTo((base.bt.trades[0].pnl! * 0.975) / 0.98, 12);
  });
});
