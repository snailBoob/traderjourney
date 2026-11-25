import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { dataDir } from "@/db/data-dir";
import type { McpAccess } from "@/lib/mcp-settings";
import { MAX_MCP_CONNECTIONS, MCP_ACCESS } from "@/lib/mcp-settings";
import { AUTH_DIRECTORY } from "@/lib/security-settings";
import { passwordConfigured } from "./auth";
import { newId, nowIso } from "./ids";

const tokenFormat = /^[a-fA-F0-9]{64}$/;
const digest = (value: string) => createHash("sha256").update(value).digest();
const legacyToken = () => {
  const value = process.env.JOURNAL_MCP_TOKEN?.trim();
  return value && tokenFormat.test(value) ? value : null;
};
const storedConnections = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    access: z.enum(MCP_ACCESS),
    createdAt: z.string(),
    enabled: z.boolean().default(true),
    tokenHash: z.string().regex(tokenFormat),
  }),
);
const directory = () => join(dataDir(), AUTH_DIRECTORY);
const file = () => join(directory(), "mcp-connections.json");
const stateFile = () => join(directory(), "mcp-enabled.json");

function mcpEnabled() {
  try {
    return JSON.parse(readFileSync(stateFile(), "utf8")) === true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw new Error("Invalid MCP switch storage.");
  }
}

function load(): z.infer<typeof storedConnections> {
  try {
    return storedConnections.parse(JSON.parse(readFileSync(file(), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error("Invalid MCP connection storage.");
  }
}

// Installation credentials live alongside the password, outside portable backups.
function save(path: string, value: unknown) {
  mkdirSync(directory(), { recursive: true, mode: 0o700 });
  const temporary = path + ".tmp";
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
  renameSync(temporary, path);
}

export function setMcpEnabled(enabled: boolean) {
  save(stateFile(), enabled);
}

export function listMcpConnections() {
  const canManage = passwordConfigured();
  return {
    connections: canManage ? load().map(({ tokenHash, ...connection }) => connection) : [],
    canManage,
    legacyReadEnabled: Boolean(legacyToken()),
    enabled: mcpEnabled(),
  };
}

export function createMcpConnection(name: string, access: McpAccess) {
  const rows = load();
  if (rows.length >= MAX_MCP_CONNECTIONS) return null;
  const connection = { id: newId(), name, access, createdAt: nowIso(), enabled: true };
  const token = randomBytes(32).toString("hex");
  save(file(), [{ ...connection, tokenHash: digest(token).toString("hex") }, ...rows]);
  return { connection, token };
}

export function revokeMcpConnection(id: string) {
  const rows = load();
  const remaining = rows.filter((row) => row.id !== id);
  if (rows.length === remaining.length) return false;
  save(file(), remaining);
  return true;
}

export function setMcpConnectionEnabled(id: string, enabled: boolean) {
  const rows = load();
  const row = rows.find((connection) => connection.id === id);
  if (!row) return false;
  row.enabled = enabled;
  save(file(), rows);
  return true;
}

// Called within the data-access guard. Managed connections are inactive when the
// installation has no password. The environment token retains its original read scope.
export function authorizeMcp(header: string | null): McpAccess | "disabled" | "unauthorized" {
  if (!mcpEnabled()) return "disabled";
  const legacy = legacyToken();
  const supplied = /^Bearer ([a-fA-F0-9]{64})$/i.exec(header ?? "")?.[1];
  if (supplied) {
    const hashed = digest(supplied);
    if (legacy && timingSafeEqual(hashed, digest(legacy))) return "read";
  }
  const rows = passwordConfigured() ? load() : [];
  if (supplied) {
    const hashed = digest(supplied);
    const row = rows.find((row) => timingSafeEqual(hashed, Buffer.from(row.tokenHash, "hex")));
    if (row?.enabled) return row.access;
  }
  return legacy || rows.length ? "unauthorized" : "disabled";
}
