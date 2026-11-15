import { eq } from "drizzle-orm";
import { readFilters, computeMetrics, plannedR, tradeR } from "@traderjourney/core";
import { handler, ok } from "@/server/api";
import { getTimeZone } from "@/server/settings";
import { db, accounts, snapshots } from "@/db";
import { queryTrades, type TradeFilters } from "@/server/trades-query";
import { readExcursions, scheduleExcursions } from "@/server/excursions";

const filtersFrom = (url: URL): TradeFilters => readFilters(url.searchParams);

export const GET = handler(async (request: Request) => {
  const url = new URL(request.url);
  const entriesParam = Number.parseInt(url.searchParams.get("entries") ?? "", 10);
  const entries = Number.isInteger(entriesParam) && entriesParam > 0 ? entriesParam : null;
  let { rows, trades } = queryTrades(filtersFrom(url));
  // "Entries limit": keep the N most recent trades, matching the client-side
  // sort (openedAt desc, key desc), then restore ascending order for output.
  if (entries && trades.length > entries) {
    const order = trades
      .map((trade, index) => index)
      .sort(
        (a, b) =>
          Date.parse(trades[b]!.openedAt) - Date.parse(trades[a]!.openedAt) ||
          trades[b]!.key.localeCompare(trades[a]!.key),
      )
      .slice(0, entries)
      .sort(
        (a, b) =>
          Date.parse(trades[a]!.openedAt) - Date.parse(trades[b]!.openedAt) ||
          trades[a]!.key.localeCompare(trades[b]!.key),
      );
    rows = order.map((index) => rows[index]!);
    trades = order.map((index) => trades[index]!);
  }
  const timeZone = getTimeZone();
  const accountNames = new Map(
    db
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .all()
      .map((account) => [account.id, account.name]),
  );
  const metrics = computeMetrics(trades, { timeZone });
  const snapshotOwners = new Set(
    db
      .select({ ownerId: snapshots.ownerId })
      .from(snapshots)
      .where(eq(snapshots.ownerType, "trade"))
      .all()
      .map((snapshot) => snapshot.ownerId),
  );
  const listView = url.searchParams.get("view") === "list";
  const excursions = readExcursions(rows);
  scheduleExcursions(excursions.tasks);
  return ok({
    excursionsPending: excursions.pending,
    timeZone,
    trades: rows.map((row, index) => {
      const { notes, exitsJson, executionIdsJson, tagsJson, mistakesJson, ...summary } = row;
      const trade = trades[index]!;
      const multiplier = trade.contractMultiplier ?? 1;
      const entryNotional = Math.abs(row.avgEntry * row.quantity * multiplier);
      return {
        ...(listView ? summary : row),
        excursion: excursions.views.get(row.key),
        account: accountNames.get(row.accountId) ?? row.accountId,
        netEntryNotional: entryNotional > 0 ? row.netPnl / entryNotional : null,
        plannedR: plannedR(trade),
        realizedR: tradeR(trade),
        tags: trade.annotations?.tags ?? [],
        mistakes: trade.annotations?.mistakes ?? [],
        reviewed: row.reviewedAt !== null,
        hasSnapshot: snapshotOwners.has(row.key),
      };
    }),
    metrics,
  });
});
