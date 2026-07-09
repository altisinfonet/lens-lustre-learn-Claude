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
  const key = queryKeys.feed();

  /** Queue a batched updater against the feed cache. */
  const enqueue = useCallback(
    (updater: (old: InfiniteData) => InfiniteData) => {
      queueCacheUpdate<InfiniteData>(queryClient, key, updater);
    },
    [queryClient, key],
  );

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
      });
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
   *  so the mapper sees the latest state. */
  const mapPosts = useCallback(
    (mapper: (post: FeedPost) => FeedPost) => {
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
    },
    [queryClient, key],
  );

  return { insertPost, replacePost, patchPost, removePost, mapPosts };
}
