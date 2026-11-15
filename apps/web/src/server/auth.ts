import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/db/data-dir";
import {
  AUTH_DIRECTORY,
  MAX_PASSWORD_LENGTH,
  type SecuritySettings,
} from "@/lib/security-settings";

/**
 * Single-user auth, optional by design: it's your journal on your box. Set
 * JOURNAL_PASSWORD overrides the installation-local password. The stored hash
 * and random session key rotate together, invalidating all previous sessions.
 */
export const AUTH_COOKIE = "journal_session";

interface StoredPassword {
  version: 1;
  salt: string;
  hash: string;
  sessionKey: string;
}

const passwordFile = () => join(dataDir(), AUTH_DIRECTORY, "password.json");
const derive = (password: string, salt: string) =>
  scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

function storedPassword(): StoredPassword | null {
  let text: string;
  try {
    text = readFileSync(passwordFile(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  // Invalid storage must fail closed, never silently disable authentication.
  let value: StoredPassword;
  try {
    value = JSON.parse(text) as StoredPassword;
  } catch {
    throw new Error("Invalid password configuration.");
  }
  if (
    !value ||
    value.version !== 1 ||
    !/^[a-f0-9]{64}$/.test(value.salt) ||
    !/^[a-f0-9]{128}$/.test(value.hash) ||
    !/^[a-f0-9]{64}$/.test(value.sessionKey)
  )
    throw new Error("Invalid password configuration.");
  return value;
}

export const securitySettings = (): SecuritySettings => ({
  configured: passwordConfigured(),
  managedByEnvironment: Boolean(process.env.JOURNAL_PASSWORD),
});

export const passwordConfigured = (): boolean =>
  Boolean(process.env.JOURNAL_PASSWORD || storedPassword());

export const sessionToken = (): string =>
  createHmac("sha256", process.env.JOURNAL_PASSWORD || storedPassword()?.sessionKey || "")
    .update("session-v1")
    .digest("hex");

export const verifyPassword = (candidate: string): boolean => {
  if (!candidate || candidate.length > MAX_PASSWORD_LENGTH) return false;
  const environment = process.env.JOURNAL_PASSWORD;
  const stored = environment ? null : storedPassword();
  if (!environment && !stored) return false;
  const expected = environment
    ? Buffer.from(environment, "utf8")
    : Buffer.from(stored!.hash, "hex");
  const given = environment ? Buffer.from(candidate, "utf8") : derive(candidate, stored!.salt);
  return expected.length === given.length && timingSafeEqual(expected, given);
};

/** Called synchronously after validation: one server per data directory. Atomic replacement. */
export function savePassword(password: string | null): void {
  if (process.env.JOURNAL_PASSWORD) throw new Error("Password is managed by server configuration.");
  if (password === null) {
    rmSync(passwordFile(), { force: true });
    return;
  }
  const salt = randomBytes(32).toString("hex");
  const stored: StoredPassword = {
    version: 1,
    salt,
    hash: derive(password, salt).toString("hex"),
    sessionKey: randomBytes(32).toString("hex"),
  };
  mkdirSync(join(dataDir(), AUTH_DIRECTORY), { recursive: true, mode: 0o700 });
  const temporary = passwordFile() + ".tmp";
  writeFileSync(temporary, JSON.stringify(stored), { mode: 0o600 });
  renameSync(temporary, passwordFile());
}

export const verifySession = (token: string | undefined): boolean => {
  if (!passwordConfigured()) return true;
  if (!token) return false;
  const expected = Buffer.from(sessionToken(), "utf8");
  const given = Buffer.from(token, "utf8");
  return expected.length === given.length && timingSafeEqual(expected, given);
};
