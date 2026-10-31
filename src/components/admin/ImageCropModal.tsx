/**
 * THE CROP DIALOG.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REBUILT FOR THE PHONE 2026-08-16. It is mounted from NINE places, including
 * the member post flow and the avatar picker, and it had never once been
 * rendered by the screenshot sweep — it had no scene. `crop-modal-tall`,
 * `crop-modal-wide` and `crop-modal-avatar` now cover it.
 *
 * OWNER REPORT, from his own phone:
 *   "After uplaidng image any editing and Crop not working, any of options not
 *    wokring., croipping selction not wokring."
 *   "marked has big corners, needs to be small."
 *   "after any button noting working after gesture back, this light boxes
 *    opened but back screen scrolled."
 *   "after grid if someone tried to zoom and fit the position based on the grid
 *    not happening, this happens in instagram."
 *
 * Every one of those was real. Measured, not eyeballed:
 *
 * 1. EIGHTEEN TAP TARGETS UNDER 44px. The close button was 16x16. Every zoom,
 *    rotate and mirror button was `p-1` around a 12px icon — 20x20. The aspect
 *    chips were 35x27. This dialog was drawn for a mouse and shipped to a
 *    thumb. "Any of options not working" is not vague; it is a 20px target.
 *
 * 2. ZOOM SILENTLY CROPPED THE WRONG PART OF THE PHOTOGRAPH. The image carried
 *    `max-h-[60vh] object-contain` AND `style={{width: zoom*100%}}`. At 100%
 *    those agree. At 200% the max-height clamps the height, the element box
 *    becomes 540x480 while the picture inside it is still 270x480, and the
 *    canvas maths — which divides naturalWidth by the ELEMENT width — is out by
 *    exactly the zoom factor, with a 135px letterbox offset on top:
 *
 *        zoom 100%   element 270x480   painted 270x480   scale used 3.33  true 3.33
 *        zoom 200%   element 540x480   painted 270x480   scale used 1.67  true 3.33
 *
 *    So a member who zoomed in got a crop from somewhere else in the frame, and
 *    at high zoom the source rectangle falls off the image entirely and the
 *    "After" panel draws nothing — which is the blank preview he photographed.
 *    ONE root cause, two of his reports.
 *
 *    The cure is to stop letting the element box and the picture disagree: the
 *    height limit moved OFF the image and ONTO its scroll container, and
 *    `object-contain` is gone. An <img> with no fit override always paints
 *    edge to edge of its own box, so `naturalWidth / img.width` is true at
 *    every zoom level by construction rather than by luck.
 *
 * 3. NOTHING LOCKED THE PAGE BEHIND IT, and nothing listened for the back
 *    gesture. Both are now handled.
 *
 * WHAT IS STILL NOT INSTAGRAM, stated rather than implied: Instagram pins the
 * frame and moves the photograph under it. This moves a frame over a still
 * photograph — that is `react-image-crop`'s model, and swapping it is a rewrite
 * of the interaction, not a fix. What has been added is the part he actually
 * asked for: PINCH TO ZOOM, with the frame keeping its ratio, so a photo can be
 * sized and positioned against the thirds grid instead of only nudged by two
 * 20px buttons.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useRef, useState } from "react";
import ReactCrop, { type Crop, type PixelCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import {
  X,
  Check,
  RotateCcw,
  Crop as CropIcon,
  Info,
  ZoomIn,
  ZoomOut,
  RotateCw,
  FlipHorizontal2,
  FlipVertical2,
  SkipForward,
} from "lucide-react";

interface Props {
  imageSrc: string;
  onCropComplete: (croppedFile: File) => void;
  onCancel: () => void;
  /** If set, locks the aspect ratio (no free/aspect selector shown) */
  forcedAspect?: number;
  /** Target output width in px */
  targetWidth?: number;
  /** Target output height in px */
  targetHeight?: number;
  /** Show circular crop overlay (for avatars). Output is still square. */
  circularCrop?: boolean;
  /** Queue position (1-based) — shown as "Photo X of Y" when both provided */
  queuePosition?: number;
  /** Queue total */
  queueTotal?: number;
  /** When present + queueTotal > 1, shows a Skip button that discards this photo and advances the queue */
  onSkip?: () => void;
}

// "Free" first and selected by default: cropping is opt-in from 2026-08-01, so
// someone who opened this dialog wants to choose their own frame, not be handed
// a preset. 4:5 is listed because it is the platform's portrait standard and
// was the forced ratio until today — one tap gets the old behaviour back.
const ASPECT_OPTIONS = [
  { label: "Free", value: undefined },
  { label: "1:1", value: 1 },
  { label: "4:5", value: 4 / 5 },
  { label: "16:9", value: 16 / 9 },
  { label: "4:3", value: 4 / 3 },
  { label: "3:2", value: 3 / 2 },
];

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;

/** Pre-render a rotated / mirrored bitmap from the source image.
 *  Returns an object URL that ReactCrop can use as its source so crop
 *  coordinates line up with what the user visually sees. */
async function renderTransformedSrc(
  src: string,
  rotation: number,
  flipH: boolean,
  flipV: boolean
): Promise<string> {
  if (rotation === 0 && !flipH && !flipV) return src;
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = src;
  });
  const rad = (rotation * Math.PI) / 180;
  const sin = Math.abs(Math.sin(rad));
  const cos = Math.abs(Math.cos(rad));
  const cw = Math.round(img.naturalWidth * cos + img.naturalHeight * sin);
  const ch = Math.round(img.naturalWidth * sin + img.naturalHeight * cos);
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) return src;
  ctx.translate(cw / 2, ch / 2);
  ctx.rotate(rad);
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  return await new Promise<string>((resolve) => {
    canvas.toBlob((b) => resolve(b ? URL.createObjectURL(b) : src), "image/png");
  });
}

export default function ImageCropModal({
  imageSrc,
  onCropComplete,
  onCancel,
  forcedAspect,
  targetWidth,
  targetHeight,
  circularCrop,
  queuePosition,
  queueTotal,
  onSkip,
}: Props) {
  const isLocked = forcedAspect !== undefined;
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const [aspect, setAspect] = useState<number | undefined>(forcedAspect);
  const [processing, setProcessing] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0); // 0 / 90 / 180 / 270
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [activeSrc, setActiveSrc] = useState(imageSrc);
  const imgRef = useRef<HTMLImageElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  /** Distance between two fingers when the current pinch began, and the zoom
   *  level at that moment. Refs, not state: they change on every touchmove and
   *  re-rendering on each one would drop frames mid-gesture. */
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);

  /**
   * THE PAGE UNDERNEATH MUST NOT SCROLL.
   *
   * Owner: "this light boxes opened but back screen scrolled." This is a plain
   * `fixed` overlay rather than a Radix dialog, so it never inherited the
   * scroll lock those get for free. On a phone the result is that a drag which
   * misses the crop frame scrolls the feed behind the dialog instead, and the
   * member comes back to a page that has moved.
   *
   * The previous overflow value is restored rather than assumed to be "auto" —
   * several screens set their own, and stamping "auto" over them would leave a
   * page scrollable that had deliberately been locked.
   */
  useEffect(() => {
    const body = document.body;
    const previous = body.style.overflow;
    body.style.overflow = "hidden";
    return () => { body.style.overflow = previous; };
  }, []);

  /**
   * THE BACK GESTURE CLOSES THE DIALOG. It does not leave the page.
   *
   * Owner: "after any button noting working after gesture back". On Android the
   * back swipe is a history POP. With nothing listening, it unwound the ROUTE
   * while this overlay — which is not part of the route — kept rendering on top
   * of whatever loaded next. That is the state where "nothing works": the
   * buttons are alive and wired to a screen that has already gone.
   *
   * Pushing one history entry when the dialog opens gives the gesture something
   * of its own to consume. The entry is popped again on a normal close, so the
   * member's real history is exactly as they left it either way.
   */
  useEffect(() => {
    let closedByPop = false;
    window.history.pushState({ cropModal: true }, "");
    const onPop = () => { closedByPop = true; onCancel(); };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (!closedByPop) window.history.back();
    };
  }, [onCancel]);

  /**
   * PINCH TO ZOOM — the thing he asked for that no button can replace.
   *
   * Handled on the WRAPPER in the capture phase and swallowed there, because
   * `react-image-crop` treats a second finger as another drag and fights the
   * gesture for it. One finger is left entirely alone, so dragging the frame
   * behaves exactly as before.
   */
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 2) return;
    const [a, c] = [e.touches[0], e.touches[1]];
    pinchRef.current = { dist: Math.hypot(a.clientX - c.clientX, a.clientY - c.clientY), zoom };

    /**
     * THE FIRST FINGER HAS ALREADY STARTED A DRAG. CALL IT OFF.
     *
     * Owner, 2026-08-16, on 1.2.8: "on app on gesture zoom in zoom out not
     * happening". The handler fires — a synthetic two-finger pinch in Chromium
     * takes the zoom from 100% to 350% — so the gesture is not being missed.
     * What differs on a real device is TIMING: two fingers never land on the
     * same frame. The first one lands alone, `react-image-crop` captures the
     * pointer and begins moving the crop frame, and by the time the second
     * arrives the library owns the gesture. The pinch then fights a drag for
     * the same fingers, and what a member sees is a frame that jitters and a
     * zoom that does not move.
     *
     * `pointercancel` is the documented way to tell a library its gesture is
     * over — the same event the browser sends when it takes a gesture over for
     * scrolling. Sent for every active pointer, on the element that captured
     * it, so the frame stops moving the instant the second finger lands and
     * the pinch has the gesture to itself.
     *
     * NOT verifiable in this container: whether Android's WebView delivers
     * two-finger touchmove at all under `touch-action: none`. It does in
     * Chromium. If it still fails on the device, the +/- buttons remain, and
     * that is a WebView difference to report rather than guess at.
     */
    for (const t of Array.from(e.touches)) {
      const target = t.target as Element | null;
      target?.dispatchEvent(
        new PointerEvent("pointercancel", { bubbles: true, cancelable: true, pointerId: t.identifier }),
      );
    }

    e.stopPropagation();
  };

  /**
   * WHEEL ZOOM, FOR THE WEBSITE. Owner: "in web on scroll zoom in zoom out not
   * happening" — correct, and not a regression: it never existed. Two 44px
   * buttons are the right controls on a phone and the wrong ones on a desktop,
   * where the wheel is what every image editor uses.
   *
   * Only with a modifier-free wheel over the picture, and `preventDefault` so
   * the page behind does not scroll at the same time. Deliberately coarse —
   * one notch is one ZOOM_STEP, matching the buttons exactly, so the two
   * controls cannot drift apart.
   */
  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) return; // leave browser page-zoom alone
    e.preventDefault();
    const dir = e.deltaY < 0 ? 1 : -1;
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +(z + dir * ZOOM_STEP).toFixed(2))));
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const start = pinchRef.current;
    if (!start || e.touches.length !== 2) return;
    const [a, c] = [e.touches[0], e.touches[1]];
    const dist = Math.hypot(a.clientX - c.clientX, a.clientY - c.clientY);
    if (start.dist <= 0) return;
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +(start.zoom * (dist / start.dist)).toFixed(2)));
    setZoom(next);
    e.stopPropagation();
  };
  const onTouchEnd = () => { pinchRef.current = null; };
  const showQueue = typeof queuePosition === "number" && typeof queueTotal === "number" && queueTotal > 1;
  const canSkip = showQueue && typeof onSkip === "function";

  // Re-render active source whenever rotation / mirror changes.
  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    (async () => {
      const url = await renderTransformedSrc(imageSrc, rotation, flipH, flipV);
      if (cancelled) {
        if (url !== imageSrc) URL.revokeObjectURL(url);
        return;
      }
      if (url !== imageSrc) createdUrl = url;
      setActiveSrc(url);
      // Reset crop so ReactCrop re-initialises against the new pixel space
      setCrop(undefined);
      setCompletedCrop(undefined);
    })();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [imageSrc, rotation, flipH, flipV]);

  // Live before/after preview — redraws when completedCrop changes.
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !completedCrop || completedCrop.width === 0 || completedCrop.height === 0) return;
    const scaleX = img.naturalWidth / img.width;
    const scaleY = img.naturalHeight / img.height;
    const sx = completedCrop.x * scaleX;
    const sy = completedCrop.y * scaleY;
    const sw = completedCrop.width * scaleX;
    const sh = completedCrop.height * scaleY;
    const maxDim = 160;
    const scale = Math.min(1, maxDim / Math.max(sw, sh));
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  }, [completedCrop, zoom]);

  /**
   * THE WIDTH THE PHOTOGRAPH IS SHOWN AT WHEN ZOOM READS 100%.
   *
   * Removing `max-height` from the image fixed the crop maths (see the file
   * header) but took the "fit on screen" behaviour with it: a 9:16 photo came
   * up 612px tall in a 542px window, so the member arrived at this screen
   * already needing to scroll to see their own picture.
   *
   * Measuring the space and sizing the image to it restores the fit WITHOUT
   * bringing back the disagreement, because the element is still sized by an
   * explicit width with `height: auto` — its box and its picture stay the same
   * rectangle at every zoom level, which is the whole property the crop maths
   * depends on. Zoom then multiplies a real number instead of a percentage of
   * a container that shrink-wraps the image inside it.
   */
  const cropAreaRef = useRef<HTMLDivElement>(null);
  const [fitWidth, setFitWidth] = useState<number | null>(null);

  const recomputeFit = useCallback(() => {
    const box = cropAreaRef.current;
    const img = imgRef.current;
    if (!box || !img || !img.naturalWidth || !img.naturalHeight) return;
    const cs = getComputedStyle(box);
    const availW = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const availH = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (availW <= 0 || availH <= 0) return;
    const ratio = img.naturalWidth / img.naturalHeight;
    setFitWidth(Math.max(1, Math.floor(Math.min(availW, availH * ratio))));
  }, []);

  /** Rotation, a keyboard opening, or turning the phone all change the space.
   *  The container's own size never depends on the image (it is a `flex-1`
   *  child with `min-h-0`), so observing it cannot feed back into itself. */
  useEffect(() => {
    const box = cropAreaRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => recomputeFit());
    ro.observe(box);
    return () => ro.disconnect();
  }, [recomputeFit]);

  /**
   * PUT A CROP RECTANGLE ON THE PICTURE, CENTRED, AT THE GIVEN RATIO.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * PULLED OUT OF `onImageLoad` 2026-08-16, because the ONLY thing that ever
   * created a crop was the image's load event — and that is why the owner
   * reported this dialog as dead on 1.2.8:
   *
   *   "unable to move selection. any upper menu section not working.
   *    anything editing not working"
   *
   * Tapping an aspect chip ran `setCrop(undefined)` and nothing put one back.
   * Measured in Chromium, the selection rectangle before and after one tap:
   *
   *     start        [100, 372, 211, 211]
   *     after 4:5    null
   *
   * From that tap onward there is NO SELECTION on the screen. There is nothing
   * to drag, so the frame "cannot be moved"; the px readout goes blank, so
   * nothing looks like it is responding; and Crop & Upload silently falls back
   * to sending the WHOLE image, because `completedCrop` is undefined. One tap
   * turns the whole dialog into furniture. Every symptom he listed is that.
   *
   * It hid behind the one control that appeared to work: ROTATE re-renders the
   * source, which fires `onLoad`, which seeded a crop again — measured coming
   * back as [28, 255, 356, 446]. So rotating "fixed" it and nothing else did,
   * which is exactly the kind of intermittence that makes a bug unreportable.
   *
   * The rule is now simple and holds everywhere: ANY change to the frame's
   * shape re-seeds the frame. Clearing it is never the last step.
   * ─────────────────────────────────────────────────────────────────────────
   */
  const seedCrop = useCallback((nextAspect: number | undefined) => {
    const img = imgRef.current;
    if (!img || !img.width || !img.height) return;
    const { width, height } = img;

    let cropW: number, cropH: number;
    if (nextAspect) {
      if (width / height > nextAspect) {
        cropH = height * 0.9;
        cropW = cropH * nextAspect;
      } else {
        cropW = width * 0.9;
        cropH = cropW / nextAspect;
      }
    } else {
      const size = Math.min(width, height) * 0.8;
      cropW = size;
      cropH = size;
    }

    setCrop({
      unit: "px",
      x: (width - cropW) / 2,
      y: (height - cropH) / 2,
      width: cropW,
      height: cropH,
    });
    // The px readout and the confirm path both read `completedCrop`, and
    // ReactCrop only fills it on a user gesture. Seeding it here means a
    // freshly chosen ratio is immediately uploadable without touching the
    // frame first — which is what a member expects after picking "4:5".
    setCompletedCrop({
      unit: "px",
      x: (width - cropW) / 2,
      y: (height - cropH) / 2,
      width: cropW,
      height: cropH,
    });
  }, []);

  const onImageLoad = useCallback(() => {
    recomputeFit();
    seedCrop(forcedAspect ?? aspect);
  }, [aspect, forcedAspect, recomputeFit, seedCrop]);

  const handleConfirm = async () => {
    if (!completedCrop || !imgRef.current) {
      const resp = await fetch(activeSrc);
      const blob = await resp.blob();
      onCropComplete(new File([blob], `cropped-${Date.now()}.png`, { type: blob.type }));
      return;
    }

    setProcessing(true);
    try {
      const canvas = document.createElement("canvas");
      const img = imgRef.current;
      const scaleX = img.naturalWidth / img.width;
      const scaleY = img.naturalHeight / img.height;

      const outW = targetWidth || completedCrop.width * scaleX;
      const outH = targetHeight || completedCrop.height * scaleY;

      canvas.width = outW;
      canvas.height = outH;

      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas context unavailable");

      ctx.drawImage(
        img,
        completedCrop.x * scaleX,
        completedCrop.y * scaleY,
        completedCrop.width * scaleX,
        completedCrop.height * scaleY,
        0,
        0,
        outW,
        outH
      );

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Failed to create blob"))),
          "image/png",
          0.92
        );
      });

      onCropComplete(new File([blob], `cropped-${Date.now()}.png`, { type: "image/png" }));
    } catch {
      const resp = await fetch(activeSrc);
      const blob = await resp.blob();
      onCropComplete(new File([blob], `cropped-${Date.now()}.png`, { type: blob.type }));
    }
    setProcessing(false);
  };

  const resetAll = () => {
    setZoom(1);
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
    // Reset means "back to how it opened", NOT "no frame at all". This used to
    // clear the crop and leave the member with an empty picture and nothing to
    // drag — the same dead end tapping an aspect chip caused. When the rotation
    // was already 0 no image reload followed either, so nothing put it back.
    seedCrop(forcedAspect ?? aspect);
  };

  const effectiveAspect = isLocked ? forcedAspect : aspect;

  return (
    <div
      /**
       * `pointer-events-auto` IS THE WHOLE FIX FOR "THE SCREEN IS FROZEN".
       *
       * ─────────────────────────────────────────────────────────────────────
       * Owner, 2026-08-16, on 1.2.9: "after uploadling any image clicked crop
       * after that any of option any fuction not wokring even not in web too,
       * no cross, no mirror, no moving the selection nothing - its like Screen
       * is freezed - web and app."
       *
       * He was describing something far simpler than anything I had been
       * fixing, and the giveaway was "no cross". The close button is a plain
       * <button onClick>. If THAT is dead, nothing about cropping is wrong —
       * the dialog is not receiving input at all.
       *
       * `WallPosts` renders this component as a SIBLING of the composer's
       * Radix <Dialog>, and that dialog is open at the moment Crop is pressed.
       * A Radix modal makes the rest of the page inert while it is open by
       * putting `pointer-events: none` on <body>. This overlay is outside the
       * dialog's content, so it inherits it — painted perfectly, laid out
       * perfectly, and completely deaf. Measured at 412px:
       *
       *     crop dialog ALONE       body pointer-events auto   Cancel reachable
       *     behind the composer     body pointer-events NONE   Cancel NOT reachable
       *                             (hit test lands on Radix's own overlay)
       *
       * Every symptom he reported is that one inherited value: no cross, no
       * mirror, no rotate, no aspect chips, no drag, no pinch. Web and app,
       * because it is not a WebView difference at all.
       *
       * AND IT IS WHY EVERY MEASUREMENT I GAVE HIM WAS TRUE AND USELESS. The
       * three crop scenes mount this component ALONE, where the body is
       * untouched and everything works. The bug lives in the ARRANGEMENT, not
       * the component — `crop-modal-behind-dialog` now reproduces it.
       *
       * `pointer-events: auto` re-enables this subtree; z-[100] already sits
       * above Radix's z-50 overlay, so paint order was never the problem.
       * ─────────────────────────────────────────────────────────────────────
       */
      className="pointer-events-auto fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
    >
      {/* FULL SCREEN ON A PHONE, a centred box from `sm` up.
          It was `w-[640px] max-w-[90vw]` at every size, which on a 360px phone
          is a 324px column with the photograph squeezed into whatever was left
          after four stacked toolbars. The photograph is the whole point of this
          screen, so on a phone it now gets the entire display and the toolbars
          get exactly the height they need. */}
      <div className="flex h-full w-full flex-col overflow-hidden bg-background sm:h-auto sm:max-h-[90vh] sm:w-[640px] sm:max-w-[90vw] sm:rounded-sm sm:border sm:border-border sm:shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-card/50 pl-4 pr-1 py-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <CropIcon className="h-4 w-4 shrink-0 text-primary" />
            <span className="truncate text-[12px] tracking-[0.12em] uppercase text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
              Crop &amp; Adjust
            </span>
            {showQueue && (
              <span
                className="shrink-0 text-[11px] tracking-[0.1em] uppercase px-2 py-0.5 rounded-sm bg-primary/10 text-primary"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                {queuePosition}/{queueTotal}
              </span>
            )}
          </div>
          {/* 16x16 before. The one control every member reaches for first. */}
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* ASPECT ROW. One line that SCROLLS SIDEWAYS rather than wrapping onto
            a second row — at 360px the six chips used to wrap, pushing "3:2"
            and Reset onto a line of their own and stealing 40px from the
            photograph. Chips are 44px tall, from 35x27. */}
        <div className="flex shrink-0 items-center gap-1.5 border-b border-border bg-muted/20 px-2">
          {isLocked ? (
            <div className="flex items-center gap-1.5 py-2.5 pl-2 text-[12px] text-primary">
              <Info className="h-4 w-4 shrink-0" />
              <span style={{ fontFamily: "var(--font-heading)" }}>
                {targetWidth && targetHeight ? `${targetWidth}×${targetHeight}px — ratio locked` : "Ratio locked"}
              </span>
            </div>
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {ASPECT_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => {
                    // Re-seed, never just clear. See `seedCrop` — clearing was
                    // the whole of the "nothing works" report.
                    setAspect(opt.value);
                    seedCrop(opt.value);
                  }}
                  className={`h-11 shrink-0 rounded-md px-3 text-[13px] font-semibold transition-colors ${
                    aspect === opt.value
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={resetAll}
            aria-label="Reset zoom, rotation, mirror and crop selection"
            className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
            title="Reset zoom, rotation, mirror, and crop selection"
          >
            <RotateCcw className="h-5 w-5" />
          </button>
        </div>

        {/* ZOOM · ROTATE · MIRROR. Every button here was `p-1` around a 12px
            icon — a 20x20 target, which is why he reported that none of these
            options worked. They are 44x44 now, with the borders dropped: this
            app does not draw outlines around controls, and eight outlined
            boxes in one strip was the loudest thing on the screen. */}
        <div className="flex shrink-0 items-center justify-between gap-1 border-b border-border bg-muted/10 px-1">
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)))}
              disabled={zoom <= ZOOM_MIN}
              className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
              title="Zoom out"
              aria-label="Zoom out"
            >
              <ZoomOut className="h-5 w-5" />
            </button>
            <span className="w-11 text-center text-[12px] tabular-nums text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)))}
              disabled={zoom >= ZOOM_MAX}
              className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
              title="Zoom in"
              aria-label="Zoom in"
            >
              <ZoomIn className="h-5 w-5" />
            </button>
          </div>

          <div className="flex items-center">
            <button
              type="button"
              onClick={() => setRotation((r) => (r + 270) % 360)}
              className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
              title="Rotate 90° left"
              aria-label="Rotate 90 degrees left"
            >
              <RotateCcw className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => setRotation((r) => (r + 90) % 360)}
              className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
              title="Rotate 90° right"
              aria-label="Rotate 90 degrees right"
            >
              <RotateCw className="h-5 w-5" />
            </button>
          </div>

          <div className="flex items-center">
            <button
              type="button"
              onClick={() => setFlipH((v) => !v)}
              className={`flex h-11 w-11 items-center justify-center rounded-md transition-colors ${
                flipH ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
              title="Mirror horizontally"
              aria-label="Mirror horizontally"
              aria-pressed={flipH}
            >
              <FlipHorizontal2 className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => setFlipV((v) => !v)}
              className={`flex h-11 w-11 items-center justify-center rounded-md transition-colors ${
                flipV ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
              title="Flip vertically"
              aria-label="Flip vertically"
              aria-pressed={flipV}
            >
              <FlipVertical2 className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* THE PHOTOGRAPH. The biggest thing on the screen, which it was not.
            `min-h-0` lets this flex child shrink so the footer stays put; the
            height cap lives HERE now instead of on the image — see the note at
            the top of the file about zoom and the crop maths. */}
        <div
          ref={cropAreaRef}
          className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-black/20 p-2 sm:max-h-[60vh] sm:min-h-[320px] sm:p-4"
          onWheel={onWheel}
          onTouchStartCapture={onTouchStart}
          onTouchMoveCapture={onTouchMove}
          onTouchEndCapture={onTouchEnd}
        >
          <ReactCrop
            crop={crop}
            onChange={(c) => setCrop(c)}
            onComplete={(c) => setCompletedCrop(c)}
            aspect={effectiveAspect}
            circularCrop={circularCrop}
            ruleOfThirds
            className="rc-fine-handles"
          >
            {/*
              NO `object-contain`, NO `max-height` — deliberately, and this is
              the fix for the wrong-crop bug. Both of those let the element's
              box grow away from the picture painted inside it, and every
              coordinate in `handleConfirm` is derived from that box. Sized by
              width alone, an <img> keeps its own ratio and fills its box
              exactly, so `naturalWidth / img.width` is correct at any zoom.

              `loading="lazy"` is gone too: this image is the only thing on the
              screen and deferring it delayed `onLoad`, which is what seeds the
              initial crop rectangle.
            */}
            <img
              decoding="async"
              ref={imgRef}
              src={activeSrc}
              alt="Crop preview"
              onLoad={onImageLoad}
              style={
                fitWidth
                  ? { width: `${Math.round(fitWidth * zoom)}px`, maxWidth: "none", height: "auto" }
                  : { width: `${zoom * 100}%`, maxWidth: "none", height: "auto" }
              }
              crossOrigin="anonymous"
            />
          </ReactCrop>
        </div>

        {/* BEFORE / AFTER — DESKTOP ONLY.
            It cost about 90px of a phone screen to show a 64px thumbnail of
            the rectangle the member is already looking at, full size, directly
            above it. The px readout in the footer keeps the one piece of
            information the strip carried that the crop frame does not. */}
        <div className="hidden shrink-0 items-center gap-3 border-t border-border bg-muted/10 px-4 py-2 sm:flex">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground shrink-0" style={{ fontFamily: "var(--font-heading)" }}>
            Preview:
          </span>
          <div className="flex items-center gap-2">
            <div className="flex flex-col items-center gap-0.5">
              <img
                src={activeSrc}
                alt="Before"
                className="h-16 max-w-[90px] object-contain border border-border rounded-sm bg-background"
                crossOrigin="anonymous"
              />
              <span className="text-[8px] uppercase tracking-wider text-muted-foreground/70">Before</span>
            </div>
            <span className="text-muted-foreground/50 text-[10px]">→</span>
            <div className="flex flex-col items-center gap-0.5">
              <div className="h-16 min-w-[40px] flex items-center justify-center border border-primary/40 rounded-sm bg-background overflow-hidden">
                {completedCrop && completedCrop.width > 0 ? (
                  <canvas ref={previewCanvasRef} className="max-h-16 max-w-[90px] object-contain" />
                ) : (
                  <span className="text-[8px] text-muted-foreground/50 px-2 text-center">Drag to crop</span>
                )}
              </div>
              <span className="text-[8px] uppercase tracking-wider text-primary/80">After</span>
            </div>
          </div>
        </div>

        {/* FOOTER. The size readout gets its own line above the buttons on a
            phone — side by side, "Drag to select crop area, or insert as-is"
            wrapped to three lines and squeezed the two buttons that matter.
            Safe-area padding so the confirm button clears a gesture bar. */}
        <div
          className="shrink-0 border-t border-border bg-card/50 px-3 pt-2"
          style={{ paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom, 0px))" }}
        >
          <span className="mb-1.5 block text-[12px] text-muted-foreground sm:mb-0 sm:inline">
            {completedCrop
              ? `${Math.round(completedCrop.width)} × ${Math.round(completedCrop.height)}px selected`
              : "Drag to select, or insert as-is"}
            {targetWidth && targetHeight ? ` → ${targetWidth}×${targetHeight}px` : ""}
          </span>
          <div className="flex items-center gap-2 sm:float-right">
            {canSkip && (
              <button
                type="button"
                onClick={onSkip}
                className="flex h-11 items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
                style={{ fontFamily: "var(--font-heading)" }}
                title="Skip this photo and keep going through the queue"
              >
                <SkipForward className="h-4 w-4" /> Skip
              </button>
            )}
            <button
              type="button"
              onClick={onCancel}
              className="flex h-11 flex-1 items-center justify-center rounded-md bg-muted/50 px-4 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted sm:flex-none"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={processing}
              className="flex h-11 flex-[2] items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 sm:flex-none"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {processing ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              {processing ? "Processing…" : "Crop & Upload"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
