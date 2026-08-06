import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useMotionValue, animate } from "framer-motion";
import { useGesture } from "@use-gesture/react";
import { logger } from "@/lib/logger";
import { deviceContext } from "@/lib/deviceContext";

/**
 * THE ONE ZOOMABLE PHOTOGRAPH. Build 1055.
 *
 * Owner instruction, 2026-08-06: *"the app itself must never pinch-zoom; a
 * photograph opened fullscreen must pinch-zoom, pan and double-tap-zoom like
 * Instagram."* He also chose the two things that shape this file: gesture
 * recognition comes from a dependency (@use-gesture/react) with the transform
 * kept here on framer-motion, and ONE component serves every member-facing
 * fullscreen viewer rather than each of the six growing its own copy.
 *
 * ── WHY THE TRANSFORM IS ON THE <img> AND NOWHERE ELSE ────────────────────
 *
 * SPEC §1: *"Only the image scales — the surrounding UI stays fixed."* The
 * close button, the counter, the arrows and the download control are siblings
 * of this component, never ancestors of the transformed node. Putting the
 * transform on a wrapper is the single easiest way to break that requirement,
 * and it is exactly what browser page zoom already does wrong today — the
 * whole document scales, the close button drifts, and the member cannot get
 * back out. Do not lift `style={{ scale, x, y }}` onto a parent.
 *
 * ── WHY touch-action: none HERE, SPECIFICALLY ─────────────────────────────
 *
 * The app root sets `touch-action: pan-x pan-y` (see src/index.css, applied
 * only inside the installed app). That kills pinch everywhere. This element
 * opts BACK IN with `touch-action: none`, which hands every touch to the
 * handlers below instead of to the browser. The opt-in is deliberately as
 * small as one photograph: it is the only place in the product where a member
 * is allowed to scale anything.
 *
 * ── WHY A GESTURE FAILURE DEGRADES INSTEAD OF THROWING ────────────────────
 *
 * These handlers sit on the touch path. An exception thrown from a pointer
 * handler is how scrolling dies for a member with no visible error at all —
 * the worst possible failure mode, because it looks like the app froze. Every
 * handler is wrapped; the first throw disables gestures for this mount, drops
 * back to a plain unzoomable photograph (which still WORKS — they can still
 * see the picture and close the viewer) and emits UI-8008 exactly once.
 *
 * ONCE is load-bearing. A pointer handler fires hundreds of times a second;
 * logging per-throw would push thousands of persisted rows off one broken
 * gesture, bury every real failure in the owner's Error Log and spend the
 * member's mobile data doing it. LOGGING_STANDARD.md: *"Ask what does this do
 * to the Error Log for every code you add."*
 */

/** Double-tap target. Instagram lands near 2.5–3×; 2.5 keeps a large photo readable without pixelating a small one. */
const DOUBLE_TAP_SCALE = 2.5;
/** Hard ceiling. Past ~4× a web-sized photograph is only showing its own compression. */
const MAX_SCALE = 4;
const MIN_SCALE = 1;
/** Two taps closer together than this are a double-tap. Matches the existing feed hook in PostMedia.tsx. */
const DOUBLE_TAP_MS = 300;
/** Below this we treat a pinch as "they meant to go back to fit" and snap cleanly to 1. */
const SNAP_BACK_BELOW = 1.05;

const SPRING = { type: "spring" as const, stiffness: 300, damping: 30, mass: 0.6 };

export interface ZoomableImageProps {
  src: string;
  alt?: string;
  /** Classes for the <img> itself — sizing stays with the caller, which owns the layout. */
  className?: string;
  /**
   * Classes for the box the photograph is panned INSIDE. Two shapes are in use
   * and the difference is deliberate:
   *
   *  · A fullscreen viewer passes nothing. The default fills its parent, so
   *    the photograph pans against the whole screen and its edge can be
   *    brought right to the edge of the display.
   *  · A viewer that sits in normal flow with a caption under it — MyPhotos,
   *    the competition viewers — passes classes that hug the photograph, so
   *    the zoom happens inside the frame the photograph already occupied and
   *    nothing below it moves. Overflow is clipped either way.
   */
  wrapperClassName?: string;
  /**
   * Fires on every transition between "fitted" and "zoomed".
   *
   * Surfaces with prev/next arrows use this to get them out of the way while a
   * photograph is magnified, the way Instagram does — an arrow floating over a
   * zoomed picture is both ugly and easy to hit by accident while panning.
   */
  onZoomChange?: (zoomed: boolean) => void;
  /**
   * Competition surfaces pass their anti-download guards through here
   * (onContextMenu, and the watermark layer's skip marker). They are the
   * caller's rules, not this component's, and this component must not quietly
   * drop them.
   *
   * DELIBERATELY NARROW, not ImgHTMLAttributes. The wide type collides with
   * framer-motion's own `onDrag` — motion re-declares it as a pan callback —
   * and the collision compiles to a runtime handler that would swallow the
   * pan. Listing what callers actually pass makes that impossible.
   */
  imgProps?: Pick<
    React.ImgHTMLAttributes<HTMLImageElement>,
    "onContextMenu" | "crossOrigin" | "decoding" | "loading" | "referrerPolicy"
  > & { "data-watermark"?: string };
}

const ZoomableImage = ({ src, alt = "", className, wrapperClassName = "w-full h-full", onZoomChange, imgProps }: ZoomableImageProps) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const scale = useMotionValue(1);
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  /** Set by the first gesture throw. Renders a plain photograph from then on. */
  const [gesturesFailed, setGesturesFailed] = useState(false);
  const loggedFailureRef = useRef(false);
  const lastTapRef = useRef(0);
  const zoomedRef = useRef(false);

  /**
   * Rule 1 of the logging standard, applied to gestures: the handler never
   * becomes the incident. One row per mount, then silence.
   */
  const reportGestureFailure = useCallback((err: unknown, phase: string) => {
    setGesturesFailed(true);
    if (loggedFailureRef.current) return;
    loggedFailureRef.current = true;
    try {
      logger.error({
        code: "UI-8008",
        event: "LIGHTBOX_GESTURE_THREW",
        fn: "ZoomableImage",
        file: "src/components/media/ZoomableImage.tsx",
        message: "Handling a pinch, pan or double-tap on a fullscreen photograph.",
        reason: err instanceof Error ? err.message : String(err),
        expected: "The gesture updates scale and offset and returns",
        actual: `threw during ${phase}; gestures disabled for this viewer, photograph still shown unzoomable`,
        nextStep:
          "Reproduce on the device model in the detail. Confirm scrolling elsewhere in the app is unaffected — this handler owning the touch path is the reason that is even a question.",
        detail: {
          phase,
          // The photograph's own URL is not logged: it identifies a member's
          // post. Its shape is enough to tell a storage URL from a data URL.
          srcKind: src.startsWith("data:") ? "data" : src.startsWith("blob:") ? "blob" : "remote",
          scaleAtFailure: Number(scale.get().toFixed(2)),
          ...deviceContext(),
        },
      });
    } catch {
      /* rule 1 — a logging failure cannot reach the member */
    }
  }, [scale, src]);

  const announceZoom = useCallback((next: boolean) => {
    if (zoomedRef.current === next) return;
    zoomedRef.current = next;
    onZoomChange?.(next);
  }, [onZoomChange]);

  /**
   * How far the photograph may travel before its own edge would come inside
   * the viewer. Measured from the laid-out size, so it is correct for a
   * portrait photo, a landscape photo and a rotated device without any of them
   * being special-cased.
   */
  const limits = useCallback((s: number) => {
    const img = imgRef.current;
    const wrap = wrapperRef.current;
    if (!img || !wrap) return { maxX: 0, maxY: 0 };
    return {
      maxX: Math.max(0, (img.offsetWidth * s - wrap.clientWidth) / 2),
      maxY: Math.max(0, (img.offsetHeight * s - wrap.clientHeight) / 2),
    };
  }, []);

  const clamp = useCallback((v: number, max: number) => Math.min(max, Math.max(-max, v)), []);

  const settle = useCallback((s: number) => {
    if (s <= SNAP_BACK_BELOW) {
      animate(scale, 1, SPRING);
      animate(x, 0, SPRING);
      animate(y, 0, SPRING);
      announceZoom(false);
      return;
    }
    const { maxX, maxY } = limits(s);
    animate(x, clamp(x.get(), maxX), SPRING);
    animate(y, clamp(y.get(), maxY), SPRING);
    announceZoom(true);
  }, [scale, x, y, limits, clamp, announceZoom]);

  /**
   * Zoom toward a point and keep that point under the finger — the difference
   * between "it zoomed" and "it zoomed where I was looking".
   *
   * A point at screen offset d from the viewer's centre sits at image-local
   * (d - t) / s. Holding it still across a scale change gives
   * t' = d - (d - t) · s'/s, which is all the maths this file needs.
   */
  const zoomAbout = useCallback((nextScale: number, dx: number, dy: number, from: { s: number; x: number; y: number }) => {
    const ratio = nextScale / from.s;
    const { maxX, maxY } = limits(nextScale);
    return {
      x: clamp(dx - (dx - from.x) * ratio, maxX),
      y: clamp(dy - (dy - from.y) * ratio, maxY),
    };
  }, [limits, clamp]);

  const offsetFromCentre = useCallback((px: number, py: number) => {
    const wrap = wrapperRef.current;
    if (!wrap) return { dx: 0, dy: 0 };
    const r = wrap.getBoundingClientRect();
    return { dx: px - (r.left + r.width / 2), dy: py - (r.top + r.height / 2) };
  }, []);

  const handleDoubleTap = useCallback((px: number, py: number) => {
    const current = scale.get();
    if (current > SNAP_BACK_BELOW) {
      animate(scale, 1, SPRING);
      animate(x, 0, SPRING);
      animate(y, 0, SPRING);
      announceZoom(false);
      return;
    }
    const { dx, dy } = offsetFromCentre(px, py);
    const target = zoomAbout(DOUBLE_TAP_SCALE, dx, dy, { s: current, x: x.get(), y: y.get() });
    animate(scale, DOUBLE_TAP_SCALE, SPRING);
    animate(x, target.x, SPRING);
    animate(y, target.y, SPRING);
    announceZoom(true);
  }, [scale, x, y, offsetFromCentre, zoomAbout, announceZoom]);

  useGesture(
    {
      onPinch: (state) => {
        try {
          const { origin: [ox, oy], first, last, offset: [s], memo } = state;
          if (first) {
            const { dx, dy } = offsetFromCentre(ox, oy);
            return { dx, dy, s: scale.get(), x: x.get(), y: y.get() };
          }
          const from = memo as { dx: number; dy: number; s: number; x: number; y: number } | undefined;
          if (!from) return;
          const next = zoomAbout(s, from.dx, from.dy, from);
          scale.set(s);
          x.set(next.x);
          y.set(next.y);
          announceZoom(s > SNAP_BACK_BELOW);
          if (last) settle(s);
          return from;
        } catch (err) {
          reportGestureFailure(err, "pinch");
        }
      },
      onDrag: (state) => {
        try {
          const { offset: [ox, oy], pinching, cancel, last, tap } = state;
          // A tap is not a pan. filterTaps keeps them apart, but a two-finger
          // gesture that starts as a drag must yield to the pinch or the
          // photograph fights itself.
          if (pinching) return cancel();
          if (tap) return;
          const s = scale.get();
          // Fitted photograph: nothing to pan. Returning here also leaves the
          // caller's own tap-to-close behaviour intact.
          if (s <= MIN_SCALE) return;
          const { maxX, maxY } = limits(s);
          x.set(clamp(ox, maxX));
          y.set(clamp(oy, maxY));
          if (last) settle(s);
        } catch (err) {
          reportGestureFailure(err, "drag");
        }
      },
    },
    {
      target: wrapperRef,
      eventOptions: { passive: false },
      enabled: !gesturesFailed,
      pinch: { scaleBounds: { min: MIN_SCALE, max: MAX_SCALE }, rubberband: true, from: () => [scale.get(), 0] },
      drag: { from: () => [x.get(), y.get()], filterTaps: true, rubberband: 0.15 },
    },
  );

  /**
   * SPEC §4.5 — reset on close. The viewers unmount this component when they
   * close, so clearing here is what guarantees *"reopening never starts
   * zoomed"*. Keyed on `src` as well so paging from photo 3 to photo 4 inside
   * one open viewer starts the next photograph fitted, which is what every
   * native gallery does.
   */
  useEffect(() => {
    scale.set(1);
    x.set(0);
    y.set(0);
    announceZoom(false);
  }, [src, scale, x, y, announceZoom]);

  /**
   * TAP RULES, and they matter more than they look.
   *
   * This element fills the whole viewer so that pan limits are measured
   * against the screen. That means it also covers the dark backdrop, and the
   * backdrop's job is to close the viewer when a member taps beside the
   * photograph — every gallery they use behaves that way and this one did too
   * before 1055. So:
   *
   *  · tap ON the photograph      → never closes (it is a double-tap candidate)
   *  · tap BESIDE it while fitted → bubbles to the backdrop and closes
   *  · tap BESIDE it while zoomed → swallowed, because at that point the
   *    "tap" is nearly always the end of a pan that ran past the edge, and
   *    losing your place mid-zoom is maddening
   */
  const onTap = useCallback((e: React.MouseEvent) => {
    const onPhotograph = e.target === imgRef.current;
    const zoomed = scale.get() > SNAP_BACK_BELOW;
    if (onPhotograph || zoomed) e.stopPropagation();
    if (!onPhotograph) return;

    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_MS) {
      lastTapRef.current = 0;
      if (!gesturesFailed) handleDoubleTap(e.clientX, e.clientY);
      return;
    }
    lastTapRef.current = now;
  }, [gesturesFailed, handleDoubleTap, scale]);

  return (
    <div
      ref={wrapperRef}
      onClick={onTap}
      className={`relative flex items-center justify-center overflow-hidden ${wrapperClassName}`}
      style={{
        // The opt-in. Everything else in the app is pan-x pan-y; this one
        // element takes the touches itself. When gestures have failed we hand
        // touch handling straight back to the browser rather than holding on
        // to events we are no longer processing.
        touchAction: gesturesFailed ? "pan-x pan-y" : "none",
      }}
    >
      <motion.img
        ref={imgRef}
        src={src}
        alt={alt}
        className={className}
        // will-change promotes the photograph to its own layer so a pinch on a
        // large original does not repaint the whole viewer every frame —
        // SPEC §1's "no lag on high-resolution photographs".
        style={{ scale, x, y, willChange: "transform" }}
        draggable={false}
        onError={() => {
          try {
            logger.warn({
              code: "UI-8007",
              event: "LIGHTBOX_IMAGE_LOAD_FAILED",
              fn: "ZoomableImage",
              file: "src/components/media/ZoomableImage.tsx",
              message: "Loading a photograph at full size for the fullscreen viewer.",
              reason: "The image element reported an error rather than a load.",
              expected: "The original photograph decodes and paints",
              actual: "empty viewer — the member tapped a photo and got nothing",
              detail: {
                srcKind: src.startsWith("data:") ? "data" : src.startsWith("blob:") ? "blob" : "remote",
                ...deviceContext(),
              },
            });
          } catch {
            /* rule 1 */
          }
        }}
        {...imgProps}
      />
    </div>
  );
};

export default ZoomableImage;
