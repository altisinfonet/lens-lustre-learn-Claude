import { isNativeCapacitorApp } from "@/lib/native/authDeepLink";
import { logger } from "@/lib/logger";
import { deviceContext } from "@/lib/deviceContext";

/**
 * THE APP-ONLY PINCH-ZOOM LOCK. Build 1055.
 *
 * Owner instruction, 2026-08-06: *"no pinch zoom, no double-tap zoom, no
 * accidental zoom while scrolling"* inside the Android app — and **"do not
 * affect desktop, do not affect normal mobile web unless explicitly
 * configured."*
 *
 * ── WHY A CLASS AND NOT THE VIEWPORT TAG ──────────────────────────────────
 *
 * The obvious shortcut is `user-scalable=no, maximum-scale=1` in index.html.
 * SPEC §4 rules it out and it deserves saying why: modern Android WebView and
 * iOS Safari ignore it in many cases, so it is not even reliable — and it is a
 * genuine accessibility regression for anyone who needs to magnify text. It
 * also cannot be undone per-platform: index.html is one file serving the app,
 * desktop and mobile web alike, which would break the owner's second
 * requirement in the same stroke.
 *
 * `touch-action: pan-x pan-y` is the standards-based mechanism. It leaves
 * scrolling completely intact, removes pinch-zoom and double-tap-zoom, and —
 * because it is a class toggled at runtime — applies to the installed app and
 * to nothing else.
 *
 * ── WHY IT GOES ON <html> ─────────────────────────────────────────────────
 *
 * touch-action is not inherited; the browser intersects the values from the
 * touched element up to the root. Putting it on the document element is
 * therefore the only placement that covers every screen including portals —
 * and this app renders its viewers through createPortal into document.body,
 * outside the React root entirely. A class on #root would have missed every
 * one of them.
 *
 * The fullscreen photo viewer opts back in with `touch-action: none` on the
 * photograph itself (src/components/media/ZoomableImage.tsx). That is not
 * "re-enabling pinch" — an ancestor's restriction can never be widened by a
 * descendant. It hands the raw touches to JavaScript instead of the browser,
 * which is what lets the viewer scale the photograph and nothing else.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ────────────────────────────────────
 *
 * No `preventDefault` on touchmove, anywhere. The app has never had one (there
 * were zero before this build) and adding one would put this file on the touch
 * path of every scroll in the product to solve a problem CSS already solves.
 */

/** Defined in src/index.css. Kept as a constant so the test can assert both sides agree. */
export const ZOOM_LOCK_CLASS = "app-zoom-locked";

let applied = false;

/**
 * Apply the lock if — and only if — we are inside the installed app.
 *
 * Idempotent: a second call is a no-op, so a future call site cannot double-log
 * or fight the first one.
 */
export function installZoomPolicy(): void {
  try {
    if (applied) return;
    const native = isNativeCapacitorApp();
    if (native) {
      document.documentElement.classList.add(ZOOM_LOCK_CLASS);
      applied = true;
    }

    logger.debug({
      code: "UI-8009",
      event: "ZOOM_POLICY_EVALUATED",
      fn: "installZoomPolicy",
      file: "src/lib/native/zoomPolicy.ts",
      message: "Deciding whether to lock browser pinch-zoom for this runtime.",
      reason: native
        ? "Running inside the installed app, where the owner requires no page zoom at all."
        : "Running on the web, where zoom is the visitor's own accessibility control and must not be touched.",
      expected: "The lock is applied in the app and skipped everywhere else",
      actual: native ? `applied, class ${ZOOM_LOCK_CLASS} on <html>` : "skipped",
      detail: { applied: native, ...deviceContext() },
    });
  } catch (err) {
    // Rule 1: this runs during boot. A failure here must cost the member a
    // zoom setting, never the app.
    try {
      logger.debug({
        code: "UI-8009",
        event: "ZOOM_POLICY_EVALUATED",
        fn: "installZoomPolicy",
        file: "src/lib/native/zoomPolicy.ts",
        message: "Deciding whether to lock browser pinch-zoom for this runtime.",
        reason: err instanceof Error ? err.message : String(err),
        expected: "The lock is applied in the app and skipped everywhere else",
        actual: "threw before it could decide; the app keeps default browser zoom",
        detail: { applied: false },
      });
    } catch {
      /* rule 1 */
    }
  }
}

/** Test-only reset so the idempotence guard does not leak between cases. */
export function __resetZoomPolicyForTests(): void {
  applied = false;
  try {
    document.documentElement.classList.remove(ZOOM_LOCK_CLASS);
  } catch {
    /* jsdom teardown */
  }
}
