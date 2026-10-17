/**
 * L1 · B1 — THE FEED'S SESSION OUTLIVES THE FEED SCREEN, AS ITS PAGES DO.
 *
 * A feed session is what a deal is made of besides its posts: the seed every
 * page of the deal is asked for with, the watermark the "N new posts" pill
 * counts from, and — per page index — the posts already delivered (the exclude
 * list) and the last author (the no-back-to-back rule across a page boundary).
 *
 * Until PR #434's review (B1) this lived in `useRef`s inside useFeedQuery, so
 * it died with the Feed component. /feed and /post/:id are sibling routes: Back
 * from a post REMOUNTS the feed. The pages came back from React Query's cache,
 * but the session did not — so even with the re-deal on Back stopped, the first
 * "load more" afterwards ran with no seed and an empty exclude list: a brand-new
 * deal behind the member's back, repeating posts already on screen.
 *
 * Kept here, outside React, for the same lifetime as the query cache entry it
 * belongs to — one session per feed variant (`categories`), for ONE member:
 *   · a different member signing in on this device starts from nothing
 *     (`feedSessionFor` drops everything the moment the member changes);
 *   · a sign-out drops everything (`clearFeedSessions`, called from
 *     wipeMemberDataOnSignOut — the path every session end takes);
 *   · a reload starts from nothing (module memory), which is also why pages
 *     restored from the device (OFF-1) are never mistaken for this session's
 *     deal: their seed is not the one held here (useFeedQuery's
 *     `isReturnToTheDealOnScreen`).
 *
 * Deliberately tiny and dependency-free: useAuth's sign-out path imports it,
 * and that path is in the entry bundle.
 */
export interface FeedSession {
  /** Friends + follows + self, labelled onto posts as `is_suggested`. */
  networkIds: { current: string[] };
  /** Post ids delivered BEFORE each page, by page index (see useFeedQuery). */
  excludeByPage: { current: Map<number, string[]> };
  /** Last author of the previous page, by page index. */
  lastAuthorByPage: { current: Map<number, string | null> };
  /** The committed deal's seed — null until a first page has ARRIVED. */
  seed: { current: string | null };
  /** The committed deal's watermark (undefined: not read yet). */
  watermark: { current: string | null | undefined };
}

let member: string | undefined;
const sessions = new Map<string, FeedSession>();

const blank = (): FeedSession => ({
  networkIds: { current: [] },
  excludeByPage: { current: new Map() },
  lastAuthorByPage: { current: new Map() },
  seed: { current: null },
  watermark: { current: undefined },
});

/**
 * The session for this member's feed variant (`catsKey`: the sorted category
 * slugs joined by ",", "" for All). A signed-out render (no `userId`, e.g.
 * while auth is still loading) never clears anything: only a DIFFERENT member
 * does, and a sign-out does through `clearFeedSessions`.
 */
export function feedSessionFor(userId: string | undefined, catsKey: string): FeedSession {
  if (userId && userId !== member) {
    sessions.clear();
    member = userId;
  }
  let s = sessions.get(catsKey);
  if (!s) {
    s = blank();
    sessions.set(catsKey, s);
  }
  return s;
}

/**
 * A fresh visit to the feed (not a Back/Forward return): the session starts
 * from nothing, as it did when it lived in the feed screen's own refs. The
 * objects are kept (the screen holds them); only what they hold is dropped.
 */
export function startFeedSessionOver(s: FeedSession): void {
  s.networkIds.current = [];
  s.excludeByPage.current = new Map();
  s.lastAuthorByPage.current = new Map();
  s.seed.current = null;
  s.watermark.current = undefined;
}

/** Sign-out: no feed session survives the member it belonged to. */
export function clearFeedSessions(): void {
  sessions.clear();
  member = undefined;
}
