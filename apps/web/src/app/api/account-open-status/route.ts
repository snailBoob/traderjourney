import { and, eq } from "drizzle-orm";
import { accounts, db, trades } from "@/db";
import { handler, ok } from "@/server/api";

interface Snapshot {
  positions?: unknown[];
  openOrders?: unknown[];
}

export const GET = handler((request: Request) => {
  const accountId = new URL(request.url).searchParams.get("accountId");

  if (accountId) {
    const account = db
      .select({
        id: accounts.id,
        kind: accounts.kind,
        credentialsEnc: accounts.credentialsEnc,
        snapshotJson: accounts.snapshotJson,
      })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .get();

    if (!account) return ok({ status: null });

    if (account.kind === "manual") {
      const openPositions = db
        .select({ key: trades.key })
        .from(trades)
        .where(and(eq(trades.accountId, account.id), eq(trades.status, "open")))
        .all().length;
      return ok({ status: { accountId: account.id, positions: openPositions, openOrders: 0 } });
    }

    if (account.kind !== "sync" || account.credentialsEnc === null) {
      return ok({ status: null });
    }

    const snapshot = account.snapshotJson
      ? (JSON.parse(account.snapshotJson) as Snapshot & {
          connectionStatus?: "connected" | "disconnected";
        })
      : null;
    if (snapshot?.connectionStatus === "disconnected") return ok({ status: null });

    return ok({
      status: {
        accountId: account.id,
        positions: snapshot?.positions?.length ?? 0,
        openOrders: snapshot?.openOrders?.length ?? 0,
      },
    });
  }

  const allAccounts = db
    .select({
      id: accounts.id,
      kind: accounts.kind,
      credentialsEnc: accounts.credentialsEnc,
      snapshotJson: accounts.snapshotJson,
    })
    .from(accounts)
    .all();

  let positions = 0;
  let openOrders = 0;

  for (const account of allAccounts) {
    if (account.kind === "manual") {
      positions += db
        .select({ key: trades.key })
        .from(trades)
        .where(and(eq(trades.accountId, account.id), eq(trades.status, "open")))
        .all().length;
      continue;
    }

    if (account.kind !== "sync" || account.credentialsEnc === null) continue;

    const snapshot = account.snapshotJson
      ? (JSON.parse(account.snapshotJson) as Snapshot & {
          connectionStatus?: "connected" | "disconnected";
        })
      : null;
    if (snapshot?.connectionStatus === "disconnected") continue;

    positions += snapshot?.positions?.length ?? 0;
    openOrders += snapshot?.openOrders?.length ?? 0;
  }

  return ok({ status: { accountId: null, positions, openOrders } });
});
