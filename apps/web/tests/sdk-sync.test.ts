import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { binance, webull } from "@luxalgo/broker-sdk/adapters";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrokerAuthError, BrokerRequestError, type BrokerSnapshot } from "@luxalgo/broker-sdk";

const state = vi.hoisted(() => ({ fetchSnapshot: vi.fn(), connect: vi.fn() }));
vi.mock("@luxalgo/broker-sdk", async (original) => ({
  ...(await original<typeof import("@luxalgo/broker-sdk")>()),
  connect: state.connect,
}));
const scratch = mkdtempSync(join(tmpdir(), "journal-sdk-sync-"));
vi.stubEnv("JOURNAL_DATA_DIR", scratch);
const { db, accounts, executions, trades } = await import("../src/db");
const { encryptJson } = await import("../src/server/crypto");
const { syncAccount } = await import("../src/server/sync");
const { rowToTrade } = await import("../src/server/trades-query");
const { insertExecutions } = await import("../src/server/executions");
type Fill = BrokerSnapshot["accounts"][number]["trades"][number];
const fill = (extra: Partial<Fill> = {}): Fill => ({
  symbol: "BTCUSDT",
  side: "buy",
  quantity: 1,
  price: 100,
  fee: 0,
  executedAt: "2026-11-01T10:00:00.000Z",
  ...extra,
});
const snapshot = (fills: Fill[], currency = "USD"): BrokerSnapshot => ({
  broker: "binance",
  fetchedAt: "2026-11-13T10:00:00.000Z",
  accounts: [
    { id: "futures", name: "Futures", currency, equity: 1000, positions: [], trades: fills },
  ],
});
beforeEach(() => {
  db.delete(trades).run();
  db.delete(executions).run();
  db.delete(accounts).run();
  state.connect.mockReset().mockReturnValue({ fetchSnapshot: state.fetchSnapshot });
  state.fetchSnapshot.mockReset();
  db.insert(accounts)
    .values({
      id: "sdk",
      name: "SDK",
      kind: "sync",
      broker: "binance",
      credentialsEnc: encryptJson({ apiKey: "test", apiSecret: "test" }),
      createdAt: "2026-01-01",
      syncStartAt: "2026-10-01T00:00:00.000Z",
    })
    .run();
});
afterAll(() => {
  db.$client.close();
  vi.unstubAllEnvs();
  rmSync(scratch, { recursive: true, force: true });
});
afterEach(() => vi.unstubAllGlobals());

it("exercises real SDK HTTP parsing, authentication failure and recovery without live credentials", async () => {
  const actual = await vi.importActual<typeof import("@luxalgo/broker-sdk")>("@luxalgo/broker-sdk");
  state.connect.mockImplementation(actual.connect);
  db.update(accounts).set({ broker: "alpaca", syncStartAt: null }).run();
  const require = createRequire(import.meta.url);
  const { raw } = JSON.parse(
    readFileSync(require.resolve("@luxalgo/broker-sdk/conformance/vectors/alpaca.json"), "utf8"),
  );
  let denied = false;
  const http = vi.fn<typeof fetch>(async (input, init) => {
    expect(init?.method ?? "GET").toBe("GET");
    if (denied) return new Response('{"message":"test key rejected"}', { status: 401 });
    const path = new URL(String(input)).pathname;
    if (path === "/v2/account") return Response.json(raw.account);
    if (path === "/v2/positions") return Response.json(raw.positions);
    if (path === "/v2/account/activities/FILL") return Response.json(raw.fills);
    throw new Error(`Unexpected SDK request: ${path}`);
  });
  vi.stubGlobal("fetch", http);
  expect(await syncAccount("sdk")).toMatchObject({ inserted: 2, equity: 10500.25, positions: 1 });
  denied = true;
  await expect(syncAccount("sdk")).rejects.toThrow();
  expect(JSON.parse(db.select().from(accounts).get()!.snapshotJson!)).toMatchObject({
    connectionStatus: "disconnected",
    equity: 10500.25,
  });
  denied = false;
  expect(await syncAccount("sdk")).toMatchObject({ inserted: 0, duplicates: 2 });
  expect(JSON.parse(db.select().from(accounts).get()!.snapshotJson!)).toMatchObject({
    connectionStatus: "connected",
    connectionMessage: null,
  });
  expect(http).toHaveBeenCalled();
});

it("retains KuCoin source pairs on real SDK syncs without duplicating legacy fills or losing notes", async () => {
  db.update(accounts)
    .set({
      broker: "kucoin",
      credentialsEnc: encryptJson({ apiKey: "test", apiSecret: "test", passphrase: "test" }),
    })
    .run();
  const fills = [
    {
      symbol: "BTC-USDC",
      side: "buy",
      size: "1",
      price: "100",
      createdAt: Date.parse("2026-11-01T10:00:00Z"),
    },
    {
      symbol: "BTC-USDC",
      side: "sell",
      size: "1",
      price: "110",
      createdAt: Date.parse("2026-11-01T11:00:00Z"),
    },
  ];
  insertExecutions(
    "sdk",
    fills.map((f) => ({
      symbol: "BTC",
      side: f.side as "buy" | "sell",
      quantity: 1,
      price: Number(f.price),
      fee: 0,
      executedAt: new Date(f.createdAt).toISOString(),
    })),
    "sync",
  );
  db.update(trades).set({ notes: "Keep my annotation" }).run();
  const key = db.select().from(trades).get()!.key;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const path = new URL(input).pathname;
      if (path === "/api/v1/accounts") return Response.json({ code: "200000", data: [] });
      if (path === "/api/v1/fills")
        return Response.json({ code: "200000", data: { items: fills } });
      throw new Error(`Unexpected request: ${path}`);
    }),
  );
  for (let i = 0; i < 2; i++) {
    expect(await syncAccount("sdk")).toMatchObject({ inserted: 0, duplicates: 2 });
    expect(db.select().from(trades).get()).toMatchObject({ key, notes: "Keep my annotation" });
    expect(
      db
        .select()
        .from(executions)
        .all()
        .map((row) => JSON.parse(row.sourceInstrumentJson!)),
    ).toEqual([
      { broker: "kucoin", symbol: "BTC-USDC" },
      { broker: "kucoin", symbol: "BTC-USDC" },
    ]);
  }
});

it("keeps simultaneous long and short futures separate, including on repeated sync", async () => {
  state.fetchSnapshot.mockResolvedValue(
    snapshot([
      fill({ assetClass: "futures", positionSide: "long", positionEffect: "open" }),
      fill({ assetClass: "futures", side: "sell", positionSide: "short", positionEffect: "open" }),
      fill({
        assetClass: "futures",
        side: "sell",
        price: 110,
        positionSide: "long",
        positionEffect: "close",
        executedAt: "2026-11-01T11:00:00.000Z",
      }),
      fill({
        assetClass: "futures",
        price: 90,
        positionSide: "short",
        positionEffect: "close",
        executedAt: "2026-11-01T12:00:00.000Z",
      }),
    ]),
  );
  expect(await syncAccount("sdk")).toMatchObject({ inserted: 4 });
  const rows = db.select().from(trades).all();
  expect(rows).toHaveLength(2);
  expect(rows.map((row) => row.netPnl)).toEqual([10, 10]);
  expect(rows.map((row) => row.direction).sort()).toEqual(["long", "short"]);
  expect(await syncAccount("sdk")).toMatchObject({ inserted: 0, duplicates: 4 });
  expect(db.select().from(trades).all()).toEqual(rows);
  expect(state.connect.mock.calls[0]![0].historySince).toBe("2026-10-01T00:00:00.000Z");
});

it("preserves Webull contract size in P&L and the trade API", async () => {
  db.update(accounts).set({ broker: "webull" }).run();
  state.fetchSnapshot.mockResolvedValue(
    snapshot([
      fill({
        symbol: "TSLA 261218C300",
        assetClass: "option",
        multiplier: 100,
        positionEffect: "open",
        price: 2,
        fee: 1,
      }),
      fill({
        symbol: "TSLA 261218C300",
        assetClass: "option",
        multiplier: 100,
        positionEffect: "close",
        side: "sell",
        price: 3,
        fee: 1,
        executedAt: "2026-11-01T11:00:00.000Z",
      }),
    ]),
  );
  await syncAccount("sdk");
  expect(rowToTrade(db.select().from(trades).get()!)).toMatchObject({
    grossPnl: 100,
    netPnl: 98,
    contractMultiplier: 100,
    assetClass: "option",
  });
});

it.each([
  [new BrokerAuthError("binance", "Rejected key"), "disconnected"],
  [new BrokerRequestError("binance", "Rate limit", 429), "unknown"],
  [new BrokerRequestError("binance", "Unavailable", 503), "unknown"],
  [new TypeError("fetch failed"), "unknown"],
])("retains last successful data on %s and recovers on the next sync", async (error, status) => {
  state.fetchSnapshot.mockResolvedValue(snapshot([fill()]));
  await syncAccount("sdk");
  const before = db.select().from(accounts).get()!;
  state.fetchSnapshot.mockRejectedValueOnce(error);
  await expect(syncAccount("sdk")).rejects.toThrow();
  const failed = db.select().from(accounts).get()!;
  expect(failed.lastSyncAt).toBe(before.lastSyncAt);
  expect(JSON.parse(failed.snapshotJson!)).toMatchObject({
    equity: 1000,
    connectionStatus: status,
    syncStatus: "error",
  });
  expect(JSON.parse(failed.snapshotJson!).connectionMessage).toBeTruthy();
  await syncAccount("sdk");
  expect(JSON.parse(db.select().from(accounts).get()!.snapshotJson!)).toMatchObject({
    connectionStatus: "connected",
    syncStatus: "success",
    connectionMessage: null,
  });
});

it("reports skipped and excluded fills instead of calling all fetched fills duplicates", async () => {
  state.fetchSnapshot.mockResolvedValue(
    snapshot([
      fill(),
      fill({ executedAt: undefined }),
      fill({ executedAt: "2026-09-01T00:00:00.000Z" }),
    ]),
  );
  await syncAccount("sdk");
  expect(JSON.parse(db.select().from(accounts).get()!.snapshotJson!).syncMessage).toBe(
    "1 new fill · 0 already imported · 1 skipped · 1 before the start date",
  );
});

it("does not turn a close outside the available history into a new short", async () => {
  state.fetchSnapshot.mockResolvedValue(
    snapshot([
      fill({ side: "sell", positionEffect: "close", positionSide: "long", assetClass: "futures" }),
    ]),
  );
  await syncAccount("sdk");
  expect(db.select().from(trades).all()).toHaveLength(0);
});

it("rejects option history without a reported contract size rather than guessing P&L", async () => {
  db.update(accounts).set({ broker: "webull" }).run();
  state.fetchSnapshot.mockResolvedValue(snapshot([fill({ assetClass: "option" })]));
  await expect(syncAccount("sdk")).rejects.toThrow(/contract size/);
  expect(db.select().from(executions).all()).toHaveLength(0);
});

it("matches explicit opening and closing fills at the same timestamp regardless of API order", async () => {
  state.fetchSnapshot.mockResolvedValue(
    snapshot([
      fill({ side: "sell", price: 110, positionEffect: "close", positionSide: "long" }),
      fill({ positionEffect: "open", positionSide: "long" }),
    ]),
  );
  await syncAccount("sdk");
  expect(db.select().from(trades).get()).toMatchObject({ netPnl: 10, openQuantity: 0 });
});

it("keeps broker subaccounts separate and rejects mixed-currency totals atomically", async () => {
  const data = snapshot([fill()]);
  data.accounts.push({ ...data.accounts[0]!, id: "second", trades: [fill({ side: "sell" })] });
  state.fetchSnapshot.mockResolvedValue(data);
  await syncAccount("sdk");
  expect(db.select().from(trades).all()).toHaveLength(2);
  data.accounts[1]!.currency = "EUR";
  const before = db.select().from(executions).all();
  await expect(syncAccount("sdk")).rejects.toThrow(/currenc/i);
  expect(db.select().from(executions).all()).toEqual(before);
});

it("filters before sync start even when a broker ignores historySince", async () => {
  state.fetchSnapshot.mockResolvedValue(
    snapshot([fill({ executedAt: "2026-09-01T00:00:00.000Z" }), fill()]),
  );
  expect(await syncAccount("sdk")).toMatchObject({ inserted: 1 });
  expect(db.select().from(executions).all()).toHaveLength(1);
});

it("retains identical distinct fills and their identities when input order changes", async () => {
  const data = snapshot([fill(), fill(), fill({ price: 101 })]);
  state.fetchSnapshot.mockResolvedValue(data);
  expect(await syncAccount("sdk")).toMatchObject({ inserted: 3 });
  data.accounts[0]!.trades.reverse();
  expect(await syncAccount("sdk")).toMatchObject({ inserted: 0, duplicates: 3 });
});

it("recognizes pre-upgrade hashes for existing history adapters and preserves annotations", async () => {
  db.update(accounts).set({ broker: "alpaca" }).run();
  const rows = [fill(), fill({ side: "sell", price: 110, executedAt: "2026-11-01T11:00:00.000Z" })];
  insertExecutions(
    "sdk",
    rows.map((row) => ({
      symbol: row.symbol,
      side: row.side,
      quantity: row.quantity,
      price: row.price,
      fee: row.fee ?? 0,
      executedAt: row.executedAt!,
    })),
    "sync",
  );
  db.update(trades).set({ notes: "Existing review", rating: 4 }).run();
  const before = db.select().from(trades).all();
  state.fetchSnapshot.mockResolvedValue(snapshot(rows));
  expect(await syncAccount("sdk")).toMatchObject({ inserted: 0, duplicates: 2 });
  expect(db.select().from(trades).all()).toEqual(before);
});

it.each([
  ["binance", "binance-usdm-futures", binance],
  ["webull", "webull-v3", webull],
] as const)(
  "imports real %s SDK normalization fixtures through SQLite",
  async (broker, vector, adapter) => {
    const require = createRequire(import.meta.url);
    const fixture = JSON.parse(
      readFileSync(
        require.resolve(`@luxalgo/broker-sdk/conformance/vectors/${vector}.json`),
        "utf8",
      ),
    );
    db.update(accounts).set({ broker, syncStartAt: null }).run();
    state.fetchSnapshot.mockResolvedValue({
      broker,
      fetchedAt: "2026-11-13T00:00:00.000Z",
      accounts: adapter.normalize(fixture.raw),
    });
    const first = await syncAccount("sdk");
    expect(first.inserted).toBeGreaterThan(0);
    expect(first.skipped).toBe(0);
    const rows = db
      .select()
      .from(trades)
      .all()
      .map((row) => rowToTrade(row));
    if (broker === "webull") {
      expect(rows.find((row) => row.symbol === "XYZ 261218C55")).toMatchObject({
        assetClass: "option",
        contractMultiplier: 100,
        quantity: 2,
      });
    } else {
      expect(first.equity).toBeCloseTo(1067.25);
      expect(
        rows.find((row) => row.symbol === "ETHUSDT" && row.direction === "short"),
      ).toMatchObject({ assetClass: "futures", contractMultiplier: 1 });
    }
    expect(await syncAccount("sdk")).toMatchObject({ inserted: 0, duplicates: first.inserted });
  },
);
