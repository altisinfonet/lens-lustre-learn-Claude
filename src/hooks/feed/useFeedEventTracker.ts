import { useCallback, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Phase 3 — Feed Event Tracking
 *
 * Tracks: view (with dwell time), like, skip, comment, share, click
 * Batches events client-side and flushes every 5 seconds to reduce DB writes.
 * Deduplicates view events per session (same post only tracked once).
 */

interface FeedEvent {
  user_id: string;
  post_id: string;
  author_id: string;
  event_type: "view" | "like" | "skip" | "comment" | "share" | "click";
  dwell_ms: number;
}

const FLUSH_INTERVAL = 5000; // 5 seconds
const MAX_BATCH = 25;

export function useFeedEventTracker(userId: string | undefined) {
  const batchRef = useRef<FeedEvent[]>([]);
  const viewedRef = useRef<Set<string>>(new Set()); // dedup views per session
  const viewStartRef = useRef<Map<string, number>>(new Map()); // post_id → timestamp

  /** Flush batched events to DB */
  const flush = useCallback(async () => {
    if (!userId || batchRef.current.length === 0) return;
    const events = batchRef.current.splice(0, MAX_BATCH);
    try {
      await supabase.from("feed_events" as any).insert(events as any);
    } catch {
      // Silent fail — tracking should never break the feed
    }
  }, [userId]);

  // Auto-flush every 5 seconds
  useEffect(() => {
    if (!userId) return;
    const interval = setInterval(flush, FLUSH_INTERVAL);
    return () => {
      clearInterval(interval);
      flush(); // flush remaining on unmount
    };
  }, [userId, flush]);

  /** Track a post entering the viewport */
  const trackViewStart = useCallback((postId: string) => {
    viewStartRef.current.set(postId, Date.now());
  }, []);

  /** Track a post leaving the viewport — calculates dwell time */
  const trackViewEnd = useCallback(
    (postId: string, authorId: string) => {
      if (!userId || viewedRef.current.has(postId)) return;
      const start = viewStartRef.current.get(postId);
      if (!start) return;

      const dwell = Date.now() - start;
      viewStartRef.current.delete(postId);

      // Only track if user spent at least 500ms viewing (not just scrolling past)
      if (dwell < 500) return;

      viewedRef.current.add(postId);
      batchRef.current.push({
        user_id: userId,
        post_id: postId,
        author_id: authorId,
        event_type: dwell < 2000 ? "skip" : "view",
        dwell_ms: Math.min(dwell, 60000), // cap at 60s
      });

      if (batchRef.current.length >= MAX_BATCH) flush();
    },
    [userId, flush],
  );

  /** Track an engagement action (like, comment, share, click) */
  const trackAction = useCallback(
    (postId: string, authorId: string, action: "like" | "comment" | "share" | "click") => {
      if (!userId) return;
      batchRef.current.push({
        user_id: userId,
        post_id: postId,
        author_id: authorId,
        event_type: action,
        dwell_ms: 0,
      });
      if (batchRef.current.length >= MAX_BATCH) flush();
    },
    [userId, flush],
  );

  return { trackViewStart, trackViewEnd, trackAction };
}
