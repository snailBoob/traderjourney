import { desc, eq } from "drizzle-orm";
import { accounts, db, executions, trades } from "@/db";
import { handler, ok } from "@/server/api";
import { syncAccount, type SyncOutcome } from "@/server/sync";
import { brokerErrorMessage } from "@/server/broker-error";

export const GET = handler(() => {
  const latest = db
    .select({ lastSyncAt: accounts.lastSyncAt })
    .from(accounts)
    .where(eq(accounts.kind, "sync"))
    .orderBy(desc(accounts.lastSyncAt))
    .limit(1)
    .get();
  return ok({ lastSyncAt: latest?.lastSyncAt ?? null });
});

export const POST = handler(async () => {
  const rows = db.select({ id: accounts.id }).from(accounts).where(eq(accounts.kind, "sync")).all();

  const results: SyncOutcome[] = [];
  const newTradeKeys = new Set<string>();
  const failures: { accountId: string; error: string }[] = [];
  for (const row of rows) {
    try {
      const before = new Set(
        db
          .select({ key: trades.key })
          .from(trades)
          .where(eq(trades.accountId, row.id))
          .all()
          .map((trade) => trade.key),
      );
      const previousExecutionIds = new Set(
        db
          .select({ id: executions.id })
          .from(executions)
          .where(eq(executions.accountId, row.id))
          .all()
          .map((execution) => execution.id),
      );
      results.push(await syncAccount(row.id));
      for (const trade of db
        .select({ key: trades.key, executionIdsJson: trades.executionIdsJson })
        .from(trades)
        .where(eq(trades.accountId, row.id))
        .all()) {
        // A corrected timestamp/direction can change a key without importing a new trade.
        if (
          !before.has(trade.key) &&
          (JSON.parse(trade.executionIdsJson) as string[]).some(
            (id) => !previousExecutionIds.has(id),
          )
        )
          newTradeKeys.add(trade.key);
      }
    } catch (error) {
      failures.push({
        accountId: row.id,
        error: brokerErrorMessage(error),
      });
    }
  }

  return ok({
    syncedAccounts: results.length,
    failedAccounts: failures.length,
    inserted: results.reduce((sum, result) => sum + result.inserted, 0),
    corrected: results.reduce((sum, result) => sum + (result.corrected ?? 0), 0),
    newTrades: newTradeKeys.size,
    duplicates: results.reduce((sum, result) => sum + result.duplicates, 0),
    skipped: results.reduce((sum, result) => sum + result.skipped, 0),
    failures,
    syncedAt: new Date().toISOString(),
  });
});
