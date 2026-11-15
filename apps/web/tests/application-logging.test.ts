import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { handler, ok, RequestError } from "../src/server/api";
import { POST } from "../src/app/api/client-errors/route";
import { logInfo } from "../src/server/logger";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
beforeEach(() => {
  vi.stubEnv("JOURNAL_PASSWORD", "");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("correlates downstream and failure logs with the response, without logging query parameters", async () => {
  const info = vi.spyOn(console, "log").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const route = handler((_request: Request) => {
    logInfo("test", "operation.started");
    throw new Error("database locked");
  });
  const response = await route(new Request("http://localhost/api/example?token=private-query"));
  expect(response.status).toBe(500);
  const requestId = response.headers.get("x-request-id");
  expect(JSON.parse(info.mock.calls[0]![0]).requestId).toBe(requestId);
  expect(JSON.parse(error.mock.calls[0]![0])).toMatchObject({
    requestId,
    meta: { path: "/api/example", status: 500 },
  });
  expect(error.mock.calls).toHaveLength(1);
  expect(error.mock.calls[0]![0]).not.toContain("private-query");
});

it("keeps successful reads quiet and does not log validation input", async () => {
  const info = vi.spyOn(console, "log").mockImplementation(() => {});
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const response = await handler(() => ok({ success: true }))();
  expect(response.headers.get("x-request-id")).toBeTruthy();
  expect(info).not.toHaveBeenCalled();
  expect(
    (
      await handler(() => {
        throw new RequestError("private-journal");
      })()
    ).status,
  ).toBe(400);
  expect(warn.mock.calls[0]![0]).not.toContain("private-journal");
});

const report = (body: unknown, origin = "http://localhost") =>
  new Request("http://localhost/api/client-errors", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const payload = {
  kind: "exception",
  name: "TypeError",
  page: "journal",
  stack: "    at fn (http://localhost/_next/static/chunks/app.js:1:20)",
};

it("accepts a browser report but drops arbitrary messages and non-asset stack content", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const response = await POST(
    report({ ...payload, message: "private-journal", stack: payload.stack + "\nprivate-key" }),
  );
  expect(response.status).toBe(204);
  expect(JSON.parse(error.mock.calls[0]![0]).meta.frames).toEqual([
    "/_next/static/chunks/app.js:1:20",
  ]);
  expect(error.mock.calls[0]![0]).not.toContain("private-");
});

it("rejects cross-origin, oversized and unauthenticated browser reports", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  expect((await POST(report(payload, "https://elsewhere.test"))).status).toBe(403);
  expect((await POST(report({ ...payload, stack: "x".repeat(13_000) }))).status).toBe(413);
  vi.stubEnv("JOURNAL_PASSWORD", "test-only");
  expect((await POST(report(payload))).status).toBe(401);
  expect(error).not.toHaveBeenCalled();
});

it("bounds browser report volume on the server", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 120_000);
  for (let i = 0; i < 30; i++) expect((await POST(report(payload))).status).toBe(204);
  expect((await POST(report(payload))).status).toBe(429);
});
