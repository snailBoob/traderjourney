// Shared by the browser reporter and server logger. Never include request bodies.
const sensitiveKey =
  /password|secret|token|authorization|cookie|credential|api[-_]?key|signature|^sign$|content|prompt|completion|body|headers|notes|journal|statement|fileName/i;

export function sanitizeLogText(text: string): string {
  return text
    .replace(/https?:\/\/[^\s)"']+/gi, (url) => {
      try {
        const parsed = new URL(url);
        return `${parsed.origin}${parsed.pathname}`;
      } catch {
        return "[URL]";
      }
    })
    .replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, "$1 [REDACTED]")
    .replace(
      /\b(password|(?:api[-_]?)?secret|(?:access[-_]?|refresh[-_]?)?token|api[-_]?key|authorization|cookie|signature)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "$1=[REDACTED]",
    )
    .replace(/\b(?:Failed query:|params:)[\s\S]*/gi, "[QUERY REDACTED]")
    .slice(0, 4000);
}

export function sanitizeLogValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return sanitizeLogText(value);
  if (typeof value === "bigint") return String(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= 5) return "[TRUNCATED]";
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (value instanceof Error) {
    // JSON.parse includes a fragment of the original input in its diagnostic.
    const message =
      value.name === "SyntaxError" && /JSON/i.test(value.message)
        ? "Invalid JSON input"
        : sanitizeLogText(value.message);
    const frames = value.stack
      ?.split("\n")
      .filter((line) => /^\s+at /.test(line))
      .join("\n");
    return sanitizeLogValue(
      {
        name: value.name,
        message,
        stack: frames ? `${value.name}: ${message}\n${frames}` : undefined,
      },
      depth + 1,
      seen,
    );
  }
  if (Array.isArray(value))
    return value.slice(0, 30).map((item) => sanitizeLogValue(item, depth + 1, seen));
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 40)
      .map(([key, item]) => [
        key,
        sensitiveKey.test(key) ? "[REDACTED]" : sanitizeLogValue(item, depth + 1, seen),
      ]),
  );
}
