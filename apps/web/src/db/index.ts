import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import * as schema from "./schema";
import { BOOTSTRAP_SQL } from "./bootstrap";
import { recoverRestore } from "./restore-files";
import { dataDir } from "./data-dir";
export { dataDir } from "./data-dir";

const globalForDb = globalThis as unknown as { __journalDb?: ReturnType<typeof createDb> };

const createDb = () => {
  const dir = dataDir();
  const isBuild = process.env.NEXT_PHASE === "phase-production-build";
  // Next builds evaluate server/API modules in parallel. Keep build-time SQLite
  // isolated per worker so migrations cannot contend for the persistent journal.db.
  if (!isBuild) {
    mkdirSync(dir, { recursive: true });
    recoverRestore(dir);
  }
  const sqlite = new Database(isBuild ? ":memory:" : join(dir, "journal.db"));
  if (!isBuild) sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(BOOTSTRAP_SQL);
  // Upgrade legacy databases before any snapshot migration query references
  // TradingView URL columns. CREATE TABLE IF NOT EXISTS in BOOTSTRAP_SQL does
  // not add columns to tables that already exist.
  const initialTradeColumns = sqlite.pragma("table_info(trades)") as { name: string }[];
  if (!initialTradeColumns.some((column) => column.name === "trading_view_url")) {
    sqlite.exec("ALTER TABLE trades ADD COLUMN trading_view_url TEXT");
  }
  const initialMissedTradeColumns = sqlite.pragma("table_info(missed_trades)") as {
    name: string;
  }[];
  if (!initialMissedTradeColumns.some((column) => column.name === "trading_view_url")) {
    sqlite.exec("ALTER TABLE missed_trades ADD COLUMN trading_view_url TEXT");
  }
  // Move legacy TradingView snapshot blobs out of generic attachments. Legacy
  // screenshots without a saved TradingView URL are intentionally discarded.
  sqlite.exec(`
    INSERT OR IGNORE INTO snapshots (id, owner_type, owner_id, mime, size, data, created_at)
    SELECT lower(hex(randomblob(16))), 'trade', a.owner_id, a.mime, a.size, a.data, a.created_at
    FROM attachments a JOIN trades t ON t.key = a.owner_id
    WHERE a.owner_type = 'trade' AND a.mime LIKE 'image/%'
      AND t.trading_view_url IS NOT NULL AND trim(t.trading_view_url) <> '';
    INSERT OR IGNORE INTO snapshots (id, owner_type, owner_id, mime, size, data, created_at)
    SELECT lower(hex(randomblob(16))), 'missed', a.owner_id, a.mime, a.size, a.data, a.created_at
    FROM attachments a JOIN missed_trades m ON m.id = a.owner_id
    WHERE a.owner_type = 'missed' AND a.mime LIKE 'image/%'
      AND m.trading_view_url IS NOT NULL AND trim(m.trading_view_url) <> '';
    DELETE FROM attachments WHERE owner_type IN ('trade', 'missed');
    DELETE FROM snapshots WHERE owner_type = 'trade' AND NOT EXISTS (
      SELECT 1 FROM trades t WHERE t.key = snapshots.owner_id
        AND t.trading_view_url IS NOT NULL AND trim(t.trading_view_url) <> ''
    );
    DELETE FROM snapshots WHERE owner_type = 'missed' AND NOT EXISTS (
      SELECT 1 FROM missed_trades m WHERE m.id = snapshots.owner_id
        AND m.trading_view_url IS NOT NULL AND trim(m.trading_view_url) <> ''
    );
  `);
  sqlite
    .transaction(() => {
      const columns = sqlite.pragma("table_info(accounts)") as { name: string }[];
      if (!columns.some((column) => column.name === "ibkr_sync_time_zone")) {
        sqlite.exec("ALTER TABLE accounts ADD COLUMN ibkr_sync_time_zone TEXT");
      }
      if (!columns.some((column) => column.name === "sync_start_at")) {
        sqlite.exec("ALTER TABLE accounts ADD COLUMN sync_start_at TEXT");
      }
    })
    .immediate();
  // Additive upgrade: existing executions retain their fields and dedup hashes.
  const executionColumns = sqlite.pragma("table_info(executions)") as { name: string }[];
  if (!executionColumns.some((column) => column.name === "source_instrument_json")) {
    sqlite.exec("ALTER TABLE executions ADD COLUMN source_instrument_json TEXT");
  }
  if (!executionColumns.some((column) => column.name === "import_metadata_json")) {
    sqlite.exec("ALTER TABLE executions ADD COLUMN import_metadata_json TEXT");
  }
  const tradeColumns = sqlite.pragma("table_info(trades)") as { name: string }[];
  sqlite.transaction(() => {
    if (!tradeColumns.some((column) => column.name === "contract_multiplier"))
      sqlite.exec("ALTER TABLE trades ADD COLUMN contract_multiplier REAL");
    if (!tradeColumns.some((column) => column.name === "reason_for_exit_json"))
      sqlite.exec("ALTER TABLE trades ADD COLUMN reason_for_exit_json TEXT");
    if (!tradeColumns.some((column) => column.name === "exit_outcome"))
      sqlite.exec("ALTER TABLE trades ADD COLUMN exit_outcome TEXT");
    if (!tradeColumns.some((column) => column.name === "total_possible_r"))
      sqlite.exec("ALTER TABLE trades ADD COLUMN total_possible_r REAL");
    if (!tradeColumns.some((column) => column.name === "volume_after_tp"))
      sqlite.exec("ALTER TABLE trades ADD COLUMN volume_after_tp TEXT");
    if (!tradeColumns.some((column) => column.name === "price_action_json"))
      sqlite.exec("ALTER TABLE trades ADD COLUMN price_action_json TEXT");
    if (!tradeColumns.some((column) => column.name === "trading_view_url"))
      sqlite.exec("ALTER TABLE trades ADD COLUMN trading_view_url TEXT");
  })();

  // 0.4.1 removes the obsolete historical-candle/replay persistence chain.
  sqlite.exec("DROP TABLE IF EXISTS trade_excursions");
  sqlite.exec("DROP TABLE IF EXISTS market_csv_datasets");

  const journalDayColumns = sqlite.pragma("table_info(journal_days)") as { name: string }[];
  if (!journalDayColumns.some((column) => column.name === "daily_bias_playbooks_json")) {
    sqlite.exec(
      "ALTER TABLE journal_days ADD COLUMN daily_bias_playbooks_json TEXT NOT NULL DEFAULT '[]'",
    );
  }
  if (!journalDayColumns.some((column) => column.name === "start_time")) {
    sqlite.exec("ALTER TABLE journal_days ADD COLUMN start_time TEXT");
  }
  if (!journalDayColumns.some((column) => column.name === "end_time")) {
    sqlite.exec("ALTER TABLE journal_days ADD COLUMN end_time TEXT");
  }

  const templateColumns = sqlite.pragma("table_info(note_templates)") as { name: string }[];
  if (!templateColumns.some((column) => column.name === "scopes_json")) {
    sqlite.exec(
      "ALTER TABLE note_templates ADD COLUMN scopes_json TEXT NOT NULL DEFAULT '[\"all\"]'",
    );
  }

  const progressColumns = sqlite.pragma("table_info(progress_rules)") as { name: string }[];
  if (!progressColumns.some((column) => column.name === "sort_order")) {
    sqlite.exec("ALTER TABLE progress_rules ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
  }

  let missedTradeColumns = sqlite.pragma("table_info(missed_trades)") as {
    name: string;
    notnull: number;
  }[];
  if (missedTradeColumns.some((column) => column.name === "direction")) {
    sqlite.transaction(() => {
      sqlite.exec("ALTER TABLE missed_trades RENAME TO missed_trades_legacy");
      sqlite.exec(`CREATE TABLE missed_trades (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        playbook_id TEXT,
        outcome TEXT,
        tags_json TEXT,
        trading_view_url TEXT,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      )`);
      const legacy = sqlite.pragma("table_info(missed_trades_legacy)") as { name: string }[];
      const has = (name: string) => legacy.some((column) => column.name === name);
      sqlite.exec(`INSERT INTO missed_trades (id, symbol, observed_at, playbook_id, outcome, tags_json, trading_view_url, notes, created_at)
        SELECT id, symbol, observed_at, ${has("playbook_id") ? "playbook_id" : "NULL"},
          ${has("outcome") ? "outcome" : "NULL"}, ${has("tags_json") ? "tags_json" : "NULL"}, ${has("trading_view_url") ? "trading_view_url" : "NULL"},
          ${has("notes") ? "COALESCE(notes, '')" : "''"}, ${has("created_at") ? "created_at" : "''"}
        FROM missed_trades_legacy`);
      sqlite.exec("DROP TABLE missed_trades_legacy");
    })();
    missedTradeColumns = sqlite.pragma("table_info(missed_trades)") as {
      name: string;
      notnull: number;
    }[];
  } else {
    sqlite.transaction(() => {
      if (!missedTradeColumns.some((column) => column.name === "outcome"))
        sqlite.exec("ALTER TABLE missed_trades ADD COLUMN outcome TEXT");
      if (!missedTradeColumns.some((column) => column.name === "trading_view_url"))
        sqlite.exec("ALTER TABLE missed_trades ADD COLUMN trading_view_url TEXT");
      if (!missedTradeColumns.some((column) => column.name === "tags_json"))
        sqlite.exec("ALTER TABLE missed_trades ADD COLUMN tags_json TEXT");
    })();
  }
  sqlite.exec(`CREATE TABLE IF NOT EXISTS missed_trade_rule_checks (
    id TEXT PRIMARY KEY, missed_trade_id TEXT NOT NULL, playbook_id TEXT NOT NULL, rule TEXT NOT NULL, followed INTEGER NOT NULL
  )`);

  return drizzle(sqlite, { schema });
};

/** Singleton across Next dev hot reloads. */
const currentDb = () => globalForDb.__journalDb ?? (globalForDb.__journalDb = createDb());
export const db = new Proxy({} as ReturnType<typeof createDb>, {
  get(_target, key) {
    const current = currentDb();
    const value = Reflect.get(current, key);
    return typeof value === "function" ? value.bind(current) : value;
  },
});

export function closeDb() {
  if (globalForDb.__journalDb) {
    globalForDb.__journalDb.$client.close();
    delete globalForDb.__journalDb;
  }
}

/** Open already-validated data without startup recovery/migrations during replacement. */
export function openRestoredDb() {
  const sqlite = new Database(join(dataDir(), "journal.db"), { fileMustExist: true });
  try {
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    if (sqlite.pragma("integrity_check", { simple: true }) !== "ok")
      throw new Error("Restored database is invalid.");
    globalForDb.__journalDb = drizzle(sqlite, { schema });
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

export * from "./schema";
