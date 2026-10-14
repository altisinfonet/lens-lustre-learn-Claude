/**
 * L1 · THE SCROLL POSITION OF A PAGE, RESTORED EXACTLY WHEN THE MEMBER RETURNS.
 * REV4 plan §6 Stage L1: "Feed scroll position restored exactly when returning."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE BROWSER ALONE IS NOT ENOUGH
 *
 * `history.scrollRestoration` is "auto" and stays "auto": on Back the browser
 * puts the old position back itself. Whether that lands depends on WHEN the
 * engine does it relative to React redrawing the page being returned to. If
 * the document on screen at that instant is still the short page being left
 * (a post, one screen tall), "1300 px down the feed" is clamped to whatever
 * that page can hold, and the feed is then drawn under the wrong position.
 *
 * Measured on the code before this file existed (13 Oct 2026,
 * tools/uishot/nav-harness.mjs, "feed → a post → Back", readings in
 * docs/evidence/d2/L1-navigation/):
 *   · Chromium 151, Chrome 155, Edge 155, Firefox 153 — restored exactly, by
 *     the browser itself. Nothing was broken there; this hook then finds the
 *     page already where it should be and moves nothing.
 *   · WebKit 26.5 (Safari's engine, and the iOS app's WebView) — NOT restored:
 *     left at 1313 px, came back at 1085 px (390 px wide viewport).
 * So the requirement held by an engine's timing, not by anything this app did.
 * This file makes it the app's own behaviour, the same in every engine.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW
 *
 *   SAVE     while this page is on screen, each scroll is remembered under the
 *            router entry it happened on (`location.key`).
 *   RESTORE  when the router arrives on an entry by a real traversal (POP —
 *            Back or Forward) and a position is remembered for it, scroll
 *            there. The page may still be growing (cards mounting), so the
 *            position is re-applied each time the document changes height,
 *            until it has held or the deadline passes.
 *
 * A PUSH never restores: a fresh visit to the feed starts where a fresh visit
 * starts. Nothing here polls — it reacts to scroll and to a ResizeObserver, and
 * its only timer is the one-shot deadline that ends a restore.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THREE THINGS THAT MAKE IT SAFE
 *
 * 1. THE MEMBER ALWAYS WINS. The first wheel, touch, key or pointer press ends
 *    the restore on the spot. A restore that fights a thumb is a worse bug than
 *    a lost position.
 * 2. A LATE SCROLL CANNOT POISON THE MEMORY. Leaving the page shortens the
 *    document, the browser clamps the scroll, and a scroll event for that
 *    clamp can arrive while this hook is still mounted. It is ignored unless
 *    the browser is still ON the entry being saved (`history.state.key`).
 * 3. IT FAILS OPEN. No ResizeObserver (jsdom, an old WebView) → one attempt,
 *    exactly what a browser without this file would have done at best.
 *
 * The memory is a bounded map, per document: a reload starts clean, which is
 * also when the browser's own restoration is at its most reliable.
 */
import { useEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

/** Entries remembered at most. Oldest goes first — never a leak. */
export const MAX_REMEMBERED_ENTRIES = 50;
/** A restore stops trying after this long, whatever the page is still doing. */
export const RESTORE_DEADLINE_MS = 3000;
/** Within this many px the position counts as restored (sub-pixel layouts round). */
const TOLERANCE_PX = 1;

const positions = new Map<string, number>();

function remember(key: string, y: number): void {
  positions.delete(key); // re-insert, so the map's order is "least recently scrolled first"
  positions.set(key, y);
  if (positions.size > MAX_REMEMBERED_ENTRIES) {
    const oldest = positions.keys().next();
    if (!oldest.done) positions.delete(oldest.value);
  }
}

/**
 * The router entry the BROWSER is on right now. React Router writes `key` into
 * `history.state`; the first entry of a document has none and is "default" —
 * the same rule the router itself applies.
 */
function browserEntryKey(): string {
  try {
    const s = window.history.state as { key?: unknown } | null;
    return typeof s?.key === "string" ? s.key : "default";
  } catch {
    return "default";
  }
}

/** For tests: what is remembered for an entry, and a clean slate. */
export const rememberedScroll = (key: string): number | undefined => positions.get(key);
export const forgetAllScroll = (): void => positions.clear();

const USER_INPUT = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

/**
 * Call once in a page whose scroll position should survive a round trip
 * (Feed.tsx). The page scrolls the WINDOW — which is what the feed does.
 */
export function useScrollRestoreOnReturn(): void {
  const location = useLocation();
  const navigationType = useNavigationType();
  const key = location.key;

  // SAVE
  useEffect(() => {
    const save = () => {
      if (browserEntryKey() !== key) return; // rule 2
      remember(key, window.scrollY);
    };
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
  }, [key]);

  // RESTORE
  useEffect(() => {
    if (navigationType !== "POP") return;
    const target = positions.get(key);
    if (target === undefined) return;

    let done = false;
    let observer: ResizeObserver | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;

    const finish = () => {
      if (done) return;
      done = true;
      observer?.disconnect();
      if (deadline !== undefined) clearTimeout(deadline);
      USER_INPUT.forEach((ev) => window.removeEventListener(ev, finish));
    };
    const apply = () => {
      if (done) return;
      if (Math.abs(window.scrollY - target) > TOLERANCE_PX) window.scrollTo(0, target);
    };

    USER_INPUT.forEach((ev) => window.addEventListener(ev, finish, { passive: true })); // rule 1
    apply();
    if (typeof ResizeObserver === "function") {
      // The document grows as the cards mount; each growth is a new chance to
      // reach a position the shorter page could not hold.
      observer = new ResizeObserver(apply);
      observer.observe(document.documentElement);
      if (document.body) observer.observe(document.body);
      deadline = setTimeout(finish, RESTORE_DEADLINE_MS);
    } else {
      finish(); // rule 3
    }
    return finish;
    // One run per history entry — `navigationType` is read as it was on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
