import { and, asc, eq, inArray } from "drizzle-orm";
import { matchesFilters, type AnalysisFilters, type AnnotatedTrade } from "@traderjourney/core";
import { getTimeZone, getMultipliers, getJournalDefaults } from "./settings";
import { db, trades, accounts } from "@/db";
import { requireValue } from "./api";

export function tradeCount(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  requireValue(/^[1-9]\d*$/.test(value) && Number(value) <= 1000, "Choose 1–1000 closed trades.");
  return Number(value);
}

export const newestClosed = (a: AnnotatedTrade, b: AnnotatedTrade) =>
  Date.parse(b.closedAt!) - Date.parse(a.closedAt!) || a.key.localeCompare(b.key);

export type TradeFilters = AnalysisFilters & { accountIds?: string[] };

export type TradeRow = typeof trades.$inferSelect;

const parseJsonArray = (value: string | null): string[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
};

const context = () => ({
  multipliers: getMultipliers(),
  defaults: getJournalDefaults(),
  bitunixAccountIds: new Set(
    db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.broker, "bitunix"))
      .all()
      .map((account) => account.id),
  ),
});
export const rowToTrade = (row: TradeRow, config = context()): AnnotatedTrade => {
  const configuredMultiplier = config.multipliers[row.symbol];
  // Bitunix linear USDT futures quantities are underlying-asset quantities, so
  // price-distance × quantity already yields the quote-currency risk amount.
  const multiplier =
    row.contractMultiplier ??
    configuredMultiplier ??
    (config.bitunixAccountIds.has(row.accountId) && row.assetClass === "futures" ? 1 : undefined);
  const defaults = config.defaults;
  const missingMultiplier =
    multiplier == null && ["futures", "option", "forex", "cfd"].includes(row.assetClass ?? "");
  const notional = missingMultiplier
    ? 0
    : Math.abs(row.avgEntry * row.quantity * (multiplier ?? 1));
  const tolerance =
    defaults.breakevenMode === "percent"
      ? (notional * defaults.breakeven) / 100
      : defaults.breakeven;
  const status =
    row.status === "open"
      ? "open"
      : Math.abs(row.netPnl) <= Math.max(1e-9, tolerance)
        ? "breakeven"
        : row.netPnl > 0
          ? "win"
          : "loss";
  return {
    key: row.key,
    accountId: row.accountId,
    symbol: row.symbol,
    assetClass: (row.assetClass ?? undefined) as AnnotatedTrade["assetClass"],
    direction: row.direction,
    status,
    contractMultiplier: multiplier,
    openedAt: row.openedAt,
    closedAt: row.closedAt ?? undefined,
    quantity: row.quantity,
    openQuantity: row.openQuantity,
    avgEntry: row.avgEntry,
    avgExit: row.avgExit ?? undefined,
    grossPnl: row.grossPnl,
    fees: row.fees,
    netPnl: row.netPnl,
    executionCount: row.executionCount,
    executionIds: parseJsonArray(row.executionIdsJson),
    exits: JSON.parse(row.exitsJson) as AnnotatedTrade["exits"],
    durationMs: row.durationMs ?? undefined,
    annotations: {
      tags: parseJsonArray(row.tagsJson),
      mistakes: parseJsonArray(row.mistakesJson),
      reasonForExit: parseJsonArray(row.reasonForExitJson),
      exitOutcome:
        row.exitOutcome === "SL hit" || row.exitOutcome === "TP hit" ? row.exitOutcome : undefined,
      totalPossibleR: row.totalPossibleR ?? undefined,
      volumeAfterTp:
        row.volumeAfterTp === "Up"
          ? "Up"
          : row.volumeAfterTp === "Down"
            ? "Down"
            : row.volumeAfterTp === "Flat"
              ? "Flat"
              : undefined,
      patternDuringTrade: parseJsonArray(row.priceActionJson),
      playbook: row.playbookId ?? undefined,
      rating: row.rating ?? undefined,
      stopLoss: row.stopLoss ?? undefined,
      profitTarget: row.profitTarget ?? undefined,
      reviewed: row.reviewedAt !== null,
    },
  };
};

/**
 * Narrow indexed identity fields before decoding rows. The core predicate
 * remains authoritative for timezone, risk and breakeven semantics.
 */
export const queryTrades = (
  filters: TradeFilters = {},
): { rows: TradeRow[]; trades: AnnotatedTrade[] } => {
  const effective = { ...filters, accounts: filters.accounts ?? filters.accountIds?.join(",") };
  const count = tradeCount(effective.lastTrades);
  const accountIds = effective.accounts
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const all = db
    .select()
    .from(trades)
    .where(
      and(
        accountIds?.length ? inArray(trades.accountId, accountIds) : undefined,
        effective.playbookId ? eq(trades.playbookId, effective.playbookId) : undefined,
        effective.direction
          ? eq(trades.direction, effective.direction as "long" | "short")
          : undefined,
        effective.assetClass ? eq(trades.assetClass, effective.assetClass) : undefined,
      ),
    )
    .orderBy(asc(trades.openedAt))
    .all();
  const timeZone = getTimeZone();
  const config = context();
  let pairs = all
    .map((row) => ({ row, trade: rowToTrade(row, config) }))
    .filter(({ trade }) => matchesFilters(trade, effective, timeZone));
  if (count !== undefined) {
    pairs = pairs
      .filter(({ trade }) => trade.status !== "open" && trade.closedAt)
      .sort((a, b) => newestClosed(a.trade, b.trade))
      .slice(0, count)
      .sort(
        (a, b) =>
          a.trade.openedAt.localeCompare(b.trade.openedAt) ||
          a.trade.key.localeCompare(b.trade.key),
      );
  }
  return {
    rows: pairs.map(({ row, trade }) => ({ ...row, status: trade.status })),
    trades: pairs.map((p) => p.trade),
  };
};

export const getTradeByKey = (key: string): TradeRow | undefined =>
  db.select().from(trades).where(eq(trades.key, key)).get();

/** Navigate chronologically within the active filters, with a stable tie-break for equal entries. */
export const getAdjacentTradeKeys = (
  currentKey: string,
  filters: TradeFilters = {},
  accountId?: string,
) => {
  const ordered = queryTrades(filters)
    .trades.filter((trade) => !accountId || trade.accountId === accountId)
    .sort((a, b) => {
      const time = Date.parse(a.openedAt) - Date.parse(b.openedAt);
      return time || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    });
  const index = ordered.findIndex((trade) => trade.key === currentKey);
  return {
    prevKey: index > 0 ? (ordered[index - 1]?.key ?? null) : null,
    nextKey: index >= 0 ? (ordered[index + 1]?.key ?? null) : null,
    position: index >= 0 ? index + 1 : null,
    total: ordered.length,
  };
};
