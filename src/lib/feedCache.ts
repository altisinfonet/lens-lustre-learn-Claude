/**
 * Local feed cache — persists the first page of feed posts to localStorage
 * so the next visit shows content instantly (stale-while-revalidate).
 *
 * Only the first page (10 posts) is cached to keep storage lean (~50-80 KB).
 * Cache expires after 30 minutes to avoid showing very stale content.
 */

const CACHE_KEY = "feed_cache_v1";
const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

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

/** Retrieve cached feed if fresh and belongs to current user */
export function getCachedFeed(userId: string): { posts: any[]; networkIds: string[] } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;

    const cached: CachedFeed = JSON.parse(raw);

    // Wrong user — discard
    if (cached.userId !== userId) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }

    // Expired
    if (Date.now() - cached.ts > MAX_AGE_MS) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }

    if (!cached.posts?.length) return null;

    return { posts: cached.posts, networkIds: cached.networkIds };
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
