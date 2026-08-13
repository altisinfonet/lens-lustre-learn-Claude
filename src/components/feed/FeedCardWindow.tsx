/**
 * FEED WINDOWING — the fix for "the platform is empty drum" on a real phone.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 *
 * `Feed.tsx` renders `posts.map(...)`. Nothing was ever unmounted. Ten
 * scroll-loads meant **100 live PostCards** in the DOM at once, each carrying
 * two or three `<img>`, a Radix dropdown, an IntersectionObserver, a
 * ContributorScore fetch and framer-motion nodes — plus the decoded bitmap of
 * every photo, which is the part that actually kills the tab. On a mid-range
 * Android that is an out-of-memory crash, and it is the single worst thing in
 * this codebase for the member experience.
 *
 * `maxPages: 5` bounded how many pages are RETAINED. This bounds how many cards
 * are MOUNTED. They are different problems and both were real.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS HAND-ROLLED AND NOT `react-virtuoso` / `@tanstack/react-virtual`
 *
 * Not preference — a measured constraint. Adding any dependency means
 * regenerating `package-lock.json`, and doing that against this repo's caret
 * ranges pulls in **414 new packages, removes 122 and changes 193** (measured
 * 2026-08-13). A mass upgrade of a live site is not something that rides along
 * with a scrolling fix.
 *
 * The other reason is that a windowing LIBRARY wants to own the list: fixed or
 * measured row heights, its own scroll container, its own ordering. This feed
 * is not a plain list — it interleaves friend suggestions after post 10, an ad
 * at slots computed by `slotForPostIndex`, and an infinite-scroll sentinel, all
 * inside an `AnimatePresence`. Handing that to a virtualiser is a rewrite of
 * the feed. This is occlusion culling instead: the list structure is untouched
 * and each card independently decides whether its contents need to exist.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW IT WORKS, AND THE THREE THINGS THAT MAKE IT SAFE
 *
 * 1. THE WRAPPER NEVER UNMOUNTS. Only its children do. The observed element is
 *    always in the DOM, so the observer keeps firing and can bring the card
 *    back. Observing something you also unmount is the classic way to build a
 *    window that gets stuck empty.
 *
 * 2. THE HEIGHT IS MEASURED BEFORE THE CHILDREN GO, and the placeholder takes
 *    that exact height. Collapse a 600px card to zero and everything below it
 *    jumps up under the member's thumb — a scroll jump is a far worse bug than
 *    the memory it saves. If the height cannot be measured (0, or not yet laid
 *    out) the card is LEFT MOUNTED. Never guess a height.
 *
 * 3. IT FAILS OPEN. No IntersectionObserver — jsdom, an old WebView, anything
 *    unexpected — and every card simply stays mounted, which is exactly the
 *    behaviour before this file existed. A windowing bug must degrade to "uses
 *    more memory", never to "the feed is blank".
 *
 * ⚠ MEASURED HEIGHTS ARE ONLY STABLE BECAUSE `PostMedia` SETS `aspectRatio` ON
 * ITS FRAME. The card's height therefore does not depend on whether its photo
 * has finished loading. If that ever changes, this measurement becomes a race
 * and the placeholder will be wrong.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * KNOWN, ACCEPTED TRADE-OFF
 *
 * A card that scrolls far enough away loses transient UI state — an open
 * comment box, an expanded caption, a half-typed reply. `WINDOW_MARGIN` is set
 * deliberately wide so this takes a real scroll, not a nudge, and it is the
 * same behaviour every native feed has. Widen the margin before reaching for a
 * state-preservation scheme; it is cheaper and it is what an app does.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * How far outside the viewport a card stays mounted.
 *
 * ~1600px is roughly two phone screens in each direction, so a card is
 * re-mounted well before it can be seen — the member never catches a
 * placeholder. Lower this and cards visibly pop in; raise it and the memory
 * saving shrinks. It is the only number in this file worth tuning, and it
 * should be tuned on a real device, not by reasoning.
 */
const WINDOW_MARGIN = "1600px 0px";

/**
 * How many cards at the top of the feed are never windowed.
 *
 * The first screenful is what a member sees on arrival and what they return to
 * when they scroll back up. Culling those buys almost no memory — they are the
 * cards most likely to be on screen — and risks churn exactly where it would be
 * most visible.
 */
export const EAGER_CARDS = 3;

interface FeedCardWindowProps {
  children: ReactNode;
  /** Never window this card. Used for the first EAGER_CARDS. */
  eager?: boolean;
}

export default function FeedCardWindow({ children, eager = false }: FeedCardWindowProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Starts mounted, always. A card must render at least once before anything
  // can know how tall it is.
  const [mounted, setMounted] = useState(true);
  const [placeholderHeight, setPlaceholderHeight] = useState<number | null>(null);

  useEffect(() => {
    if (eager) return;
    const el = ref.current;
    if (!el) return;
    // Fail open — see point 3 in the header.
    if (typeof IntersectionObserver === "undefined") return;

    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;

        if (entry.isIntersecting) {
          setMounted(true);
          return;
        }

        // Leaving the window. Measure FIRST, and only then drop the children —
        // once they are gone the height is unknowable.
        const h = el.getBoundingClientRect().height;
        if (h > 0) {
          setPlaceholderHeight(h);
          setMounted(false);
        }
        // h === 0 means "not laid out yet". Stay mounted rather than collapse
        // the card to nothing and yank the scroll position.
      },
      { rootMargin: WINDOW_MARGIN },
    );

    io.observe(el);
    return () => io.disconnect();
  }, [eager]);

  return (
    <div ref={ref} style={mounted ? undefined : { height: placeholderHeight ?? undefined }}>
      {mounted ? children : null}
    </div>
  );
}
