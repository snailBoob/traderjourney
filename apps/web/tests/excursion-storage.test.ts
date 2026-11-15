import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";

const scratch = mkdtempSync(join(tmpdir(), "journal-excursions-"));
vi.stubEnv("JOURNAL_DATA_DIR", scratch);
vi.mock("../src/server/excursion-market-data", () => ({ fetchExcursionCandles: vi.fn() }));
vi.mock("../src/server/logger", () => ({ logWarn: vi.fn() }));
const { db, accounts, trades, executions, excursionResults } = await import("../src/db");
const { rebuildAccount } = await import("../src/server/rebuild");
const { readExcursions, processExcursions, refreshAccountExcursions } =
  await import("../src/server/excursions");
const { fetchExcursionCandles } = await import("../src/server/excursion-market-data");
const start = Date.parse("2026-11-12T11:27:00Z");
const rows = () => db.select().from(trades).all();
const view = () => readExcursions(rows()).views.get(rows()[0]!.key)!;

beforeEach(() => {
  vi.stubEnv("JOURNAL_PASSWORD", "");
  db.delete(excursionResults).run();
  db.delete(trades).run();
  db.delete(executions).run();
  db.delete(accounts).run();
  vi.mocked(fetchExcursionCandles)
    .mockReset()
    .mockResolvedValue([
      { time: start, high: 102, low: 99 },
      { time: start + 60000, high: 103, low: 98 },
    ]);
  db.insert(accounts)
    .values({
      id: "a",
      name: "Bitunix",
      kind: "sync",
      broker: "bitunix",
      createdAt: new Date(start).toISOString(),
    })
    .run();
  for (const [id, side, price, time] of [
    ["entry", "buy", 100, start],
    ["exit", "sell", 101, start + 120000],
  ] as const) {
    db.insert(executions)
      .values({
        id,
        accountId: "a",
        symbol: "BTCUSDT",
        side,
        quantity: 2,
        price,
        fee: 0,
        executedAt: new Date(time).toISOString(),
        source: "sync",
        contentHash: id,
        createdAt: new Date(start).toISOString(),
      })
      .run();
  }
  rebuildAccount("a");
  db.update(trades).set({ stopLoss: 95, notes: "User notes", totalPossibleR: 3 }).run();
});
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(scratch, { recursive: true, force: true });
});

it("persists results, preserves annotations and makes repeated reads/syncs network-free", async () => {
  expect(readExcursions(rows()).pending).toBe(true);
  await refreshAccountExcursions("a");
  expect(view()).toMatchObject({ maeR: 0.4, mfeR: 0.6, realizedR: 0.2 });
  rebuildAccount("a");
  await refreshAccountExcursions("a");
  expect(fetchExcursionCandles).toHaveBeenCalledTimes(1);
  expect(rows()[0]).toMatchObject({ stopLoss: 95, notes: "User notes", totalPossibleR: 3 });
  expect(readExcursions(rows()).pending).toBe(false);
});

it("hides stale results immediately after SL corrections or execution edits", async () => {
  await refreshAccountExcursions("a");
  db.update(trades).set({ stopLoss: 90 }).run();
  expect(view().maeR).toBeNull();
  await refreshAccountExcursions("a");
  expect(view()).toMatchObject({ maeR: 0.2, mfeR: 0.3, realizedR: 0.1 });
  db.update(executions).set({ price: 102 }).where(eq(executions.id, "exit")).run();
  rebuildAccount("a");
  expect(view().maeR).toBeNull();
  await refreshAccountExcursions("a");
  expect(view().realizedR).toBe(0.2);
});

it("does not fetch missing SLs or other brokers and excludes incomplete history", async () => {
  db.update(trades).set({ stopLoss: null }).run();
  await refreshAccountExcursions("a");
  expect(view().reason).toMatch(/original SL/);
  db.update(trades).set({ stopLoss: 95 }).run();
  db.update(accounts).set({ broker: "alpaca" }).run();
  await refreshAccountExcursions("a");
  expect(fetchExcursionCandles).not.toHaveBeenCalled();
  db.update(accounts).set({ broker: "bitunix" }).run();
  vi.mocked(fetchExcursionCandles).mockResolvedValue([{ time: start, high: 102, low: 99 }]);
  await refreshAccountExcursions("a");
  expect(view().maeR).toBeNull();
  expect(view().reason).toMatch(/history/);
  await refreshAccountExcursions("a");
  expect(fetchExcursionCandles).toHaveBeenCalledTimes(1);
});

it("routes new providers and never reuses results from a different exchange", async () => {
  await refreshAccountExcursions("a");
  db.update(accounts).set({ broker: "binance" }).run();
  db.update(trades).set({ assetClass: "futures" }).run();
  expect(view().maeR).toBeNull();
  await refreshAccountExcursions("a");
  expect(fetchExcursionCandles).toHaveBeenLastCalledWith(
    "BTCUSDT",
    start,
    start + 120000,
    "binance",
  );
  expect(view().maeR).toBe(0.4);
  db.update(accounts).set({ broker: "hyperliquid" }).run();
  db.update(trades).set({ symbol: "xyz:XYZ100" }).run();
  await refreshAccountExcursions("a");
  expect(fetchExcursionCandles).toHaveBeenLastCalledWith(
    "xyz:XYZ100",
    start,
    start + 120000,
    "hyperliquid",
  );
});

it("requires a proven KuCoin pair on every execution, including after cache population", async () => {
  db.update(accounts).set({ broker: "kucoin" }).run();
  db.update(trades).set({ symbol: "BTC" }).run();
  expect(view().reason).toMatch(/exact KuCoin pair/);
  expect(readExcursions(rows()).tasks).toHaveLength(0);
  db.update(executions)
    .set({ sourceInstrumentJson: JSON.stringify({ broker: "kucoin", symbol: "BTC-USDC" }) })
    .run();
  await refreshAccountExcursions("a");
  expect(fetchExcursionCandles).toHaveBeenLastCalledWith(
    "BTC-USDC",
    start,
    start + 120000,
    "kucoin",
  );
  db.update(executions)
    .set({ sourceInstrumentJson: JSON.stringify({ broker: "kucoin", symbol: "BTC-USDT" }) })
    .where(eq(executions.id, "exit"))
    .run();
  expect(view().maeR).toBeNull();
  expect(readExcursions(rows()).tasks).toHaveLength(0);
});

it("rejects stale in-flight results when the stop changes", async () => {
  const tasks = readExcursions(rows()).tasks;
  vi.mocked(fetchExcursionCandles).mockImplementation(async () => {
    db.update(trades).set({ stopLoss: 90 }).run();
    return [
      { time: start, high: 102, low: 99 },
      { time: start + 60000, high: 103, low: 98 },
    ];
  });
  await processExcursions(tasks);
  expect(db.select().from(excursionResults).all()).toHaveLength(0);
  expect(view().maeR).toBeNull();
});

it("deletes derived results with their trade", async () => {
  await refreshAccountExcursions("a");
  expect(db.select().from(excursionResults).all()).toHaveLength(1);
  db.delete(trades).run();
  expect(db.select().from(excursionResults).all()).toHaveLength(0);
});

it("serves one consistent cohort to the dashboard and both trade tables, respecting filters", async () => {
  await refreshAccountExcursions("a");
  const { GET: stats } = await import("../src/app/api/stats/route");
  const { GET: tradeList } = await import("../src/app/api/trades/route");
  const { GET: day } = await import("../src/app/api/journal/[date]/route");
  const statsResponse = await stats(new Request("http://localhost/api/stats?accounts=a"));
  expect(statsResponse.status).toBe(200);
  const payload = await statsResponse.json();
  expect(payload.excursions).toMatchObject({
    covered: 1,
    total: 1,
    maeR: 0.4,
    mfeR: 0.6,
    realizedR: 0.2,
    winnerMaeR: 0.4,
  });
  const filtered = await (
    await stats(new Request("http://localhost/api/stats?accounts=other"))
  ).json();
  expect(filtered.excursions).toMatchObject({ covered: 0, total: 0, maeR: null });
  const list = await (await tradeList(new Request("http://localhost/api/trades?view=list"))).json();
  expect(list.trades[0].excursion).toMatchObject({ maeR: 0.4, mfeR: 0.6 });
  const journal = await (
    await day(new Request("http://localhost/api/journal/2026-11-12"), {
      params: Promise.resolve({ date: "2026-11-12" }),
    })
  ).json();
  expect(journal.trades[0].excursion).toEqual(list.trades[0].excursion);
  expect(fetchExcursionCandles).toHaveBeenCalledTimes(1);
});
