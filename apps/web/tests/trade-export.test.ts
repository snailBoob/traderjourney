import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import {
  validExportDates,
  tradeExportDocument,
  tradeExportCsv,
  type TradeExportRow,
} from "../src/lib/trade-export";
import { buildReviewPdf } from "../src/lib/export-review";

it("accepts inclusive and open-ended periods, rejects reversed and impossible dates", () => {
  expect(validExportDates()).toBe(true);
  expect(validExportDates("2026-11-07", "2026-11-07")).toBe(true);
  expect(validExportDates(undefined, "2026-11-07")).toBe(true);
  expect(validExportDates("2026-11-08", "2026-11-07")).toBe(false);
  expect(validExportDates("2026-02-30")).toBe(false);
  expect(validExportDates("not-a-date")).toBe(false);
});

it("exports financial details and account context without private analysis in CSV and PDF", async () => {
  const row = {
    key: "trade-1",
    accountId: "account-1",
    accountName: 'Trading, "main"',
    broker: "ibkr",
    currency: "EUR",
    symbol: "ES",
    direction: "long",
    status: "win",
    openedAt: "2026-11-07T12:00:00Z",
    closedAt: "2026-11-07T13:00:00Z",
    quantity: 2,
    avgEntry: 6000,
    avgExit: 6010,
    grossPnl: 1000,
    fees: 4,
    netPnl: 996,
    notes: "Review café\n".repeat(100) + "FINAL NOTE",
    tagsJson: '["PRIVATE TAG"]',
    mistakesJson: '["PRIVATE MISTAKE"]',
    reasonForExitJson: '["PRIVATE REASON"]',
    priceActionJson: '["PRIVATE PATTERN"]',
  } as TradeExportRow;
  const doc = tradeExportDocument([row], "Europe/Amsterdam", "2026-11-07", "2026-11-07");
  expect(doc.lines.join("\n")).toContain("Net P&L: 996");
  expect(doc.lines.join("\n")).toContain(
    'Account name: Trading, "main" | Broker: ibkr | Currency: EUR',
  );
  const csv = tradeExportCsv([row]);
  expect(csv.split("\n")[0]).toBe(
    "key,account_id,account_name,broker,currency,symbol,direction,status,opened_at,closed_at,quantity,avg_entry,avg_exit,gross_pnl,fees,net_pnl",
  );
  expect(csv).toContain('"Trading, ""main""",ibkr,EUR');
  expect(csv).toContain(",1000,4,996");
  for (const output of [csv, doc.lines.join("\n")]) {
    expect(output).not.toMatch(
      /FINAL NOTE|PRIVATE|Tags:|Mistakes:|Exit reasons:|Outcome:|Total possible R:|Volume after TP:|Pattern during trade:|Notes:/,
    );
  }
  expect(doc.subtitle).toContain("1 trades");
  const font = readFileSync(new URL("../public/fonts/NotoSans-Regular.ttf", import.meta.url));
  const pdf = await PDFDocument.load(await buildReviewPdf(doc, font));
  expect(pdf.getPageCount()).toBe(1);
  expect(pdf.getTitle()).toBe("Trade export");
});

it("explains an empty result in the exported document", () => {
  expect(tradeExportDocument([], "UTC").lines).toEqual(["No trades in the selected period."]);
});
