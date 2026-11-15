import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BitunixApiError } from "../src/server/bitunix";

const sync = vi.hoisted(() => vi.fn());
vi.mock("../src/server/sync", () => ({ syncAccount: sync }));
const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "sync-errors-"));
process.env.JOURNAL_DATA_DIR = scratch;
const { db, accounts } = await import("../src/db");
const { POST } = await import("../src/app/api/sync/route");
const { POST: action } = await import("../src/app/api/accounts/[id]/actions/route");

beforeEach(() => {
  vi.stubEnv("JOURNAL_PASSWORD", "");
  sync.mockReset();
  db.delete(accounts).run();
  db.insert(accounts)
    .values(
      ["good", "bad"].map((id) => ({
        id,
        name: id,
        kind: "sync" as const,
        createdAt: "2026-01-01",
      })),
    )
    .run();
});
afterAll(() => {
  vi.unstubAllEnvs();
  db.$client.close();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});

it("reports partial success and a useful error tied to the failed account", async () => {
  sync.mockImplementation(async (id: string) => {
    if (id === "bad") throw new BitunixApiError(403, "10004", "IP rejected");
    return { accountId: id, inserted: 2, corrected: 1, duplicates: 0, skipped: 1 };
  });
  const response = await POST();
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result).toMatchObject({
    syncedAccounts: 1,
    failedAccounts: 1,
    inserted: 2,
    corrected: 1,
    skipped: 1,
  });
  expect(result.failures).toEqual([
    { accountId: "bad", error: expect.stringContaining("allowed IPs") },
  ]);
});

it("identifies every failed account when none completed", async () => {
  sync.mockRejectedValue(new DOMException("timeout", "TimeoutError"));
  const result = await (await POST()).json();
  expect(result).toMatchObject({ syncedAccounts: 0, failedAccounts: 2, inserted: 0, newTrades: 0 });
  expect(result.failures.map((f: { accountId: string }) => f.accountId).sort()).toEqual([
    "bad",
    "good",
  ]);
  expect(result.failures.every((f: { error: string }) => f.error.includes("sync again"))).toBe(
    true,
  );
});

it("returns the same actionable broker error for an individual account sync", async () => {
  sync.mockRejectedValue(new BitunixApiError(401, "10007", "invalid"));
  const response = await action(
    new Request("http://localhost/api/accounts/bad/actions", {
      method: "POST",
      body: JSON.stringify({ action: "sync" }),
    }),
    { params: Promise.resolve({ id: "bad" }) },
  );
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: expect.stringContaining("API key and secret") });
  expect(db.select().from(accounts).all()).toHaveLength(2);
});
