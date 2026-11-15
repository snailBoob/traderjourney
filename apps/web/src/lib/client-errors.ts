import { sanitizeLogText } from "./log-sanitize";

let sent = 0;
let windowStarted = 0;
const recent = new Set<string>();

/** Only technical details: never the error message (which can contain user input). */
export function reportClientError(
  error: unknown,
  kind: "exception" | "rejection" | "render" | "network" = "exception",
) {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (now - windowStarted > 60_000) {
    windowStarted = now;
    sent = 0;
    recent.clear();
  }
  if (sent >= 10) return;
  const name =
    error instanceof Error &&
    ["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "TimeoutError"].includes(
      error.name,
    )
      ? error.name
      : "Error";
  const stack =
    error instanceof Error
      ? sanitizeLogText(
          (error.stack ?? "")
            .split("\n")
            .filter((line) => /^\s+at /.test(line))
            .slice(0, 8)
            .join("\n"),
        )
      : "";
  const requestId =
    error &&
    typeof error === "object" &&
    "requestId" in error &&
    typeof error.requestId === "string"
      ? error.requestId
      : undefined;
  // Only the top-level screen name; detail paths may contain user-supplied identifiers.
  const page = window.location.pathname.split("/")[1] || "home";
  const body = JSON.stringify({ kind, name, stack, page, requestId });
  if (recent.has(body)) return;
  recent.add(body);
  sent++;
  void fetch("/api/client-errors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    credentials: "same-origin",
    keepalive: true,
  }).catch(() => {
    /* Reporting must not create another unhandled rejection. */
  });
}
