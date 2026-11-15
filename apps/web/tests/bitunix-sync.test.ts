import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";

const scratch = mkdtempSync(join(tmpdir(), "journal-bitunix-"));
vi.stubEnv("JOURNAL_DATA_DIR", scratch);
vi.mock("../src/server/logger", () => ({
  logDebug: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));
const { db, accounts, executions, trades, snapshots, tradeRuleChecks, notes, attachments } =
  await import("../src/db");
const { encryptJson } = await import("../src/server/crypto");
const { syncAccount } = await import("../src/server/sync");
const { syncBitunix } = await import("../src/server/bitunix");
const { rebuildAccount } = await import("../src/server/rebuild");
const { executionHash } = await import("../src/server/ids");
const credentials = { apiKey: "test-only", apiSecret: "test-only" };
const now = Date.parse("2026-11-01T12:00:00Z");
const opened = now - 3_600_000;
const closed = now - 1_800_000;
const reply = (data: unknown, code = 0) =>
  Response.json({ code, msg: code ? "request too frequently" : "Success", data });
// Exchange cash flow: negative is paid; journal cost metadata is positive.
const position = (positionId = "p1", funding = "-0.5") => ({
  positionId,
  funding,
  mtime: closed,
  ctime: opened,
});
const fills = (id = "p1") => [
  {
    tradeId: `${id}-close-a`,
    orderId: `${id}-close`,
    symbol: "BTCUSDT",
    side: "SELL",
    qty: "1",
    price: "110",
    fee: "0.1",
    realizedPNL: "10",
    ctime: String(closed),
  },
  {
    tradeId: `${id}-close-b`,
    orderId: `${id}-close`,
    symbol: "BTCUSDT",
    side: "SELL",
    qty: "1",
    price: "110",
    fee: "0.1",
    realizedPNL: "10",
    ctime: String(closed),
  },
  {
    tradeId: `${id}-entry`,
    orderId: `${id}-entry`,
    symbol: "BTCUSDT",
    side: "BUY",
    qty: "2",
    price: "100",
    fee: "0.1",
    realizedPNL: "0",
    ctime: String(opened),
  },
];
let history: ReturnType<typeof position>[];
let pending: { positionId: string }[];
let emptyIds: Set<string>;
let calls: { url: URL; time: number; headers: Headers }[];
let intercept: ((url: URL) => Response | undefined) | undefined;
let testIndex = 0;
const account = () => db.select().from(accounts).where(eq(accounts.id, "bitunix")).get()!;
const snapshot = () => JSON.parse(account().snapshotJson!);
const settle = async <T>(promise: Promise<T>): Promise<T> => {
  // Attach rejection handling before advancing timers (also for expected errors).
  const result = promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.runAllTimersAsync();
  const outcome = await result;
  if ("error" in outcome) throw outcome.error;
  return outcome.value;
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now + testIndex++ * 86_400_000);
  db.delete(snapshots).run();
  db.delete(tradeRuleChecks).run();
  db.delete(notes).run();
  db.delete(attachments).run();
  db.delete(trades).run();
  db.delete(executions).run();
  db.delete(accounts).run();
  db.insert(accounts)
    .values({
      id: "bitunix",
      name: "Bitunix test",
      kind: "sync",
      broker: "bitunix",
      credentialsEnc: encryptJson(credentials),
      syncStartAt: "2026-10-01",
      createdAt: "2026-10-01",
    })
    .run();
  history = [position()];
  pending = [];
  emptyIds = new Set();
  calls = [];
  intercept = undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit) => {
      const url = new URL(input);
      calls.push({ url, time: Date.now(), headers: new Headers(init.headers) });
      const override = intercept?.(url);
      if (override) return override;
      if (url.pathname.endsWith("get_history_orders")) return reply({ orderList: [], total: 0 });
      if (url.pathname.endsWith("get_history_positions"))
        return reply({ positionList: history, total: history.length });
      if (url.pathname.endsWith("get_pending_positions")) return reply(pending);
      if (url.pathname.endsWith("get_history_trades")) {
        const id = url.searchParams.get("positionId")!;
        const rows = emptyIds.has(id) ? [] : fills(id);
        return reply({ tradeList: rows, total: rows.length });
      }
      if (url.pathname.includes("/tpsl/")) return reply([]);
      if (url.pathname.endsWith("get_pending_orders")) return reply({ orderList: [], total: 0 });
      if (url.pathname.endsWith("/account"))
        return reply({
          available: "1000",
          frozen: "0",
          margin: "0",
          crossUnrealizedPNL: "0",
          isolationUnrealizedPNL: "0",
        });
      throw new Error(`Unexpected endpoint ${url.pathname}`);
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
afterAll(() => {
  db.$client.close();
  vi.unstubAllEnvs();
  rmSync(scratch, { recursive: true, force: true });
});

it("paces 64 positions across concurrent syncs using one shared request budget", async () => {
  history = Array.from({ length: 64 }, (_, i) => position(`p${i}`));
  await settle(
    Promise.all([
      syncBitunix(credentials, "2026-10-01", null),
      syncBitunix(credentials, "2026-10-01", null),
    ]),
  );
  expect(calls.filter(({ url }) => url.pathname.endsWith("get_history_trades"))).toHaveLength(128);
  for (let i = 1; i < calls.length; i++)
    expect(calls[i]!.time - calls[i - 1]!.time).toBeGreaterThanOrEqual(150);
});

it.each([10005, 10006, 429])(
  "retries rate limit %i with fresh signatures and shared cooldown",
  async (code) => {
    let remaining = 2;
    intercept = () =>
      remaining-- > 0
        ? code === 429
          ? new Response("Too many requests", { status: 429, headers: { "Retry-After": "3" } })
          : reply(null, code)
        : undefined;
    await settle(syncAccount("bitunix"));
    expect(calls[1]!.time - calls[0]!.time).toBeGreaterThanOrEqual(code === 429 ? 3000 : 1000);
    expect(calls[2]!.time - calls[1]!.time).toBeGreaterThanOrEqual(code === 429 ? 3000 : 2000);
    expect(calls[1]!.headers.get("nonce")).not.toBe(calls[0]!.headers.get("nonce"));
    expect(calls[1]!.headers.get("timestamp")).not.toBe(calls[0]!.headers.get("timestamp"));
    expect(db.select().from(trades).get()!.fees).toBeCloseTo(0.8);
  },
);

it("bounds retries, preserves the cursor and permits a later successful sync", async () => {
  intercept = () => reply(null, 10006);
  await expect(settle(syncAccount("bitunix"))).rejects.toMatchObject({ code: "10006" });
  expect(calls).toHaveLength(4);
  expect(account().lastSyncAt).toBeNull();
  expect(snapshot().bitunixCursorAt).toBeUndefined();
  expect(db.select().from(executions).all()).toHaveLength(0);
  intercept = undefined;
  await settle(syncAccount("bitunix"));
  expect(account().lastSyncAt).toBeTruthy();
});

it("does not retry signature errors", async () => {
  intercept = () => reply(null, 10007);
  await expect(settle(syncAccount("bitunix"))).rejects.toMatchObject({ code: "10007" });
  expect(calls).toHaveLength(1);
});

it("shares overlapping account syncs and persists same-time funding once", async () => {
  const startedAt = Date.now();
  const first = syncAccount("bitunix");
  expect(syncAccount("bitunix")).toBe(first);
  await settle(first);
  const trade = db.select().from(trades).get()!;
  expect(trade.fees).toBeCloseTo(0.8);
  expect(trade.netPnl).toBeCloseTo(19.2);
  expect(
    db
      .select()
      .from(executions)
      .all()
      .every((row) => row.fee === 0.1),
  ).toBe(true);
  expect(snapshot().bitunixCursorAt).toBe(new Date(startedAt).toISOString());
  expect(snapshot().bitunixFundingBackfillComplete).toBe(true);
  calls = [];
  await settle(syncAccount("bitunix"));
  expect(calls.some(({ url }) => url.pathname.endsWith("get_history_trades"))).toBe(false);
  expect(db.select().from(trades).get()!.fees).toBeCloseTo(0.8);
});

it("repairs old misplaced funding and handles received funding and corrections to zero", async () => {
  await settle(syncAccount("bitunix"));
  for (const row of db.select().from(executions).all()) {
    const metadata = JSON.parse(row.importMetadataJson!);
    metadata.reportedFunding = metadata.id.endsWith("close-a") ? 0.5 : 0;
    db.update(executions)
      .set({ importMetadataJson: JSON.stringify(metadata) })
      .where(eq(executions.id, row.id))
      .run();
  }
  db.update(accounts)
    .set({ snapshotJson: JSON.stringify({ ...snapshot(), bitunixFundingVersion: 1 }) })
    .run();
  await settle(syncAccount("bitunix"));
  expect(db.select().from(trades).get()!.fees).toBeCloseTo(0.8);
  for (const funding of ["0.5", "0"]) {
    history = [{ ...position("p1", funding), mtime: Date.now() }];
    await settle(syncAccount("bitunix"));
    expect(db.select().from(trades).get()!.fees).toBeCloseTo(0.3 - Number(funding));
    expect(db.select().from(executions).all()).toHaveLength(3);
  }
});

it("retries unresolved old positions instead of declaring funding backfill complete", async () => {
  history.push(position("missing"));
  emptyIds.add("missing");
  await settle(syncAccount("bitunix"));
  expect(snapshot().bitunixFundingBackfillComplete).toBe(false);
  expect(snapshot().bitunixUnresolvedPositionIds).toContain("missing");
  emptyIds.clear();
  await settle(syncAccount("bitunix"));
  expect(snapshot().bitunixFundingBackfillComplete).toBe(true);
  expect(db.select().from(trades).all()).toHaveLength(2);
});

it.each([
  { cashFlow: "-0.5", fees: 0.8, netPnl: 19.2 },
  { cashFlow: "0.5", fees: -0.2, netPnl: 20.2 },
])(
  "repairs version 2 cash flow $cashFlow once without duplicating fills",
  async ({ cashFlow, fees, netPnl }) => {
    history = [position("p1", cashFlow)];
    await settle(syncAccount("bitunix"));
    for (const row of db.select().from(executions).all()) {
      const metadata = JSON.parse(row.importMetadataJson!);
      if (metadata.id.endsWith("close-b")) {
        metadata.reportedFunding = Number(cashFlow);
        db.update(executions)
          .set({ importMetadataJson: JSON.stringify(metadata) })
          .where(eq(executions.id, row.id))
          .run();
      }
    }
    db.update(accounts)
      .set({ snapshotJson: JSON.stringify({ ...snapshot(), bitunixFundingVersion: 2 }) })
      .run();
    db.update(trades).set({ notes: "Keep my review", rating: 4 }).run();
    calls = [];
    const repaired = await settle(syncAccount("bitunix"));
    expect(repaired.inserted).toBe(0);
    expect(calls.some(({ url }) => url.pathname.endsWith("get_history_trades"))).toBe(true);
    expect(snapshot().bitunixFundingVersion).toBe(3);
    expect(snapshot().bitunixFundingBackfillComplete).toBe(true);
    const trade = db.select().from(trades).get()!;
    expect(trade.fees).toBeCloseTo(fees);
    expect(trade.netPnl).toBeCloseTo(netPnl);
    expect(trade.notes).toBe("Keep my review");
    expect(trade.rating).toBe(4);
    calls = [];
    await settle(syncAccount("bitunix"));
    expect(calls.some(({ url }) => url.pathname.endsWith("get_history_trades"))).toBe(false);
    expect(db.select().from(trades).get()!.fees).toBeCloseTo(fees);
    expect(db.select().from(executions).all()).toHaveLength(3);
  },
);

it("charges the observed BEAMX long funding payment rather than crediting it", async () => {
  // Independently checked against Bitunix funding-rate history at 2026-10-30
  // 12:00 UTC: positive rate 0.00005, mark 0.004718, long quantity 90,000.
  const paidFunding = 90_000 * 0.004718 * 0.00005;
  expect(paidFunding).toBeCloseTo(0.021231, 9);
  history = [position("p1", "-0.021231")];
  intercept = (url) => {
    if (!url.pathname.endsWith("get_history_trades")) return;
    return reply({
      tradeList: [
        {
          ...fills()[0],
          symbol: "BEAMXUSDT",
          qty: "90000",
          price: "0.004597",
          fee: "0.206865",
          realizedPNL: "-5.67",
        },
        { ...fills()[2], symbol: "BEAMXUSDT", qty: "90000", price: "0.00466", fee: "0.2097" },
      ],
      total: 2,
    });
  };
  await settle(syncAccount("bitunix"));
  const trade = db.select().from(trades).get()!;
  expect(trade.fees).toBeCloseTo(0.437796, 9);
  expect(trade.netPnl).toBeCloseTo(-6.107796, 9);
  const stored = db.select().from(executions).all();
  expect(stored.reduce((total, row) => total + row.fee, 0)).toBeCloseTo(0.416565, 9);
  expect(
    stored.reduce(
      (total, row) => total + (JSON.parse(row.importMetadataJson!).reportedFunding ?? 0),
      0,
    ),
  ).toBeCloseTo(paidFunding, 9);
});

it("keeps full entry history for pending positions during incremental sync", async () => {
  await settle(syncAccount("bitunix"));
  pending = [{ positionId: "open" }];
  calls = [];
  await settle(syncAccount("bitunix"));
  const requests = calls.filter(({ url }) => url.pathname.endsWith("get_history_trades"));
  expect(requests).toHaveLength(1);
  expect(requests[0]!.url.searchParams.get("positionId")).toBe("open");
  expect(requests[0]!.url.searchParams.get("startTime")).toBe(String(Date.parse("2026-10-01")));
});

it("paces pagination and retains every execution beyond a 100-row page", async () => {
  const many = Array.from({ length: 101 }, (_, i) => ({ ...fills()[2]!, tradeId: `entry-${i}` }));
  intercept = (url) => {
    if (!url.pathname.endsWith("get_history_trades")) return;
    const skip = Number(url.searchParams.get("skip"));
    return reply({ tradeList: many.slice(skip, skip + 100), total: many.length });
  };
  const result = await settle(syncBitunix(credentials, "2026-10-01", null));
  expect(result.rows).toHaveLength(101);
  const pages = calls.filter(({ url }) => url.pathname.endsWith("get_history_trades"));
  expect(pages.map(({ url }) => url.searchParams.get("skip"))).toEqual(["0", "100"]);
  expect(pages[1]!.time - pages[0]!.time).toBeGreaterThanOrEqual(150);
});

it("does not mark absent funding as a completed historical reconciliation", async () => {
  history = [position("p1", "")];
  await settle(syncAccount("bitunix"));
  expect(snapshot().bitunixFundingBackfillComplete).toBe(false);
  history = [position()];
  await settle(syncAccount("bitunix"));
  expect(snapshot().bitunixFundingBackfillComplete).toBe(true);
  expect(db.select().from(trades).get()!.fees).toBeCloseTo(0.8);
});

it("honors HTTP-date Retry-After values", async () => {
  let first = true;
  intercept = () => {
    if (!first) return;
    first = false;
    return new Response("rate limited", {
      status: 429,
      headers: { "Retry-After": new Date(Date.now() + 5000).toUTCString() },
    });
  };
  await settle(syncAccount("bitunix"));
  expect(calls[1]!.time - calls[0]!.time).toBeGreaterThanOrEqual(5000);
});

it("repairs minute-truncated MEGA fills by exchange ID and preserves journal data across rekeying", async () => {
  const base = Date.now() - 3_600_000;
  const minute = Math.floor(base / 60000) * 60000;
  let precise = false;
  history = [{ ...position(), mtime: minute + 29000 }];
  intercept = (url) => {
    if (!url.pathname.endsWith("get_history_trades")) return;
    const rows = [
      {
        ...fills()[0],
        tradeId: "mega-close",
        side: "BUY",
        qty: "15000",
        price: "0.04533",
        fee: "0.339975",
        realizedPNL: "-21.21332",
        ctime: String(minute + (precise ? 29000 : 0)),
      },
      {
        ...fills()[1],
        tradeId: "mega-open-a",
        side: "SELL",
        qty: "6332",
        price: "0.04391",
        fee: "0.13901906",
        realizedPNL: "0",
        ctime: String(minute + (precise ? 23000 : 0)),
      },
      {
        ...fills()[2],
        tradeId: "mega-open-b",
        side: "SELL",
        qty: "8668",
        price: "0.04392",
        fee: "0.19034928",
        realizedPNL: "0",
        ctime: String(minute + (precise ? 23000 : 0)),
      },
    ].map((row) => ({ ...row, symbol: "MEGAUSDT" }));
    return reply({ tradeList: rows, total: rows.length });
  };
  history[0]!.funding = "0";
  await settle(syncAccount("bitunix"));
  const before = db.select().from(trades).get()!;
  expect(before.direction).toBe("long");
  expect(before.grossPnl).toBe(0);
  const originalIds = db
    .select()
    .from(executions)
    .all()
    .map((row) => row.id)
    .sort();
  db.update(trades)
    .set({
      notes: "My review",
      tagsJson: '["news"]',
      rating: 4,
      stopLoss: 0.046,
      tradingViewUrl: "https://tradingview.com/x/example",
    })
    .run();
  db.insert(snapshots)
    .values({
      id: "shot",
      ownerType: "trade",
      ownerId: before.key,
      mime: "image/png",
      size: 1,
      data: Buffer.from([1]),
      createdAt: "now",
    })
    .run();
  db.insert(tradeRuleChecks)
    .values({
      id: "check",
      tradeKey: before.key,
      playbookId: "playbook",
      rule: "risk",
      followed: true,
    })
    .run();
  db.insert(notes)
    .values({
      id: "note",
      folderId: "folder",
      tradeKey: before.key,
      content: "linked note",
      createdAt: "now",
      updatedAt: "now",
    })
    .run();
  db.insert(attachments)
    .values({
      id: "attachment",
      ownerType: "trade",
      ownerId: before.key,
      name: "file",
      mime: "text/plain",
      size: 1,
      data: Buffer.from([1]),
      createdAt: "now",
    })
    .run();
  precise = true;
  const repaired = await settle(syncAccount("bitunix"));
  expect(repaired.inserted).toBe(0);
  expect(repaired.corrected).toBe(3);
  expect(
    db
      .select()
      .from(executions)
      .all()
      .map((row) => row.id)
      .sort(),
  ).toEqual(originalIds);
  const after = db.select().from(trades).get()!;
  expect(after.key).not.toBe(before.key);
  expect(after.direction).toBe("short");
  expect(after.grossPnl).toBeCloseTo(-21.21332, 8);
  expect(after.netPnl).toBeCloseTo(-21.88266334, 8);
  expect(after.notes).toBe("My review");
  expect(after.rating).toBe(4);
  expect(after.stopLoss).toBe(0.046);
  expect(after.tagsJson).toBe('["news"]');
  expect(after.tradingViewUrl).toContain("example");
  expect(db.select().from(snapshots).get()!.ownerId).toBe(after.key);
  expect(db.select().from(tradeRuleChecks).get()!.tradeKey).toBe(after.key);
  expect(db.select().from(notes).get()!.tradeKey).toBe(after.key);
  expect(db.select().from(attachments).get()!.ownerId).toBe(after.key);
  const repeated = await settle(syncAccount("bitunix"));
  expect(repeated.inserted).toBe(0);
  expect(repeated.corrected).toBe(0);
  expect(db.select().from(trades).all()).toHaveLength(1);
});

it("reconciles recent unchanged-mtime positions across midnight, including fee and PnL corrections", async () => {
  history = [{ ...position(), mtime: Date.now() - 30 * 3_600_000 }];
  await settle(syncAccount("bitunix"));
  intercept = (url) =>
    url.pathname.endsWith("get_history_trades")
      ? reply({
          tradeList: fills().map((row) =>
            row.tradeId.endsWith("close-a") ? { ...row, fee: "0.3", realizedPNL: "12" } : row,
          ),
          total: 3,
        })
      : undefined;
  const result = await settle(syncAccount("bitunix"));
  expect(result.inserted).toBe(0);
  expect(result.corrected).toBe(1);
  expect(db.select().from(trades).get()!.netPnl).toBeCloseTo(21);
});

it("performs a one-time full execution repair outside 48 hours", async () => {
  await settle(syncAccount("bitunix"));
  db.update(executions).set({ fee: 999 }).run();
  db.update(accounts)
    .set({
      snapshotJson: JSON.stringify({ ...snapshot(), bitunixReconciliationVersion: undefined }),
    })
    .run();
  const result = await settle(syncAccount("bitunix"));
  expect(result.corrected).toBe(3);
  expect(snapshot().bitunixReconciliationVersion).toBe(1);
  expect(db.select().from(trades).get()!.fees).toBeCloseTo(0.8);
  calls = [];
  await settle(syncAccount("bitunix"));
  expect(calls.some(({ url }) => url.pathname.endsWith("get_history_trades"))).toBe(false);
});

it("collapses duplicate exchange IDs without deleting absent API fills", async () => {
  history = [{ ...position(), mtime: Date.now() }];
  await settle(syncAccount("bitunix"));
  const original = db
    .select()
    .from(executions)
    .all()
    .find((row) => JSON.parse(row.importMetadataJson!).id.endsWith("entry"))!;
  const copy = { ...original, id: "duplicate", executedAt: new Date(opened + 1000).toISOString() };
  copy.contentHash = executionHash({
    ...copy,
    importMetadata: JSON.parse(copy.importMetadataJson!),
  });
  db.insert(executions).values(copy).run();
  rebuildAccount("bitunix");
  const result = await settle(syncAccount("bitunix"));
  expect(result.corrected).toBe(1);
  expect(db.select().from(executions).all()).toHaveLength(3);
  intercept = (url) =>
    url.pathname.endsWith("get_history_trades")
      ? reply({ tradeList: [fills()[0]], total: 1 })
      : undefined;
  await settle(syncAccount("bitunix"));
  expect(db.select().from(executions).all()).toHaveLength(3);
  expect(snapshot().bitunixUnresolvedPositionIds).toContain("p1");
  expect(snapshot().bitunixReconciliationVersion).toBe(0);
});

it("rolls back corrected fills and cursor if journal preservation fails", async () => {
  history = [{ ...position(), mtime: Date.now() }];
  await settle(syncAccount("bitunix"));
  const before = db.select().from(executions).all();
  const cursor = snapshot().bitunixCursorAt;
  // Force a persistence failure during the rebuild after execution updates.
  db.$client.exec(
    "CREATE TRIGGER reject_rebuild BEFORE UPDATE ON trades BEGIN SELECT RAISE(ABORT, 'test rebuild failure'); END;",
  );
  intercept = (url) =>
    url.pathname.endsWith("get_history_trades")
      ? reply({ tradeList: fills().map((row) => ({ ...row, fee: "0.2" })), total: 3 })
      : undefined;
  try {
    await expect(settle(syncAccount("bitunix"))).rejects.toThrow("test rebuild failure");
    expect(db.select().from(executions).all()).toEqual(before);
    expect(snapshot().bitunixCursorAt).toBe(cursor);
  } finally {
    db.$client.exec("DROP TRIGGER reject_rebuild");
  }
});
