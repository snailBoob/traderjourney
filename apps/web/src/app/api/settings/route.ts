import { db, accounts } from "@/db";
import { rebuildAccount } from "@/server/rebuild";
import { handler, ok, requireValue } from "@/server/api";
import {
  getMultipliers,
  getTimeZone,
  getTotalCapital,
  getHeaderMessage,
  setHeaderMessage,
  getImportTimeZone,
  setTotalCapital,
  setSetting,
  getNavOrder,
  hasSavedNavOrder,
  setNavOrder,
} from "@/server/settings";
import { PRIMARY_NAV_HREFS } from "@/lib/navigation";
import { isTimeZone } from "@/lib/timezone";

export const GET = handler(() =>
  ok({
    timeZone: getTimeZone(),
    headerMessage: getHeaderMessage(),
    importTimeZone: getImportTimeZone(),
    totalCapital: getTotalCapital(),
    multipliers: getMultipliers(),
    navOrder: getNavOrder(),
    navOrderSaved: hasSavedNavOrder(),
  }),
);

interface SettingsBody {
  timeZone?: string;
  headerMessage?: string;
  importTimeZone?: string;
  /** Whole trading pot across accounts; null clears it. Absent = unchanged. */
  totalCapital?: number | null;
  multipliers?: Record<string, number>;
  navOrder?: string[];
}

export const PATCH = handler(async (request: Request) => {
  const body = (await request.json()) as SettingsBody;
  requireValue(body && typeof body === "object" && !Array.isArray(body), "Enter valid settings.");
  for (const key of ["timeZone", "importTimeZone"] as const)
    if (body[key] !== undefined)
      requireValue(
        isTimeZone(body[key]),
        `Enter a valid IANA ${key === "timeZone" ? "display" : "import"} timezone.`,
      );
  if (body.headerMessage !== undefined)
    requireValue(
      typeof body.headerMessage === "string" && body.headerMessage.length <= 10000,
      "Header message is too long.",
    );
  if (body.totalCapital !== undefined)
    requireValue(
      body.totalCapital === null ||
        (typeof body.totalCapital === "number" &&
          Number.isFinite(body.totalCapital) &&
          body.totalCapital >= 0),
      "Total capital must be a non-negative number.",
    );
  if (body.multipliers !== undefined)
    requireValue(
      body.multipliers &&
        typeof body.multipliers === "object" &&
        Object.values(body.multipliers).every(
          (n) => typeof n === "number" && Number.isFinite(n) && n > 0,
        ),
      "Contract multipliers must be positive numbers.",
    );

  db.transaction(() => {
    // A display-only change must not silently alter the legacy import default.
    if (body.timeZone !== undefined || body.importTimeZone !== undefined)
      setSetting("importTimeZone", body.importTimeZone ?? getImportTimeZone());
    if (body.timeZone !== undefined) setSetting("timeZone", body.timeZone);
  });
  if (body.navOrder !== undefined)
    requireValue(
      Array.isArray(body.navOrder) &&
        body.navOrder.length === PRIMARY_NAV_HREFS.length &&
        new Set(body.navOrder).size === PRIMARY_NAV_HREFS.length &&
        body.navOrder.every((href) =>
          PRIMARY_NAV_HREFS.includes(href as (typeof PRIMARY_NAV_HREFS)[number]),
        ),
      "Enter a valid menu order.",
    );

  if (body.navOrder !== undefined) setNavOrder(body.navOrder);

  if (body.multipliers !== undefined)
    db.transaction(() => {
      setSetting("multipliers", JSON.stringify(body.multipliers));
      for (const account of db.select({ id: accounts.id }).from(accounts).all())
        rebuildAccount(account.id);
    });
  db.transaction(() => {
    if (body.headerMessage !== undefined) setHeaderMessage(body.headerMessage);
    if (body.totalCapital !== undefined) setTotalCapital(body.totalCapital);
  });
  return ok({ saved: true });
});
