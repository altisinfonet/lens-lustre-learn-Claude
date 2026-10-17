/**
 * WHAT AN AD'S COMMENTS BOX SAYS ABOUT THE AD — the name in its header and its
 * headline, kept by creative id.
 *
 * Bug 3 (Owner, 15 Oct 2026): ONE comments box for posts, ads, video posts and
 * picture posts — same features, same wording. A post's box says
 * "Add a comment for <owner>" and shows the post's first line in its search
 * row; the ad's said "Write a comment..." and nothing, because the overlay is
 * opened with a creative id and the media, and the name was never passed.
 *
 * The card (AdZone) already knows both, so it leaves them here as it draws,
 * and AdComments reads them back. A Map, not a fetch: it only ever holds what
 * is on the screen, and an id it has not seen falls back to the one shared
 * placeholder (commentPlaceholderFor) — never to a second string.
 */
export interface AdThreadSubject {
  /** Exactly what the ad's header shows: the advertiser, or the site's own name. */
  owner: string;
  /** The creative's headline, for the box's search row; null when it has none. */
  headline: string | null;
}

const subjects = new Map<string, AdThreadSubject>();

export const rememberAdThreadSubject = (creativeId: string, subject: AdThreadSubject): void => {
  subjects.set(creativeId, subject);
};

export const adThreadSubject = (creativeId: string): AdThreadSubject | null => subjects.get(creativeId) ?? null;
