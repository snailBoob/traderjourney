import { afterEach, expect, it, vi } from "vitest";
import { logDebug, logError, logInfo } from "../src/server/logger";
import { withLogContext } from "../src/server/log-context";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("emits JSON with isolated context across concurrent requests", async () => {
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  await Promise.all(
    ["first", "second"].map((requestId) =>
      withLogContext({ requestId }, async () => {
        await Promise.resolve();
        logInfo("test", "completed");
      }),
    ),
  );
  const rows = output.mock.calls.map(([line]) => JSON.parse(line));
  expect(rows.map((row) => row.requestId)).toEqual(["first", "second"]);
  expect(rows[0]).toMatchObject({ level: "info", event: "completed", scope: "test" });
  expect(rows[0].timestamp).toBeTruthy();
  expect(rows[0].version).toBeTruthy();
});

it("redacts nested secrets and error text, and handles circular metadata", () => {
  const output = vi.spyOn(console, "error").mockImplementation(() => {});
  const meta: Record<string, unknown> = {
    nested: { apiKey: "private-key", cookie: "private-cookie", content: "private-journal" },
  };
  meta.self = meta;
  logError(
    "test",
    "failed",
    new Error("token=private-token https://example.org/a?secret=private-query"),
    meta,
  );
  const line = output.mock.calls[0]![0] as string;
  for (const secret of [
    "private-key",
    "private-cookie",
    "private-journal",
    "private-token",
    "private-query",
  ])
    expect(line).not.toContain(secret);
  expect(JSON.parse(line).error.stack).toContain("logging.test.ts");
});

it("keeps debug quiet unless explicitly enabled", () => {
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("LOG_LEVEL", "info");
  logDebug("test", "details");
  expect(output).not.toHaveBeenCalled();
  vi.stubEnv("LOG_LEVEL", "debug");
  logDebug("test", "details");
  expect(JSON.parse(output.mock.calls[0]![0]).level).toBe("debug");
});

it("omits input snippets echoed by JSON parser errors", () => {
  const output = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    JSON.parse("SENSITIVE");
  } catch (error) {
    logError("api", "request.failed", error);
  }
  expect(output.mock.calls[0]![0]).not.toContain("SENSITIVE");
  expect(JSON.parse(output.mock.calls[0]![0]).error.name).toBe("SyntaxError");
});
