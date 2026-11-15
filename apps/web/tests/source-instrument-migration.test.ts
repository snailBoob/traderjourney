import { afterAll, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BOOTSTRAP_SQL } from "../src/db/bootstrap";

const scratch = mkdtempSync(join(tmpdir(), "source-instrument-upgrade-"));
vi.stubEnv("JOURNAL_DATA_DIR", scratch);
const legacy = new Database(join(scratch, "journal.db"));
legacy.exec(BOOTSTRAP_SQL.replace("  source_instrument_json TEXT,\n", ""));
legacy.exec(`INSERT INTO executions (id, account_id, symbol, side, quantity, price, executed_at, source, content_hash, created_at)
  VALUES ('old', 'a', 'BTC', 'buy', 1, 100, '2026-01-01', 'sync', 'unchanged', '2026-01-01')`);
const before = legacy.prepare("SELECT * FROM executions").get();
legacy.close();
const { db } = await import("../src/db");

it("adds nullable source instruments while preserving every existing execution field", () => {
  const { source_instrument_json, ...after } = db.$client
    .prepare("SELECT * FROM executions")
    .get() as Record<string, unknown>;
  expect(source_instrument_json).toBeNull();
  expect(after).toEqual(before);
});

afterAll(() => {
  db.$client.close();
  vi.unstubAllEnvs();
  rmSync(scratch, { recursive: true, force: true });
});
