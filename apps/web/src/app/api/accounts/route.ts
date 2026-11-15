import { asc, eq, sql } from "drizzle-orm";
import { accounts, db } from "@/db";
import { bad, handler, ok } from "@/server/api";
import { encryptJson } from "@/server/crypto";
import { newId, nowIso } from "@/server/ids";
import { syncAccount } from "@/server/sync";
import { brokerErrorMessage } from "@/server/broker-error";
import { getTotalCapital } from "@/server/settings";
import type { BrokerConnectionStatus } from "@/lib/brokers";
import { syncStartDate } from "@/server/sync-start-date";

export const GET = handler((request: Request) => {
  if (new URL(request.url).searchParams.get("summary") === "1") {
    return ok({
      totalCapital: getTotalCapital(),
      accounts: db
        .select({
          id: accounts.id,
          name: accounts.name,
          broker: accounts.broker,
          archivedAt: accounts.archivedAt,
        })
        .from(accounts)
        .orderBy(asc(accounts.createdAt))
        .all(),
    });
  }
  const rows = db.select().from(accounts).orderBy(asc(accounts.createdAt)).all();
  return ok({
    accounts: rows.map(({ credentialsEnc, ...safe }) => {
      let snapshot = safe.snapshotJson
        ? (JSON.parse(safe.snapshotJson) as { connectionStatus?: BrokerConnectionStatus })
        : null;
      if (safe.kind === "sync" && credentialsEnc === null)
        snapshot = { ...snapshot, connectionStatus: "disconnected" };
      return {
        ...safe,
        // Existing consumers use this flag to offer retry/quick-sync controls.
        // The card's observed connection state is separate from configured access.
        connected: credentialsEnc !== null && snapshot?.connectionStatus !== "disconnected",
        snapshot,
      };
    }),
  });
});

interface CreateBody {
  name?: string;
  kind?: "sync" | "import" | "manual";
  broker?: string;
  currency?: string;
  initialBalance?: number;
  profitCalcMethod?: "fifo" | "lifo" | "wavg";
  credentials?: Record<string, string>;
  syncStartAt?: string;
  /** When false, the caller performs the initial sync separately so the UI can show its sync phase. */
  initialSync?: boolean;
}

export const POST = handler(async (request: Request) => {
  const body = (await request.json()) as CreateBody;
  if (!body.name || !body.kind) return bad("name and kind are required");
  if (body.kind === "sync" && (!body.broker || !body.credentials)) {
    return bad("sync accounts need a broker and credentials");
  }
  const startDate = body.kind === "sync" ? syncStartDate(body.broker!, body.syncStartAt) : null;

  const trimmedName = body.name.trim();
  if (!trimmedName) return bad("Account name is required");
  const duplicate = db
    .select({ id: accounts.id })
    .from(accounts)
    .where(sql`lower(${accounts.name}) = lower(${trimmedName})`)
    .get();
  if (duplicate) return bad("An account with this name already exists.", 409);

  const id = newId();
  db.insert(accounts)
    .values({
      id,
      name: trimmedName,
      broker: body.broker ?? "",
      kind: body.kind,
      currency: body.currency ?? "USD",
      initialBalance: body.initialBalance ?? 0,
      profitCalcMethod: body.profitCalcMethod ?? "fifo",
      credentialsEnc: body.kind === "sync" ? encryptJson(body.credentials) : null,
      syncStartAt: startDate,
      createdAt: nowIso(),
    })
    .run();

  // First sync happens right away so the account isn't born empty.
  let sync = null;
  if (body.kind === "sync" && body.initialSync !== false) {
    try {
      sync = await syncAccount(id);
    } catch (error) {
      // Bad credentials shouldn't strand a half-created account.
      db.delete(accounts).where(eq(accounts.id, id)).run();
      return bad(brokerErrorMessage(error), 502);
    }
  }
  return ok({ id, sync });
});
