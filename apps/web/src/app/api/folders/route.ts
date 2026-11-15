import { eq } from "drizzle-orm";
import { db, folders, notes } from "@/db";
import { bad, handler, ok } from "@/server/api";
import { newId, nowIso } from "@/server/ids";

export const POST = handler(async (request: Request) => {
  const body: unknown = await request.json();
  const name = body && typeof body === "object" && "name" in body ? body.name : null;
  if (typeof name !== "string" || !name.trim()) return bad("Enter a folder name.");
  if (name.trim().length > 100) return bad("Folder names must be 100 characters or fewer.");
  const id = newId();
  db.insert(folders).values({ id, name: name.trim(), kind: "user", createdAt: nowIso() }).run();
  return ok({ id });
});

interface PatchFolderBody {
  id?: string;
  name?: string;
}

export const PATCH = handler(async (request: Request) => {
  const body = (await request.json()) as PatchFolderBody;
  if (!body.id || body.id === "all") return bad("This folder cannot be renamed.");
  const existing = db.select().from(folders).where(eq(folders.id, body.id)).get();
  if (!existing) return bad("Folder not found.", 404);
  if (typeof body.name !== "string" || !body.name.trim()) return bad("Enter a folder name.");
  if (body.name.trim().length > 100) return bad("Folder names must be 100 characters or fewer.");
  db.update(folders).set({ name: body.name.trim() }).where(eq(folders.id, body.id)).run();
  return ok({ updated: true });
});

export const DELETE = handler(async (request: Request) => {
  const body = (await request.json()) as { id?: string };
  if (!body.id || body.id === "all") return bad("This folder cannot be deleted.");
  const existing = db.select().from(folders).where(eq(folders.id, body.id)).get();
  if (!existing) return bad("Folder not found.", 404);
  db.transaction((tx) => {
    tx.update(notes).set({ folderId: "all" }).where(eq(notes.folderId, body.id!)).run();
    tx.delete(folders).where(eq(folders.id, body.id!)).run();
  });
  return ok({ deleted: true });
});
