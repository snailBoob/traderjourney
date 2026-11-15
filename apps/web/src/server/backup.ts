import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
} from "@zip.js/zip.js/index-native.js";
import { closeDb, dataDir, db, openRestoredDb } from "@/db";
import { recoverRestore, replaceDataFiles, RESTORE_DIRECTORY } from "@/db/restore-files";
import { decryptJson, encryptJson, keyMaterial } from "./crypto";
import { RequestError, requireValue } from "./api";
import { stopDataAccess } from "./data-access";
import { logInfo, logWarn } from "./logger";
import { AI_PROVIDERS, AI_PROVIDER_NAMES, type AiProvider } from "@/lib/ai-settings";
import { AUTH_DIRECTORY } from "@/lib/security-settings";

export const MAX_BACKUP_UPLOAD = 512 * 1024 * 1024;
const MAX_EXPANDED = 1024 * 1024 * 1024;
const MAX_ENTRIES = 10_000;

function schemaDigest(database: Database.Database) {
  const rows = database
    .prepare(
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    )
    .all();
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

function checkPassword(password: string) {
  requireValue(
    password.length === 0 || (password.length >= 12 && password.length <= 1024),
    "Leave the password empty or use 12–1024 characters.",
  );
}

function savedAiKeys(database: Database.Database) {
  const keys = AI_PROVIDERS.map((provider) => `${provider}KeyEnc`);
  return database
    .prepare(`SELECT key, value FROM settings WHERE key IN (${keys.map(() => "?").join(",")})`)
    .all(...keys) as { key: string; value: string }[];
}

function validateDatabase(
  database: Database.Database,
  expectedSchema: string,
  key: Buffer,
  source: "journal" | "backup" = "backup",
) {
  requireValue(
    database.pragma("integrity_check", { simple: true }) === "ok",
    "Backup database failed its integrity check.",
  );
  const foreignKeys = database.pragma("foreign_key_check") as unknown[];
  requireValue(foreignKeys.length === 0, "Backup contains broken database references.");
  requireValue(
    schemaDigest(database) === expectedSchema,
    "This backup uses a different database schema. Restore with the matching TraderJourney version.",
  );
  // Only fields owned by the current credential writers use this envelope format.
  // Legacy/unrelated settings must survive unchanged, regardless of their name.
  const verifyCredential = (value: string, detail: string, remedy: string) => {
    try {
      decryptJson(value, key);
    } catch {
      throw new RequestError(
        source === "journal"
          ? `Backup could not be created: ${detail} cannot be read. ${remedy} and try again.`
          : `Backup cannot be restored: ${detail} cannot be read. ${remedy} on the source installation and create a new backup. Your current data was not replaced.`,
      );
    }
  };
  for (const row of database
    .prepare("SELECT name, credentials_enc FROM accounts WHERE credentials_enc IS NOT NULL")
    .all() as { name: string; credentials_enc: string }[]) {
    verifyCredential(
      row.credentials_enc,
      `the saved connection details for account "${row.name}"`,
      "Re-enter them in Accounts",
    );
  }
  for (const row of savedAiKeys(database)) {
    const provider = row.key.slice(0, -"KeyEnc".length) as AiProvider;
    verifyCredential(
      row.value,
      `the saved API key for ${AI_PROVIDER_NAMES[provider]}`,
      "Re-enter it in Settings → AI",
    );
  }
  for (const table of ["attachments", "snapshots"]) {
    const row = database
      .prepare(`SELECT count(*) AS count FROM ${table} WHERE length(data) != size`)
      .get() as { count: number };
    requireValue(row.count === 0, "Backup contains an incomplete attachment.");
  }
}

export async function createBackup(password: string): Promise<Uint8Array> {
  checkPassword(password);
  const sqlite = db.$client;
  const key = keyMaterial();
  const temporary = mkdtempSync(join(tmpdir(), "journal-backup-"));
  try {
    const snapshot = join(temporary, "journal.db");
    await sqlite.backup(snapshot);
    requireValue(
      lstatSync(snapshot).size <= MAX_EXPANDED,
      "The database exceeds the 1 GiB backup limit.",
    );
    const copy = new Database(snapshot, { readonly: true });
    const schema = schemaDigest(copy);
    try {
      validateDatabase(copy, schema, key, "journal");
    } finally {
      copy.close();
    }
    const writer = new ZipWriter(new Uint8ArrayWriter(), {
      password: password || undefined,
      encryptionStrength: 3,
      useWebWorkers: false,
      level: 0,
    });
    let size = 0;
    let entries = 0;
    const add = async (name: string, content: Uint8Array) => {
      size += content.byteLength;
      requireValue(
        size <= MAX_EXPANDED && ++entries <= MAX_ENTRIES,
        "The data directory exceeds the backup size limit (1 GiB / 10,000 files).",
      );
      await writer.add(name, new Uint8ArrayReader(content));
    };
    await add(
      "backup.json",
      Buffer.from(
        JSON.stringify({
          format: "trade-journal",
          version: 1,
          createdAt: new Date().toISOString(),
          schema,
        }),
      ),
    );
    await add("data/journal.db", readFileSync(snapshot));
    // Export the effective key, including when JOURNAL_SECRET supplies it.
    await add("data/.secret", Buffer.from(key.toString("hex")));
    const walk = async (directory: string, prefix: string) => {
      for (const name of readdirSync(directory)) {
        if (
          !prefix &&
          [
            "journal.db",
            "journal.db-wal",
            "journal.db-shm",
            ".secret",
            RESTORE_DIRECTORY,
            AUTH_DIRECTORY,
          ].includes(name)
        )
          continue;
        const file = join(directory, name);
        const stat = lstatSync(file);
        requireValue(
          !stat.isSymbolicLink(),
          "The data directory contains a symbolic link; it cannot be backed up.",
        );
        const path = prefix ? `${prefix}/${name}` : name;
        requireValue(
          name !== RESTORE_DIRECTORY && !/[\\\x00:]/.test(name),
          "Unsupported filename in the data directory.",
        );
        if (stat.isDirectory()) await walk(file, path);
        else {
          requireValue(
            stat.isFile() && stat.size + size <= MAX_EXPANDED,
            "Unsupported file or backup size limit exceeded.",
          );
          await add(`data/${path}`, readFileSync(file));
        }
      }
    };
    await walk(dataDir(), "");
    const bytes = await writer.close();
    requireValue(
      bytes.byteLength <= MAX_BACKUP_UPLOAD,
      "The backup exceeds the 512 MiB upload limit.",
    );
    logInfo("backup", "backup.created", { bytes: bytes.byteLength });
    return bytes;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export async function restoreBackup(bytes: Uint8Array, password: string) {
  checkPassword(password);
  requireValue(bytes.byteLength <= MAX_BACKUP_UPLOAD, "Backup uploads are limited to 512 MiB.");
  const expectedSchema = schemaDigest(db.$client); // initialize before creating staging files
  const targetKey = keyMaterial();
  const dir = dataDir();
  const root = join(dir, RESTORE_DIRECTORY);
  requireValue(
    !existsSync(root),
    "A previous restore needs recovery. Restart the journal before retrying.",
  );
  const incoming = join(root, "incoming");
  mkdirSync(incoming, { recursive: true, mode: 0o700 });
  let replacing = false;
  try {
    const reader = new ZipReader(new Uint8ArrayReader(bytes), { password, useWebWorkers: false });
    const names = new Set<string>();
    let expanded = 0;
    try {
      const entries = await reader.getEntries();
      requireValue(entries.length <= MAX_ENTRIES, "Too many files in the backup.");
      for (const entry of entries) {
        const name = entry.filename;
        requireValue(
          !entry.directory && !entry.symlink && !entry.zipCrypto,
          "Use a TraderJourney backup ZIP.",
        );
        requireValue(
          !entry.encrypted || password.length > 0,
          "This backup is password-protected. Enter its password.",
        );
        requireValue(!names.has(name), "Duplicate file in backup.");
        names.add(name);
        requireValue(
          name === "backup.json" ||
            (name.startsWith("data/") &&
              name
                .split("/")
                .every(
                  (part) =>
                    part !== "" && part !== "." && part !== ".." && part !== RESTORE_DIRECTORY,
                ) &&
              name !== `data/${AUTH_DIRECTORY}` &&
              !name.startsWith(`data/${AUTH_DIRECTORY}/`) &&
              !/[\\\x00:]/.test(name)),
          "Invalid backup file path.",
        );
        requireValue(
          !["data/journal.db-wal", "data/journal.db-shm"].includes(name),
          "Backup must contain a standalone database.",
        );
        requireValue(
          entry.uncompressedSize <= MAX_EXPANDED - expanded,
          "Expanded backup exceeds 1 GiB.",
        );
        const entryLimit =
          name === "backup.json" ? 4096 : name === "data/.secret" ? 256 : MAX_EXPANDED;
        requireValue(entry.uncompressedSize <= entryLimit, "Invalid backup metadata size.");
        const file =
          name === "backup.json" ? join(root, "backup.json") : join(incoming, name.slice(5));
        mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
        writeFileSync(file, "", { flag: "wx", mode: 0o600 });
        let written = 0;
        await entry.getData(
          new WritableStream<Uint8Array>({
            write(chunk) {
              written += chunk.byteLength;
              expanded += chunk.byteLength;
              requireValue(
                expanded <= MAX_EXPANDED && written <= entryLimit,
                "Expanded backup exceeds its size limit.",
              );
              appendFileSync(file, chunk);
            },
          }),
          { checkSignature: true },
        );
      }
    } finally {
      await reader.close();
    }
    requireValue(
      ["backup.json", "data/journal.db", "data/.secret"].every((name) => names.has(name)),
      "Incomplete TraderJourney backup.",
    );
    const manifest = JSON.parse(readFileSync(join(root, "backup.json"), "utf8"));
    requireValue(
      manifest.format === "trade-journal" &&
        manifest.version === 1 &&
        manifest.schema === expectedSchema,
      "Unsupported backup format or database version.",
    );
    const secret = readFileSync(join(incoming, ".secret"), "utf8").trim();
    requireValue(/^[a-f0-9]{64}$/.test(secret), "Invalid backup encryption key.");
    const sourceKey = Buffer.from(secret, "hex");
    const staged = new Database(join(incoming, "journal.db"), { fileMustExist: true });
    try {
      validateDatabase(staged, expectedSchema, sourceKey);
      staged.pragma("journal_mode = DELETE");
      staged.transaction(() => {
        const accounts = staged
          .prepare("SELECT id, credentials_enc FROM accounts WHERE credentials_enc IS NOT NULL")
          .all() as { id: string; credentials_enc: string }[];
        for (const row of accounts)
          staged
            .prepare("UPDATE accounts SET credentials_enc = ? WHERE id = ?")
            .run(encryptJson(decryptJson(row.credentials_enc, sourceKey), targetKey), row.id);
        for (const row of savedAiKeys(staged))
          staged
            .prepare("UPDATE settings SET value = ? WHERE key = ?")
            .run(encryptJson(decryptJson(row.value, sourceKey), targetKey), row.key);
      })();
      validateDatabase(staged, expectedSchema, targetKey);
    } finally {
      staged.close();
    }
    writeFileSync(join(incoming, ".secret"), targetKey.toString("hex"), { mode: 0o600 });
    // No await below: replacement and rollback are one exclusive server operation.
    db.$client.pragma("wal_checkpoint(TRUNCATE)");
    closeDb();
    replacing = true;
    replaceDataFiles(dir, () => {
      openRestoredDb();
      validateDatabase(db.$client, expectedSchema, targetKey);
    });
    logInfo("backup", "restore.completed");
  } catch (error) {
    if (replacing) {
      closeDb();
      try {
        recoverRestore(dir);
        openRestoredDb();
        logWarn("backup", "restore.rolled_back");
      } catch {
        stopDataAccess();
        throw new Error(
          "Restore recovery could not finish. Stop the server and preserve the data directory for recovery.",
        );
      }
    } else rmSync(root, { recursive: true, force: true });
    if (error instanceof RequestError) throw error;
    throw new RequestError(
      replacing
        ? "Restore failed; the previous data has been restored."
        : "Backup could not be verified. Check the password and ZIP file. Your current data was not replaced.",
    );
  }
}
