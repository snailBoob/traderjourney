import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { GET, PUT } from "../src/app/api/settings/security/route";
import { POST as login } from "../src/app/api/auth/route";
import { handler, ok } from "../src/server/api";
import {
  passwordConfigured,
  savePassword,
  sessionToken,
  verifyPassword,
  verifySession,
} from "../src/server/auth";
import { middleware } from "../src/middleware";

const session = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (session.token ? { value: session.token } : undefined),
    set: (_name: string, token: string) => {
      session.token = token;
    },
    delete: () => {
      session.token = undefined;
    },
  }),
}));
let directory: string;
const first = "first strong password";
const second = "another strong password";
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "journal-security-"));
  vi.stubEnv("JOURNAL_DATA_DIR", directory);
  vi.stubEnv("JOURNAL_PASSWORD", "");
  session.token = undefined;
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});
function request(body: unknown, origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/settings/security", {
    method: "PUT",
    headers: { "Content-Type": "application/json", origin, host: "localhost:3000" },
    body: JSON.stringify(body),
  });
}
const set = (password: string, currentPassword?: string) =>
  request({
    action: "set",
    newPassword: password,
    confirmPassword: password,
    currentPassword,
  });

describe("installation password settings", () => {
  it("accepts the external Host and port even when Next uses an internal request URL", async () => {
    const req = new Request("http://localhost:3000/api/settings/security", {
      method: "PUT",
      headers: {
        host: "192.168.3.234:40004",
        origin: "http://192.168.3.234:40004",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "set", newPassword: first, confirmPassword: first }),
    });
    expect((await PUT(req)).status).toBe(200);
    expect(verifyPassword(first)).toBe(true);
  });

  it.each([
    ["http://other.test", "192.168.3.234:40004"],
    ["http://192.168.3.234:3000", "192.168.3.234:40004"],
    ["http://localhost:3000", "192.168.3.234:40004"],
    ["null", "localhost:3000"],
    ["not a URL", "localhost:3000"],
    ["", "localhost:3000"],
    ["http://localhost:3000", ""],
  ])("rejects origin %s against Host %s regardless of forwarded headers", async (origin, host) => {
    const req = new Request("http://localhost:3000/api/settings/security", {
      method: "PUT",
      headers: {
        host,
        origin,
        "x-forwarded-host": "other.test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "set", newPassword: first, confirmPassword: first }),
    });
    expect((await PUT(req)).status).toBe(403);
    expect(passwordConfigured()).toBe(false);
  });

  it("sets a salted hash, logs in, rotates sessions and removes protection", async () => {
    expect(await (await GET()).json()).toEqual({ configured: false, managedByEnvironment: false });
    expect((await PUT(set(first))).status).toBe(200);
    const stored = readFileSync(join(directory, ".auth/password.json"), "utf8");
    expect(stored).not.toContain(first);
    expect(statSync(join(directory, ".auth/password.json")).mode & 0o777).toBe(0o600);
    expect(verifyPassword(first)).toBe(true);
    expect(verifyPassword("wrong")).toBe(false);
    expect((await handler(() => ok({ secret: true }))()).status).toBe(401);
    expect(
      (
        await login(
          new Request("http://localhost:3000/api/auth", {
            method: "POST",
            body: JSON.stringify({ password: first }),
          }),
        )
      ).status,
    ).toBe(200);
    const oldSession = session.token;
    expect((await PUT(set(second, "wrong"))).status).toBe(400);
    expect(verifySession(oldSession)).toBe(true);
    expect((await PUT(set(second, first))).status).toBe(200);
    expect(session.token).toBeUndefined();
    expect(verifySession(oldSession)).toBe(false);
    expect(verifyPassword(first)).toBe(false);
    expect(verifyPassword(second)).toBe(true);
    session.token = sessionToken();
    expect((await PUT(request({ action: "remove", currentPassword: "wrong" }))).status).toBe(400);
    expect(passwordConfigured()).toBe(true);
    expect((await PUT(request({ action: "remove", currentPassword: second }))).status).toBe(200);
    expect(passwordConfigured()).toBe(false);
    expect((await handler(() => ok({ open: true }))()).status).toBe(200);
  });

  it("rejects short, mismatched, cross-origin and non-JSON setup requests", async () => {
    expect((await PUT(set("short"))).status).toBe(400);
    expect(
      (await PUT(request({ action: "set", newPassword: first, confirmPassword: second }))).status,
    ).toBe(400);
    expect(
      (
        await PUT(
          request(
            { action: "set", newPassword: first, confirmPassword: first },
            "http://other.test",
          ),
        )
      ).status,
    ).toBe(403);
    const plain = new Request("http://localhost:3000/api/settings/security", {
      method: "PUT",
      headers: {
        origin: "http://localhost:3000",
        host: "localhost:3000",
        "Content-Type": "text/plain",
      },
      body: JSON.stringify({ action: "set", newPassword: first, confirmPassword: first }),
    });
    expect((await PUT(plain)).status).toBe(415);
    expect(passwordConfigured()).toBe(false);
  });

  it("gives the environment password priority and prevents settings changes", async () => {
    savePassword(first);
    vi.stubEnv("JOURNAL_PASSWORD", second);
    expect(verifyPassword(first)).toBe(false);
    expect(verifyPassword(second)).toBe(true);
    session.token = sessionToken();
    expect(await (await GET()).json()).toEqual({ configured: true, managedByEnvironment: true });
    expect((await PUT(set(first, second))).status).toBe(409);
    expect((await PUT(request({ action: "remove", currentPassword: second }))).status).toBe(409);
    vi.stubEnv("JOURNAL_PASSWORD", "");
    expect(verifyPassword(first)).toBe(true);
  });

  it("guards page navigation and API access against absent, forged and old cookies", () => {
    savePassword(first);
    const old = sessionToken();
    savePassword(second);
    for (const token of ["", "forged", old]) {
      const headers = new Headers();
      if (token) headers.set("cookie", `journal_session=${token}`);
      const page = middleware(new NextRequest("http://localhost:3000/settings", { headers }));
      expect(page.headers.get("location")).toBe("http://localhost:3000/login");
      expect(
        middleware(new NextRequest("http://localhost:3000/api/settings", { headers })).status,
      ).toBe(401);
    }
    expect(
      middleware(
        new NextRequest("http://localhost:3000/settings", {
          headers: { cookie: `journal_session=${sessionToken()}` },
        }),
      ).status,
    ).toBe(200);
    expect(middleware(new NextRequest("http://localhost:3000/login")).status).toBe(200);
  });

  it("invalidates sessions even when reusing the same password and fails closed on corrupt storage", () => {
    savePassword(first);
    const old = sessionToken();
    savePassword(first);
    expect(verifySession(old)).toBe(false);
    writeFileSync(join(directory, ".auth/password.json"), '{"version":99}');
    expect(() => passwordConfigured()).toThrow("Invalid password configuration");
  });
});
