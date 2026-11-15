import { afterAll, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BOOTSTRAP_SQL } from "../src/db/bootstrap";

const scratch = mkdtempSync(join(tmpdir(), "journal-broker-upgrade-"));
vi.stubEnv("JOURNAL_DATA_DIR", scratch);
const legacy = new Database(join(scratch, "journal.db"));
legacy.exec(BOOTSTRAP_SQL);
legacy.exec(`INSERT INTO trades
  (key, account_id, symbol, direction, status, opened_at, quantity, open_quantity,
   avg_entry, gross_pnl, fees, net_pnl, execution_count, execution_ids_json, exits_json, notes)
  VALUES ('old', 'account', 'ES', 'long', 'open', '2026-01-01', 1, 1, 100, 0, 0, 0, 1, '[]', '[]', 'Keep review')`);
const before = legacy.prepare("SELECT * FROM trades").get();
legacy.close();
const { db, trades } = await import("../src/db");

it("adds nullable broker contract size without rewriting historical trades", () => {
  const { contract_multiplier, ...after } = db.$client
    .prepare("SELECT * FROM trades")
    .get() as Record<string, unknown>;
  expect(contract_multiplier).toBeNull();
  expect(after).toEqual(before);
  expect(db.select().from(trades).get()?.contractMultiplier).toBeNull();
});

afterAll(() => {
  db.$client.close();
  vi.unstubAllEnvs();
  rmSync(scratch, { recursive: true, force: true });
});
