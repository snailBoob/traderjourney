import { afterAll, beforeEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";

const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-demo-test-"));
process.env.JOURNAL_DATA_DIR = scratch;
const { db, accounts, executions, trades, settings, notes } = await import("../src/db");
const { loadDemoData, getDemoStatus } = await import("../src/server/demo");
const { insertExecutions } = await import("../src/server/executions");

beforeEach(() => {
  for (const table of [notes, trades, executions, accounts, settings]) db.delete(table).run();
});
afterAll(() => {
  db.$client.close();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});

it("creates exactly 50 closed crypto futures trades over 90 days with 50k capital", () => {
  expect(getDemoStatus().active).toBe(false);
  const result = loadDemoData();
  expect(result.inserted).toBe(100);
  const all = db.select().from(trades).all();
  expect(all).toHaveLength(50);
  expect(new Set(all.map((t) => t.direction))).toEqual(new Set(["long", "short"]));
  expect(new Set(all.map((t) => t.status))).toEqual(new Set(["win", "loss"]));
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (const t of all) {
    expect(t.symbol).toMatch(/USDT$/);
    expect(t.assetClass).toBe("futures");
    expect(t.openQuantity).toBe(0);
    expect(Date.parse(t.openedAt)).toBeGreaterThanOrEqual(today.getTime() - 90 * 86400000);
    expect(Date.parse(t.closedAt!)).toBeLessThan(today.getTime());
  }
  expect(db.select().from(accounts).get()?.initialBalance).toBe(50000);
  expect(getDemoStatus()).toEqual({ accountId: result.accountId, active: true, current: true });
  expect(loadDemoData()).toEqual({ accountId: result.accountId, inserted: 0, alreadyLoaded: true });
  expect(db.select().from(trades).all()).toEqual(all);
});

function legacy() {
  for (const id of ["demo", "real"]) {
    db.insert(accounts)
      .values({
        id,
        name: id,
        broker: id,
        kind: "import",
        initialBalance: 25000,
        createdAt: "2026-01-01",
      })
      .run();
    insertExecutions(
      id,
      [
        {
          symbol: "AAPL",
          side: "buy",
          quantity: 1,
          price: 100,
          fee: 0,
          executedAt: "2026-01-01T10:00:00Z",
        },
        {
          symbol: "AAPL",
          side: "sell",
          quantity: 1,
          price: 110,
          fee: 0,
          executedAt: "2026-01-01T11:00:00Z",
        },
      ],
      "import",
    );
    const trade = db.select().from(trades).where(eq(trades.accountId, id)).get()!;
    db.insert(notes)
      .values({
        id,
        folderId: "trades",
        tradeKey: trade.key,
        content: id,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      })
      .run();
  }
  db.insert(settings).values({ key: "totalCapital", value: "123456" }).run();
}

it("replaces legacy demo trades and notes while preserving real data and global settings", () => {
  legacy();
  const real = db.select().from(trades).where(eq(trades.accountId, "real")).all();
  expect(loadDemoData().accountId).toBe("demo");
  expect(db.select().from(trades).where(eq(trades.accountId, "demo")).all()).toHaveLength(50);
  expect(db.select().from(trades).where(eq(trades.accountId, "real")).all()).toEqual(real);
  expect(
    db
      .select()
      .from(notes)
      .all()
      .map((n) => n.id),
  ).toEqual(["real"]);
  expect(db.select().from(settings).where(eq(settings.key, "totalCapital")).get()?.value).toBe(
    "123456",
  );
});

it("rolls back replacement when rebuilding fails", () => {
  legacy();
  const before = db.select().from(trades).all();
  db.$client.exec(
    "CREATE TRIGGER fail_demo BEFORE INSERT ON trades BEGIN SELECT RAISE(FAIL, 'test failure'); END",
  );
  try {
    expect(() => loadDemoData()).toThrow();
    expect(db.select().from(trades).all()).toEqual(before);
    expect(db.select().from(notes).all()).toHaveLength(2);
    expect(getDemoStatus().current).toBe(false);
  } finally {
    db.$client.exec("DROP TRIGGER fail_demo");
  }
});
