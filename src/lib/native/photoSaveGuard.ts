/**
 * PHOTO PLAN U3 · THE APP'S LONG-PRESS "SAVE IMAGE" IS OFF
 * (switch `photo_set_v2`; Owner decision 3: "App: no download at all, and
 * disable long-press 'save image' in the WebView").
 *
 * Done in WEB code so it ships with the web bundle — no native release:
 *   · a class on <html> (same placement and reasoning as zoomPolicy.ts: the
 *     viewers render through portals into document.body, so only the root
 *     covers every photo) whose CSS in src/index.css sets, on every <img>:
 *     `-webkit-touch-callout: none` (the long-press callout), `user-select:
 *     none` and `-webkit-user-drag: none`;
 *   · ONE capture-phase `contextmenu` listener that cancels the menu when the
 *     long-pressed element is a photo (an <img>) — that is the event the
 *     Android WebView / Chrome long-press menu ("Download image", "Open
 *     image") is built from; and `dragstart` on an <img> is cancelled too.
 *
 * ONLY images: long-press on text (selection, copy) and every other element
 * keeps its default. Installed only when the caller says so (app shell AND
 * switch on — src/components/AppPhotoSaveGuard.tsx); the web is untouched.
 */

/** Defined in src/index.css. Kept as a constant so the test can assert both sides agree. */
export const PHOTO_SAVE_GUARD_CLASS = "app-photo-save-off";

function onImage(e: Event): boolean {
  const t = e.target as { tagName?: unknown } | null;
  return !!t && typeof t.tagName === "string" && t.tagName.toUpperCase() === "IMG";
}

function block(e: Event): void {
  if (onImage(e)) e.preventDefault();
}

let installed = false;

/** Turn the guard on or off. Idempotent both ways; never throws. */
export function setPhotoSaveGuard(on: boolean): void {
  try {
    if (on === installed) return;
    const root = document.documentElement;
    if (on) {
      root.classList.add(PHOTO_SAVE_GUARD_CLASS);
      document.addEventListener("contextmenu", block, true);
      document.addEventListener("dragstart", block, true);
    } else {
      root.classList.remove(PHOTO_SAVE_GUARD_CLASS);
      document.removeEventListener("contextmenu", block, true);
      document.removeEventListener("dragstart", block, true);
    }
    installed = on;
  } catch {
    /* a guard failure costs a long-press setting, never the app */
  }
}

/** Test seam. */
export function __resetPhotoSaveGuardForTests(): void {
  setPhotoSaveGuard(false);
}
