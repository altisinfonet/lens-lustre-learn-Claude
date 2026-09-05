/**
 * URL helper utilities for human-readable URLs throughout the app.
 */

/** Build a competition URL using slug (preferred) or ID fallback */
export function competitionUrl(comp: { slug?: string | null; id: string }) {
  return `/competitions/${comp.slug || comp.id}`;
}

/**
 * The in-app address for a member, or null when there isn't one.
 *
 * F-95 — THERE IS NO ID FALLBACK, AND THAT IS THE POINT. This used to be
 * `profileUrl(profile)` returning `/profile/${profile.id}` when the member had
 * no handle, which is precisely the address the Owner's rule forbids: an
 * in-app click is a client-side navigation, so the edge redirect in
 * functions/profile/[id].ts never sees it and the id stays in the address bar.
 *
 * Returning null forces the caller to decide, and the decision is already made
 * for them: render the member's NAME AS PLAIN TEXT. Not a dead anchor, not a
 * disabled-looking control, and never the id. A member without a handle is a
 * closed and shrinking set — F-93 assigns one BEFORE INSERT, so only rows
 * predating its backfill on a given lane are affected.
 */
export function memberPath(handle: string | null | undefined): string | null {
  const h = (handle || "").trim();
  return h ? `/${h}` : null;
}

/** Build structured page title: "Page | Sub | 50mm Retina World" */
export function pageTitle(...parts: (string | undefined | null)[]) {
  const filtered = parts.filter(Boolean) as string[];
  if (filtered.length === 0) return "50mm Retina World";
  return [...filtered, "50mm Retina World"].join(" | ");
}

/**
 * Where a member goes to claim a name-URL.
 *
 * F-95 — THIS IS THE ANSWER TO "THEN WHERE DOES THE LINK GO?". A member with no
 * handle has nothing to link their own profile to, and the rule forbids the id.
 * Sending them to a dead control would be a worse answer than the bug; sending
 * them to the one screen that fixes the cause is a better one. F-93 assigns a
 * handle BEFORE INSERT, so on a backfilled lane nobody sees this at all — it is
 * for the rows that predate the backfill, and for anyone who clears their own
 * handle under F-96.
 */
export const CLAIM_URL_PATH = "/edit-profile";
