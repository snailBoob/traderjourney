import type { TradeRow } from "@/server/trades-query";
import type { ReviewDocument } from "./export-review";
import { formatTimestamp } from "./timezone";

export type TradeExportRow = TradeRow & {
  accountName: string;
  broker: string;
  currency: string;
};

export function tradeExportCsv(rows: TradeExportRow[]): string {
  const header =
    "key,account_id,account_name,broker,currency,symbol,direction,status,opened_at,closed_at,quantity,avg_entry,avg_exit,gross_pnl,fees,net_pnl";
  const escape = (value: unknown): string => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    header,
    ...rows.map((row) =>
      [
        row.key,
        row.accountId,
        row.accountName,
        row.broker,
        row.currency,
        row.symbol,
        row.direction,
        row.status,
        row.openedAt,
        row.closedAt,
        row.quantity,
        row.avgEntry,
        row.avgExit,
        row.grossPnl,
        row.fees,
        row.netPnl,
      ]
        .map(escape)
        .join(","),
    ),
  ].join("\n");
}

export function validExportDates(from?: string, to?: string): boolean {
  const valid = (value?: string) =>
    !value ||
    (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value);
  return valid(from) && valid(to) && !(from && to && from > to);
}

export function tradeExportDocument(
  rows: TradeExportRow[],
  timeZone: string,
  from?: string,
  to?: string,
): ReviewDocument {
  return {
    title: "Trade export",
    subtitle: `${from || "Start"} – ${to || "Latest"} | ${timeZone} | ${rows.length} trades`,
    lines: rows.length
      ? rows.flatMap((row) => [
          `## ${row.symbol} · ${row.direction} · ${row.status}`,
          `Account: ${row.accountId} | Trade: ${row.key}`,
          `Account name: ${row.accountName} | Broker: ${row.broker} | Currency: ${row.currency}`,
          `Opened: ${formatTimestamp(row.openedAt, timeZone)}`,
          `Closed: ${row.closedAt ? formatTimestamp(row.closedAt, timeZone) : "Open"}`,
          `Quantity: ${row.quantity} | Entry: ${row.avgEntry} | Exit: ${row.avgExit ?? "—"}`,
          `Gross P&L: ${row.grossPnl} | Fees: ${row.fees} | Net P&L: ${row.netPnl}`,
          "",
        ])
      : ["No trades in the selected period."],
  };
}
