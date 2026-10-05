/**
 * Local feed cache — persists the first page of feed posts to localStorage
 * so the next visit shows content instantly (stale-while-revalidate).
 *
 * Only the first page (10 posts = useFeedQuery's PAGE_SIZE, the same first page
 * OFF-1's device store keeps) is cached to keep storage lean (~50-80 KB).
 *
 * ⚠ IT NO LONGER EXPIRES — F-D3-13, OFF-5 rule G2 ("Saved first, then fresh.
 * Age is a label, never a reason to hide what is saved. The current 30-minute
 * expiry in src/lib/feedCache.ts is removed."). This is the feed's FIRST paint
 * (useFeedQuery's placeholderData, read synchronously before the device store
 * hydrates) and the only saved feed when IndexedDB is unavailable. With the old
 * 30-minute expiry a cold start offline an hour later DELETED the posts the
 * member already had and showed the error card. Staleness is handled where it
 * belongs: the feed refetches on mount as soon as there is a network
 * (staleTime 0), and `savedAt` lets the screen say how old the saved copy is.
 *
 * What still discards it: a different member (never show another member's
 * feed) and sign-out (signOutWipe.ts → clearFeedCache).
 */

const CACHE_KEY = "feed_cache_v1";

interface CachedFeed {
  ts: number;        // timestamp when cached
  userId: string;    // owner — don't show another user's cache
  posts: any[];      // first page posts (enriched)
  networkIds: string[];
}

/** Save first page of feed to localStorage */
export function persistFeedPage(posts: any[], networkIds: string[], userId: string) {
  try {
    // Only cache first 10 posts to keep size small
    const payload: CachedFeed = {
      ts: Date.now(),
      userId,
      posts: posts.slice(0, 10),
      networkIds,
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Storage full or unavailable — non-critical
  }
}

/** Retrieve the saved feed if it belongs to the current user — at any age (G2). */
export function getCachedFeed(userId: string): { posts: any[]; networkIds: string[]; savedAt: number } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;

    const cached: CachedFeed = JSON.parse(raw);

    // Wrong user — discard
    if (cached.userId !== userId) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }

    if (!cached.posts?.length) return null;

    return { posts: cached.posts, networkIds: cached.networkIds, savedAt: cached.ts };
  } catch {
    return null;
  }
}

/** Clear feed cache (e.g. on logout) */
export function clearFeedCache() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // ignore
  }
}
