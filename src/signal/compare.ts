import type { BacktestResult } from "./backtest";
import type { ErlCandle } from "./types";

/** Minimal settled account trade; timestamps already normalised to Unix seconds. */
export interface AccountEntry {
  isLong: boolean;
  openedAtSec: number;
  pnlUsd: number;
}

export interface AlignmentGroup {
  count: number;
  wins: number;
  winRate: number | null;
}

export interface Alignment {
  with: AlignmentGroup;
  against: AlignmentGroup;
  none: AlignmentGroup;
  /** Entries outside the loaded candle range; not classified. */
  outside: number;
}

const group = (rows: AccountEntry[]): AlignmentGroup => {
  const wins = rows.filter((r) => r.pnlUsd > 0).length;
  return { count: rows.length, wins, winRate: rows.length ? (wins / rows.length) * 100 : null };
};

/**
 * Did each account entry happen while an ERL signal was in force (from its confirming close to
 * its exit), and on which side? A signal does not assert the account traded on it.
 */
export function compareAccount(
  entries: readonly AccountEntry[],
  candles: readonly ErlCandle[],
  bt: BacktestResult,
  timeframeSec: number,
): Alignment {
  const start = candles[0]?.t ?? Infinity;
  const end = (candles.at(-1)?.t ?? -Infinity) + timeframeSec;
  const windows = bt.trades.map((t) => ({
    from: t.candidate.confirmedAt,
    to: t.exitTime ?? Infinity,
    long: t.side === 1,
  }));
  if (bt.pending)
    windows.push({ from: bt.pending.confirmedAt, to: Infinity, long: bt.pending.side === 1 });
  const w: AccountEntry[] = [],
    a: AccountEntry[] = [],
    n: AccountEntry[] = [];
  let outside = 0;
  for (const e of entries) {
    if (!(e.openedAtSec >= start && e.openedAtSec < end)) {
      outside++;
      continue;
    }
    const hit = windows.find((x) => e.openedAtSec >= x.from && e.openedAtSec < x.to);
    if (!hit) n.push(e);
    else if (hit.long === e.isLong) w.push(e);
    else a.push(e);
  }
  return { with: group(w), against: group(a), none: group(n), outside };
}
