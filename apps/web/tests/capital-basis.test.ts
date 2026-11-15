import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-capital-test-"));
process.env.JOURNAL_DATA_DIR = scratch;
const { db, accounts } = await import("../src/db");
const { getTotalCapital, setTotalCapital } = await import("../src/server/settings");
const { GET: getSettings, PATCH: patchSettings } = await import("../src/app/api/settings/route");
const { GET: getStats } = await import("../src/app/api/stats/route");
const { effectiveCapitalBase, readCapitalBasis } = await import("../src/lib/capital");
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const settingsRequest = (body: unknown) =>
  new Request("http://localhost/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const stats = async (query = "") =>
  (await (await getStats(new Request(`http://localhost/api/stats${query}`))).json()) as Record<
    string,
    unknown
  >;

const addAccount = (initialBalance: number) =>
  db
    .insert(accounts)
    .values({
      id: `acc-${initialBalance}`,
      name: `Account ${initialBalance}`,
      kind: "manual",
      initialBalance,
      createdAt: new Date().toISOString(),
    })
    .run();

describe("capital basis", () => {
  beforeEach(() => {
    setTotalCapital(null);
    db.delete(accounts).run();
  });

  afterEach(() => setTotalCapital(null));

  afterAll(() => {
    if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
    else process.env.JOURNAL_DATA_DIR = originalDir;
    rmSync(scratch, { recursive: true, force: true });
  });

  it("defaults to the allocated sum and keeps legacy behavior without a total", async () => {
    addAccount(5000);
    addAccount(7500);
    expect(readCapitalBasis(null)).toBe("total");
    expect(readCapitalBasis("allocated")).toBe("allocated");
    expect(
      effectiveCapitalBase({ basis: "total", totalCapital: null, allocatedBalance: 12500 }),
    ).toBe(12500);
    const payload = await stats();
    expect(payload.allocatedBalance).toBe(12500);
    expect(payload.totalCapital).toBeNull();
    expect(payload.initialBalance).toBe(12500);
    expect(payload.capitalBasis).toBe("total");
  });

  it("uses total capital on the default basis and allocations when switched", async () => {
    addAccount(5000);
    setTotalCapital(15000);
    const total = await stats();
    expect(total.initialBalance).toBe(15000);
    expect(total.capitalBasis).toBe("total");
    const allocated = await stats("?capitalBasis=allocated");
    expect(allocated.initialBalance).toBe(5000);
    expect(allocated.capitalBasis).toBe("allocated");
    expect(allocated.totalCapital).toBe(15000);
    // A selection only sums its own accounts.
    const filtered = await stats("?capitalBasis=allocated&accounts=acc-5000");
    expect(filtered.allocatedBalance).toBe(5000);
    // Unknown values fall back to the default basis.
    expect((await stats("?capitalBasis=nonsense")).initialBalance).toBe(15000);
  });

  it("stores and clears total capital through the settings API", async () => {
    const saved = await patchSettings(settingsRequest({ totalCapital: 15000 }));
    expect(saved.status).toBe(200);
    expect(getTotalCapital()).toBe(15000);
    const payload = (await (await getSettings()).json()) as {
      totalCapital: number | null;
    };
    expect(payload.totalCapital).toBe(15000);
    await patchSettings(settingsRequest({ totalCapital: null }));
    expect(getTotalCapital()).toBeNull();
    const rejected = await patchSettings(settingsRequest({ totalCapital: -5 }));
    expect(rejected.status).toBe(400);
    const nonNumeric = await patchSettings(settingsRequest({ totalCapital: "12000" }));
    expect(nonNumeric.status).toBe(400);
    expect(getTotalCapital()).toBeNull();
  });
});
