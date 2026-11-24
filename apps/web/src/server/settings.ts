import { eq } from "drizzle-orm";
import { db, settings } from "@/db";
import { EMPTY_DEFAULTS, type JournalDefaults } from "@/lib/journal-defaults";
import { PRIMARY_NAV_HREFS } from "@/lib/navigation";

export const getJournalDefaults = (): JournalDefaults => {
  try {
    return { ...EMPTY_DEFAULTS, ...JSON.parse(getSetting("journalDefaults") ?? "{}") };
  } catch {
    return EMPTY_DEFAULTS;
  }
};

export const getSetting = (key: string): string | null =>
  db.select().from(settings).where(eq(settings.key, key)).get()?.value ?? null;

export const setSetting = (key: string, value: string): void => {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
};

export const deleteSetting = (key: string): void => {
  db.delete(settings).where(eq(settings.key, key)).run();
};

const LEGACY_NAV_HREFS: Record<string, (typeof PRIMARY_NAV_HREFS)[number]> = {
  "/playbooks": "/strategies",
  "/progress": "/routines",
};

const normalizeNavOrder = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;
  const valid = value.flatMap((item) => {
    if (typeof item !== "string") return [];
    const href = LEGACY_NAV_HREFS[item] ?? item;
    return PRIMARY_NAV_HREFS.includes(href as (typeof PRIMARY_NAV_HREFS)[number])
      ? [href as (typeof PRIMARY_NAV_HREFS)[number]]
      : [];
  });
  const unique = [...new Set(valid)];
  if (unique.length !== PRIMARY_NAV_HREFS.length) return null;
  return unique;
};

export const getNavOrder = (): string[] => {
  const raw = getSetting("navOrder");
  if (!raw) return [...PRIMARY_NAV_HREFS];
  try {
    return normalizeNavOrder(JSON.parse(raw)) ?? [...PRIMARY_NAV_HREFS];
  } catch {
    return [...PRIMARY_NAV_HREFS];
  }
};

export const hasSavedNavOrder = (): boolean => getSetting("navOrder") !== null;

export const setNavOrder = (value: string[]): void => {
  const normalized = normalizeNavOrder(value);
  if (!normalized) throw new Error("Enter a valid menu order.");
  setSetting("navOrder", JSON.stringify(normalized));
};

/** Journal display timezone (IANA), default UTC. */
export const getTimeZone = (): string => getSetting("timeZone") ?? "UTC";

/** Whole trading pot across accounts; null until the user sets it. */
export const getTotalCapital = (): number | null => {
  const raw = getSetting("totalCapital");
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
};

export const setTotalCapital = (value: number | null): void => {
  if (value === null || !Number.isFinite(value) || value < 0) deleteSetting("totalCapital");
  else setSetting("totalCapital", String(value));
};

export const getHeaderMessage = (): string => getSetting("headerMessage") ?? "";

export const setHeaderMessage = (value: string): void => {
  const normalized = value.trim();
  if (!normalized) deleteSetting("headerMessage");
  else setSetting("headerMessage", normalized);
};

/** Preserve the legacy parsing default until a separate import zone is saved. */
export const getImportTimeZone = (): string => getSetting("importTimeZone") ?? getTimeZone();

/** Per-symbol contract multipliers for futures/options P&L. */
export const getMultipliers = (): Record<string, number> => {
  const raw = getSetting("multipliers");
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, number>;
  } catch {
    return {};
  }
};
