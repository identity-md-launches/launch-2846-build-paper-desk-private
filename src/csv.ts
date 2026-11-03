import type { Cashflow, Trade } from "./api";
import { formatDateTime } from "./format";
const cell = (value: unknown): string => {
  const text = value === null || value === undefined ? "" : String(value);
  // Spreadsheet formula injection can also start after whitespace.
  const safe =
    /^\s*[=+@-]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)
      ? `'${text}`
      : text;
  return `"${safe.replaceAll('"', '""')}"`;
};
export const csv = (rows: unknown[][]) =>
  "\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n");
export function tradesCsv(trades: Trade[]): string {
  return csv([
    [
      "Position ID",
      "Market",
      "Side",
      "Outcome",
      "Margin USD",
      "Leverage",
      "Entry",
      "Exit",
      "PnL USD",
      "Fee USD",
      "PAPER minted",
      "Opened UTC",
      "Closed UTC",
      "Transaction hash",
    ],
    ...trades.map((t) => [
      t.positionId,
      t.symbol,
      t.isLong ? "Long" : "Short",
      t.kind,
      t.marginUsd,
      t.leverage,
      t.entry,
      t.exit,
      t.pnlUsd,
      t.feeUsd,
      t.paperMinted,
      formatDateTime(t.openedAt),
      t.closedAt ? formatDateTime(t.closedAt) : "",
      t.txHash,
    ]),
  ]);
}
export function cashflowsCsv(rows: Cashflow[]): string {
  return csv([
    ["Time UTC", "Kind", "Amount USD", "Route", "Status", "Transaction hash"],
    ...rows.map((c) => [
      formatDateTime(c.t),
      c.kind,
      c.amountUsd,
      c.route,
      c.status,
      c.txHash,
    ]),
  ]);
}
export function downloadCsv(name: string, body: string): void {
  const url = URL.createObjectURL(
    new Blob([body], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
