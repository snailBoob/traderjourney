import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
} from "@zip.js/zip.js/index-native.js";
import * as database from "../src/db";
import { createBackup, restoreBackup } from "../src/server/backup";
import { decryptJson, encryptJson } from "../src/server/crypto";
import { enterDataAccess } from "../src/server/data-access";
import { recoverRestore, replaceDataFiles, RESTORE_DIRECTORY } from "../src/db/restore-files";
import { POST } from "../src/app/api/backup/route";
import { savePassword, sessionToken, verifyPassword } from "../src/server/auth";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
const password = "a strong backup password";
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "journal-backup-test-"));
  vi.stubEnv("JOURNAL_DATA_DIR", directory);
  vi.stubEnv("JOURNAL_PASSWORD", "");
  vi.stubEnv("JOURNAL_SECRET", "");
  database.closeDb();
});
afterEach(() => {
  database.closeDb();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

function seed() {
  database.db.$client
    .prepare("INSERT INTO accounts (id,name,kind,credentials_enc,created_at) VALUES (?,?,?,?,?)")
    .run("test", "Original", "sync", encryptJson({ token: "private-broker-token" }), "2026-01-01");
  database.db.$client
    .prepare("INSERT INTO settings VALUES (?,?)")
    .run("openaiKeyEnc", encryptJson("private-ai-key"));
  database.db.$client
    .prepare("INSERT INTO attachments VALUES (?,?,?,?,?,?,?,?)")
    .run(
      "file",
      "note",
      "note-id",
      "image.png",
      "image/png",
      4,
      Buffer.from([1, 2, 3, 4]),
      "2026-01-01",
    );
  mkdirSync(join(directory, "extra"));
  writeFileSync(join(directory, "extra", "note.txt"), "original extra file");
}

async function entries(bytes: Uint8Array) {
  const reader = new ZipReader(new Uint8ArrayReader(bytes), { password, useWebWorkers: false });
  try {
    const result: Record<string, Uint8Array> = {};
    for (const entry of await reader.getEntries()) {
      expect(entry.encrypted).toBe(true);
      if (!entry.directory) result[entry.filename] = await entry.getData(new Uint8ArrayWriter());
    }
    return result;
  } finally {
    await reader.close();
  }
}

async function zip(files: Record<string, Uint8Array>) {
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    password,
    encryptionStrength: 3,
    useWebWorkers: false,
    level: 0,
  });
  for (const [name, bytes] of Object.entries(files))
    await writer.add(name, new Uint8ArrayReader(bytes));
  return writer.close();
}

describe("portable encrypted backup", () => {
  it("excludes installation passwords, preserves them on restore and rejects injected auth files", async () => {
    seed();
    savePassword("installation password");
    const originalSession = sessionToken();
    const archive = await createBackup(password);
    const files = await entries(archive);
    expect(Object.keys(files).some((name) => name.includes(".auth"))).toBe(false);
    await restoreBackup(archive, password);
    expect(verifyPassword("installation password")).toBe(true);
    expect(sessionToken()).toBe(originalSession);
    files["data/.auth/password.json"] = new TextEncoder().encode("{}");
    await expect(restoreBackup(await zip(files), password)).rejects.toThrow(
      "Invalid backup file path",
    );
    expect(verifyPassword("installation password")).toBe(true);
  });
  it("preserves unrelated legacy settings without treating their suffix as an encrypted API key", async () => {
    seed();
    database.db.$client
      .prepare("INSERT INTO settings VALUES (?, ?)")
      .run("marketData:bitunix-futures:keyEnc", "legacy-format");
    const archive = await createBackup(password);
    await restoreBackup(archive, password);
    expect(
      database.db.$client
        .prepare("SELECT value FROM settings WHERE key = ?")
        .get("marketData:bitunix-futures:keyEnc"),
    ).toEqual({ value: "legacy-format" });
  });

  it.each(["malformed-value", "wrong-encryption-key"])(
    "explains which AI connection to repair for %s without exposing its secret",
    async (value) => {
      seed();
      const stored =
        value === "wrong-encryption-key" ? encryptJson("private-key", Buffer.alloc(32, 1)) : value;
      database.db.$client
        .prepare("UPDATE settings SET value=? WHERE key='openaiKeyEnc'")
        .run(stored);
      await expect(createBackup(password)).rejects.toThrow(
        "saved API key for OpenAI cannot be read. Re-enter it in Settings → AI",
      );
    },
  );

  it("identifies the account when saved broker credentials cannot be read", async () => {
    seed();
    database.db.$client.prepare("UPDATE accounts SET credentials_enc='malformed-value'").run();
    await expect(createBackup(password)).rejects.toThrow(
      'saved connection details for account "Original" cannot be read. Re-enter them in Accounts',
    );
  });

  it("creates and restores a ZIP without a password when the password is left empty", async () => {
    seed();
    const archive = await createBackup("");
    const reader = new ZipReader(new Uint8ArrayReader(archive), { useWebWorkers: false });
    try {
      for (const entry of await reader.getEntries()) {
        expect(entry.encrypted).toBe(false);
        if (!entry.directory)
          expect((await entry.getData(new Uint8ArrayWriter())).length).toBeGreaterThan(0);
      }
    } finally {
      await reader.close();
    }
    database.db.$client.prepare("UPDATE accounts SET name='Changed'").run();
    await restoreBackup(archive, "");
    const account = database.db.$client
      .prepare("SELECT name, credentials_enc FROM accounts")
      .get() as { name: string; credentials_enc: string };
    expect(account.name).toBe("Original");
    expect(decryptJson(account.credentials_enc)).toEqual({ token: "private-broker-token" });
    expect(existsSync(join(directory, RESTORE_DIRECTORY))).toBe(false);
  });

  it("still requires a password for encrypted backups and preserves the current data", async () => {
    seed();
    const archive = await createBackup(password);
    database.db.$client.prepare("UPDATE accounts SET name='Keep current data'").run();
    await expect(restoreBackup(archive, "")).rejects.toThrow("password-protected");
    expect(database.db.$client.prepare("SELECT name FROM accounts").get()).toEqual({
      name: "Keep current data",
    });
    expect(existsSync(join(directory, RESTORE_DIRECTORY))).toBe(false);
  });

  it("restores WAL writes, binary attachments, extra files and credentials into a different installation", async () => {
    vi.stubEnv("JOURNAL_SECRET", "source-server-secret");
    seed();
    const archive = await createBackup(password);
    expect(Buffer.from(archive).includes(Buffer.from("private-broker-token"))).toBe(false);
    expect(Object.keys(await entries(archive))).toEqual([
      "backup.json",
      "data/journal.db",
      "data/.secret",
      "data/extra/note.txt",
    ]);
    database.closeDb();
    const target = join(directory, "target");
    vi.stubEnv("JOURNAL_DATA_DIR", target);
    vi.stubEnv("JOURNAL_SECRET", "different-target-server-secret");
    database.db.$client.prepare("INSERT INTO settings VALUES ('old-only','remove me')").run();
    await restoreBackup(archive, password);
    const account = database.db.$client
      .prepare("SELECT name, credentials_enc FROM accounts")
      .get() as { name: string; credentials_enc: string };
    expect(account.name).toBe("Original");
    expect(decryptJson(account.credentials_enc)).toEqual({ token: "private-broker-token" });
    expect(
      decryptJson(
        (
          database.db.$client
            .prepare("SELECT value FROM settings WHERE key='openaiKeyEnc'")
            .get() as { value: string }
        ).value,
      ),
    ).toBe("private-ai-key");
    expect(
      database.db.$client.prepare("SELECT * FROM settings WHERE key='old-only'").get(),
    ).toBeUndefined();
    expect(
      (database.db.$client.prepare("SELECT data FROM attachments").get() as { data: Buffer }).data,
    ).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(readFileSync(join(target, "extra/note.txt"), "utf8")).toBe("original extra file");
    expect(existsSync(join(target, RESTORE_DIRECTORY))).toBe(false);
    database.closeDb();
    expect(database.db.$client.prepare("SELECT count(*) AS count FROM accounts").get()).toEqual({
      count: 1,
    });
  });

  it("also transfers generated local secrets and leaves no plaintext staging directory", async () => {
    seed();
    const archive = await createBackup(password);
    database.db.$client.prepare("UPDATE accounts SET name='Changed'").run();
    await restoreBackup(archive, password);
    expect(database.db.$client.prepare("SELECT name FROM accounts").get()).toEqual({
      name: "Original",
    });
    expect(existsSync(join(directory, RESTORE_DIRECTORY))).toBe(false);
  });

  it("does not replace any live data for an incorrect password", async () => {
    seed();
    const archive = await createBackup(password);
    await expect(restoreBackup(archive, "incorrect-password")).rejects.toThrow(
      "could not be verified",
    );
    expect(database.db.$client.prepare("SELECT name FROM accounts").get()).toEqual({
      name: "Original",
    });
    expect(existsSync(join(directory, RESTORE_DIRECTORY))).toBe(false);
  });

  it.each(["corrupt database", "wrong key", "wrong schema", "path traversal"])(
    "rejects %s before replacement",
    async (problem) => {
      seed();
      const files = await entries(await createBackup(password));
      if (problem === "corrupt database") files["data/journal.db"] = Buffer.from("not SQLite");
      if (problem === "wrong key") files["data/.secret"] = Buffer.from("a".repeat(64));
      if (problem === "wrong schema")
        files["backup.json"] = Buffer.from(
          JSON.stringify({ format: "trade-journal", version: 1, schema: "wrong" }),
        );
      if (problem === "path traversal") files["data/../escaped"] = Buffer.from("escape");
      await expect(restoreBackup(await zip(files), password)).rejects.toThrow();
      expect(database.db.$client.prepare("SELECT name FROM accounts").get()).toEqual({
        name: "Original",
      });
      expect(existsSync(join(directory, "escaped"))).toBe(false);
      expect(existsSync(join(directory, RESTORE_DIRECTORY))).toBe(false);
    },
  );

  it("automatically rolls back when verification fails after the files were replaced", async () => {
    seed();
    const archive = await createBackup(password);
    database.db.$client.prepare("UPDATE accounts SET name='Keep this current data'").run();
    const open = database.openRestoredDb;
    vi.spyOn(database, "openRestoredDb").mockImplementationOnce(() => {
      open();
      throw new Error("injected reopen failure");
    });
    await expect(restoreBackup(archive, password)).rejects.toThrow(
      "previous data has been restored",
    );
    expect(database.db.$client.prepare("SELECT name FROM accounts").get()).toEqual({
      name: "Keep this current data",
    });
    expect(existsSync(join(directory, RESTORE_DIRECTORY))).toBe(false);
  });
});

it("recovers an interrupted file replacement before startup and removes new-only files", () => {
  writeFileSync(join(directory, "original"), "old");
  const incoming = join(directory, RESTORE_DIRECTORY, "incoming");
  mkdirSync(incoming, { recursive: true });
  writeFileSync(join(incoming, "original"), "new");
  writeFileSync(join(incoming, "new-only"), "new");
  expect(() =>
    replaceDataFiles(directory, () => {
      throw new Error("interruption");
    }),
  ).toThrow("interruption");
  recoverRestore(directory);
  expect(readFileSync(join(directory, "original"), "utf8")).toBe("old");
  expect(existsSync(join(directory, "new-only"))).toBe(false);
  recoverRestore(directory);
});

it("does not switch databases while another request or sync is active", () => {
  const request = enterDataAccess()!;
  expect(enterDataAccess(true)).toBeNull();
  request();
  const exclusive = enterDataAccess(true)!;
  expect(enterDataAccess()).toBeNull();
  expect(enterDataAccess(true)).toBeNull();
  exclusive();
  const next = enterDataAccess();
  expect(next).not.toBeNull();
  next!();
});

it("authenticates backup requests and rejects cross-origin restore", async () => {
  vi.stubEnv("JOURNAL_PASSWORD", "server-login");
  expect(
    (await POST(new Request("http://localhost/api/backup?action=create", { method: "POST" })))
      .status,
  ).toBe(401);
  vi.stubEnv("JOURNAL_PASSWORD", "");
  expect(
    (
      await POST(
        new Request("http://localhost/api/backup?action=restore", {
          method: "POST",
          headers: { origin: "https://other.test", "x-journal-backup": "1" },
        }),
      )
    ).status,
  ).toBe(400);
});

it.each([
  ["http://192.168.8.234:40004", "Choose backup or restore."],
  ["http://192.168.8.234:3000", "Cross-origin backup requests are not allowed."],
  ["http://other.test:40004", "Cross-origin backup requests are not allowed."],
  ["http://localhost:3000", "Cross-origin backup requests are not allowed."],
])(
  "checks browser origin %s against the forwarded request host and port",
  async (origin, error) => {
    const response = await POST(
      new Request("http://localhost:3000/api/backup?action=invalid", {
        method: "POST",
        headers: { host: "192.168.8.234:40004", origin, "x-journal-backup": "1" },
      }),
    );
    expect(await response.json()).toEqual({ error });
  },
);
