/**
 * THE WEB "SAVE IMAGE" FILE IS ALWAYS THE CREDITED COPY — AND THE SCREEN NEVER
 * SHOWS IT (Owner, 3 Nov 2026: requirement 3 + fault 2 of his web check).
 *
 * One mechanism for every photo surface (ZoomableImage for full screen, the
 * feed photo, the post-page grid):
 *   · the PIXELS are the clean copy, painted as the element's CSS background
 *     (contain + centre = exactly what `object-contain` paints);
 *   · the <img>'s own SOURCE is the credited copy, its picture moved outside
 *     its box (replaced content is clipped to the box in every engine) — so the
 *     browser's context menu ("save image as", "copy image address", a phone
 *     browser's long-press "download image") acts on the credited file.
 *
 * Full screen is layered from the start (it is one photo, opened on purpose).
 * A FEED photo is layered only at a sign of intent — a right-button press, a
 * touch held still for LONG_PRESS_MS (the long-press menu opens later), and in
 * Firefox only (its menu needs the credited copy LOADED) a mouse that really
 * moves on the photo and rests HOVER_ARM_MS — so a feed scrolled past, even
 * under a parked cursor, never downloads a credited file.
 * The clean picture already on screen (`currentSrc`) becomes the background:
 * it is in the cache, nothing flickers, layout is untouched (the feed <img> is
 * sized by its box, not by its file).
 *
 * In the installed app long-press save is off (AppPhotoSaveGuard: the class on
 * <html>), so nothing is armed there.
 */
import { PHOTO_SAVE_GUARD_CLASS } from "@/lib/native/photoSaveGuard";
import { drawsCreditOnSave } from "@/lib/photoCreditSave";

/** Moves the <img>'s own picture (the credited file) completely outside its box. */
export const CREDIT_HIDDEN_POSITION = "-100000px -100000px";
/** A touch held this long without moving is a long-press (the browser menu opens at ~500 ms). */
export const LONG_PRESS_MS = 350;
/**
 * MEASURED (3 engines, 3 Nov): Chromium and WebKit act on the new source at
 * once when it is set at the right-button press. Firefox's menu acts on the
 * image that has already LOADED, so in Firefox only, a mouse that really
 * MOVES on a photo and then rests this long arms it in advance. Synthetic
 * boundary events after a scroll carry no movement and never arm (review of
 * #854: a cursor parked over a scrolling feed must not download credited files).
 */
export const HOVER_ARM_MS = 300;

/** Firefox (Gecko) — the one engine whose menu needs the credited copy LOADED first. Read at event time. */
export function menuNeedsLoadedImage(): boolean {
  try { return /\bFirefox\//.test(navigator.userAgent); } catch { return false; }
}

/** A URL as a CSS `url("…")` value (quotes, backslashes and newlines escaped). */
export function cssUrl(u: string): string {
  return `url("${u.replace(/["\\\n\r]/g, (c) => `\\${c === "\n" ? "a " : c === "\r" ? "d " : c}`)}")`;
}

/**
 * The style that paints `shown` exactly as the element's `object-fit` would
 * (contain / cover / fill; centred like the default object-position) and hides
 * the element's own (credited) picture.
 */
export function layeredStyle(shown: string, fit: string = "contain"): { backgroundImage: string; backgroundSize: string; backgroundPosition: string; backgroundRepeat: string; objectPosition: string } {
  const size = fit === "cover" ? "cover" : fit === "fill" ? "100% 100%" : "contain";
  return { backgroundImage: cssUrl(shown), backgroundSize: size, backgroundPosition: "center", backgroundRepeat: "no-repeat", objectPosition: CREDIT_HIDDEN_POSITION };
}

function saveGuardOn(): boolean {
  try { return document.documentElement.classList.contains(PHOTO_SAVE_GUARD_CLASS); } catch { return false; }
}

/**
 * Credit U3: the server draws a new photo's credited copy after the post exists,
 * so for some minutes it is not there. A file that just failed is not asked for
 * again until this much later (the sweep may have run by then).
 */
export const CREDITED_RETRY_MS = 60_000;
const missingCredited = new Map<string, number>();

/**
 * Make `img` hand the browser `credited` as its file while still PAINTING the
 * clean picture it shows now. Idempotent; a no-op in the app, without a
 * credited copy, or before the clean picture is on screen. If the credited
 * file fails to load, the clean picture goes back as a plain image, exactly as
 * it was (the same fallback as ZoomableImage): "save image" then gets the clean
 * copy on screen rather than a broken file.
 */
export function armCreditedSave(img: HTMLImageElement | null, credited: string | null | undefined): void {
  if (!img || !credited || saveGuardOn() || !img.isConnected) return;
  // Already armed — unless React has since written the clean source back (a
  // rung / data-saver change): then arm again.
  if (img.dataset.saveAs === credited && img.getAttribute("src") === credited && !img.hasAttribute("srcset")) return;
  const failedAt = missingCredited.get(credited);
  if (failedAt !== undefined && Date.now() - failedAt < CREDITED_RETRY_MS) return;
  const shown = img.currentSrc || img.getAttribute("src") || "";
  if (!shown || !(img.complete && img.naturalWidth > 0)) return;
  let fit = "contain";
  try { fit = getComputedStyle(img).objectFit || "contain"; } catch { /* keep contain */ }
  const st = layeredStyle(shown, fit);
  img.style.backgroundImage = st.backgroundImage;
  img.style.backgroundSize = st.backgroundSize;
  img.style.backgroundPosition = st.backgroundPosition;
  img.style.backgroundRepeat = st.backgroundRepeat;
  img.style.objectPosition = st.objectPosition;
  const was = { src: img.getAttribute("src"), srcset: img.getAttribute("srcset"), sizes: img.getAttribute("sizes") };
  img.dataset.photoShown = shown;
  img.dataset.saveAs = credited;
  img.removeAttribute("srcset");
  img.removeAttribute("sizes");
  const loaded = () => img.removeEventListener("error", failed);
  const failed = () => {
    img.removeEventListener("load", loaded);
    if (img.getAttribute("src") !== credited) return; // React has moved on: not this file's error
    missingCredited.set(credited, Date.now());
    img.style.backgroundImage = "";
    img.style.backgroundSize = "";
    img.style.backgroundPosition = "";
    img.style.backgroundRepeat = "";
    img.style.objectPosition = "";
    delete img.dataset.photoShown;
    delete img.dataset.saveAs;
    if (was.srcset !== null) img.setAttribute("srcset", was.srcset);
    if (was.sizes !== null) img.setAttribute("sizes", was.sizes);
    img.setAttribute("src", was.src ?? shown);
  };
  img.addEventListener("load", loaded, { once: true });
  img.addEventListener("error", failed, { once: true });
  img.setAttribute("src", credited);
}

/**
 * Event props for a feed / grid <img>: arm on a right-button press (it comes
 * before `contextmenu` in every engine) or a still touch of LONG_PRESS_MS.
 * `credited` null (an old photo, or no credited copy) → no props at all.
 */
export function creditedSaveProps(credited: string | null | undefined): {
  onPointerDown?: (e: React.PointerEvent<HTMLImageElement>) => void;
  onPointerUp?: () => void;
  onPointerCancel?: () => void;
  onPointerMove?: (e: React.PointerEvent<HTMLImageElement>) => void;
  onPointerLeave?: () => void;
  onContextMenu?: (e: React.MouseEvent<HTMLImageElement>) => void;
} {
  if (!credited) return {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  let start: { x: number; y: number } | null = null;
  let hover: ReturnType<typeof setTimeout> | null = null;
  const clear = () => { if (timer) clearTimeout(timer); timer = null; start = null; };
  const clearHover = () => { if (hover) clearTimeout(hover); hover = null; };
  return {
    onPointerLeave: () => { clearHover(); clear(); },
    onPointerDown: (e) => {
      const img = e.currentTarget;
      if (e.pointerType === "mouse" || e.pointerType === "pen") {
        if (e.button === 2) armCreditedSave(img, credited);
        return;
      }
      clear();
      start = { x: e.clientX, y: e.clientY };
      timer = setTimeout(() => { timer = null; armCreditedSave(img, credited); }, LONG_PRESS_MS);
    },
    onPointerMove: (e) => {
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) clear(); // a scroll, not a long-press
      // Firefox only: a REAL mouse movement on the photo, then a rest → load the
      // credited copy before a right-click (see HOVER_ARM_MS). No movement = a
      // synthetic event after a scroll → nothing.
      if ((e.pointerType === "mouse" || e.pointerType === "pen") && (e.movementX || e.movementY) && menuNeedsLoadedImage()) {
        const img = e.currentTarget;
        clearHover();
        hover = setTimeout(() => { hover = null; armCreditedSave(img, credited); }, HOVER_ARM_MS);
      }
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    // Keyboard menu key / Shift+F10, or a browser without pointer events: arm now
    // (the menu is already opening; the next one gets the credited file).
    onContextMenu: (e) => armCreditedSave(e.currentTarget, credited),
  };
}

/**
 * A touch held this long without moving saves a feed-set photo (the browsers'
 * own long-press menu opens at ≈ 500 ms; Android fires `contextmenu` first and
 * that one saves instead, so a long-press saves once).
 */
export const SAVE_LONG_PRESS_MS = 600;

/**
 * THE ONE CHOICE of save behaviour for a photo <img> (feed, post page grid):
 *   · a FEED SET photo (`-l6`) → the credit is DRAWN at save time
 *     (photoCreditSave.savePhotoWithCredit): right-click / the long-press menu
 *     is replaced by that download, so the browser never saves the clean file;
 *   · any other photo → creditedSaveProps(credited), exactly as before.
 * In the installed app (AppPhotoSaveGuard) nothing is armed and nothing saved:
 * "App: no download at all" (Owner decision 3) stands.
 */
export function photoSaveProps(src: string, credited: string | null | undefined): ReturnType<typeof creditedSaveProps> {
  return drawsCreditOnSave(src) ? drawnCreditSaveProps(src) : creditedSaveProps(credited);
}

/**
 * FULL SCREEN (ZoomableImage) of a feed set photo: the context-menu handler that
 * replaces the browser's menu (it would save the clean 2048) with the drawn-credit
 * save. Only the menu — full screen's pointer events belong to pinch / pan.
 * Null for every other photo (they keep their layered credited copy).
 */
export function feedSetSaveMenu(src: string): ((e: React.MouseEvent<HTMLImageElement>) => void) | null {
  return drawsCreditOnSave(src) ? (drawnCreditSaveProps(src).onContextMenu ?? null) : null;
}

function drawnCreditSaveProps(src: string): ReturnType<typeof creditedSaveProps> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let start: { x: number; y: number } | null = null;
  let savedAt = 0;
  const clear = () => { if (timer) clearTimeout(timer); timer = null; start = null; };
  const save = () => {
    clear();
    if (saveGuardOn() || Date.now() - savedAt < 1500) return; // one gesture, one file
    savedAt = Date.now();
    void import("@/lib/photoCreditSave").then((m) => m.savePhotoWithCredit(src));
  };
  return {
    onPointerDown: (e) => {
      if (e.pointerType === "mouse" || e.pointerType === "pen") return; // the right button opens `contextmenu`
      // iOS opens its own "Save to Photos" callout instead of `contextmenu`: switch it off for this photo.
      try { e.currentTarget.style.setProperty("-webkit-touch-callout", "none"); } catch { /* not WebKit */ }
      clear();
      start = { x: e.clientX, y: e.clientY };
      timer = setTimeout(save, SAVE_LONG_PRESS_MS);
    },
    onPointerMove: (e) => { if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) clear(); },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onContextMenu: (e) => {
      if (saveGuardOn()) return; // the app's guard owns this event
      e.preventDefault(); // the browser's menu would save the CLEAN file
      save();
    },
  };
}
