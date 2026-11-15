import { db, settings } from "@/db";
import { handler, ok, requireValue } from "@/server/api";
import { setSetting } from "@/server/settings";
import { UI_PREFERENCE_KEYS, type UiPreferenceKey } from "@/lib/ui-preferences";

const PREFIX = "ui.";
const ALLOWED = new Set<string>(Object.values(UI_PREFERENCE_KEYS));

const parseValue = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

export const GET = handler(() => {
  const preferences: Record<string, unknown> = {};
  for (const row of db.select().from(settings).all()) {
    if (!row.key.startsWith(PREFIX)) continue;
    const key = row.key.slice(PREFIX.length);
    if (!ALLOWED.has(key)) continue;
    preferences[key] = parseValue(row.value);
  }
  return ok({ preferences });
});

interface Body {
  key?: UiPreferenceKey;
  value?: unknown;
}

export const PATCH = handler(async (request: Request) => {
  const body = (await request.json()) as Body;
  requireValue(
    body && typeof body === "object" && !Array.isArray(body),
    "Enter a valid preference.",
  );
  requireValue(typeof body.key === "string" && ALLOWED.has(body.key), "Unknown preference.");
  requireValue(body.value !== undefined, "Enter a preference value.");

  let serialized: string;
  try {
    serialized = JSON.stringify(body.value);
  } catch {
    throw new Error("Preference could not be serialized.");
  }
  requireValue(serialized.length <= 1_000_000, "Preference is too large.");
  setSetting(`${PREFIX}${body.key}`, serialized);
  return ok({ saved: true });
});
