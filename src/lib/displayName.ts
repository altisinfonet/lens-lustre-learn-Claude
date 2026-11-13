/**
 * WHAT A MEMBER IS CALLED — AND WHAT IS SHOWN WHILE WE DO NOT KNOW YET.
 *
 * Owner, 2026-11-13 (screenshot: his own new post named "Photographer"):
 * "On a weak network, Meta show Name … I need strong plan not a weak plan".
 *
 * Until that day the fallback for a missing name was the WORD "Photographer"
 * (2026-08-12: it replaced a "?"). A word in the name's place reads as the
 * name, so a member saw a stranger called Photographer where their friend
 * should be. There is no fallback word any more:
 *
 *   • the database gives every member a name (20261113_0500: none is empty)
 *   • every post / comment read carries the name in the same reply
 *   • UserIdentityBlock asks the shared profile cache by member id when a
 *     caller had no name (useMemberName) and draws a grey name bar meanwhile
 *   • the member's own name comes from the copy on the phone (ownDisplayName)
 *   • src/__tests__/noPhotographerFallback.test.ts fails the build if the word
 *     comes back as a fallback anywhere in src
 *
 * displayName() is for the places that need TEXT (an aria-label, a search
 * title): the trimmed name, or "" — a blank, never a made-up name.
 */

/** The trimmed name, or "" when there is none. Never a made-up word. */
export function displayName(name: string | null | undefined): string {
  return (name ?? "").trim();
}

/**
 * The single uppercase letter for a placeholder avatar, or "" when the name is
 * not known yet (the circle stays plain — loading, not a fake initial).
 *
 * `Array.from` rather than `[0]` because a name may begin with an emoji or any
 * other astral-plane character, and indexing a JS string returns half of a
 * surrogate pair — which renders as the replacement glyph.
 */
export function avatarInitial(name: string | null | undefined): string {
  const first = Array.from(displayName(name))[0] ?? "";
  return first.toUpperCase();
}
