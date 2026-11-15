import { bad, handler } from "@/server/api";
import { logError } from "@/server/logger";

let windowStarted = 0;
let received = 0;

export const POST = handler(async (request: Request) => {
  if (
    request.headers.get("origin") !== new URL(request.url).origin ||
    !request.headers.get("content-type")?.startsWith("application/json")
  )
    return bad("Invalid report", 403);
  const now = Date.now();
  if (now - windowStarted > 60_000) {
    windowStarted = now;
    received = 0;
  }
  if (++received > 30) return bad("Too many reports", 429);
  const reader = request.body?.getReader();
  if (!reader) return bad("Invalid report");
  let text = "";
  let size = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 12_000) {
        await reader.cancel();
        return bad("Report too large", 413);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  let report: unknown;
  try {
    report = JSON.parse(text);
  } catch {
    return bad("Invalid report");
  }
  if (!report || typeof report !== "object") return bad("Invalid report");
  const { kind, name, page, stack, requestId } = report as Record<string, unknown>;
  if (
    typeof kind !== "string" ||
    !["exception", "rejection", "render", "network"].includes(kind) ||
    typeof name !== "string" ||
    !["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "TimeoutError"].includes(
      name,
    ) ||
    typeof page !== "string" ||
    !/^[a-z-]{1,40}$/.test(page) ||
    typeof stack !== "string" ||
    stack.length > 4000 ||
    (requestId !== undefined &&
      (typeof requestId !== "string" || !/^[a-f0-9-]{36}$/.test(requestId)))
  )
    return bad("Invalid report");
  // Browser data is untrusted. Only keep application asset locations, not arbitrary stack text.
  const frames = stack
    .split("\n")
    .flatMap((line) => {
      const match = line.match(/\/_next\/static\/[a-zA-Z0-9_./%-]+\.js:\d+:\d+/);
      return match ? [match[0]] : [];
    })
    .slice(0, 8);
  logError("browser", "browser.failed", undefined, {
    kind,
    name,
    page,
    frames,
    relatedRequestId: requestId,
  });
  return new Response(null, { status: 204 });
});
