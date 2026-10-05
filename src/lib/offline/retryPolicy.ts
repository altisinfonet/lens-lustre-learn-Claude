/**
 * OFF-3 · when a failed query is retried, and how long the app waits between tries.
 *
 * Before OFF-3 every query retried exactly once, whatever failed. On a poor
 * network one retry is often not enough (a second timeout in a tunnel), and for
 * a REFUSAL — a 4xx, an RLS denial, a missing row — any retry is wasted traffic.
 *
 *   network failure or our own timeout  -> up to MAX_NETWORK_RETRIES, backing off
 *   a server 5xx                        -> one retry
 *   anything else (4xx, RLS, bad input) -> no retry: asking again cannot help
 * While the device is offline React Query PAUSES instead of retrying (its
 * onlineManager), and resumes when the network returns.
 */
export const MAX_NETWORK_RETRIES = 3;

/** The HTTP status carried by a fetch/PostgREST error, if any. (Not a competition entry's status.) */
function httpStatusOf(error: unknown): number | null {
  const { status: httpStatus, code } = (error ?? {}) as { status?: unknown; code?: unknown };
  if (typeof httpStatus === "number") return httpStatus;
  if (typeof code === "string" && /^\d{3}$/.test(code)) return Number(code);
  return null;
}

export function isNetworkError(error: unknown): boolean {
  const e = error as { name?: string; message?: string } | null;
  const name = e?.name ?? "";
  const msg = (e?.message ?? "").toLowerCase();
  return name === "TimeoutError" || (name === "TypeError" && msg.includes("fetch"))
    || msg.includes("failed to fetch") || msg.includes("network") || msg.includes("timed out") || msg.includes("load failed");
}

export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isNetworkError(error)) return failureCount < MAX_NETWORK_RETRIES;
  const httpStatus = httpStatusOf(error);
  if (httpStatus !== null && httpStatus >= 500) return failureCount < 1;
  return false;
}

/** 1 s, 2 s, 4 s … capped at 8 s, so a recovering link is tried soon and a dead one is not hammered. */
export function retryDelay(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 8000);
}
