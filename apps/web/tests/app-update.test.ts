import { afterEach, expect, it, vi } from "vitest";
import { isNewerVersion, releaseUrl } from "../src/lib/app-release";

vi.mock("../src/server/version", () => ({ version: "1.0.0" }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
});

it("compares stable releases numerically and links the installed release", () => {
  expect(isNewerVersion("1.10.0", "1.9.0")).toBe(true);
  expect(isNewerVersion("2.0.0", "1.99.99")).toBe(true);
  expect(isNewerVersion("1.0.1", "1.0.0")).toBe(true);
  for (const v of ["1.0.0", "0.99.0", "1.1.0-beta.1", "garbage"])
    expect(isNewerVersion(v, "1.0.0")).toBe(false);
  expect(isNewerVersion("1.1.0", "unknown")).toBe(false);
  expect(releaseUrl("1.0.0")).toBe(
    "https://github.com/snailBoob/traderjourney/releases/tag/v1.0.0",
  );
  expect(releaseUrl("unknown")).toBe("https://github.com/snailBoob/traderjourney/releases");
});

it("shares concurrent checks and caches a release for one hour", async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ tag_name: "v1.1.0", draft: false, prerelease: false })),
    );
  vi.stubGlobal("fetch", fetch);
  const { availableUpdate } = await import("../src/server/app-update");
  expect(await Promise.all([availableUpdate(), availableUpdate()])).toEqual(["1.1.0", "1.1.0"]);
  expect(await availableUpdate()).toBe("1.1.0");
  expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockResolvedValue(
    new Response(JSON.stringify({ tag_name: "v1.2.0", draft: false, prerelease: false })),
  );
  vi.advanceTimersByTime(3600000);
  expect(await availableUpdate()).toBe("1.2.0");
  expect(fetch).toHaveBeenCalledTimes(2);
});

it.each(["offline", "rate-limit", "prerelease", "malformed", "current"])(
  "quietly handles %s without retrying every request",
  async (scenario) => {
    const fetch = vi.fn();
    if (scenario === "offline") fetch.mockRejectedValue(new Error("offline"));
    else if (scenario === "rate-limit") fetch.mockResolvedValue(new Response("", { status: 403 }));
    else
      fetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            tag_name: scenario === "malformed" ? 42 : scenario === "current" ? "v1.0.0" : "v2.0.0",
            draft: false,
            prerelease: scenario === "prerelease",
          }),
        ),
      );
    vi.stubGlobal("fetch", fetch);
    const { availableUpdate } = await import("../src/server/app-update");
    expect(await availableUpdate()).toBeNull();
    expect(await availableUpdate()).toBeNull();
    expect(fetch).toHaveBeenCalledOnce();
  },
);
