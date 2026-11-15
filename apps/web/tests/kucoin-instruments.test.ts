import { afterAll, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const scratch = mkdtempSync(join(tmpdir(), "kucoin-instruments-"));
vi.stubEnv("JOURNAL_DATA_DIR", scratch);
const { kucoinInstruments, retainKucoinInstruments } =
  await import("../src/server/kucoin-instruments");
const { db, executions } = await import("../src/db");
const fill = { symbol: "BTC-USDC", side: "buy", price: "100", size: "2", createdAt: 60000 };
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(scratch, { recursive: true, force: true });
});

it("retains exact pairs under unchanged legacy hashes and makes ambiguous matches permanently unavailable", () => {
  const pairs = kucoinInstruments({ accounts: [], fills: [fill] });
  const [hash, pair] = [...pairs][0]!;
  expect(pair).toBe("BTC-USDC");
  db.insert(executions)
    .values({
      id: "e",
      accountId: "a",
      symbol: "BTC",
      side: "buy",
      quantity: 2,
      price: 100,
      executedAt: new Date(60000).toISOString(),
      source: "sync",
      contentHash: hash,
      createdAt: "now",
    })
    .run();
  retainKucoinInstruments("a", pairs);
  expect(JSON.parse(db.select().from(executions).get()!.sourceInstrumentJson!)).toEqual({
    broker: "kucoin",
    symbol: "BTC-USDC",
  });
  const ambiguous = kucoinInstruments({
    accounts: [],
    fills: [fill, { ...fill, symbol: "BTC-USDT" }],
  });
  expect(ambiguous.get(hash)).toBeNull();
  retainKucoinInstruments("a", ambiguous);
  retainKucoinInstruments("a", pairs);
  const stored = db.select().from(executions).get()!;
  expect(stored.contentHash).toBe(hash);
  expect(stored.symbol).toBe("BTC");
  expect(JSON.parse(stored.sourceInstrumentJson!).symbol).toBeNull();
  expect(stored.importMetadataJson).toBeNull();
});
