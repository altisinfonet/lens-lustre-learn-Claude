import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactElement } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Heart } from "lucide-react";

/**
 * THE ONE FEED-PHOTO GESTURE LAYER — Owner order, 4 Nov 2026: "exactly like
 * Instagram", web and app (the Capacitor WebView runs this same code).
 *
 *  · TAP / CLICK opens nothing. There is no feed viewer any more. A single tap
 *    is handed to `onSingleTap` (PostCard uses it to reveal the reach figures
 *    on a touch screen) and does nothing else.
 *  · DOUBLE-TAP / DOUBLE-CLICK calls `onDoubleTap` once and bursts a heart in
 *    the middle of the photograph. Whether that likes is the caller's choice —
 *    PostCard passes its ONE like action (`onReact(post.id, "like")`, the same
 *    prop the like button calls) and skips it when the post is already liked,
 *    so a double-tap never un-likes, exactly as Instagram.
 *  · TWO-FINGER PINCH lifts the photograph IN PLACE over the feed: a copy of
 *    the frame is laid over it at the same spot (the card clips — PostCard's
 *    root is overflow-hidden — so the live frame cannot grow out of it), the
 *    copy follows the fingers (scale + pan from the pinch midpoint), the feed
 *    dims behind it, and on release it springs back and is removed.
 *  · ONE FINGER IS NEVER TOUCHED. Scrolling the feed and swiping an album are
 *    the browser's and framer's, as before. The listeners are non-passive only
 *    so a two-finger gesture can stop the page scrolling under the pinch;
 *    the default is only ever prevented with two fingers down / a pinch on.
 *
 * Desktop has no pinch; that is fine (Owner).
 *
 * WHY NATIVE LISTENERS: React attaches touchstart/touchmove as PASSIVE, so a
 * React onTouchMove cannot stop the page from scrolling during a pinch.
 *
 * WHY THE TRANSFORM IS WRITTEN STRAIGHT TO THE LAYER'S STYLE: touchmove fires
 * at screen rate; a React state update per move would re-render the card 60–
 * 120 times a second during a pinch.
 *
 * A gesture failure must never kill scrolling (see ZoomableImage's note): every
 * handler is wrapped, the first throw tears the layer down and turns pinch off
 * for this mount. Tap and double-tap keep working.
 */

/** Two taps closer together than this are a double-tap (unchanged from the old feed hook). */
export const FEED_DOUBLE_TAP_MS = 300;
/** How far a pinch may enlarge the photograph. Instagram stops around 3–4×. */
export const FEED_PINCH_MAX_SCALE = 4;
/** The spring back to the card on release. */
export const FEED_PINCH_RELEASE_MS = 280;
/** A click that arrives this soon after a pinch is the pinch's, not a tap. */
const AFTER_PINCH_QUIET_MS = 400;
/** How long the heart stays on the photograph. */
const HEART_MS = 900;

type TouchPoint = { clientX: number; clientY: number };

interface Pinch {
  frame: HTMLElement;
  root: HTMLDivElement;
  layer: HTMLDivElement;
  backdrop: HTMLDivElement;
  d0: number;
  mx: number;
  my: number;
}

const distance = (a: TouchPoint, b: TouchPoint) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
const transformFor = (tx: number, ty: number, s: number) => `translate3d(${tx}px, ${ty}px, 0) scale(${s})`;

/** Controls and overlays that belong to the card, not to the photograph — never lifted with it. */
const NOT_THE_PHOTO = "button, [data-slider-dots], [data-feed-heart], [data-pinch-hide]";

function liftFrame(frame: HTMLElement, a: TouchPoint, b: TouchPoint): Pinch {
  const rect = frame.getBoundingClientRect();
  const mx = (a.clientX + b.clientX) / 2;
  const my = (a.clientY + b.clientY) / 2;

  const root = document.createElement("div");
  root.setAttribute("data-feed-pinch", "");
  root.setAttribute("aria-hidden", "true");
  root.style.cssText = "position:fixed;inset:0;z-index:200;pointer-events:none;";

  const backdrop = document.createElement("div");
  backdrop.style.cssText = `position:absolute;inset:0;background:#000;opacity:0;transition:opacity ${FEED_PINCH_RELEASE_MS}ms ease-out;`;

  const layer = document.createElement("div");
  layer.setAttribute("data-feed-pinch-layer", "");
  layer.style.cssText = `position:absolute;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;will-change:transform;`;
  layer.style.transformOrigin = `${mx - rect.left}px ${my - rect.top}px`;
  layer.style.transform = transformFor(0, 0, 1);

  // A copy of what is on screen right now — same images, same attributes, so
  // the same pixels (and no second network request: they are already decoded).
  const copy = frame.cloneNode(true) as HTMLElement;
  copy.querySelectorAll(NOT_THE_PHOTO).forEach((n) => n.remove());
  copy.removeAttribute("data-feed-photo");
  copy.style.width = "100%";
  copy.style.height = "100%";
  copy.style.visibility = "visible";
  layer.appendChild(copy);

  root.appendChild(backdrop);
  root.appendChild(layer);
  document.body.appendChild(root);
  // The live frame keeps its place in the layout (nothing reflows) but is not
  // painted, so the photograph is in exactly one place.
  frame.style.visibility = "hidden";

  return { frame, root, layer, backdrop, d0: distance(a, b), mx, my };
}

function dropLayer(p: Pinch) {
  p.root.remove();
  p.frame.style.visibility = "";
}

export interface FeedPhotoGestures {
  /** Put on the photograph's frame element. */
  frameRef: (el: HTMLElement | null) => void;
  /** Put on the same element as `onClick`. */
  onClick: (e: ReactMouseEvent<HTMLElement>) => void;
  /** The heart burst; render it inside the frame. */
  heart: ReactElement;
  /** True while a pinch is on, and just after it — an album must not page on a pinch's drag. */
  pinchActive: () => boolean;
}

export function useFeedPhotoGestures({ onDoubleTap, onSingleTap }: { onDoubleTap?: () => void; onSingleTap?: () => void }): FeedPhotoGestures {
  const [frame, setFrame] = useState<HTMLElement | null>(null);
  const [heartId, setHeartId] = useState<number | null>(null);
  const pinchRef = useRef<Pinch | null>(null);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const releasing = useRef<Pinch | null>(null);
  const pinchEndedAt = useRef(0);
  const broken = useRef(false);
  const lastTap = useRef(0);
  const singleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const singleRef = useRef(onSingleTap);
  singleRef.current = onSingleTap;

  const finishRelease = useCallback(() => {
    if (releaseTimer.current) { clearTimeout(releaseTimer.current); releaseTimer.current = null; }
    if (releasing.current) { dropLayer(releasing.current); releasing.current = null; }
  }, []);

  // Pinch: native, non-passive touch listeners on the frame.
  useEffect(() => {
    if (!frame) return;

    const fail = () => {
      broken.current = true;
      const p = pinchRef.current;
      pinchRef.current = null;
      try { finishRelease(); if (p) dropLayer(p); } catch { /* nothing left to save */ }
    };

    const release = () => {
      const p = pinchRef.current;
      if (!p) return;
      pinchRef.current = null;
      pinchEndedAt.current = Date.now();
      const ease = `${FEED_PINCH_RELEASE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;
      p.layer.style.transition = `transform ${ease}`;
      p.layer.style.transform = transformFor(0, 0, 1);
      p.backdrop.style.opacity = "0";
      releasing.current = p;
      releaseTimer.current = setTimeout(finishRelease, FEED_PINCH_RELEASE_MS + 20);
    };

    const onStart = (e: TouchEvent) => {
      if (broken.current) return;
      try {
        if (e.touches.length >= 2 && !pinchRef.current) {
          finishRelease();
          if (e.cancelable) e.preventDefault();
          pinchRef.current = liftFrame(frame, e.touches[0], e.touches[1]);
        }
      } catch { fail(); }
    };

    const onMove = (e: TouchEvent) => {
      const p = pinchRef.current;
      if (!p || broken.current) return;
      try {
        if (e.touches.length >= 2) {
          if (e.cancelable) e.preventDefault();
          const a = e.touches[0];
          const b = e.touches[1];
          const s = Math.min(FEED_PINCH_MAX_SCALE, Math.max(1, distance(a, b) / p.d0));
          const tx = (a.clientX + b.clientX) / 2 - p.mx;
          const ty = (a.clientY + b.clientY) / 2 - p.my;
          p.layer.style.transform = transformFor(tx, ty, s);
          p.backdrop.style.opacity = String(Math.min(0.85, (s - 1) * 1.2));
        }
      } catch { fail(); }
    };

    const onEnd = (e: TouchEvent) => {
      if (!pinchRef.current) return;
      try {
        // Instagram: the photo goes back the moment the pinch is let go.
        if (e.touches.length < 2) release();
      } catch { fail(); }
    };

    const active = { passive: false } as const;
    frame.addEventListener("touchstart", onStart, active);
    frame.addEventListener("touchmove", onMove, active);
    frame.addEventListener("touchend", onEnd);
    frame.addEventListener("touchcancel", onEnd);
    return () => {
      frame.removeEventListener("touchstart", onStart);
      frame.removeEventListener("touchmove", onMove);
      frame.removeEventListener("touchend", onEnd);
      frame.removeEventListener("touchcancel", onEnd);
      const p = pinchRef.current;
      pinchRef.current = null;
      finishRelease();
      if (p) dropLayer(p);
    };
  }, [frame, finishRelease]);

  // A post scrolled away mid-window must not act later.
  useEffect(() => () => {
    if (singleTimer.current) clearTimeout(singleTimer.current);
    if (heartTimer.current) clearTimeout(heartTimer.current);
  }, []);

  const pinchActive = useCallback(() => !!pinchRef.current || Date.now() - pinchEndedAt.current < AFTER_PINCH_QUIET_MS, []);

  const onClick = useCallback(() => {
    if (pinchActive()) { lastTap.current = 0; return; }
    const now = Date.now();
    if (now - lastTap.current < FEED_DOUBLE_TAP_MS) {
      lastTap.current = 0;
      if (singleTimer.current) { clearTimeout(singleTimer.current); singleTimer.current = null; }
      if (!onDoubleTap) return;
      setHeartId(now);
      if (heartTimer.current) clearTimeout(heartTimer.current);
      heartTimer.current = setTimeout(() => setHeartId(null), HEART_MS);
      onDoubleTap();
      return;
    }
    lastTap.current = now;
    // The single tap waits out the double-tap window, so the first half of a
    // like never also counts as a tap.
    if (singleTimer.current) clearTimeout(singleTimer.current);
    singleTimer.current = setTimeout(() => { singleTimer.current = null; singleRef.current?.(); }, FEED_DOUBLE_TAP_MS);
  }, [onDoubleTap, pinchActive]);

  const heart = (
    <AnimatePresence>
      {heartId !== null && (
        <motion.div
          key={heartId}
          data-feed-heart=""
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
          initial={{ opacity: 0, scale: 0.3 }}
          animate={{ opacity: [0, 1, 1, 0], scale: [0.3, 1.15, 1, 1] }}
          exit={{ opacity: 0 }}
          transition={{ duration: HEART_MS / 1000, times: [0, 0.25, 0.7, 1], ease: "easeOut" }}
        >
          <Heart className="h-24 w-24 text-white fill-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.45)]" />
        </motion.div>
      )}
    </AnimatePresence>
  );

  return { frameRef: setFrame, onClick, heart, pinchActive };
}
