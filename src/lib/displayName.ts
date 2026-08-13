/**
 * WHAT A MEMBER IS CALLED WHEN WE DO NOT KNOW WHAT THEY ARE CALLED.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 *
 * Owner, 2026-08-12: *"Very often every names are showing as ? then coming to
 * names automatically."*
 *
 * Two different fallbacks were in use for the same missing value, side by side,
 * on the same row of the same post:
 *
 *   * the NAME rendered `name || "Photographer"`   (UserIdentityBlock)
 *   * the AVATAR rendered `(name || "?")[0]`       (PostCard and ~30 others)
 *
 * So a post whose author had not resolved yet showed a "?" circle next to the
 * word "Photographer" — the same unknown, described two ways, one of which
 * looks like a fault. A question mark on a person's face is read as "this
 * account is broken", which is a much stronger claim than the truth ("the name
 * has not arrived yet").
 *
 * One fallback, one place. The avatar letter is now derived FROM the display
 * name, so the circle and the text can never disagree again — an unresolved
 * author is a "P" beside "Photographer", which reads as loading rather than as
 * damage.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS THE COSMETIC HALF OF THE FIX, NOT THE FIX.
 *
 * The reason a name goes missing at all is a failed profile batch — see
 * `profileMapCache.ts`, where the lookup now retries instead of resolving to
 * placeholders on the first dropped request. That is what makes the unknown
 * state RARE. This module only makes it honest when it does happen.
 */

/**
 * The name shown for a member whose profile has not resolved.
 *
 * Not "Unknown", not "Anonymous", not an empty string: this is a photography
 * platform and every member is a photographer, so the generic term is also an
 * accurate one. It has been the site's fallback since UserIdentityBlock was
 * written; it is only centralised here.
 */
export const DISPLAY_NAME_FALLBACK = "Photographer";

/** The name to render, with the fallback applied. Never empty. */
export function displayName(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  return trimmed.length > 0 ? trimmed : DISPLAY_NAME_FALLBACK;
}

/**
 * The single uppercase letter for a placeholder avatar.
 *
 * Derived from `displayName`, which is the entire point — pass a missing name
 * and you get "P" for "Photographer", never "?".
 *
 * `Array.from` rather than `[0]` because a name may begin with an emoji or any
 * other astral-plane character, and indexing a JS string returns half of a
 * surrogate pair — which renders as the replacement glyph, i.e. we would have
 * traded "?" for "�".
 */
export function avatarInitial(name: string | null | undefined): string {
  const first = Array.from(displayName(name))[0] ?? DISPLAY_NAME_FALLBACK[0];
  return first.toUpperCase();
}
