import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE, passwordConfigured, verifySession } from "./auth";
import { randomUUID } from "node:crypto";
import { withLogContext } from "./log-context";
import { logError, logWarn } from "./logger";
import { enterDataAccess } from "./data-access";

export class RequestError extends Error {}
export function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new RequestError(message);
}

export const ok = (data: unknown, init?: ResponseInit) => {
  const headers = new Headers(init?.headers);
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "private, no-store");
  return NextResponse.json(data, { ...init, headers });
};

export const bad = (message: string, status = 400) =>
  NextResponse.json({ error: message }, { status });

/** Route-handler wrapper: uniform error JSON instead of HTML 500 pages. */
export const handler =
  <A extends unknown[]>(
    fn: (...args: A) => Promise<Response> | Response,
    options: { public?: boolean; exclusive?: boolean } = {},
  ) =>
  async (...args: A): Promise<Response> => {
    const requestId = randomUUID();
    const started = Date.now();
    const request = args[0] instanceof Request ? args[0] : undefined;
    return withLogContext({ requestId }, async () => {
      let response: Response;
      const meta = {
        method: request?.method,
        path: request ? new URL(request.url).pathname : undefined,
      };
      const invoke = async () => {
        const release = enterDataAccess(options.exclusive);
        if (!release)
          return bad("The journal is busy. Please retry when the current operation finishes.", 503);
        try {
          return await fn(...args);
        } finally {
          release();
        }
      };
      try {
        if (!options.public && passwordConfigured()) {
          const token = (await cookies()).get(AUTH_COOKIE)?.value;
          if (!verifySession(token)) {
            response = bad("Unauthorized", 401);
          } else response = await invoke();
        } else {
          response = await invoke();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Internal error";
        if (!(error instanceof RequestError))
          logError("api", "request.failed", error, {
            ...meta,
            status: 500,
            durationMs: Date.now() - started,
          });
        response = NextResponse.json(
          { error: message },
          { status: error instanceof RequestError ? 400 : 500 },
        );
        // The exception already carries the diagnostic detail; don't log it twice.
        response.headers.set("x-request-id", requestId);
        if (response.status === 500) return response;
      }
      if (response.status >= 500)
        logError("api", "request.failed", undefined, {
          ...meta,
          status: response.status,
          durationMs: Date.now() - started,
        });
      else if (response.status >= 400 && meta.path !== "/api/client-errors")
        logWarn("api", "request.rejected", {
          ...meta,
          status: response.status,
          durationMs: Date.now() - started,
        });
      response.headers.set("x-request-id", requestId);
      return response;
    });
  };
