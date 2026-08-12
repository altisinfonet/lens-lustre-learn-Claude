import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { queueCacheUpdate, flushCacheUpdates } from "@/lib/batchedCacheUpdate";
import type { FeedPost } from "@/hooks/feed/useFeedQuery";

/**
 * Sorting helper — ensures created_at DESC order.
 */
const sortDesc = (posts: FeedPost[]) =>
  posts.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

/**
 * Shared type for the infinite query cache shape.
 */
interface FeedPage {
  posts: FeedPost[];
  nextCursor: string | null;
  networkIds: string[];
}

interface InfiniteData {
  pages: FeedPage[];
  pageParams: unknown[];
}

/**
 * Returns memoized cache-update functions for the feed infinite query.
 * All realtime updates are batched within a 150ms window to coalesce
 * rapid-fire events into a single cache write + re-render.
 */
export function useFeedCacheUpdaters() {
  const queryClient = useQueryClient();
  /**
   * ⚠ THIS USED TO BE A SINGLE EXACT KEY, AND THAT BREAKS SILENTLY.
   *
   * `queryKeys.feed()` is now `["feed", null]`, so writing to one fixed key
   * would update the "All" cache only. Every category feed the member has
   * visited would keep its stale copy: a deleted post would linger there, and
   * a realtime arrival would never show. Nothing would error — the feed would
   * simply stop reacting on those tabs.
   *
   * `invalidateQueries` is prefix-based and was never at risk. `setQueryData`
   * is exact, and was.
   *
   * So updates fan out across every cached feed variant. `insertPost` is the
   * one that also has to care about WHICH variant: a Landscape post belongs in
   * the All feed and in the Landscape feed, and nowhere else.
   */
  const feedPrefix = queryKeys.feedAll();

  /**
   * Queue a batched updater against EVERY cached feed variant.
   *
   * `getQueryCache().findAll({ queryKey: ["feed"] })` matches by prefix, so it
   * finds `["feed", null]` and every `["feed", [...slugs]]` the member has
   * opened this session. Each gets its own batched update under its own exact
   * key — which is what `queueCacheUpdate` needs.
   *
   * `only` narrows the fan-out: pass a predicate to skip variants a change
   * does not belong in. Removals and counter updates apply everywhere (a
   * deleted post must vanish from all of them); an INSERT does not.
   */
  const enqueue = useCallback(
    (
      updater: (old: InfiniteData) => InfiniteData,
      only?: (categories: string[] | null) => boolean,
    ) => {
      const entries = queryClient.getQueryCache().findAll({ queryKey: feedPrefix });
      for (const entry of entries) {
        const cats = (entry.queryKey[1] ?? null) as string[] | null;
        if (only && !only(cats)) continue;
        queueCacheUpdate<InfiniteData>(queryClient, entry.queryKey, updater);
      }
    },
    [queryClient, feedPrefix],
  );

  /**
   * Does a post belong in the feed variant filtered to `cats`?
   * `null` is "All" and takes everything. Otherwise the post must carry at
   * least one of the selected slugs — the client-side mirror of the `&&`
   * operator the RPC uses, so a Landscape post never appears under Portrait.
   */
  const belongsIn = (post: FeedPost, cats: string[] | null): boolean => {
    if (!cats || cats.length === 0) return true;
    const own = ((post as unknown as { categories?: string[] }).categories) ?? [];
    return own.some((c) => cats.includes(c));
  };

  /** Insert a new post if not already present; maintain sort order. */
  const insertPost = useCallback(
    (post: FeedPost) => {
      enqueue((old) => {
        for (const page of old.pages) {
          if (page.posts.some((p) => p.id === post.id)) return old;
        }
        const firstPage = old.pages[0];
        return {
          ...old,
          pages: [
            { ...firstPage, posts: sortDesc([post, ...firstPage.posts]) },
            ...old.pages.slice(1),
          ],
        };
      },
      // A realtime arrival belongs in "All" and in the category feeds it was
      // filed under — nowhere else. Without this guard a Landscape post would
      // pop into the Portrait feed, which is exactly the confusion the whole
      // feature is meant to remove.
      (cats) => belongsIn(post, cats));
    },
    [enqueue],
  );

  /** Replace an existing post by id across all pages.
   *  Full replacement — no merge to avoid stale fields. */
  const replacePost = useCallback(
    (postId: string, replacement: FeedPost) => {
      enqueue((old) => {
        let changed = false;
        const pages = old.pages.map((page) => {
          const idx = page.posts.findIndex((p) => p.id === postId);
          if (idx === -1) return page;
          changed = true;
          const updated = [...page.posts];
          updated[idx] = replacement;
          return { ...page, posts: updated };
        });
        return changed ? { ...old, pages } : old;
      });
    },
    [enqueue],
  );

  /** Patch fields on a post using current cache value (safe for counters). */
  const patchPost = useCallback(
    (postId: string, updater: (current: FeedPost) => Partial<FeedPost>) => {
      enqueue((old) => {
        let changed = false;
        const pages = old.pages.map((page) => {
          const idx = page.posts.findIndex((p) => p.id === postId);
          if (idx === -1) return page;
          changed = true;
          const updated = [...page.posts];
          updated[idx] = { ...updated[idx], ...updater(updated[idx]) };
          return { ...page, posts: updated };
        });
        return changed ? { ...old, pages } : old;
      });
    },
    [enqueue],
  );

  /** Remove a post by id from all pages. Safe if not present. */
  const removePost = useCallback(
    (postId: string) => {
      enqueue((old) => {
        let changed = false;
        const pages = old.pages.map((page) => {
          const filtered = page.posts.filter((p) => p.id !== postId);
          if (filtered.length !== page.posts.length) changed = true;
          return filtered.length !== page.posts.length
            ? { ...page, posts: filtered }
            : page;
        });
        return changed ? { ...old, pages } : old;
      });
    },
    [enqueue],
  );

  /** Map over every post via a mapper function.
   *  Used by optimistic mutations — flushes pending batched updates first
   *  so the mapper sees the latest state.
   *
   *  This one deliberately does NOT go through `enqueue`: an optimistic
   *  mutation must land in the same tick the member clicked, not 150ms later.
   *  It still has to fan out, though — the same post is in the All cache and
   *  in every category cache the member has opened, and a like that appears on
   *  one tab but not another is the exact class of bug the fan-out exists for. */
  const mapPosts = useCallback(
    (mapper: (post: FeedPost) => FeedPost) => {
      const entries = queryClient.getQueryCache().findAll({ queryKey: feedPrefix });
      for (const entry of entries) {
        const key = entry.queryKey;
        // Flush any pending realtime updates before applying optimistic mutation
        flushCacheUpdates<InfiniteData>(queryClient, key);

        queryClient.setQueryData<InfiniteData>(key, (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              posts: page.posts.map(mapper),
            })),
          };
        });
      }
    },
    [queryClient, feedPrefix],
  );

  return { insertPost, replacePost, patchPost, removePost, mapPosts };
}
