import { afterEach, expect, it, vi } from "vitest";
import { requestJson } from "../src/lib/request-json";
import { postJson } from "../src/lib/use-api";
import { acquireJson } from "../src/lib/api-request";
import { brokerErrorMessage } from "../src/server/broker-error";
import { BitunixApiError } from "../src/server/bitunix";
import { BrokerAuthError, MissingCredentialsError } from "@luxalgo/broker-sdk";

afterEach(() => vi.unstubAllGlobals());

it("explains a failed read and leaves retries to the caller", async () => {
  const fetcher = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
  vi.stubGlobal("fetch", fetcher);
  const read = acquireJson("/offline");
  await expect(read.promise).rejects.toThrow("Could not reach TraderJourney");
  expect(fetcher).toHaveBeenCalledTimes(1);
  read.release();
});

it.each(["POST", "PATCH", "DELETE"] as const)(
  "does not claim that a disconnected %s was rolled back",
  async (method) => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetcher);
    await expect(postJson("/save", { value: 1 }, method)).rejects.toThrow(
      "The result could not be confirmed. Check the current data before trying again.",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);

it.each([502, 503, 504, 200])(
  "handles non-JSON HTTP %s responses without displaying parser or HTML errors",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>proxy error</html>", { status })),
    );
    await expect(postJson("/save", {})).rejects.toThrow("The result could not be confirmed");
  },
);

it("distinguishes a session expiry from rejected broker credentials", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ error: "Unauthorized" }, { status: 401 })),
  );
  await expect(requestJson("/data")).rejects.toThrow("Sign in and try again");
  expect(brokerErrorMessage(new BitunixApiError(401, "10007", "rejected"))).toContain(
    "API key and secret",
  );
});

it("preserves explicit application validation errors", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(Response.json({ error: "Observation date is required" }, { status: 400 })),
  );
  await expect(postJson("/save", {})).rejects.toThrow("Observation date is required");
});

it("preserves aborts but explains a genuine timeout", async () => {
  const abort = new DOMException("Cancelled", "AbortError");
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockRejectedValueOnce(abort)
      .mockRejectedValueOnce(new DOMException("Timeout", "TimeoutError")),
  );
  await expect(requestJson("/data")).rejects.toBe(abort);
  await expect(postJson("/save", {})).rejects.toThrow("did not respond in time");
});

it.each([
  [new BitunixApiError(403, "10004", "ip"), "allowed IPs"],
  [new BitunixApiError(403, "other", "denied"), "read permissions"],
  [new BitunixApiError(429, "other", "limit"), "Wait a few minutes"],
  [new BitunixApiError(503, "other", "maintenance"), "temporarily unavailable"],
  [new DOMException("timeout", "TimeoutError"), "did not respond in time"],
  [new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } }), "server's internet connection"],
] as const)("gives an actionable broker error for %s", (error, message) => {
  expect(brokerErrorMessage(error)).toContain(message);
});

it("preserves unrelated sync validation errors", () => {
  expect(brokerErrorMessage(new Error("Bitunix sync start date is not configured."))).toBe(
    "Bitunix sync start date is not configured.",
  );
});

it("handles the SDK's typed credential errors even when they carry no HTTP status", () => {
  expect(
    brokerErrorMessage(new BrokerAuthError("binance", "Binance rejected the credentials (403)")),
  ).toContain("read permissions and IP restrictions");
  expect(
    brokerErrorMessage(new MissingCredentialsError("coinbase", "Access token is missing")),
  ).toContain("Access token is missing");
  expect(
    brokerErrorMessage(new MissingCredentialsError("coinbase", "Access token is missing")),
  ).toContain("before syncing again");
});

it("preserves cancellation while the response body is being read", async () => {
  const abort = new DOMException("Cancelled", "AbortError");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(abort),
    }),
  );
  await expect(requestJson("/data")).rejects.toBe(abort);
});
