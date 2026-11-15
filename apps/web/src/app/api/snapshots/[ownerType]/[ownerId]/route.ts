import { and, eq } from "drizzle-orm";
import { db, snapshots } from "@/db";
import { bad, handler } from "@/server/api";

type Context = { params: Promise<{ ownerType: string; ownerId: string }> };
export const GET = handler(async (_request: Request, { params }: Context) => {
  const { ownerType, ownerId } = await params;
  if (ownerType !== "trade" && ownerType !== "missed") return bad("Snapshot not found", 404);
  const snapshot = db
    .select()
    .from(snapshots)
    .where(and(eq(snapshots.ownerType, ownerType), eq(snapshots.ownerId, ownerId)))
    .get();
  if (!snapshot) return bad("Snapshot not found", 404);
  return new Response(new Uint8Array(snapshot.data), {
    headers: {
      "Content-Type": snapshot.mime,
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
    },
  });
});
