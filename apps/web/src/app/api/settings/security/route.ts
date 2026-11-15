import { cookies } from "next/headers";
import { bad, handler, ok, requireValue } from "@/server/api";
import {
  AUTH_COOKIE,
  passwordConfigured,
  savePassword,
  securitySettings,
  verifyPassword,
} from "@/server/auth";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/security-settings";

export const GET = handler(() => ok(securitySettings()));

export const PUT = handler(async (request: Request) => {
  // JSON-only, same-origin requests also protect first-time setup without a password.
  const origin = request.headers.get("origin");
  let sameOrigin = false;
  try {
    // Next may reconstruct request.url with its internal listen address. The
    // HTTP Host retains the browser-facing authority (including forwarded ports).
    // Do not trust arbitrary X-Forwarded-Host values as additional allowed origins.
    sameOrigin = Boolean(
      origin && new URL(origin).host === request.headers.get("host")?.toLowerCase(),
    );
  } catch {
    /* A malformed Origin is not a trusted caller. */
  }
  if (!sameOrigin) return bad("Invalid request origin.", 403);
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
    return bad("Expected JSON.", 415);
  if (process.env.JOURNAL_PASSWORD) return bad("Password is managed by server configuration.", 409);
  const body = await request.json();
  requireValue(body && typeof body === "object", "Invalid password settings.");
  const jar = await cookies();
  // No awaits between checking the current password and replacing it.
  if (
    passwordConfigured() &&
    (typeof body.currentPassword !== "string" || !verifyPassword(body.currentPassword))
  )
    return bad("Current password is incorrect.", 400);
  requireValue(body.action === "set" || body.action === "remove", "Choose a password action.");
  if (body.action === "set") {
    requireValue(
      typeof body.newPassword === "string" &&
        body.newPassword.length >= MIN_PASSWORD_LENGTH &&
        body.newPassword.length <= MAX_PASSWORD_LENGTH,
      `Use between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters.`,
    );
    requireValue(body.newPassword === body.confirmPassword, "Passwords do not match.");
  } else requireValue(passwordConfigured(), "No password is configured.");
  savePassword(body.action === "remove" ? null : body.newPassword);
  jar.delete(AUTH_COOKIE);
  return ok(securitySettings());
});
