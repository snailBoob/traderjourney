import { and, eq } from "drizzle-orm";
import { db, attachments, trades, notes, missedTrades, propAccounts, propEntries } from "@/db";
import { handler, ok, requireValue } from "@/server/api";
import { newId, nowIso } from "@/server/ids";
import { attachmentMime, MAX_ATTACHMENT_SIZE } from "@/lib/attachment-validation";
function owner(type: string, id: string) {
  if (type === "prop-account")
    return !!db
      .select({ id: propAccounts.id })
      .from(propAccounts)
      .where(eq(propAccounts.id, id))
      .get();
  if (type === "prop-entry")
    return !!db
      .select({ id: propEntries.id })
      .from(propEntries)
      .where(eq(propEntries.id, id))
      .get();
  if (type === "trade")
    return !!db.select({ key: trades.key }).from(trades).where(eq(trades.key, id)).get();
  if (type === "note")
    return !!db.select({ id: notes.id }).from(notes).where(eq(notes.id, id)).get();
  if (type === "missed")
    return !!db
      .select({ id: missedTrades.id })
      .from(missedTrades)
      .where(eq(missedTrades.id, id))
      .get();
  return (
    type === "day" &&
    /^\d{4}-\d{2}-\d{2}$/.test(id) &&
    !isNaN(Date.parse(id)) &&
    new Date(id).toISOString().slice(0, 10) === id
  );
}
export const GET = handler((request: Request) => {
  const p = new URL(request.url).searchParams;
  const type = p.get("type") ?? "",
    id = p.get("id") ?? "";
  requireValue(
    type !== "trade" && type !== "missed",
    "Trade snapshots must use the snapshot endpoint.",
  );
  requireValue(owner(type, id), "Attachment owner not found.");
  return ok({
    attachments: db
      .select({
        id: attachments.id,
        name: attachments.name,
        mime: attachments.mime,
        size: attachments.size,
      })
      .from(attachments)
      .where(and(eq(attachments.ownerType, type), eq(attachments.ownerId, id)))
      .all(),
  });
});
export const POST = handler(async (request: Request) => {
  requireValue(
    Number(request.headers.get("content-length") ?? 0) <= MAX_ATTACHMENT_SIZE + 10000,
    "Files must be 8 MB or smaller.",
  );
  const form = await request.formData();
  const type = String(form.get("type") ?? ""),
    ownerId = String(form.get("id") ?? ""),
    file = form.get("file");
  requireValue(
    type !== "trade" && type !== "missed",
    "Trade snapshots must use the snapshot endpoint.",
  );
  requireValue(owner(type, ownerId), "Attachment owner not found.");
  requireValue(
    file instanceof File && file.size > 0 && file.size <= MAX_ATTACHMENT_SIZE,
    "Choose a file up to 8 MB.",
  );
  const bytes = Buffer.from(await file.arrayBuffer()),
    mime = attachmentMime(bytes);
  requireValue(mime, "Supported files: PNG, JPEG, WebP and PDF.");
  const uploadId = form.get("uploadId");
  requireValue(
    uploadId === null ||
      (typeof uploadId === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uploadId)),
    "Invalid upload ID.",
  );
  const id = uploadId ?? newId();
  // Reuse the ID even when a committed response was lost in transit.
  const existing = db.select().from(attachments).where(eq(attachments.id, id)).get();
  if (existing) {
    requireValue(
      existing.ownerType === type &&
        existing.ownerId === ownerId &&
        existing.name === file.name.slice(0, 200) &&
        existing.mime === mime &&
        Buffer.from(existing.data).equals(bytes),
      "Upload ID already belongs to another attachment.",
    );
    return ok({ id });
  }
  db.insert(attachments)
    .values({
      id,
      ownerType: type,
      ownerId,
      name: file.name.slice(0, 200),
      mime,
      size: bytes.length,
      data: bytes,
      createdAt: nowIso(),
    })
    .run();
  return ok({ id });
});
