import { and, eq, inArray } from "drizzle-orm";
import type { ImportedExecution } from "@traderjourney/importers";
import { db, executions, accounts, trades, tradeRuleChecks, snapshots } from "@/db";
import { executionHash, newId, nowIso } from "./ids";
import { rebuildAccount } from "./rebuild";
import { getJournalDefaults } from "./settings";
import { defaultFee } from "@/lib/journal-defaults";
import { requireValue } from "./api";

export interface InsertResult {
  inserted: number;
  duplicates: number;
  /** Rows dropped because a broker or file record was unusable (sync/import only). */
  skipped: number;
  /** A few plain-language reasons for skipped rows, capped so payloads stay small. */
  skippedReasons: string[];
  tradeKeys?: string[];
  tradeKey?: string;
}

export type ExecutionSource = "sync" | "import" | "manual";

const MAX_SKIP_REASONS = 5;

/** Keep the saved TradingView image attached to a trade when rebuilding changes its key. */
const moveTradeSnapshot = (fromKey: string, toKey: string): void => {
  if (!fromKey || !toKey || fromKey === toKey) return;
  db.transaction((tx) => {
    const source = tx
      .select({ id: snapshots.id })
      .from(snapshots)
      .where(and(eq(snapshots.ownerType, "trade"), eq(snapshots.ownerId, fromKey)))
      .get();
    if (!source) return;
    // The source trade is the one being edited/rekeyed; keep its image if a
    // rebuilt destination already has a snapshot, since only one image can own a key.
    tx.delete(snapshots)
      .where(and(eq(snapshots.ownerType, "trade"), eq(snapshots.ownerId, toKey)))
      .run();
    tx.update(snapshots)
      .set({ ownerId: toKey })
      .where(and(eq(snapshots.ownerType, "trade"), eq(snapshots.ownerId, fromKey)))
      .run();
  });
};

const isFiniteNumber = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Plain-language reason a row can't be journaled, or null when the row is valid. */
export const executionProblem = (row: unknown, source: ExecutionSource): string | null => {
  if (!row || typeof row !== "object") return "Execution is missing.";
  const r = row as Partial<ImportedExecution>;
  const label = typeof r.symbol === "string" && r.symbol.trim() ? r.symbol.trim() : "execution";
  if (typeof r.symbol !== "string" || !r.symbol.trim()) return "An execution has no symbol.";
  if (!["buy", "sell"].includes(r.side as string)) return `${label}: side must be buy or sell.`;
  if (!isFiniteNumber(r.quantity) || r.quantity <= 0)
    return `${label}: quantity must be a finite positive number.`;
  if (!isFiniteNumber(r.price)) return `${label}: price must be a finite number.`;
  if (!isFiniteNumber(r.fee ?? 0)) return `${label}: fee must be a finite number.`;
  if (typeof r.executedAt !== "string" || !Number.isFinite(Date.parse(r.executedAt)))
    return `${label}: timestamp is missing or invalid.`;
  const meta = r.importMetadata;
  const metaOk =
    !meta ||
    ((source === "import" || source === "sync") &&
      typeof meta.id === "string" &&
      meta.id.length > 0 &&
      meta.id.length <= 2000 &&
      (meta.group === undefined ||
        (typeof meta.group === "string" && meta.group.length > 0 && meta.group.length <= 2000)) &&
      Number.isSafeInteger(meta.order) &&
      meta.order >= 0 &&
      (meta.reportedGrossPnl === undefined || Number.isFinite(meta.reportedGrossPnl)) &&
      (meta.preserveFee === undefined || typeof meta.preserveFee === "boolean") &&
      (meta.contractMultiplier === undefined ||
        (Number.isFinite(meta.contractMultiplier) && meta.contractMultiplier > 0)) &&
      (meta.positionEffect === undefined || ["open", "close"].includes(meta.positionEffect)));
  if (!metaOk) return `${label}: invalid imported execution metadata.`;
  return null;
};

/**
 * Split a batch into usable rows and skip reasons. Manual entry is strict: the
 * whole batch is rejected on the first bad row. Broker syncs and file imports
 * are lenient: one odd record must not fail the entire batch, so bad rows are
 * dropped and counted for the caller to report.
 */
export const partitionExecutions = (
  rows: ImportedExecution[],
  source: ExecutionSource,
): { usable: ImportedExecution[]; skipped: number; skippedReasons: string[] } => {
  const usable: ImportedExecution[] = [];
  const skippedReasons: string[] = [];
  let skipped = 0;
  for (const row of rows) {
    const problem = executionProblem(row, source);
    if (problem === null) {
      usable.push(row);
      continue;
    }
    if (source === "manual") {
      requireValue(
        false,
        "Every execution needs a symbol, buy/sell side, finite positive quantity, price, fee and valid timestamp.",
      );
    }
    skipped++;
    if (skippedReasons.length < MAX_SKIP_REASONS) skippedReasons.push(problem);
  }
  return { usable, skipped, skippedReasons };
};

/** Insert fills, rebuild materialized trades after commit, and attach optional manual notes. */
export const insertExecutions = (
  accountId: string,
  rows: ImportedExecution[],
  source: ExecutionSource,
  manualNotes?: string,
  options: { preserveFees?: boolean } = {},
): InsertResult => {
  requireValue(
    manualNotes === undefined ||
      (source === "manual" && typeof manualNotes === "string" && manualNotes.length <= 100000),
    "Manual trade notes must be at most 100,000 characters.",
  );
  requireValue(
    db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId)).get(),
    "Account not found.",
  );
  const { usable, skipped, skippedReasons } = partitionExecutions(rows, source);
  requireValue(
    !usable.some((row) => row.ninjaTrader || row.importMetadata?.group?.startsWith("ninjatrader")),
    "NinjaTrader fills require the reviewed import endpoint.",
  );
  let inserted = 0;
  let duplicates = 0;
  const createdAt = nowIso();
  const defaults = getJournalDefaults();
  const note = manualNotes?.trim() ? manualNotes : undefined;
  const noteExecutionIds = new Set<string>();
  const submittedExecutionIds = new Set<string>();

  // Keep inserted executions, rebuilt trades and appended notes atomic. Nested
  // Drizzle transactions use savepoints on the same SQLite connection, so any
  // rebuild or note-validation failure rolls the entire submission back.
  return db.transaction(() => {
    db.transaction((tx) => {
      if (source === "import") {
        const existingHashes = new Set(
          tx
            .select({ hash: executions.contentHash })
            .from(executions)
            .where(and(eq(executions.accountId, accountId), eq(executions.source, "import")))
            .all()
            .map((row) => row.hash),
        );
        for (const row of usable) {
          if (existingHashes.has(executionHash(row))) continue;
          const candidates = [row.legacyExecutedAt, row.executedAt.replace(/\.\d{3}Z$/, ".000Z")];
          requireValue(
            !candidates.some(
              (executedAt) =>
                executedAt &&
                executedAt !== row.executedAt &&
                existingHashes.has(executionHash({ ...row, executedAt })),
            ),
            "Matching imported fills have timestamps from an older parser or indistinguishable whole-second executions. Import the complete corrected history into a new journal account and compare it before retiring the old account; nothing was saved.",
          );
        }
      }
      for (const row of usable) {
        const id = newId();
        const contentHash = executionHash(row);
        const result = tx
          .insert(executions)
          .values({
            id,
            accountId,
            symbol: row.symbol,
            side: row.side,
            quantity: row.quantity,
            price: row.price,
            fee:
              row.importMetadata?.preserveFee || options.preserveFees
                ? row.fee
                : defaultFee(row.fee, row.quantity, accountId, row.symbol, defaults),
            executedAt: row.executedAt,
            assetClass: row.assetClass ?? null,
            source,
            importMetadataJson: row.importMetadata ? JSON.stringify(row.importMetadata) : null,
            contentHash,
            createdAt,
          })
          .onConflictDoNothing()
          .run();
        if (result.changes > 0) {
          inserted++;
          submittedExecutionIds.add(id);
          if (note) noteExecutionIds.add(id);
        } else {
          duplicates++;
          const existing = tx
            .select({ id: executions.id })
            .from(executions)
            .where(
              and(eq(executions.accountId, accountId), eq(executions.contentHash, contentHash)),
            )
            .get();
          if (existing) {
            submittedExecutionIds.add(existing.id);
            if (note) noteExecutionIds.add(existing.id);
          }
        }
      }
    });

    if (inserted > 0 || duplicates > 0) rebuildAccount(accountId);

    if (note) {
      db.transaction((tx) => {
        const affected = tx
          .select({
            key: trades.key,
            notes: trades.notes,
            executionIdsJson: trades.executionIdsJson,
          })
          .from(trades)
          .where(eq(trades.accountId, accountId))
          .all();
        for (const trade of affected) {
          const ids = JSON.parse(trade.executionIdsJson) as string[];
          if (!ids.some((id) => noteExecutionIds.has(id))) continue;
          // Keep prior annotations when these fills extend or close an existing position.
          // Retrying the same submission must not append the note a second time.
          if (trade.notes === note || trade.notes?.endsWith(`\n\n${note}`)) continue;
          const notes = trade.notes?.trim() ? `${trade.notes}\n\n${note}` : note;
          requireValue(
            notes.length <= 100000,
            "Combined trade notes must be at most 100,000 characters.",
          );
          tx.update(trades).set({ notes }).where(eq(trades.key, trade.key)).run();
        }
      });
    }

    const affectedTrades = db
      .select({ key: trades.key, executionIdsJson: trades.executionIdsJson })
      .from(trades)
      .where(eq(trades.accountId, accountId))
      .all()
      .filter((trade) =>
        (JSON.parse(trade.executionIdsJson) as string[]).some((id) =>
          submittedExecutionIds.has(id),
        ),
      );
    const tradeKeys = affectedTrades.map((trade) => trade.key);
    const primaryExecutionId = submittedExecutionIds.values().next().value as string | undefined;
    const tradeKey = primaryExecutionId
      ? affectedTrades.find((trade) =>
          (JSON.parse(trade.executionIdsJson) as string[]).includes(primaryExecutionId),
        )?.key
      : undefined;
    return { inserted, duplicates, skipped, skippedReasons, tradeKeys, tradeKey };
  });
};

export interface UpdateExecutionInput {
  symbol?: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  fee: number;
  executedAt: string;
}

/** Update one execution, rebuild the account, and return the trade now containing it. */
export const updateExecution = (
  executionId: string,
  input: UpdateExecutionInput,
): string | null => {
  const existing = db.select().from(executions).where(eq(executions.id, executionId)).get();
  requireValue(existing, "Execution not found.");
  requireValue(
    input.symbol === undefined ||
      (typeof input.symbol === "string" && input.symbol.trim().length > 0),
    "Symbol is required.",
  );
  requireValue(input.quantity > 0, "Quantity must be greater than zero.");
  requireValue(Number.isFinite(input.price), "Price must be a finite number.");
  requireValue(Number.isFinite(input.fee), "Fee must be a finite number.");
  requireValue(Number.isFinite(Date.parse(input.executedAt)), "Timestamp is invalid.");

  const oldTrade = db
    .select({
      key: trades.key,
      notes: trades.notes,
      tagsJson: trades.tagsJson,
      mistakesJson: trades.mistakesJson,
      reasonForExitJson: trades.reasonForExitJson,
      exitOutcome: trades.exitOutcome,
      totalPossibleR: trades.totalPossibleR,
      volumeAfterTp: trades.volumeAfterTp,
      priceActionJson: trades.priceActionJson,
      playbookId: trades.playbookId,
      rating: trades.rating,
      stopLoss: trades.stopLoss,
      profitTarget: trades.profitTarget,
      reviewedAt: trades.reviewedAt,
      tradingViewUrl: trades.tradingViewUrl,
      executionIdsJson: trades.executionIdsJson,
    })
    .from(trades)
    .where(eq(trades.accountId, existing!.accountId))
    .all()
    .find((row) => (JSON.parse(row.executionIdsJson) as string[]).includes(executionId));

  const importMetadata = existing!.importMetadataJson
    ? JSON.parse(existing!.importMetadataJson)
    : undefined;
  const nextSymbol = input.symbol?.trim().toUpperCase() ?? existing!.symbol;
  const contentHash = executionHash({
    symbol: nextSymbol,
    side: input.side,
    quantity: input.quantity,
    price: input.price,
    executedAt: input.executedAt,
    importMetadata,
  });
  const duplicate = db
    .select({ id: executions.id })
    .from(executions)
    .where(
      and(eq(executions.accountId, existing!.accountId), eq(executions.contentHash, contentHash)),
    )
    .get();
  requireValue(
    !duplicate || duplicate.id === executionId,
    "An identical execution already exists.",
  );

  db.update(executions)
    .set({
      symbol: nextSymbol,
      side: input.side,
      quantity: input.quantity,
      price: input.price,
      fee: input.fee,
      executedAt: input.executedAt,
      contentHash,
    })
    .where(eq(executions.id, executionId))
    .run();
  rebuildAccount(existing!.accountId);

  const tradeKey = findTradeKeyByExecutionId(existing!.accountId, executionId);
  if (oldTrade && tradeKey && tradeKey !== oldTrade.key) {
    db.update(trades)
      .set({
        notes: oldTrade.notes,
        tagsJson: oldTrade.tagsJson,
        mistakesJson: oldTrade.mistakesJson,
        reasonForExitJson: oldTrade.reasonForExitJson,
        exitOutcome: oldTrade.exitOutcome,
        totalPossibleR: oldTrade.totalPossibleR,
        volumeAfterTp: oldTrade.volumeAfterTp,
        priceActionJson: oldTrade.priceActionJson,
        playbookId: oldTrade.playbookId,
        rating: oldTrade.rating,
        stopLoss: oldTrade.stopLoss,
        profitTarget: oldTrade.profitTarget,
        reviewedAt: oldTrade.reviewedAt,
        tradingViewUrl: oldTrade.tradingViewUrl,
      })
      .where(eq(trades.key, tradeKey))
      .run();
    db.update(tradeRuleChecks)
      .set({ tradeKey })
      .where(eq(tradeRuleChecks.tradeKey, oldTrade.key))
      .run();
    moveTradeSnapshot(oldTrade.key, tradeKey);
  }
  return tradeKey;
};

export const findTradeKeyByExecutionId = (
  accountId: string,
  executionId: string,
): string | null => {
  const rows = db
    .select({ key: trades.key, executionIdsJson: trades.executionIdsJson })
    .from(trades)
    .where(eq(trades.accountId, accountId))
    .all();
  for (const row of rows) {
    const ids = JSON.parse(row.executionIdsJson) as string[];
    if (ids.includes(executionId)) return row.key;
  }
  return null;
};

export const deleteExecution = (executionId: string): string | null => {
  const existing = db.select().from(executions).where(eq(executions.id, executionId)).get();
  requireValue(existing, "Execution not found.");
  const accountId = existing!.accountId;
  const containingTrade = db
    .select({
      key: trades.key,
      notes: trades.notes,
      tagsJson: trades.tagsJson,
      mistakesJson: trades.mistakesJson,
      reasonForExitJson: trades.reasonForExitJson,
      exitOutcome: trades.exitOutcome,
      totalPossibleR: trades.totalPossibleR,
      volumeAfterTp: trades.volumeAfterTp,
      priceActionJson: trades.priceActionJson,
      playbookId: trades.playbookId,
      rating: trades.rating,
      stopLoss: trades.stopLoss,
      profitTarget: trades.profitTarget,
      reviewedAt: trades.reviewedAt,
      tradingViewUrl: trades.tradingViewUrl,
      executionIdsJson: trades.executionIdsJson,
    })
    .from(trades)
    .where(eq(trades.accountId, accountId))
    .all()
    .find((row) => (JSON.parse(row.executionIdsJson) as string[]).includes(executionId));
  const remainingIds = containingTrade
    ? (JSON.parse(containingTrade.executionIdsJson) as string[]).filter((id) => id !== executionId)
    : [];
  db.delete(executions).where(eq(executions.id, executionId)).run();
  rebuildAccount(accountId);
  for (const remainingId of remainingIds) {
    const tradeKey = findTradeKeyByExecutionId(accountId, remainingId);
    if (!tradeKey) continue;
    if (containingTrade && tradeKey !== containingTrade.key) {
      db.update(trades)
        .set({
          notes: containingTrade.notes,
          tagsJson: containingTrade.tagsJson,
          mistakesJson: containingTrade.mistakesJson,
          reasonForExitJson: containingTrade.reasonForExitJson,
          exitOutcome: containingTrade.exitOutcome,
          totalPossibleR: containingTrade.totalPossibleR,
          priceActionJson: containingTrade.priceActionJson,
          playbookId: containingTrade.playbookId,
          rating: containingTrade.rating,
          stopLoss: containingTrade.stopLoss,
          profitTarget: containingTrade.profitTarget,
          reviewedAt: containingTrade.reviewedAt,
          tradingViewUrl: containingTrade.tradingViewUrl,
        })
        .where(eq(trades.key, tradeKey))
        .run();
      moveTradeSnapshot(containingTrade.key, tradeKey);
    }
    return tradeKey;
  }
  return null;
};

export const deleteExecutionsForTrades = (accountId: string, executionIds: string[]): void => {
  if (executionIds.length === 0) return;
  db.delete(executions)
    .where(and(eq(executions.accountId, accountId), inArray(executions.id, executionIds)))
    .run();
  rebuildAccount(accountId);
};

export const listExecutions = (accountId: string, ids?: string[]) => {
  if (ids && ids.length > 0) {
    return db
      .select()
      .from(executions)
      .where(and(eq(executions.accountId, accountId), inArray(executions.id, ids)))
      .all();
  }
  return db.select().from(executions).where(eq(executions.accountId, accountId)).all();
};
