import { eq, asc } from "drizzle-orm";
import { db, folders, notes } from "@/db";
import { REVIEW_FOLDER } from "@/lib/mcp-settings";
import { newId, nowIso } from "./ids";

export function saveWeeklyReview(weekStart: string, markdown: string) {
  const monday = new Date(`${weekStart}T00:00:00Z`);
  if (monday.getUTCDay() !== 1) return { error: "weekStart must be a Monday." };
  const sunday = new Date(monday.getTime() + 6 * 86400000).toISOString().slice(0, 10);
  const id = `weekly-ai-review-${weekStart}`;
  // Store markup as text, not executable HTML/JSX in the notebook editor.
  const content = markdown.replaceAll("<", "&lt;");
  return db.transaction(
    (tx) => {
      const previous = tx.select().from(notes).where(eq(notes.id, id)).get();
      if (previous) {
        return previous.content === content
          ? { id, folderId: previous.folderId, created: false }
          : { error: "A review for this week already exists. Edit it in Notes if needed." };
      }
      const folder = tx
        .select({ id: folders.id })
        .from(folders)
        .where(eq(folders.name, REVIEW_FOLDER))
        .orderBy(asc(folders.createdAt), asc(folders.id))
        .get();
      const folderId = folder?.id ?? newId();
      const now = nowIso();
      if (!folder)
        tx.insert(folders)
          .values({ id: folderId, name: REVIEW_FOLDER, kind: "user", createdAt: now })
          .run();
      tx.insert(notes)
        .values({
          id,
          folderId,
          title: `Week of ${weekStart} – ${sunday}`,
          content,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      return { id, folderId, created: true };
    },
    { behavior: "immediate" },
  );
}
