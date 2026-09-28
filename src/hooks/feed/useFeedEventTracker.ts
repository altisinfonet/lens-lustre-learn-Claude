import { useCallback, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { startVisibilityInterval } from "@/lib/timers/visibilityInterval";

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

/* P10: was 5000. Raised to 15s and stopped while hidden.
 *
 * JUSTIFIED, NOT JUST SLOWED. This is a flush of an in-memory batch, not a
 * poll: it issues no request at all when the batch is empty, so its cost while
 * a member reads is proportional to what they actually looked at. What the old
 * shape did wrong was keep firing behind a hidden tab, where the batch is
 * always empty and the wake-up is always wasted. 15s bounds the loss if the
 * tab is killed outright to fifteen seconds of view events — telemetry, not
 * member data — and the unmount flush below still catches the ordinary case.
 */
const FLUSH_INTERVAL = 15_000;
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

  useEffect(() => {
    if (!userId) return;
    const stop = startVisibilityInterval(() => { void flush(); }, FLUSH_INTERVAL);
    /* P10: hiding the tab is the most likely moment for a member to never come
     * back to it, so flush once on the way out rather than losing the batch. */
    const onHide = () => { if (document.hidden) void flush(); };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onHide);
      void flush(); // flush remaining on unmount
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
