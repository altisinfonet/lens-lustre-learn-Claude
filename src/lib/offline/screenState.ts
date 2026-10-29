/**
 * S7b-4 · WHAT A SCREEN SAYS WHEN IT HAS NOTHING TO SHOW. "This profile
 * doesn't exist" and "Nothing here yet" were shown with no network too, because
 * a paused or network-failed read looked exactly like an empty answer. Saved
 * data always wins; with none, no network is "offline" — never "missing".
 */
import { isNetworkError } from "./retryPolicy";

export type ScreenState = "show" | "loading" | "offline" | "missing";

export function screenState(s: { hasData: boolean; loading: boolean; error: unknown; online: boolean; paused?: boolean }): ScreenState {
  if (s.hasData) return "show";
  if (!s.online || s.paused || (s.error != null && isNetworkError(s.error))) return "offline";
  if (s.loading) return "loading";
  return "missing";
}
