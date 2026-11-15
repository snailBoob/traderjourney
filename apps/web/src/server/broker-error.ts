import { BitunixApiError } from "./bitunix";
import { BrokerAuthError, MissingCredentialsError } from "@luxalgo/broker-sdk";

/** Translate only recognizable connection failures; preserve application validation messages. */
export function brokerErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Sync failed";
  const details = error as { status?: number; code?: string; cause?: { code?: string } } | null;
  const status = details?.status;
  const code = details?.cause?.code ?? details?.code;
  const bitunixCode = error instanceof BitunixApiError ? error.code : null;
  if (error instanceof MissingCredentialsError)
    return `${message} Check the broker connection credentials before syncing again.`;
  if (error instanceof BrokerAuthError)
    return `${message}. Check the API key or token, read permissions and IP restrictions at the broker, then sync again.`;
  if (bitunixCode === "10004")
    return "IP not whitelisted. Add the TraderJourney server's IP address to the API key's allowed IPs at the broker, then sync again.";
  if (bitunixCode === "10003" || /missing broker credentials|API key missing/i.test(message))
    return "API key missing. Check the broker connection credentials before syncing again.";
  if (
    status === 401 ||
    bitunixCode === "10007" ||
    /invalid API credentials|invalid API.?key|expired (access )?token/i.test(message)
  )
    return "Invalid or expired API credentials. Check the API key and secret or renew the token at the broker, then sync again.";
  if (status === 403)
    return "API key not authorized. Check the key's read permissions and IP restrictions at the broker, then sync again.";
  if (status === 429 || bitunixCode === "10005" || bitunixCode === "10006")
    return "The broker is limiting requests. Wait a few minutes before syncing again.";
  if (
    (error instanceof Error &&
      (error.name === "TimeoutError" || /timed?\s*out|timeout/i.test(message))) ||
    code === "ETIMEDOUT" ||
    code === "UND_ERR_CONNECT_TIMEOUT"
  )
    return "The broker did not respond in time. Wait a moment, then sync again.";
  if (
    bitunixCode === "10001" ||
    /failed to fetch|fetch failed|network error/i.test(message) ||
    ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN"].includes(code ?? "")
  )
    return "Could not reach the broker. Check the TraderJourney server's internet connection and the broker's service status, then sync again.";
  if (status !== undefined && status >= 500)
    return "The broker is temporarily unavailable. Wait a moment, then sync again.";
  return message;
}
