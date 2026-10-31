/**
 * The comment threads this device has already drawn, kept in memory so a second
 * open of the same thread draws at once (bug 5) — the post thread
 * (usePostComments) and the ad thread (AdComments) both use it.
 *
 * The rule is Meta's (Facebook / Instagram): stale-while-revalidate where the
 * SERVER ALWAYS WINS. The cached copy is only ever a first frame; every open
 * still re-reads, and whatever that read returns replaces the screen — an
 * EMPTY thread included, so a comment deleted or moderated elsewhere is gone
 * the moment the read lands.
 *
 * Privacy on a shared phone (review of #435, 17 Oct 2026):
 *   · every entry is keyed by the VIEWER as well as the thread
 *     (`threadCacheKey`), so member B can never be drawn member A's copy, not
 *     even for one frame — B's key simply has no entry;
 *   · every sign-out empties every cache (`clearCommentThreadCaches`, called
 *     from signOutWipe and from useAuth.signOut, next to clearFeedCache);
 *   · each cache is bounded (least recently used goes first), so a long session
 *     never piles up threads.
 *
 * In memory only — nothing here ever reaches localStorage or IndexedDB.
 */

export const THREAD_CACHE_MAX = 50;

export interface ThreadCache<T> {
  get(viewerId: string | null | undefined, threadId: string): T | undefined;
  has(viewerId: string | null | undefined, threadId: string): boolean;
  set(viewerId: string | null | undefined, threadId: string, value: T): void;
  /** A write on the thread makes every remembered copy of it wrong. */
  forget(threadId: string | null | undefined): void;
  clear(): void;
  readonly size: number;
}

/** One key per (viewer, thread). A signed-out viewer is "anon" — never a member's id. */
export const threadCacheKey = (viewerId: string | null | undefined, threadId: string): string =>
  `${viewerId || "anon"}\u0000${threadId}`;

const caches = new Set<ThreadCache<unknown>>();

export function createThreadCache<T>(max: number = THREAD_CACHE_MAX): ThreadCache<T> {
  const map = new Map<string, T>();
  const cache: ThreadCache<T> = {
    get: (viewerId, threadId) => {
      const key = threadCacheKey(viewerId, threadId);
      const value = map.get(key);
      if (value !== undefined) {
        // Touch: most recently used moves to the back of the eviction queue.
        map.delete(key);
        map.set(key, value);
      }
      return value;
    },
    has: (viewerId, threadId) => map.has(threadCacheKey(viewerId, threadId)),
    set: (viewerId, threadId, value) => {
      const key = threadCacheKey(viewerId, threadId);
      map.delete(key);
      map.set(key, value);
      while (map.size > max) map.delete(map.keys().next().value as string);
    },
    forget: (threadId) => {
      if (!threadId) return;
      const suffix = `\u0000${threadId}`;
      for (const key of [...map.keys()]) if (key.endsWith(suffix)) map.delete(key);
    },
    clear: () => map.clear(),
    get size() { return map.size; },
  };
  caches.add(cache as ThreadCache<unknown>);
  return cache;
}

/** Sign-out: no comment thread drawn for the departing member survives it. */
export function clearCommentThreadCaches(): void {
  caches.forEach((c) => {
    try { c.clear(); } catch { /* never block sign-out */ }
  });
}
