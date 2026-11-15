import { eq, sql } from "drizzle-orm";
import { accounts, db, executions, trades } from "@/db";
import { bad, handler, ok, requireValue } from "@/server/api";
import { rebuildAccount } from "@/server/rebuild";
import { hasSyncedExecutions, isIbkrSyncAccount } from "@/server/ibkr-sync-timezone";
import { syncStartDate } from "@/server/sync-start-date";

type Params = { params: Promise<{ id: string }> };

interface PatchBody {
  name?: string;
  broker?: string;
  currency?: string;
  initialBalance?: number;
  profitCalcMethod?: "fifo" | "lifo" | "wavg";
  syncStartAt?: string | null;
}

export const PATCH = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const account = db.select().from(accounts).where(eq(accounts.id, id)).get();
  if (!account) return bad("Account not found", 404);

  const body = (await request.json()) as PatchBody;
  const patch: Partial<typeof accounts.$inferInsert> = {};
  if (body.name !== undefined) {
    const trimmedName = body.name.trim();
    requireValue(trimmedName.length > 0, "Account name is required.");
    const duplicate = db
      .select({ id: accounts.id })
      .from(accounts)
      .where(sql`lower(${accounts.name}) = lower(${trimmedName})`)
      .get();
    requireValue(!duplicate || duplicate.id === id, "An account with this name already exists.");
    patch.name = trimmedName;
  }
  if (body.broker !== undefined) patch.broker = body.broker;
  if (body.currency !== undefined) patch.currency = body.currency;
  if (body.initialBalance !== undefined) patch.initialBalance = body.initialBalance;
  if (body.profitCalcMethod !== undefined) patch.profitCalcMethod = body.profitCalcMethod;
  if (body.syncStartAt !== undefined) {
    requireValue(account.kind === "sync", "Only broker accounts have a sync start date.");
    patch.syncStartAt = syncStartDate(body.broker ?? account.broker, body.syncStartAt);
  }

  db.transaction(
    () => {
      const current = db.select().from(accounts).where(eq(accounts.id, id)).get();
      requireValue(current, "Account not found.");
      if (
        patch.syncStartAt !== undefined &&
        patch.syncStartAt !== current.syncStartAt &&
        current.broker === "bitunix" &&
        current.snapshotJson
      ) {
        const snapshot = JSON.parse(current.snapshotJson) as Record<string, unknown>;
        delete snapshot.bitunixCursorAt;
        delete snapshot.bitunixImportInitialized;
        delete snapshot.bitunixFundingBackfillComplete;
        patch.snapshotJson = JSON.stringify(snapshot);
      }
      if (
        body.broker !== undefined &&
        body.broker !== current.broker &&
        isIbkrSyncAccount(current)
      ) {
        requireValue(
          !hasSyncedExecutions(id),
          "An IBKR account with synced history cannot change brokers. Connect a separate account to preserve its timestamp history.",
        );
      }
      if (Object.keys(patch).length > 0) {
        db.update(accounts).set(patch).where(eq(accounts.id, id)).run();
      }
      // A new profit-calc method changes per-exit attribution — recompute.
      if (body.profitCalcMethod && body.profitCalcMethod !== current.profitCalcMethod) {
        rebuildAccount(id);
      }
    },
    { behavior: "immediate" },
  );
  return ok({ updated: true });
});

export const DELETE = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  db.transaction((tx) => {
    tx.delete(trades).where(eq(trades.accountId, id)).run();
    tx.delete(executions).where(eq(executions.accountId, id)).run();
    tx.delete(accounts).where(eq(accounts.id, id)).run();
  });
  return ok({ deleted: true });
});
