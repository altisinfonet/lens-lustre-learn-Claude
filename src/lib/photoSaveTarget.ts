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
 * A FEED photo is layered only at a sign of intent — a mouse resting on it for
 * HOVER_ARM_MS (Firefox needs the credited copy LOADED before the menu opens),
 * a right-button press, or a touch held still for LONG_PRESS_MS (the long-press
 * menu opens later) — so a feed scrolled past never downloads a credited file.
 * The clean picture already on screen (`currentSrc`) becomes the background:
 * it is in the cache, nothing flickers, layout is untouched (the feed <img> is
 * sized by its box, not by its file).
 *
 * In the installed app long-press save is off (AppPhotoSaveGuard: the class on
 * <html>), so nothing is armed there.
 */
import { PHOTO_SAVE_GUARD_CLASS } from "@/lib/native/photoSaveGuard";

/** Moves the <img>'s own picture (the credited file) completely outside its box. */
export const CREDIT_HIDDEN_POSITION = "-100000px -100000px";
/** A touch held this long without moving is a long-press (the browser menu opens at ~500 ms). */
export const LONG_PRESS_MS = 350;
/**
 * A mouse resting this long on a photo arms it too. MEASURED (3 engines):
 * Chromium and WebKit act on the new source at once when it is set at the
 * right-button press; Firefox's menu acts on the image that has already
 * LOADED — so on a desktop the credited copy must be loaded before the click.
 * Only a photo the pointer rests on fetches it; a feed scrolled past never does.
 */
export const HOVER_ARM_MS = 300;

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
 * Make `img` hand the browser `credited` as its file while still PAINTING the
 * clean picture it shows now. Idempotent; a no-op in the app, without a
 * credited copy, or before the clean picture is on screen.
 */
export function armCreditedSave(img: HTMLImageElement | null, credited: string | null | undefined): void {
  if (!img || !credited || saveGuardOn()) return;
  if (img.dataset.saveAs === credited) return;
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
  img.dataset.photoShown = shown;
  img.dataset.saveAs = credited;
  img.removeAttribute("srcset");
  img.removeAttribute("sizes");
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
  onPointerEnter?: (e: React.PointerEvent<HTMLImageElement>) => void;
  onPointerLeave?: () => void;
  onContextMenu?: (e: React.MouseEvent<HTMLImageElement>) => void;
} {
  if (!credited) return {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  let start: { x: number; y: number } | null = null;
  let hover: ReturnType<typeof setTimeout> | null = null;
  const clear = () => { if (timer) clearTimeout(timer); timer = null; start = null; };
  return {
    onPointerEnter: (e) => {
      if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
      const img = e.currentTarget;
      if (hover) clearTimeout(hover);
      hover = setTimeout(() => { hover = null; armCreditedSave(img, credited); }, HOVER_ARM_MS);
    },
    onPointerLeave: () => { if (hover) clearTimeout(hover); hover = null; clear(); },
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
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    // Keyboard menu key / Shift+F10, or a browser without pointer events: arm now
    // (the menu is already opening; the next one gets the credited file).
    onContextMenu: (e) => armCreditedSave(e.currentTarget, credited),
  };
}
