import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const dir = mkdtempSync(join(tmpdir(), "journal-mcp-"));
const token = "a".repeat(64);
const url = "http://localhost:3000/api/mcp";
const managerUrl = "http://localhost:3000/api/settings/mcp";
const { session } = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: session }) }));
let data: typeof import("../src/db");
let route: typeof import("../src/app/api/mcp/route");
let management: typeof import("../src/app/api/settings/mcp/route");
let auth: typeof import("../src/server/auth");
let middleware: (typeof import("../src/middleware"))["middleware"];

beforeAll(async () => {
  vi.stubEnv("JOURNAL_DATA_DIR", dir);
  data = await import("../src/db");
  route = await import("../src/app/api/mcp/route");
  management = await import("../src/app/api/settings/mcp/route");
  auth = await import("../src/server/auth");
  ({ middleware } = await import("../src/middleware"));
  const { db, accounts, trades, journalDays, settings } = data;
  db.insert(settings).values({ key: "timeZone", value: "Europe/Amsterdam" }).run();
  db.insert(accounts)
    .values([
      { id: "main", name: "Test", kind: "manual", createdAt: "2026-01-01" },
      { id: "other", name: "Other", kind: "manual", createdAt: "2026-01-01" },
    ])
    .run();
  const trade = {
    accountId: "main",
    symbol: "ES",
    direction: "long" as const,
    status: "win" as const,
    openedAt: "2026-05-01T21:00:00Z",
    closedAt: "2026-05-01T23:00:00Z",
    quantity: 1,
    openQuantity: 0,
    executionCount: 2,
    executionIdsJson: "[]",
    exitsJson: "[]",
    avgEntry: 100,
    avgExit: 105,
    netPnl: 4,
    grossPnl: 5,
    fees: 1,
    tagsJson: '["breakout"]',
    notes: "Waited for the retest",
  };
  db.insert(trades)
    .values([
      { ...trade, key: "trade-a" },
      { ...trade, key: "trade-b" },
      { ...trade, key: "trade-c", symbol: "NQ" },
      { ...trade, key: "trade-d", accountId: "other" },
    ])
    .run();
  db.insert(journalDays)
    .values({ date: "2026-05-02", note: "Review the first entry", updatedAt: "2026-05-02" })
    .run();
});

beforeEach(() => {
  vi.stubEnv("JOURNAL_PASSWORD", "installation-only-password");
  vi.stubEnv("JOURNAL_MCP_TOKEN", token);
});

afterAll(() => {
  data?.closeDb();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

function request(method: string, params?: object, headers: Record<string, string> = {}) {
  return route.POST(
    new Request(url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
}

async function call(name: string, args: object) {
  const response = await request("tools/call", { name, arguments: args });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  return (await response.json()).result;
}

it("requires explicit opt-in and the MCP token, regardless of browser access", async () => {
  vi.stubEnv("JOURNAL_MCP_TOKEN", "");
  expect((await request("tools/list")).status).toBe(404);
  vi.stubEnv("JOURNAL_MCP_TOKEN", token);
  for (const Authorization of [
    "",
    `Bearer ${"b".repeat(64)}`,
    "Bearer installation-only-password",
  ]) {
    expect((await request("tools/list", {}, { Authorization })).status).toBe(401);
  }
  expect((await request("tools/list", {}, { Origin: "https://untrusted.invalid" })).status).toBe(
    403,
  );
  expect((await route.GET(new Request(url))).status).toBe(401);
  expect(middleware(new NextRequest(url)).headers.get("x-middleware-next")).toBe("1");
  expect(
    middleware(
      new NextRequest("http://localhost:3000/api/trades", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ).status,
  ).toBe(401);
});

it("lets the login logo load without unlocking other paths", () => {
  const visit = (path: string) => middleware(new NextRequest(`http://localhost:3000${path}`));
  expect(visit("/tradejournal-tj-rounded.png").headers.get("x-middleware-next")).toBe("1");
  expect(visit("/bird-logo.png").status).toBe(307);
  expect(visit("/api/settings/mcp").status).toBe(401);
});

it("initializes and exposes only read-only tools for the legacy token", async () => {
  const initialize = await request("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  });
  expect((await initialize.json()).result.serverInfo.name).toBe("traderjourney");
  const list = await request("tools/list");
  const { tools } = (await list.json()).result;
  expect(tools.map((tool: { name: string }) => tool.name).sort()).toEqual([
    "get_journal_day",
    "get_mcp_guide",
    "get_trade",
    "list_note_templates",
    "list_trades",
  ]);
  expect(
    tools.every(
      (tool: { annotations: { readOnlyHint: boolean } }) => tool.annotations.readOnlyHint,
    ),
  ).toBe(true);
});

it("tests the MCP handshake without granting browser access to the MCP endpoint", async () => {
  const probe = (candidate: string, origin = "http://localhost:3000") =>
    management.PUT(
      new Request(managerUrl, {
        method: "PUT",
        headers: { origin, host: "localhost:3000", "content-type": "application/json" },
        body: JSON.stringify({ token: candidate }),
      }),
    );
  expect((await probe(token)).status).toBe(401);
  session.mockReturnValue({ value: auth.sessionToken() });
  try {
    const writer = (await import("../src/server/mcp-connections")).createMcpConnection(
      "Probe",
      "read-write",
    );
    if (!writer) throw new Error("Expected a free MCP connection slot");
    const before = data.db.select().from(data.notes).all();
    expect((await probe(writer.token, "https://untrusted.invalid")).status).toBe(403);
    expect((await probe("not-a-token")).status).toBe(400);
    expect(await (await probe(writer.token)).json()).toEqual({ connected: true });
    expect(data.db.select().from(data.notes).all()).toEqual(before);
    (await import("../src/server/mcp-connections")).revokeMcpConnection(writer.connection.id);
    const revoked = await probe(writer.token);
    expect(revoked.status).toBe(422);
    expect(await revoked.text()).not.toContain(writer.token);
  } finally {
    session.mockReset();
  }
});

it("pauses both token types without replacing them and caps managed connections at five", async () => {
  const service = await import("../src/server/mcp-connections");
  const previous = service.listMcpConnections().connections.length;
  const ids: string[] = [];
  const manage = (method: "POST" | "PATCH", body: object) =>
    management[method](
      new Request(managerUrl, {
        method,
        headers: {
          origin: "http://localhost:3000",
          host: "localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
    );
  session.mockReturnValue({ value: auth.sessionToken() });
  try {
    let latest;
    const tokens: string[] = [];
    for (let i = previous; i < 5; i++) {
      const response = await manage("POST", { name: `Slot ${i}`, access: "read" });
      expect(response.status).toBe(201);
      latest = await response.json();
      ids.push(latest.connection.id);
      tokens.push(latest.token);
    }
    const managed = { Authorization: `Bearer ${latest.token}` };
    const other = { Authorization: `Bearer ${tokens[0]}` };
    const id = latest.connection.id;
    expect((await manage("PATCH", { id: "missing", enabled: false })).status).toBe(404);
    expect((await manage("PATCH", { id, enabled: "false" })).status).toBe(400);
    expect((await manage("PATCH", { id, enabled: false })).status).toBe(200);
    expect(service.listMcpConnections().connections[0]).toMatchObject({ id, enabled: false });
    expect((await request("tools/list", {}, managed)).status).toBe(401);
    expect((await request("tools/list", {}, other)).status).toBe(200);
    expect((await manage("POST", { name: "Overflow", access: "read" })).status).toBe(409);
    expect((await manage("PATCH", { enabled: false })).status).toBe(200);
    expect(service.listMcpConnections()).toMatchObject({ enabled: false });
    expect(service.listMcpConnections().connections).toHaveLength(5);
    expect((await request("tools/list")).status).toBe(404);
    expect((await request("tools/list", {}, managed)).status).toBe(404);
    expect((await manage("PATCH", { enabled: true })).status).toBe(200);
    expect((await request("tools/list")).status).toBe(200);
    expect((await request("tools/list", {}, managed)).status).toBe(401);
    expect((await manage("PATCH", { id, enabled: true })).status).toBe(200);
    expect((await request("tools/list", {}, managed)).status).toBe(200);
    service.revokeMcpConnection(ids.pop()!);
    const replacement = await manage("POST", { name: "Replacement", access: "read" });
    expect(replacement.status).toBe(201);
    ids.push((await replacement.json()).connection.id);
  } finally {
    service.setMcpEnabled(true);
    ids.forEach(service.revokeMcpConnection);
    session.mockReset();
  }
});

it("creates a scoped editor template only with Read/Write", async () => {
  const service = await import("../src/server/mcp-connections");
  const writer = service.createMcpConnection("Template writer", "read-write");
  if (!writer) throw new Error("Expected a free MCP connection slot");
  const args = { name: "Trade reflection", markdown: "## Entry\n## Exit", scopes: ["trade"] };
  const check = async (name: string, args: object, token?: string) =>
    (
      await (
        await request(
          "tools/call",
          { name, arguments: args },
          token ? { Authorization: `Bearer ${token}` } : {},
        )
      ).json()
    ).result;
  try {
    expect(await check("create_note_template", args)).toMatchObject({ isError: true });
    expect(
      await check("create_note_template", { ...args, scopes: ["all", "trade"] }, writer.token),
    ).toMatchObject({ isError: true });
    const { id } = (await check("create_note_template", args, writer.token)).structuredContent;
    expect(
      (await check("list_note_templates", { scope: "trade" })).structuredContent.templates,
    ).toContainEqual({ id, name: args.name, content: args.markdown, scopes: ["trade"] });
    expect(
      (await check("list_note_templates", { scope: "journal" })).structuredContent.templates,
    ).not.toEqual(expect.arrayContaining([expect.objectContaining({ id })]));
  } finally {
    service.revokeMcpConnection(writer.connection.id);
  }
});

it("manages independent tokens and only allows Read/Write to add weekly reviews", async () => {
  const manage = (method: "POST" | "DELETE", body: object, origin = "http://localhost:3000") =>
    management[method](
      new Request(managerUrl, {
        method,
        body: JSON.stringify(body),
        headers: { host: "localhost:3000", origin, "content-type": "application/json" },
      }),
    );
  const write = { name: "Writer", access: "read-write" };
  expect((await manage("POST", write)).status).toBe(401);
  vi.stubEnv("JOURNAL_PASSWORD", "");
  expect((await manage("POST", write)).status).toBe(403);
  vi.stubEnv("JOURNAL_PASSWORD", "installation-only-password");
  session.mockReturnValue({ value: auth.sessionToken() });
  expect((await manage("POST", write, "https://elsewhere.invalid")).status).toBe(403);
  const writer = await (await manage("POST", write)).json();
  const reader = await (await manage("POST", { name: "Reader", access: "read" })).json();
  expect(writer.token).toMatch(/^[a-f0-9]{64}$/);
  expect(writer.token).not.toBe(reader.token);
  const catalog = await (await management.GET()).text();
  expect(catalog).toContain("Writer");
  expect(catalog).not.toContain(writer.token);
  expect(catalog).not.toContain("tokenHash");

  const review = { weekStart: "2026-05-04", markdown: "# Week review\nKeep a checklist." };
  const invoke = async (credential: string, name: string, args: object) =>
    (
      await (
        await request(
          "tools/call",
          { name, arguments: args },
          { Authorization: `Bearer ${credential}` },
        )
      ).json()
    ).result;
  expect((await invoke(reader.token, "get_mcp_guide", {})).structuredContent).toMatchObject({
    access: "read",
  });
  expect(await invoke(reader.token, "save_weekly_review", review)).toMatchObject({ isError: true });
  expect(
    await invoke(writer.token, "save_weekly_review", { ...review, weekStart: "2026-05-05" }),
  ).toMatchObject({ isError: true });
  expect(
    data.db
      .select()
      .from(data.folders)
      .all()
      .some((row) => row.name === "Weekly AI reviews"),
  ).toBe(false);
  const saved = (await invoke(writer.token, "save_weekly_review", review)).structuredContent;
  expect(saved).toMatchObject({ created: true });
  expect(
    (await invoke(writer.token, "save_weekly_review", review)).structuredContent,
  ).toMatchObject({ ...saved, created: false });
  expect(
    await invoke(writer.token, "save_weekly_review", { ...review, markdown: "Overwrite" }),
  ).toMatchObject({ isError: true });
  const next = (
    await invoke(writer.token, "save_weekly_review", { ...review, weekStart: "2026-05-11" })
  ).structuredContent;
  expect(next).toMatchObject({ folderId: saved.folderId, created: true });
  expect(data.db.select().from(data.notes).all()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: saved.id, folderId: saved.folderId, content: review.markdown }),
    ]),
  );
  expect((await manage("DELETE", { id: writer.connection.id })).status).toBe(200);
  expect(
    (await request("tools/list", {}, { Authorization: `Bearer ${writer.token}` })).status,
  ).toBe(401);
  expect(
    (await request("tools/list", {}, { Authorization: `Bearer ${reader.token}` })).status,
  ).toBe(200);
  session.mockReset();
});

it("filters by journal-local day, account and symbol, with stable paging", async () => {
  const filters = {
    from: "2026-05-02",
    to: "2026-05-02",
    accountId: "main",
    symbol: "es",
    limit: 1,
  };
  const first = (await call("list_trades", filters)).structuredContent;
  expect(first).toMatchObject({ timeZone: "Europe/Amsterdam", total: 2, nextOffset: 1 });
  expect(first.trades[0]).toMatchObject({ key: "trade-a", netPnl: 4, status: "win" });
  expect(first.trades[0]).not.toHaveProperty("notes");
  const second = (await call("list_trades", { ...filters, offset: 1 })).structuredContent;
  expect(second).toMatchObject({ nextOffset: null, trades: [{ key: "trade-b" }] });
});

it("reads trade and day notes without exposing attachment or credential fields", async () => {
  const detail = (await call("get_trade", { key: "trade-a" })).structuredContent;
  expect(detail.trade).toMatchObject({ notes: "Waited for the retest", tags: ["breakout"] });
  expect(Object.keys(detail.trade)).not.toContain("executionIdsJson");
  const day = (await call("get_journal_day", { date: "2026-05-02" })).structuredContent;
  expect(day).toMatchObject({ date: "2026-05-02", note: "Review the first entry" });
  expect(day).not.toHaveProperty("attachments");
});

it("rejects invalid inputs and unknown trade keys", async () => {
  expect(await call("get_journal_day", { date: "2026-02-30" })).toMatchObject({ isError: true });
  expect(await call("list_trades", { from: "2026-06-01", to: "2026-05-01" })).toMatchObject({
    isError: true,
  });
  expect(await call("list_trades", { limit: 1000 })).toMatchObject({ isError: true });
  expect(await call("get_trade", { key: "missing" })).toMatchObject({ isError: true });
});
