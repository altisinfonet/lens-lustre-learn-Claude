import { useState, useCallback, useEffect, useRef } from "react";
import { X, ChevronLeft, ChevronRight, Heart } from "lucide-react";
import { useDownloadImage } from "@/hooks/core/useDownloadImage";
import DownloadButton from "@/components/DownloadButton";
import ZoomableImage from "@/components/media/ZoomableImage";
import { motion, AnimatePresence, type PanInfo } from "framer-motion";
import { frameAspectFor, frameAspectForUrls, parseImageDims } from "@/lib/imageFrame";
import { hasLadderMarker, rungPath, rungPlan, rungWidthFor } from "@/lib/imageLadder";

interface PostMediaProps {
  urls: string[];
  /**
   * The STORED thumbnail for each slide, straight from posts.thumbnail_urls —
   * aligned with `urls` by index. Optional because older posts have none and
   * some paths (realtime inserts) may not carry it. See the note above
   * ProgressiveImage: the feed shows the stored thumbnail when it has one and
   * NEVER GUESSES a thumbnail address again.
   */
  thumbUrls?: (string | null | undefined)[];
  onDoubleTapLike?: () => void;
  /**
   * FIRST TAP ON THE PHOTOGRAPH, on a touch screen.
   *
   * Owner's decision, 2026-08-15, from three options: the first tap reveals
   * the reach/viewed figures and does NOTHING ELSE; a second tap opens the
   * photograph as it always did. Return `true` to say "I consumed this tap" —
   * the viewer then stays shut. Returning false (or omitting the prop) leaves
   * the old behaviour exactly as it was, which is what the web pointer path
   * uses, because there the figures appear on hover and never steal a click.
   */
  interceptFirstTap?: () => boolean;
}

/**
 * ── THE FRAME, AND WHY IT IS SOMETIMES MEASURED ──
 *
 * The card's shape normally comes from the `-w<W>h<H>` the uploader writes into
 * the filename, so it is known before a single byte of the photo is fetched and
 * nothing reflows.
 *
 * Every photo posted BEFORE 2026-08-01 has no such suffix. Those used to be
 * force-cropped to 4:5 at upload, so a 4:5 frame was correct for them. It is
 * not correct any more: the sharp image is now `object-contain`, so an old
 * landscape photo sat inside a portrait frame with enormous bars above and
 * below it. Reported by the owner with a screenshot, 2026-08-01.
 *
 * So when — and ONLY when — the URL carries no dimensions, the frame is
 * measured from the image itself. It is measured from the 32px LQIP, which is
 * fetched eagerly and arrives in a few milliseconds, rather than from the sharp
 * image, which is lazy and would resize the card long after the reader has
 * settled on it. The cost is up to ~2% of ratio error from rounding a 32px
 * edge; the blurred backdrop covers a bar that thin and no one can see it.
 *
 * A photo WITH dimensions in its name is never measured, so new posts still
 * have zero reflow.
 */
const PostMedia = ({ urls, thumbUrls, onDoubleTapLike, interceptFirstTap }: PostMediaProps) => {
  const first = urls[0];
  // One frame per card, taken from the first photo — see src/lib/imageFrame.ts.
  // An album must not resize between slides: the buttons would move under the
  // user's finger and everything below would reflow on every swipe.
  const declaredAspect = frameAspectForUrls(urls);
  const needsMeasure = parseImageDims(first) === null;
  const [measuredAspect, setMeasuredAspect] = useState<number | null>(null);

  // A different first photo is a different frame. Without this reset a card
  // recycled by the feed's virtualiser would keep the previous photo's shape.
  useEffect(() => { setMeasuredAspect(null); }, [first]);

  const handleNaturalSize = useCallback(
    (w: number, h: number) => {
      if (!needsMeasure) return;
      if (!(w > 0) || !(h > 0)) return;
      setMeasuredAspect((prev) => (prev === null ? frameAspectFor(w / h) : prev));
    },
    [needsMeasure],
  );

  if (urls.length === 0) return null;

  const frameAspect = measuredAspect ?? declaredAspect;
  if (urls.length === 1) {
    return <SingleImagePost src={first} thumb={thumbUrls?.[0]} frameAspect={frameAspect} onNaturalSize={needsMeasure ? handleNaturalSize : undefined} onDoubleTapLike={onDoubleTapLike} interceptFirstTap={interceptFirstTap} />;
  }
  return <AlbumCarousel urls={urls} thumbUrls={thumbUrls} frameAspect={frameAspect} onNaturalSize={needsMeasure ? handleNaturalSize : undefined} onDoubleTapLike={onDoubleTapLike} interceptFirstTap={interceptFirstTap} />;
};

/* ── Supabase render-endpoint helpers ──
 * Phase 1: bandwidth fix. Feed/Wall thumbnails use Supabase image transform
 * (LQIP 32px + responsive srcset 480/800/1200). Lightbox + download still use
 * the original URL passed in via props — never transformed here.
 *
 * Edge cases handled:
 *  - Non-Supabase URLs (external/CDN/data:) → fall back to original, no srcset
 *  - Already-transformed render URLs → not double-transformed
 *  - GIF/SVG → never transformed (animation/vector loss); fall back to original
 */
const SUPABASE_PUBLIC_RE = /\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/;
const SUPABASE_RENDER_RE = /\/storage\/v1\/render\/image\/public\//;

/* ── Cloudflare Transformations: SHIPPED 2026-08-01, REMOVED 2026-08-05 ──
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS WAS "IMAGES ARE NOT COMING". Do not route images through
 * /cdn-cgi/image/ again without reading this.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * On 2026-08-01 every cdn.50mmretina.com post image was rerouted through
 * `https://50mmretina.com/cdn-cgi/image/width=…/<original>` to cut bandwidth
 * (measured 89% smaller that day — the endpoint really did work when it
 * shipped). From then on the owner reported, repeatedly: *"Images are not
 * coming. Many times told, still you not solved — all time images are not
 * coming."*
 *
 * MEASURED IN THE OWNER'S OWN BROWSER, 2026-08-05 19:0x — the owner himself
 * supplied the decisive experiment, two windows side by side:
 *
 *   page on https://50mmretina.com (apex):
 *     /cdn-cgi/image/…/post-images/….webp → 200 image/jpeg, photos render
 *   page on https://www.50mmretina.com (what every member uses):
 *     the IDENTICAL request → killed at network level ("Failed to fetch",
 *     even in no-cors mode), every photo → branded placeholder
 *
 * The transformer only serves requests initiated from the apex origin. The
 * site lives on www. The Android app is a third origin (its own scheme), so
 * builds 1035…1051 — every build cut after 2026-08-01 — show no photos at
 * all. And any test made from the apex, or of the URL directly, passes —
 * which is exactly why this survived every earlier check.
 *
 * Avatars, journal ads, trending thumbnails and the /login wall never went
 * through the transformer (direct urls) and loaded fine throughout — that
 * asymmetry was the fingerprint that found this.
 *
 * The transformer is zone infrastructure, not code: its origin rules and
 * quota live in the Cloudflare dashboard, where no deploy, test or review in
 * this repo can see them change. Post images therefore load DIRECT from
 * cdn.50mmretina.com — proven working from every origin — and nothing may
 * reroute them through an endpoint that can be switched off outside this
 * repo. If the bandwidth win is ever wanted again it needs (a) the zone rule
 * verified for www AND the app origin, and (b) an automatic per-image
 * fallback to the direct URL. Neither existed.
 */

/* The three definitions below are UNUSED since the removal — kept, unchanged,
   as the exact code that used to run, so the note above stays checkable
   against it. Safe to delete whenever. */
const CF_ZONE_ORIGIN = "https://50mmretina.com";
const CDN_HOST = "cdn.50mmretina.com";

function isCdnImage(url: string): boolean {
  try {
    return new URL(url).host === CDN_HOST;
  } catch {
    return false;
  }
}

function buildCfUrl(url: string, width: number, quality = 70): string {
  // %2C, NOT a literal comma. Cloudflare accepts either, but `srcset` is a
  // COMMA-SEPARATED list — a raw comma inside a candidate URL makes the browser
  // fail to parse the whole attribute, `currentSrc` comes back empty and NO
  // image loads at all. That shipped for a few minutes on 2026-08-01: the cards
  // showed only their blurred backdrop. Verified both forms return a correct
  // 800px image; only this one survives srcset.
  const opts = [`width=${width}`, `quality=${quality}`, "format=auto"].join("%2C");
  return `${CF_ZONE_ORIGIN}/cdn-cgi/image/${opts}/${url}`;
}

function isTransformable(url: string): boolean {
  if (!url || url.startsWith("data:") || url.startsWith("blob:")) return false;
  if (SUPABASE_RENDER_RE.test(url)) return false; // already transformed
  if (url.indexOf("/cdn-cgi/image/") !== -1) return false; // already transformed
  if (/\.(gif|svg)(\?|$)/i.test(url)) return false; // preserve animation/vector
  return SUPABASE_PUBLIC_RE.test(url);
}

function buildRenderUrl(url: string, width: number, quality = 70): string {
  try {
    const u = new URL(url);
    const m = u.pathname.match(SUPABASE_PUBLIC_RE);
    if (!m) return url;
    const params = new URLSearchParams(u.search);
    params.set("width", String(width));
    params.set("quality", String(quality));
    params.set("resize", "contain");
    return `${u.origin}/storage/v1/render/image/public/${m[1]}/${m[2]}?${params.toString()}`;
  } catch {
    return url;
  }
}

function buildLqipUrl(url: string): string {
  return buildRenderUrl(url, 32, 30);
}

/* ── STORED thumbnails, never GUESSED ones. 2026-08-07, second attempt. ──
 *
 * The upload pipeline creates a 600px WebP thumbnail beside every full-size
 * original and records its address in posts.thumbnail_urls. The first attempt
 * at using it (shipped earlier today) did not read that column — it DERIVED the
 * thumb address from the original by string rule (`<path>-thumb.<ext>` on the
 * CDN host), assuming the two always live side by side.
 *
 * THEY DO NOT. Measured 2026-08-07 against production data: for the posts from
 * roughly before the R2 migration, the original lives on cdn.50mmretina.com but
 * the stored thumbnail lives on SUPABASE STORAGE — the derived CDN address
 * simply does not exist. That alone should have degraded to the original via
 * onError; instead the global retrier in src/lib/imageFallback.ts captured the
 * dead derived URL, kept re-writing it over the component's fallback, and after
 * two rounds planted the permanent branded placeholder. Owner report, with
 * screenshots: "some images are not loading - image broken - happened with many
 * profile." Both halves are fixed: imageFallback now drops a retry when the
 * element has moved to a different address, and this file now uses ONLY the
 * stored thumbnail_urls value — the address the uploader actually wrote,
 * whichever host it is on. No thumbnail on record → the original is shown, the
 * pre-2026-08-07 behaviour: heavier, never broken.
 *
 * GIF/SVG originals never swap to a thumbnail (it would freeze the animation).
 * The lightbox is unaffected: it receives the original `urls` prop directly.
 */
function usableThumb(thumb: string | null | undefined, original: string): string | null {
  if (!thumb || typeof thumb !== "string") return null;
  if (!/^https?:\/\//i.test(thumb)) return null;
  if (/\.(gif|svg)(\?|$)/i.test(original)) return null; // preserve animation/vector
  if (thumb === original) return null; // nothing to gain
  return thumb;
}

function buildSrcSet(url: string): string | undefined {
  if (!isTransformable(url)) return undefined;
  return [480, 800, 1200].map((w) => `${buildRenderUrl(url, w)} ${w}w`).join(", ");
}

const FEED_SIZES = "(max-width: 768px) 100vw, 600px";

const THUMB_LONG_EDGE = 600;

/**
 * PHOTO QUALITY — owner report, 2026-08-09: *"Photos are uploading with
 * extremely low reducing size so that images value quality getting very poor."*
 *
 * MEASURED on the live feed, 2026-08-10, before this fix:
 *
 *   slot 588 CSS px × DPR 1.125  =  662 device px needed
 *   delivered                    =  600 × 400   (and 480 × 600 for portraits)
 *   srcset                       =  none
 *
 * The browser was upscaling. On a phone at DPR 3 the same slot needs ~1,760
 * device pixels and still got 600 — three times too few. That is the softness.
 *
 * NOTHING IS WRONG WITH THE UPLOAD. The stored originals measure 1920×1280,
 * 1080×1350, 2560×1165. Not one pixel is lost at upload; the wrong copy was
 * being displayed.
 *
 * WHY, EXACTLY — and it was my change of 2026-08-07. `isTransformable()`
 * requires the URL to match `/storage/v1/object/public/…`, but every stored
 * address is `https://cdn.50mmretina.com/…`, the custom CDN domain. So
 * `transformable` was ALWAYS false, `buildSrcSet()` ALWAYS returned undefined,
 * and the sharp layer fell to `thumb ?? src` — the 600px thumbnail, on every
 * device, forever.
 *
 * THE FIX IS NOT TO THROW THE THUMBNAIL AWAY. It is genuinely the right file
 * for a small slot, and it is what makes the first paint fast. It is now
 * offered ALONGSIDE the original with width descriptors, and the browser picks
 * — by slot size and by device pixel ratio, which is the one thing we cannot
 * measure at render time. A phone gets the original; a small grid cell on a
 * 1× screen still gets the 600px copy.
 */
function intrinsicFromName(url: string): { w: number; h: number } | null {
  // The uploader bakes the size into the filename: `…-w1920h1280.webp`, and
  // `…-w1920h1280-thumb.webp` for its 600px copy. Without those numbers there
  // are no width descriptors and srcset cannot be built at all.
  const m = url.match(/-w(\d+)h(\d+)(?:-l3)?(?:-thumb)?\.[a-z0-9]+(?:[?#]|$)/i);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w > 0 && h > 0 ? { w, h } : null;
}

/**
 * `thumb 600w[, rung 1080w[, rung 1440w]], original 1920w` — never a guess:
 * every address offered is a STORED file.
 *
 * Rungs are offered ONLY when the filename carries the `-l3` marker (B3d-1) —
 * a legacy URL gets exactly the thumb+original pair it always got, because
 * offering a rung that was never uploaded would 404-then-fallback on first
 * paint for every old photo.
 */
function buildThumbFirstSrcSet(thumb: string | null, original: string): string | undefined {
  if (!thumb) return undefined;
  const dim = intrinsicFromName(original) ?? intrinsicFromName(thumb);
  if (!dim || dim.w <= THUMB_LONG_EDGE) return undefined;
  // The thumbnail is capped on its LONG edge, so a portrait's width is smaller
  // than 600. Declaring 600w for a 480px-wide file would make the browser skip
  // the original when it should not.
  const thumbW =
    dim.w >= dim.h ? THUMB_LONG_EDGE : Math.max(1, Math.round((THUMB_LONG_EDGE * dim.w) / dim.h));
  if (thumbW >= dim.w) return undefined;
  const parts = [`${thumb} ${thumbW}w`];
  if (hasLadderMarker(original)) {
    for (const rung of rungPlan(dim.w, dim.h)) {
      const rw = rungWidthFor(rung, dim.w, dim.h);
      // Skip a rung whose declared width would not beat the original's — the
      // no-upscale rule seen from the renderer's side.
      if (rw < dim.w) parts.push(`${rungPath(original, rung)} ${rw}w`);
    }
  }
  parts.push(`${original} ${dim.w}w`);
  return parts.join(", ");
}


/* ── Progressive Image ──
 * Two layers, and the back one now does two jobs.
 *
 * BEFORE 2026-08-01 the 32px LQIP was purely a loading placeholder: it faded to
 * opacity-0 the moment the sharp image arrived, and the sharp image was
 * `object-cover` inside a frame hard-locked to 4:5 — so every photo that was
 * not 4:5 got silently cropped.
 *
 * NOW the sharp image is `object-contain`: the whole photograph is shown, never
 * recomposed. When its ratio does not exactly match the frame that leaves bars,
 * and the LQIP fills them — heavily blurred, scaled past the edges so the blur
 * has nothing to bleed into, and dimmed so the photo's own edge stays readable.
 *
 * The backdrop costs ZERO extra bandwidth: that 32px image was already being
 * downloaded as the placeholder. Blurring a 32px source is visually identical
 * to blurring the full-size one, at ~1KB instead of ~200KB.
 *
 * When the photo's ratio equals the frame's — which is the common case, since
 * the frame is derived from the photo — the backdrop is completely covered and
 * costs nothing visually either.
 *
 * BRIGHTNESS, corrected 2026-08-01. The backdrop was dimmed to 0.55, which was
 * tuned on a bright photo. On a dark photograph — a forest interior, a night
 * shot — 0.55 of an already-dark image is indistinguishable from an empty
 * card, and the padding reads as a black void rather than as the photo. 0.8
 * keeps the photo's own edge clearly separated while leaving the bars visibly
 * part of the picture.
 *
 * The backdrop also gets its own error fallback. It had none: if the 32px
 * transform failed, the layer rendered nothing at all and the bars really were
 * blank. It now falls back to the untransformed original once.
 */
const ProgressiveImage = ({
  src,
  thumb: thumbProp,
  className,
  onNaturalSize,
}: {
  src: string;
  /** The STORED thumbnail address for this photo (posts.thumbnail_urls), if any. */
  thumb?: string | null;
  className?: string;
  /** Reports the intrinsic size of the backdrop copy — see PostMedia's header. */
  onNaturalSize?: (width: number, height: number) => void;
}) => {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [backdropFailed, setBackdropFailed] = useState(false);
  const transformable = isTransformable(src);
  // PERF 2026-08-07: show the 600px thumbnail the uploader STORED for this
  // photo rather than the full 2560px original. `failed` (set by the sharp
  // layer's onError) falls everything back to the original, so a dead thumbnail
  // degrades to the pre-thumbnail behaviour instead of breaking. See the note
  // above usableThumb — the address is never guessed, only read.
  const thumb = !transformable && !failed ? usableThumb(thumbProp, src) : null;
  /**
   * ⚠ THE BACKDROP NEVER LOADS THE FULL-RESOLUTION ORIGINAL. EVER.
   *
   * This used to end `: src` — so when a post had no usable stored thumbnail,
   * the blurred decorative layer below fetched the **2560px original**, with
   * `loading="eager"`, ignoring the viewport entirely. A decoded 2560×1440
   * bitmap is roughly **14.7 MB of RAM**, and the feed mounts every card it has
   * ever scrolled past. That combination is the out-of-memory crash on a
   * mid-range Android phone, and this single expression was the largest part
   * of it.
   *
   * What makes it indefensible rather than merely expensive: the image is
   * `scale-125 blur-2xl brightness-[0.8]` with `imageRendering: pixelated`. It
   * is blurred into unrecognisable mush. Fourteen megabytes were being spent on
   * pixels that are deliberately destroyed before anyone sees them.
   *
   * Three thumbnail-less paths reach here routinely, so this was not an edge
   * case: realtime-inserted posts (Feed.tsx never sets `thumbnail_urls` on
   * them), any post where the thumbnail array length does not match the image
   * array, and every scheduled post (`scheduled_posts` has no thumbnail column
   * at all).
   *
   * `null` now means "no cheap source exists" — and the backdrop is simply not
   * rendered. A flat card background behind a letterboxed photo is a rounding
   * error next to a 14.7 MB decode.
   */
  const lqip = backdropFailed
    ? null
    : transformable
      ? buildLqipUrl(src)
      : thumb ?? null;
  // The sharp layer is the ORIGINAL again. The thumbnail has not been dropped —
  // it still paints the backdrop instantly, and it is the small end of the
  // srcset below, so a slot that only needs 600px still downloads only 600px.
  const sharpSrc = transformable ? buildRenderUrl(src, 800) : src;
  const srcSet = transformable ? buildSrcSet(src) : buildThumbFirstSrcSet(thumb, src);

  return (
    <>
      {/* Rendered ONLY when a cheap source exists — see the note on `lqip`.
          `fetchPriority="low"` because this is decoration competing with the
          real photo for the same connection. */}
      {lqip && (
        <img
          src={lqip}
          alt=""
          aria-hidden="true"
          className={`absolute inset-0 w-full h-full object-cover scale-125 blur-2xl brightness-[0.8] ${className ?? ""}`}
          loading="eager"
          fetchPriority="low"
          decoding="async"
          style={{ imageRendering: "pixelated" }}
          onLoad={(e) => {
            // Still measured here when it exists — this layer is EAGER and the
            // sharp one is lazy, so for a legacy photo with no dimensions in
            // its filename this is what keeps the frame from reflowing late.
            // `handleNaturalSize` takes the first answer and ignores the rest,
            // so reporting from both layers is idempotent by construction.
            const img = e.currentTarget;
            onNaturalSize?.(img.naturalWidth, img.naturalHeight);
          }}
          onError={() => setBackdropFailed(true)}
        />
      )}
      <img
        src={failed ? src : sharpSrc}
        srcSet={failed ? undefined : srcSet}
        sizes={!failed && srcSet ? FEED_SIZES : undefined}
        alt=""
        className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-500 ${loaded ? "opacity-100" : "opacity-0"} ${className ?? ""}`}
        loading="lazy"
        decoding="async"
        onLoad={(e) => {
          setLoaded(true);
          /**
           * ⚠ MEASUREMENT MOVED HERE FROM THE BACKDROP (2026-08-13).
           *
           * The backdrop used to report the intrinsic size, which made a
           * DECORATIVE layer load-bearing — it is now conditional, so it can be
           * absent entirely. This layer always renders, so the measurement can
           * never go missing.
           *
           * The ratio is what is used (`frameAspectFor(w / h)`), and every
           * transform in this file preserves aspect, so measuring the resized
           * variant gives the identical frame as measuring the original.
           */
          const img = e.currentTarget;
          onNaturalSize?.(img.naturalWidth, img.naturalHeight);
        }}
        onError={() => {
          // On the free Cloudflare plan, exceeding 5,000 unique transformations
          // in a month makes the transform endpoint return an error instead of
          // degrading — which would show a BROKEN image, not a heavy one. Fall
          // back to the untransformed original once, then give up.
          if (!failed) { setFailed(true); return; }
          setLoaded(true);
        }}
      />
    </>
  );
};

/* ── Double Tap Heart Animation ── */
const DoubleTapHeart = ({ x, y }: { x: number; y: number }) => (
  <motion.div initial={{ opacity: 1, scale: 0.5 }} animate={{ opacity: 0, scale: 1.6 }} transition={{ duration: 0.45 }} className="absolute z-20 pointer-events-none" style={{ left: x - 24, top: y - 24 }}>
    <Heart className="h-12 w-12 text-white fill-white drop-shadow-lg" />
  </motion.div>
);

/* ── Tap / Double-Tap Hook ──
 *
 * BUILD 1055. This used to be `useDoubleTap`: one tap did nothing at all, two
 * taps liked the post. The owner asked for a feed photograph to open
 * fullscreen on a tap, so this now has to separate two gestures that begin
 * identically — and a single tap must NEVER be able to fire a like.
 *
 * THE 300ms IS A REAL COST, NOT AN OVERSIGHT. A single tap cannot be resolved
 * until the double-tap window has passed, because until then it might be the
 * first half of a like. So opening the viewer is deliberately deferred by
 * 300ms — the same threshold the double-tap already used before this build.
 * The alternative, acting on the first tap immediately, would open the viewer
 * underneath every like a member gives their friends' photographs. Nobody
 * would call that faster.
 *
 * The timer is cleared on unmount: a post scrolled out of the feed inside the
 * window must not open a viewer for a photograph that is no longer on screen.
 */
function useTapOrDoubleTap(
  onDoubleTap?: (x: number, y: number) => void,
  onSingleTap?: () => void,
) {
  const lastTapRef = useRef(0);
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (pendingRef.current) clearTimeout(pendingRef.current); }, []);

  const handleTap = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      const now = Date.now();
      if (now - lastTapRef.current < 300) {
        // Second tap inside the window — this was a like all along. Cancel the
        // open that the first tap scheduled.
        if (pendingRef.current) { clearTimeout(pendingRef.current); pendingRef.current = null; }
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        let clientX: number, clientY: number;
        if ("touches" in e) { clientX = e.changedTouches?.[0]?.clientX ?? 0; clientY = e.changedTouches?.[0]?.clientY ?? 0; }
        else { clientX = e.clientX; clientY = e.clientY; }
        onDoubleTap?.(clientX - rect.left, clientY - rect.top);
        lastTapRef.current = 0;
        return;
      }
      lastTapRef.current = now;
      if (!onSingleTap) return;
      if (pendingRef.current) clearTimeout(pendingRef.current);
      pendingRef.current = setTimeout(() => { pendingRef.current = null; onSingleTap(); }, 300);
    },
    [onDoubleTap, onSingleTap],
  );
  return handleTap;
}

/* ── Single Image ── */
const SingleImagePost = ({ src, thumb, frameAspect, onNaturalSize, onDoubleTapLike, interceptFirstTap }: { src: string; thumb?: string | null; frameAspect: number; onNaturalSize?: (w: number, h: number) => void; onDoubleTapLike?: () => void; interceptFirstTap?: () => boolean }) => {
  const [heart, setHeart] = useState<{ x: number; y: number; id: number } | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const { downloading, download } = useDownloadImage();

  const handleTap = useTapOrDoubleTap(
    (x, y) => {
      setHeart({ x, y, id: Date.now() });
      onDoubleTapLike?.();
    },
    // BUILD 1055 — a single-photo feed post had NO fullscreen viewer at all
    // before this build. Tapping it did nothing; only a double tap registered.
    useCallback(() => {
      // The first tap belongs to the figures, not the viewer. See
      // `interceptFirstTap` on PostMediaProps.
      if (interceptFirstTap?.()) return;
      setLightboxOpen(true);
    }, [interceptFirstTap]),
  );

  return (
    <>
      <div className="relative group/img w-full overflow-hidden rounded-sm bg-muted/30 cursor-zoom-in" style={{ aspectRatio: String(frameAspect) }} onClick={handleTap}>
        <ProgressiveImage src={src} thumb={thumb} onNaturalSize={onNaturalSize} />
        <AnimatePresence>{heart && <DoubleTapHeart key={heart.id} x={heart.x} y={heart.y} />}</AnimatePresence>
        <DownloadButton
          downloading={downloading === src}
          onClick={(e) => { e.stopPropagation(); download(src); }}
          className="absolute bottom-3 right-3 p-2 rounded-full bg-card/80 backdrop-blur-sm text-foreground opacity-0 group-hover/img:opacity-100 transition-opacity hover:bg-card shadow-sm"
        />
      </div>
      {/* The viewer is handed the ORIGINAL url, never the 800px render copy
          the card displays. Zooming a downscaled thumbnail would magnify the
          downscale, which is the opposite of the point. */}
      <CarouselLightbox urls={[src]} currentIndex={lightboxOpen ? 0 : null} onClose={() => setLightboxOpen(false)} onNavigate={() => {}} />
    </>
  );
};

/* ── Preload helper ── */
function preloadImage(url: string | undefined) { if (!url) return; const img = new Image(); img.src = url; }

/* ── Album Carousel (Framer Motion drag) ── */
const SWIPE_THRESHOLD = 50;
const SWIPE_VELOCITY = 300;

const AlbumCarousel = ({ urls, thumbUrls, frameAspect, onNaturalSize, onDoubleTapLike, interceptFirstTap }: { urls: string[]; thumbUrls?: (string | null | undefined)[]; frameAspect: number; onNaturalSize?: (w: number, h: number) => void; onDoubleTapLike?: () => void; interceptFirstTap?: () => boolean }) => {
  const [current, setCurrent] = useState(0);
  const [direction, setDirection] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [heart, setHeart] = useState<{ x: number; y: number; id: number } | null>(null);
  const { downloading, download } = useDownloadImage();

  /**
   * A swipe ends in a click event. Without this the member would flick to the
   * next photograph and the viewer would open on top of it — the album would
   * be effectively unswipeable. Set by handleDragEnd, checked by the tap.
   */
  const swipedUntilRef = useRef(0);

  const handleTap = useTapOrDoubleTap(
    (x, y) => {
      setHeart({ x, y, id: Date.now() });
      onDoubleTapLike?.();
    },
    useCallback(() => {
      if (Date.now() < swipedUntilRef.current) return;
      // The first tap belongs to the figures, not the viewer — but only after
      // the swipe guard above, or a member paging through an album would have
      // their swipe counted as the "reveal" tap.
      if (interceptFirstTap?.()) return;
      setLightboxOpen(true);
    }, [interceptFirstTap]),
  );

  useEffect(() => {
    preloadImage(urls[(current + 1) % urls.length]);
    preloadImage(urls[(current - 1 + urls.length) % urls.length]);
  }, [current, urls]);

  const navigate = useCallback((newDir: number) => {
    setDirection(newDir);
    setCurrent((c) => { if (newDir > 0) return c < urls.length - 1 ? c + 1 : 0; return c > 0 ? c - 1 : urls.length - 1; });
  }, [urls.length]);

  const handleDragEnd = useCallback((_: unknown, info: PanInfo) => {
    const { offset, velocity } = info;
    // Anything past a few pixels was a drag, not a tap — even if it did not
    // travel far enough to page. The window covers the click that follows.
    if (Math.abs(offset.x) > 5) swipedUntilRef.current = Date.now() + 400;
    if (Math.abs(offset.x) > SWIPE_THRESHOLD || Math.abs(velocity.x) > SWIPE_VELOCITY) navigate(offset.x < 0 ? 1 : -1);
  }, [navigate]);

  const slideVariants = {
    enter: (d: number) => ({ x: d > 0 ? "100%" : "-100%", opacity: 0.5 }),
    center: { x: 0, opacity: 1 },
    exit: (d: number) => ({ x: d > 0 ? "-100%" : "100%", opacity: 0.5 }),
  };

  return (
    <>
      <div className="relative group/album w-full overflow-hidden rounded-sm bg-muted/30 cursor-zoom-in" style={{ aspectRatio: String(frameAspect) }} onClick={handleTap}>
        <AnimatePresence initial={false} custom={direction} mode="popLayout">
          <motion.div key={current} custom={direction} variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.3, ease: "easeOut" }} drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={0.15} onDragEnd={handleDragEnd} className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing">
            {/* Only slide 0 may set the frame — an album has ONE shape and it
                belongs to the first photo. Swiping must never resize the card. */}
            <ProgressiveImage src={urls[current]} thumb={thumbUrls?.[current]} onNaturalSize={current === 0 ? onNaturalSize : undefined} />
          </motion.div>
        </AnimatePresence>
        <AnimatePresence>{heart && <DoubleTapHeart key={heart.id} x={heart.x} y={heart.y} />}</AnimatePresence>

        <button onClick={(e) => { e.stopPropagation(); navigate(-1); }} className="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-card/70 backdrop-blur-sm flex items-center justify-center text-foreground opacity-0 group-hover/album:opacity-100 transition-opacity shadow-sm">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button onClick={(e) => { e.stopPropagation(); navigate(1); }} className="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-card/70 backdrop-blur-sm flex items-center justify-center text-foreground opacity-0 group-hover/album:opacity-100 transition-opacity shadow-sm">
          <ChevronRight className="h-4 w-4" />
        </button>

        <div className="absolute top-3 right-3 z-10 px-2 py-0.5 rounded-full bg-black/50 text-white text-xs font-medium">{current + 1}/{urls.length}</div>

        <DownloadButton
          downloading={downloading === urls[current]}
          onClick={(e) => { e.stopPropagation(); download(urls[current]); }}
          className="absolute bottom-3 right-3 p-2 rounded-full bg-card/80 backdrop-blur-sm text-foreground opacity-0 group-hover/album:opacity-100 transition-opacity hover:bg-card shadow-sm z-10"
        />

        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 z-10">
          {urls.map((_, i) => (
            <button key={i} onClick={(e) => { e.stopPropagation(); setDirection(i > current ? 1 : -1); setCurrent(i); }}
              className={`rounded-full transition-all ${i === current ? "w-2 h-2 bg-white" : "w-1.5 h-1.5 bg-white/50"}`} />
          ))}
        </div>
      </div>

      <CarouselLightbox urls={urls} currentIndex={lightboxOpen ? current : null} onClose={() => setLightboxOpen(false)} onNavigate={setCurrent} />
    </>
  );
};

/* ── Full-screen Lightbox ── */
interface CarouselLightboxProps { urls: string[]; currentIndex: number | null; onClose: () => void; onNavigate: (index: number) => void; }

const CarouselLightbox = ({ urls, currentIndex, onClose, onNavigate }: CarouselLightboxProps) => {
  const isOpen = currentIndex !== null;
  const { downloading, download } = useDownloadImage();
  const [zoomed, setZoomed] = useState(false);

  const goPrev = useCallback(() => { if (currentIndex === null) return; onNavigate(currentIndex > 0 ? currentIndex - 1 : urls.length - 1); }, [currentIndex, urls.length, onNavigate]);
  const goNext = useCallback(() => { if (currentIndex === null) return; onNavigate(currentIndex < urls.length - 1 ? currentIndex + 1 : 0); }, [currentIndex, urls.length, onNavigate]);

  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = "hidden";
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); if (e.key === "ArrowLeft") goPrev(); if (e.key === "ArrowRight") goNext(); };
    window.addEventListener("keydown", handleKey);
    return () => { document.body.style.overflow = ""; window.removeEventListener("keydown", handleKey); };
  }, [isOpen, onClose, goPrev, goNext]);

  return (
    <AnimatePresence>
      {isOpen && currentIndex !== null && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-sm" onClick={onClose}>
          <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
            <span className="text-sm text-white/60 mr-2">{currentIndex + 1} / {urls.length}</span>
            <DownloadButton
              downloading={downloading === urls[currentIndex]}
              onClick={(e) => { e.stopPropagation(); download(urls[currentIndex]); }}
              className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors disabled:opacity-60"
              iconSize="h-5 w-5"
            />
            <button onClick={onClose} className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>
          {urls.length > 1 && !zoomed && (
            <>
              <button onClick={(e) => { e.stopPropagation(); goPrev(); }} className="absolute left-4 md:left-8 top-1/2 -translate-y-1/2 z-10 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all">
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button onClick={(e) => { e.stopPropagation(); goNext(); }} className="absolute right-4 md:right-8 top-1/2 -translate-y-1/2 z-10 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all">
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          )}
          {/* BUILD 1055 — see the note in FacebookPhotoGrid: the transform
              lives on the photograph, the chrome above are siblings, and the
              entry animation is opacity only so nothing competes with the
              gesture for the scale property. */}
          <AnimatePresence mode="wait">
            <motion.div key={currentIndex} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="absolute inset-0 flex items-center justify-center">
              <ZoomableImage
                src={urls[currentIndex]}
                className="max-w-[95vw] max-h-[92vh] object-contain rounded-sm shadow-2xl"
                onZoomChange={setZoomed}
              />
            </motion.div>
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default PostMedia;
