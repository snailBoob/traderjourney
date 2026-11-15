import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectionStatus } from "../src/lib/brokers";

const scratch = mkdtempSync(join(tmpdir(), "journal-sync-settings-"));
vi.stubEnv("JOURNAL_DATA_DIR", scratch);
vi.stubEnv("JOURNAL_PASSWORD", "");
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
const { db, accounts, executions, trades } = await import("../src/db");
const { encryptJson } = await import("../src/server/crypto");
const { GET, POST } = await import("../src/app/api/accounts/route");
const { PATCH } = await import("../src/app/api/accounts/[id]/route");
const { insertExecutions } = await import("../src/server/executions");
const patch = (body: unknown) =>
  PATCH(
    new Request("http://localhost/api/accounts/test", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "test" }) },
  );
beforeEach(() => {
  db.delete(trades).run();
  db.delete(executions).run();
  db.delete(accounts).run();
  db.insert(accounts)
    .values({
      id: "test",
      name: "Test",
      kind: "sync",
      broker: "binance",
      createdAt: "2026-01-01",
      credentialsEnc: encryptJson({ apiKey: "test" }),
    })
    .run();
});
afterAll(() => {
  db.$client.close();
  vi.unstubAllEnvs();
  rmSync(scratch, { recursive: true, force: true });
});

it("reports saved credentials as unchecked until a successful sync", async () => {
  const result = await (await GET(new Request("http://localhost/api/accounts"))).json();
  expect(result.accounts[0].connected).toBe(true);
  expect(connectionStatus(result.accounts[0])).toBe("unknown");
  expect(result.accounts[0]).not.toHaveProperty("credentialsEnc");
});

it("does not show a restored account as connected when its credentials are missing", async () => {
  db.update(accounts)
    .set({
      credentialsEnc: null,
      lastSyncAt: "2026-11-13",
      snapshotJson: JSON.stringify({ connectionStatus: "connected", equity: 100 }),
    })
    .run();
  const result = await (await GET(new Request("http://localhost/api/accounts"))).json();
  expect(result.accounts[0]).toMatchObject({
    connected: false,
    snapshot: { connectionStatus: "disconnected", equity: 100 },
  });
});

it("updates an optional start date without deleting historical fills, then restores broker defaults", async () => {
  insertExecutions(
    "test",
    [
      {
        symbol: "BTCUSDT",
        side: "buy",
        price: 100,
        quantity: 1,
        fee: 0,
        executedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    "sync",
  );
  const before = db.select().from(executions).all();
  expect((await patch({ syncStartAt: "2026-11-01T00:00:00.000Z" })).status).toBe(200);
  expect(db.select().from(accounts).get()?.syncStartAt).toBe("2026-11-01T00:00:00.000Z");
  expect(db.select().from(executions).all()).toEqual(before);
  expect((await patch({ syncStartAt: null })).status).toBe(200);
  expect(db.select().from(accounts).get()?.syncStartAt).toBeNull();
});

it.each(["2026-02-30T00:00:00.000Z", "not-a-date", "2026-11-01T12:00:00.000Z", 42])(
  "rejects malformed start date %s before writing",
  async (value) => {
    expect((await patch({ syncStartAt: value })).status).toBe(400);
    expect(db.select().from(accounts).get()?.syncStartAt).toBeNull();
  },
);

it("resets Bitunix's history cursor while keeping its last known account data", async () => {
  db.update(accounts)
    .set({
      broker: "bitunix",
      syncStartAt: "2026-10-01T00:00:00.000Z",
      snapshotJson: JSON.stringify({
        equity: 200,
        bitunixCursorAt: "2026-11-13",
        bitunixImportInitialized: true,
        bitunixFundingBackfillComplete: true,
      }),
    })
    .run();
  expect((await patch({ syncStartAt: "2026-09-01T00:00:00.000Z" })).status).toBe(200);
  expect(JSON.parse(db.select().from(accounts).get()!.snapshotJson!)).toEqual({ equity: 200 });
  expect((await patch({ syncStartAt: null })).status).toBe(400);
});

it("rejects history dates for a balances-only connector, both on create and edit", async () => {
  db.update(accounts).set({ broker: "kraken" }).run();
  expect((await patch({ syncStartAt: "2026-11-01T00:00:00.000Z" })).status).toBe(400);
  const response = await POST(
    new Request("http://localhost/api/accounts", {
      method: "POST",
      body: JSON.stringify({
        name: "New",
        kind: "sync",
        broker: "kraken",
        credentials: {},
        initialSync: false,
        syncStartAt: "2026-11-01T00:00:00.000Z",
      }),
    }),
  );
  expect(response.status).toBe(400);
  expect(db.select().from(accounts).all()).toHaveLength(1);
});
