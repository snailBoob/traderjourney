import { asc } from "drizzle-orm";
import { db, noteTemplates } from "@/db";
import { newId } from "./ids";

export const TEMPLATE_SCOPES = ["journal", "notebook", "trade", "missed", "all"] as const;
export const validTemplateScopes = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((scope) => TEMPLATE_SCOPES.includes(scope)) &&
  (!value.includes("all") || value.length === 1);

export function listNoteTemplates(scope?: string | null) {
  return db
    .select()
    .from(noteTemplates)
    .orderBy(asc(noteTemplates.name), asc(noteTemplates.id))
    .all()
    .filter((row) => {
      if (!scope) return true;
      try {
        const scopes = JSON.parse(row.scopesJson) as string[];
        return scopes.includes("all") || scopes.includes(scope);
      } catch {
        return true;
      }
    });
}

export function createNoteTemplate(name: string, content: string, scopes: string[]) {
  const id = newId();
  db.insert(noteTemplates)
    .values({ id, name: name.trim(), content, scopesJson: JSON.stringify(scopes) })
    .run();
  return id;
}
