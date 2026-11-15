import { and, eq } from "drizzle-orm";
import { db, trades, snapshots } from "@/db";
import { handler, ok, requireValue } from "@/server/api";

type Params = { params: Promise<{ key: string }> };

export const GET = handler(async (_request: Request, { params }: Params) => {
  const { key } = await params;
  const trade = db.select().from(trades).where(eq(trades.key, key)).get();
  requireValue(trade, "Trade not found.");
  const stored = db
    .select({ id: snapshots.id, mime: snapshots.mime, size: snapshots.size })
    .from(snapshots)
    .where(and(eq(snapshots.ownerType, "trade"), eq(snapshots.ownerId, key)))
    .get();
  return ok({
    hasSnapshot: Boolean(stored),
    mime: stored?.mime ?? null,
    size: stored?.size ?? null,
  });
});
