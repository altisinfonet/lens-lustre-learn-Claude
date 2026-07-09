import { useState, useCallback, useRef } from "react";
import type { FeedPost } from "@/hooks/feed/useFeedQuery";

/**
 * Phase 2 — Realtime Post Buffering
 *
 * Instead of inserting new realtime posts directly into the feed (causing jank),
 * buffer them and show a "New posts available" banner.
 *
 * The user clicks the banner to merge buffered posts into the feed.
 */

export function useNewPostsBanner() {
  const [bufferedPosts, setBufferedPosts] = useState<FeedPost[]>([]);
  const bufferedIdsRef = useRef<Set<string>>(new Set());

  /** Buffer a new post instead of showing it immediately */
  const bufferPost = useCallback((post: FeedPost) => {
    if (bufferedIdsRef.current.has(post.id)) return;
    bufferedIdsRef.current.add(post.id);
    setBufferedPosts((prev) => [post, ...prev]);
  }, []);

  /** Flush buffered posts — returns them and clears the buffer */
  const flushBuffer = useCallback((): FeedPost[] => {
    const posts = [...bufferedPosts];
    setBufferedPosts([]);
    bufferedIdsRef.current.clear();
    return posts;
  }, [bufferedPosts]);

  /** Check if a post ID is already buffered (to avoid duplicates) */
  const isBuffered = useCallback((postId: string): boolean => {
    return bufferedIdsRef.current.has(postId);
  }, []);

  return {
    bufferedCount: bufferedPosts.length,
    bufferPost,
    flushBuffer,
    isBuffered,
  };
}
