import {
  db,
  accounts,
  executions,
  journalDays,
  notes,
  playbooks,
  trades,
  attachments,
  noteTemplates,
  tradeRuleChecks,
  progressRules,
  progressChecks,
  missedTrades,
  folders,
  propAccounts,
  propEntries,
  propReceipts,
  propAudit,
  importSources,
  importSourceAliases,
  importBatches,
} from "@/db";
import { readFilters } from "@traderjourney/core";
import { queryTrades } from "@/server/trades-query";
import {
  getJournalDefaults,
  getMultipliers,
  getTimeZone,
  getImportTimeZone,
} from "@/server/settings";
import { handler, ok, requireValue } from "@/server/api";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildReviewPdf } from "@/lib/export-review";
import { tradeExportCsv, tradeExportDocument, validExportDates } from "@/lib/trade-export";
import { attachmentExportRecord, EXPORT_ATTACHMENTS_NOTE } from "@/lib/export-format";

/**
 * Full data export: your journal is yours. Credentials are deliberately
 * excluded: an export must be safe to share or move between machines.
 */
export const GET = handler(async (request: Request) => {
  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "json";
  const filters = readFilters(url.searchParams);
  if (format === "csv" || format === "pdf") {
    requireValue(validExportDates(filters.from, filters.to), "Invalid export date range.");
    const accountDetails = new Map(
      db
        .select({
          id: accounts.id,
          accountName: accounts.name,
          broker: accounts.broker,
          currency: accounts.currency,
        })
        .from(accounts)
        .all()
        .map((account) => [account.id, account]),
    );
    const rows = queryTrades(filters).rows.map((row) => {
      const account = accountDetails.get(row.accountId);
      return {
        ...row,
        accountName: account?.accountName ?? "",
        broker: account?.broker ?? "",
        currency: account?.currency ?? "",
      };
    });

    if (format === "pdf") {
      const doc = tradeExportDocument(rows, getTimeZone(), filters.from, filters.to);
      const font = await readFile(join(process.cwd(), "public/fonts/NotoSans-Regular.ttf"));
      const bytes = await buildReviewPdf(doc, font);
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": 'attachment; filename="trades.pdf"',
          "Cache-Control": "private, no-store",
        },
      });
    }

    if (format === "csv") {
      return new Response(tradeExportCsv(rows), {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": 'attachment; filename="trades.csv"',
        },
      });
    }
  }

  return ok({
    exportedAt: new Date().toISOString(),
    note: EXPORT_ATTACHMENTS_NOTE,
    accounts: db
      .select()
      .from(accounts)
      .all()
      .map(({ credentialsEnc: _omitted, ...safe }) => safe),
    executions: db.select().from(executions).all(),
    importSources: db.select().from(importSources).all(),
    importSourceAliases: db.select().from(importSourceAliases).all(),
    importBatches: db.select().from(importBatches).all(),
    trades: db.select().from(trades).all(),
    journalDays: db.select().from(journalDays).all(),
    notes: db.select().from(notes).all(),
    folders: db.select().from(folders).all(),
    playbooks: db.select().from(playbooks).all(),
    noteTemplates: db.select().from(noteTemplates).all(),
    tradeRuleChecks: db.select().from(tradeRuleChecks).all(),
    progressRules: db.select().from(progressRules).all(),
    progressChecks: db.select().from(progressChecks).all(),
    missedTrades: db.select().from(missedTrades).all(),
    propAccounts: db.select().from(propAccounts).all(),
    propEntries: db.select().from(propEntries).all(),
    propReceipts: db.select().from(propReceipts).all(),
    propAudit: db.select().from(propAudit).all(),
    journalDefaults: getJournalDefaults(),
    settings: {
      timeZone: getTimeZone(),
      importTimeZone: getImportTimeZone(),
      multipliers: getMultipliers(),
    },
    // Metadata only: attachment binaries stay in the data directory.
    attachments: db
      .select({
        id: attachments.id,
        ownerType: attachments.ownerType,
        ownerId: attachments.ownerId,
        name: attachments.name,
        mime: attachments.mime,
        size: attachments.size,
        createdAt: attachments.createdAt,
      })
      .from(attachments)
      .all()
      .map(attachmentExportRecord),
  });
});
