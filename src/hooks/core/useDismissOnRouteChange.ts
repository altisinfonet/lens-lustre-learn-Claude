/**
 * Close this overlay whenever the route changes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * An overlay that closes itself in its own click handler is one delivery
 * failure away from being stuck on screen. Two have now happened for real:
 *
 *   • GlobalSearch, earlier: "tapping a result navigated but the row's click
 *     handler was not delivered, so the panel survived navigation" (Android
 *     webview). Fixed there with a local effect.
 *   • NotificationBell, 2026-08-01: the owner tapped "See All", the page
 *     changed, and the panel stayed. Measured on production, the node was
 *     still in the DOM at `opacity: 0` with the closing transform applied —
 *     the handler HAD run, and the element was still never removed. It left a
 *     304x456 invisible rectangle over every page that swallowed clicks until
 *     a full reload.
 *
 * The common lesson: closing must not depend on any single mechanism. This
 * hook is the layer that holds when the click is lost, when an animation never
 * finishes, and when the navigation came from somewhere else entirely — a
 * push-notification deep link, the browser back button, a redirect.
 *
 * TWO DELIBERATE CHOICES
 *
 * 1. Keyed on `location.key`, not `location.pathname`.
 *    `key` is a fresh value for EVERY navigation, so this also fires on
 *    `replace`, on back/forward between identical paths, and on navigating to
 *    the URL you are already on. A pathname-keyed effect silently misses all
 *    three — and "already on /notifications, tap See All again" is a real user
 *    action.
 *
 * 2. `useLayoutEffect`, not `useEffect`.
 *    It runs before the browser paints, so the overlay cannot be visible for
 *    even one frame on the destination route.
 *
 * The first run is skipped: mounting is not a navigation, and firing `close`
 * during mount would fight any overlay that legitimately opens on load.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useLayoutEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

/**
 * @param close   Called on every navigation after the first render. Safe to
 *                pass an inline arrow — the effect depends on `location.key`,
 *                not on the identity of this function, so a new closure on each
 *                render does not retrigger it.
 * @param enabled Pass `false` to skip entirely (e.g. while the overlay is
 *                already closed). Optional; defaults to always on, because
 *                calling a close function that is already a no-op costs nothing
 *                and one fewer condition is one fewer way to be wrong.
 */
export function useDismissOnRouteChange(close: () => void, enabled = true): void {
  const location = useLocation();
  const closeRef = useRef(close);
  closeRef.current = close;

  const lastKeyRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    // First render establishes the baseline; it is not a navigation.
    if (lastKeyRef.current === null) {
      lastKeyRef.current = location.key;
      return;
    }
    if (lastKeyRef.current === location.key) return;
    lastKeyRef.current = location.key;
    if (enabled) closeRef.current();
  }, [location.key, enabled]);
}

export default useDismissOnRouteChange;
