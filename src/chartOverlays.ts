import type { SeriesMarker, Time, UTCTimestamp } from "lightweight-charts";
import {
  TIMEFRAME_SECONDS,
  type Candle,
  type Position,
  type Timeframe,
  type Trade,
} from "./api";
import { toMs } from "./format";
import { settledTrades } from "./stats";
/** Account markers share the candle's timestamp; timestamps outside loaded history stay unplotted. */
export function accountMarkers(
  bars: readonly Candle[],
  trades: readonly Trade[],
  positions: readonly Position[],
  symbol: string,
  tf: Timeframe,
): { markers: SeriesMarker<Time>[]; visible: number; total: number } {
  const times = new Set(bars.map((b) => b.t));
  const step = TIMEFRAME_SECONDS[tf];
  const markers: SeriesMarker<Time>[] = [];
  let total = 0,
    visible = 0;
  const at = (timestamp: number | string | null): UTCTimestamp | null => {
    const ms = toMs(timestamp);
    if (ms === null) return null;
    const t = Math.floor(ms / 1000 / step) * step;
    return times.has(t) ? (t as UTCTimestamp) : null;
  };
  const entries = new Map<string, Trade | Position>();
  for (const t of trades) if (t.symbol === symbol) entries.set(t.positionId, t);
  for (const p of positions)
    if (p.symbol === symbol) entries.set(p.positionId, p);
  for (const p of entries.values()) {
    total++;
    const time = at(p.openedAt);
    if (time === null) continue;
    visible++;
    markers.push({
      time,
      position: p.isLong ? "belowBar" : "aboveBar",
      shape: p.isLong ? "arrowUp" : "arrowDown",
      color: p.isLong ? "#22c55e" : "#ef4444",
      text: "",
      size: 1.2,
    });
  }
  for (const t of settledTrades(trades)) {
    if (t.symbol !== symbol) continue;
    total++;
    const time = at(t.closedAt);
    if (time === null) continue;
    visible++;
    // v5 has no X marker shape. A zero-size shape leaves the literal X and LIQ label as the marker.
    markers.push(
      t.kind === "Liquidated"
        ? {
            time,
            position: "aboveBar",
            shape: "square",
            color: "#FF2D78",
            text: "✕ LIQ",
            size: 0,
          }
        : {
            time,
            position: t.isLong ? "aboveBar" : "belowBar",
            shape: "square",
            color: "#c7bca6",
            text: "",
            size: 0.55,
          },
    );
  }
  return {
    markers: markers.sort((a, b) => Number(a.time) - Number(b.time)),
    visible,
    total,
  };
}
