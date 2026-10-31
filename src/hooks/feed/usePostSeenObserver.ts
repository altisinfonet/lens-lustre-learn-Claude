import { useEffect, useRef, type RefObject } from "react";
import { VIEW_VISIBLE_RATIO, VIEW_VIEWPORT_SHARE } from "@/hooks/feed/useFeedEventTracker";

/**
 * STAGE L2 · ONE IntersectionObserver PER POST CARD, reporting whether the card
 * is visible enough to count (useFeedEventTracker.ts holds the one-second clock).
 *
 * Visible enough = at least VIEW_VISIBLE_RATIO of the card is on screen, OR the
 * on-screen part fills at least VIEW_VIEWPORT_SHARE of the viewport — the second
 * rule is for a card taller than twice the screen, which could otherwise never
 * reach 50 % and would never be seen.
 *
 * Fails open like FeedCardWindow: no IntersectionObserver (jsdom, an old
 * WebView) → nothing is reported and nothing is recorded; the feed itself is
 * unaffected.
 */

/** 0, 0.05 … 1 — fine enough that the viewport-share rule is noticed as a tall card scrolls. */
export const SEEN_THRESHOLDS: readonly number[] = Array.from({ length: 21 }, (_, i) => i / 20);

type EntryLike = Pick<IntersectionObserverEntry, "isIntersecting" | "intersectionRatio" | "intersectionRect" | "rootBounds">;

export function isVisibleEnough(entry: EntryLike, viewportHeight: number = typeof window !== "undefined" ? window.innerHeight : 0): boolean {
  if (!entry.isIntersecting) return false;
  if (entry.intersectionRatio >= VIEW_VISIBLE_RATIO) return true;
  const vh = entry.rootBounds?.height || viewportHeight;
  return vh > 0 && entry.intersectionRect.height >= vh * VIEW_VIEWPORT_SHARE;
}

export function usePostSeenObserver(
  ref: RefObject<Element | null>,
  postId: string,
  authorId: string,
  report: (postId: string, authorId: string, visibleEnough: boolean) => void,
): void {
  const reportRef = useRef(report);
  reportRef.current = report;

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    let last: boolean | null = null;
    const io = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      const now = isVisibleEnough(entry);
      if (now === last) return;
      last = now;
      reportRef.current(postId, authorId, now);
    }, { threshold: [...SEEN_THRESHOLDS] });
    io.observe(el);
    return () => {
      io.disconnect();
      if (last) reportRef.current(postId, authorId, false);
    };
  }, [ref, postId, authorId]);
}
