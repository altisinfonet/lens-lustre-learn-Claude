/**
 * "LAST SEEN X AGO" — THE READER. Nothing in here writes any more.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT LEFT, AND WHERE IT WENT (2-D2-03, P1 client half)
 *
 * This file used to hold `useLastActive()`, which wrote
 * `profiles.last_active_at` and `profiles.last_platform` on mount and then
 * every five minutes for as long as the tab was open, and `isActiveNow()`,
 * which turned that timestamp into the green dot. `docs/gates/P1-interface.md`
 * §5 removes the first: "No client code writes profiles.last_active_at or
 * profiles.last_platform. There is no client timer that touches profiles."
 *
 *   · the green dot        → `src/lib/presence/online.ts` (Realtime Presence,
 *                            zero writes) — §1
 *   · the "last seen" write → `src/hooks/core/useSessionEnd.ts`, one
 *                            `record_session_end` call when the session ends,
 *                            with the two-tab rule resolved in the database — §2
 *   · the missed-write case → `backfill_last_seen()` on pg_cron, D1's half — §3
 *
 * `isActiveNow` is DELETED rather than deprecated, and that is the point of
 * mentioning it here: while it existed, "active within five minutes" was one
 * import away from becoming the dot again in the next component somebody wrote.
 * §4 is explicit — "The green dot uses isOnline(userId), never
 * isActiveNow(last_active_at)".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE FILE KEEPS ITS NAME
 *
 * `formatLastSeen` is the reader of `profiles.last_active_at`, which §4 keeps
 * exactly as it was. Renaming the file would edit every importer for no
 * behavioural change, in a unit whose diff is already wide; the header is the
 * honest way to say what it now contains.
 */

/**
 * Format `profiles.last_active_at` into "Last seen X ago".
 *
 * "Active now" here is a property of the TIMESTAMP, not of presence: it means
 * the last recorded session end was under two minutes ago. The green dot must
 * not be derived from it — `useOnline(userId)` is the live answer (§4). The
 * admin list shows the presence answer in preference to this string when the two
 * disagree, which they will: `record_session_end` writes when a member LEAVES.
 */
export function formatLastSeen(lastActiveAt: string | null | undefined): string {
  if (!lastActiveAt) return "";
  const diff = Date.now() - new Date(lastActiveAt).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return "Active now";
  if (mins < 60) return `Last seen ${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Last seen ${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `Last seen ${days}d ago`;
  return `Last seen ${Math.floor(days / 7)}w ago`;
}
