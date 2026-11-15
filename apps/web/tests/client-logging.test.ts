// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("deduplicates browser reports and sends no raw messages or URL query data", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  const { reportClientError } = await import("../src/lib/client-errors");
  const error = Object.assign(new TypeError("private-journal"), {
    stack:
      "TypeError: private-journal\n    at fn (http://localhost/_next/static/chunks/app.js?token=private-token:1:2)",
    requestId: "12345678-1234-1234-1234-123456789012",
  });
  reportClientError(error);
  reportClientError(error);
  expect(fetch).toHaveBeenCalledTimes(1);
  const body = fetch.mock.calls[0]![1].body;
  expect(body).not.toContain("private-");
  expect(JSON.parse(body)).toMatchObject({
    kind: "exception",
    name: "TypeError",
    requestId: error.requestId,
  });
});

it("bounds reports and consumes reporting failures", async () => {
  const fetch = vi.fn().mockRejectedValue(new Error("offline"));
  vi.stubGlobal("fetch", fetch);
  const { reportClientError } = await import("../src/lib/client-errors");
  for (let i = 0; i < 15; i++) {
    const error = new Error("synthetic");
    error.stack = `Error\n    at fn (http://localhost/_next/static/chunks/app.js:1:${i})`;
    reportClientError(error);
  }
  await Promise.resolve();
  expect(fetch).toHaveBeenCalledTimes(10);
});

it("returns the server reference with API errors", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json(
        { error: "Failed" },
        {
          status: 500,
          headers: { "x-request-id": "12345678-1234-1234-1234-123456789012" },
        },
      ),
    ),
  );
  const { requestJson } = await import("../src/lib/request-json");
  await expect(requestJson("/api/example")).rejects.toMatchObject({
    message: "Failed (Reference: 12345678-1234-1234-1234-123456789012)",
    requestId: "12345678-1234-1234-1234-123456789012",
  });
});
