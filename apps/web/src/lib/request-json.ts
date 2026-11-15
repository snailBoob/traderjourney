import { reportClientError } from "./client-errors";

const uncertainResult =
  "The result could not be confirmed. Check the current data before trying again.";

/** Keep transport failures separate from an error explicitly returned by the application. */
export async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const writing = !["GET", "HEAD"].includes(options?.method?.toUpperCase() ?? "GET");
  const nextStep = writing ? uncertainResult : "Please try again.";
  let response: Response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    // Subscriber cancellation is not a connectivity error.
    if (error instanceof Error && error.name === "AbortError") throw error;
    reportClientError(error, "network");
    const reason =
      error instanceof Error && error.name === "TimeoutError"
        ? "TraderJourney did not respond in time."
        : "Could not reach TraderJourney. Check your connection and whether TraderJourney is running.";
    throw new Error(`${reason} ${nextStep}`);
  }

  if (response.status === 401)
    throw new Error(
      "Your TraderJourney session has expired or you are not signed in. Sign in and try again.",
    );

  let data: T & { error?: unknown };
  try {
    data = await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    const reason =
      response.status === 504 || response.status === 408
        ? "TraderJourney did not respond in time."
        : response.status === 502 || response.status === 503
          ? "TraderJourney is temporarily unavailable."
          : "TraderJourney returned an unreadable response.";
    throw new Error(`${reason} ${nextStep}`);
  }
  if (!response.ok) {
    if (typeof data?.error === "string" && data.error.trim()) {
      const requestId = response.headers.get("x-request-id");
      const message =
        response.status >= 500 && requestId
          ? `${data.error} (Reference: ${requestId})`
          : data.error;
      throw Object.assign(new Error(message), { requestId });
    }
    const reason =
      response.status === 403
        ? "You do not have permission to perform this action."
        : response.status === 429
          ? "Too many requests. Wait a moment before trying again."
          : `TraderJourney could not complete the request (HTTP ${response.status}).`;
    throw new Error(`${reason} ${writing ? uncertainResult : "Please try again."}`);
  }
  return data;
}
