import { version } from "./version";
import { getLogContext } from "./log-context";
import { sanitizeLogValue } from "../lib/log-sanitize";

const levels = { debug: 10, info: 20, warn: 30, error: 40 };
type Level = keyof typeof levels;

function write(
  level: Level,
  scope: string,
  event: string,
  meta?: Record<string, unknown>,
  error?: unknown,
) {
  const configured = process.env.LOG_LEVEL as Level;
  if (levels[level] < (levels[configured] ?? levels.info)) return;
  try {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      version,
      scope,
      event,
      ...getLogContext(),
      meta: sanitizeLogValue(meta),
      error: sanitizeLogValue(error),
    });
    console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](line);
  } catch {
    // Logging must never turn a completed operation into a failed request.
  }
}

export const logDebug = (scope: string, message: string, meta?: Record<string, unknown>) =>
  write("debug", scope, message, meta);

export const logInfo = (scope: string, message: string, meta?: Record<string, unknown>) => {
  write("info", scope, message, meta);
};

export const logWarn = (scope: string, message: string, meta?: Record<string, unknown>) => {
  write("warn", scope, message, meta);
};

export const logError = (
  scope: string,
  message: string,
  error?: unknown,
  meta?: Record<string, unknown>,
) => {
  write("error", scope, message, meta, error);
};
