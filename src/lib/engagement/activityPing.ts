/**
 * Phase 2a — Active Engagement collector. COLLECT ONLY.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS DOES AND WHAT IT DELIBERATELY DOES NOT DO
 *
 * It reports "this signed-in member was genuinely in the foreground during this
 * wall-clock minute, on this kind of page". That is all. Nothing here is
 * scored, nothing is displayed, and no member's Contributor Score moves by a
 * point because of it. Owner, 2026-08-11: "Proceed with Phase 2a — Collect
 * Only."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SEGMENT ALLOW-LIST, NOT "THE FIRST PATH SEGMENT"
 *
 * Owner, 2026-08-11: "Record only the first path segment/category such as
 * `feed`, `journal`, `profile`, `course`; never store full URLs, IDs or slugs."
 *
 * Taking the first segment literally would honour that everywhere except at the
 * root, because this site routes `/:customUrl` — a member's vanity URL — at the
 * top level. `/dipannita-sen` has a first segment that IS a member identifier.
 * `/hashtag/roses` is fine (first segment `hashtag`), but the vanity route
 * would have quietly written usernames into a table meant to hold categories.
 *
 * So the segment is matched against the fixed list of routes this app actually
 * declares, and anything unrecognised becomes `other`. A new route added later
 * lands in `other` until it is added here — under-reporting a category, which
 * is recoverable, rather than leaking an identifier, which is not.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO RETRY, NO OFFLINE QUEUE — ON PURPOSE
 *
 * A dropped ping is a lost minute and that is the correct outcome. Any buffer
 * would replay a duration the client asserts happened, which is precisely the
 * claim this whole design refuses to trust. Under-counting is the safe error.
 */
import { supabase } from "@/integrations/supabase/client";

/**
 * Every static first segment declared in App.tsx, plus "home" for the root.
 * Dynamic-only routes (`/:customUrl`) are absent by design — see above.
 */
const KNOWN_SEGMENTS = new Set([
  "ad",
  "admin",
  "certificate",
  "certificates",
  "competitions",
  "cookie-policy",
  "courses",
  "dashboard",
  "discover",
  "edit-profile",
  "entry",
  "featured-artist",
  "feed",
  "forgot-password",
  "friends",
  "hashtag",
  "help-support",
  "home",
  "idverification",
  "journal",
  "judge",
  "login",
  "notifications",
  "page",
  "photos",
  "post",
  "profile",
  "referrals",
  "reset-password",
  "scheduled-posts",
  "settings",
  "signup",
  "unsubscribe",
  "verify",
  "wallet",
  "winners",
]);

/**
 * `/journal/my-trip-to-ladakh` -> "journal". `/dipannita-sen` -> "other".
 *
 * Lower-cased because `/IDverification` is declared with capitals and the same
 * page reached two ways must not look like two categories.
 */
export const pathSegment = (pathname: string): string => {
  const first = (pathname || "/").split("/")[1] ?? "";
  if (first === "") return "home";
  const seg = first.toLowerCase();
  return KNOWN_SEGMENTS.has(seg) ? seg : "other";
};

/**
 * The minute this instant falls in, as a stable key. Used only to stop the
 * client sending more than one ping per wall-clock minute; the authoritative
 * bucket is `date_trunc('minute', now())` computed on the server, because a
 * client clock is not evidence of anything.
 */
export const minuteKey = (ms: number): number => Math.floor(ms / 60_000);

/**
 * src/integrations/supabase/types.ts is generated and has not been regenerated
 * since record_activity_minute was created, so the typed rpc() overload does
 * not know the function exists. One documented narrowing through `unknown`
 * records that gap in a single place — rather than an `as any` at the call
 * site, which would also silence a genuine mistake in the argument names.
 */
type UntypedRpc = (
  fn: string,
  args: Record<string, unknown>,
) => PromiseLike<unknown>;

/**
 * Fire-and-forget. Resolves whether or not the write succeeded — the caller has
 * nothing useful to do with a failure, and a toast about telemetry would be an
 * insult to the member.
 */
export const sendActivityPing = async (
  segment: string,
  interacted: boolean,
): Promise<void> => {
  try {
    await (supabase.rpc as unknown as UntypedRpc)("record_activity_minute", {
      _segment: segment,
      _interacted: interacted,
    });
  } catch {
    // Swallowed deliberately. No retry, no queue — see the header.
  }
};
