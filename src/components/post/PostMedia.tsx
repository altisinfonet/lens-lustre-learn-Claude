/**
 * TAP TARGETS ON THE PHOTOGRAPH — measured, not guessed.
 *
 * The album's previous/next arrows were 32×32 and the download button 32×32,
 * both under the 44px floor and both photographed at that size in the harness
 * on 2026-08-15. They are enlarged here rather than given an invisible hit area,
 * which the owner called "fraud, button same size as before" on 2026-08-03.
 *
 * Safe to grow because every one of them is ABSOLUTELY POSITIONED over the
 * image: nothing reflows, and there is nothing beside them to collide with —
 * which is exactly what stopped the notification bell being enlarged in the
 * same pass. The glyphs inside are unchanged.
 */
import { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { CDN_HOST as LANE_CDN_HOST, SITE_ORIGIN } from "@/lib/env";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePhotoDownload } from "@/hooks/core/usePhotoDownload";
import DownloadButton from "@/components/DownloadButton";
import { useFeedPhotoGestures } from "@/components/post/useFeedPhotoGestures";
import { ladderFor } from "@/lib/media/resolvedMedia";
import { motion, AnimatePresence, type PanInfo } from "framer-motion";
import { frameAspectFor, frameAspectForUrls, parseImageDims } from "@/lib/imageFrame";
import { hasLadderMarker, isSaveTargetCreditedUrl, photoSetBlurUrl, photoSetCleanUrl, photoSetMarker, rungPath, rungPlan, rungWidthFor } from "@/lib/imageLadder";
import { useNetworkQuality } from "@/hooks/core/useNetworkQuality";
import { useDataSaver } from "@/hooks/core/useDataSaver";
import { feedPhotoSet, memberPhotoSrc, saveAsPhotoUrl } from "@/lib/photoProtection";
import { useOldPhotoCreditVersion } from "@/lib/photoOldCredit";
import { photoSaveProps } from "@/lib/photoSaveTarget";

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
  /**
   * DOUBLE-TAP / DOUBLE-CLICK on the photograph (Owner, 4 Nov 2026: like
   * Instagram). Called once per double-tap; a heart bursts on the photo only
   * when this is given. PostCard passes its one like action here.
   */
  onDoubleTapLike?: () => void;
  /**
   * A SINGLE TAP ON THE PHOTOGRAPH.
   *
   * Owner's decision, 2026-08-15: the first tap reveals the reach/viewed
   * figures. Since 4 Nov 2026 a tap opens nothing at all (there is no feed
   * viewer), so this is the only thing a single tap can do. The boolean answer
   * ("I consumed this tap") is kept for the caller's own bookkeeping.
   */
  interceptFirstTap?: () => boolean;
  /**
   * Photo plan U2 (switch `photo_set_v2`, given only while it is on): which
   * photo of an album is showing, so the card's camera line/strip can follow it.
   */
  onSlideChange?: (index: number) => void;
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
const PostMedia = ({ urls, thumbUrls, onDoubleTapLike, interceptFirstTap, onSlideChange }: PostMediaProps) => {
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
  return <AlbumCarousel urls={urls} thumbUrls={thumbUrls} frameAspect={frameAspect} onNaturalSize={needsMeasure ? handleNaturalSize : undefined} onDoubleTapLike={onDoubleTapLike} interceptFirstTap={interceptFirstTap} onSlideChange={onSlideChange} />;
};

/* ── Supabase render-endpoint helpers ──
 * Phase 1: bandwidth fix. Feed/Wall thumbnails use Supabase image transform
 * (LQIP 32px + responsive srcset 480/800/1200). Download still uses
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

/* The three definitions below are UNUSED since the removal — kept as the code
   that used to run, so the note above stays checkable against it. Safe to
   delete whenever.

   ⚠ 2026-08-22: the two hosts are now lane-derived rather than literal. They
   held the production apex origin and the production CDN host respectively —
   named in the prose above, so nothing is lost by not repeating them here.
   Left as literals they would have put both into every staging bundle: dead
   code still ships as bytes, and the isolation guard reads bytes, not
   reachability. */
const CF_ZONE_ORIGIN = SITE_ORIGIN;
const CDN_HOST = LANE_CDN_HOST;

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
 * Download is unaffected: it receives the original `urls` prop directly.
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

/**
 * Phones (≤ 430 CSS px wide) declare a 360 px slot, so a DPR-3 screen asks for
 * ~1,080 device px — Instagram's feed width — and gets the 1080 rung instead of
 * the 1440 rung or the 2–4 MB original (Owner 2026-10-29, "poor network is not
 * handled"; live median photo 438 KB, p90 1.26 MB). Tablets and the desktop
 * column are unchanged, so the 2026-08-09 softness fix stands.
 */
export const FEED_SIZES = "(max-width: 430px) 360px, (max-width: 768px) 100vw, 600px";
/**
 * OFF-3: on a slow or Data-Saver connection the browser is told the slot is
 * small, so it picks the SMALLEST rung of the same srcset (480w, or the stored
 * 600px thumbnail) instead of 800–1200w. Same images, no new URLs; the photo is
 * softer on a good screen and arrives far sooner on a bad link.
 */
export const SLOW_FEED_SIZES = "160px";

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
  const m = url.match(/-w(\d+)h(\d+)(?:-l3|-l[45]f?|-l6)?(?:-thumb)?\.[a-z0-9]+(?:[?#]|$)/i);
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
  const slowLink = useNetworkQuality().slow;
  const transformable = isTransformable(src);
  // PERF 2026-08-07: show the 600px thumbnail the uploader STORED for this
  // photo rather than the full 2560px original. `failed` (set by the sharp
  // layer's onError) falls everything back to the original, so a dead thumbnail
  // degrades to the pre-thumbnail behaviour instead of breaking. See the note
  // above usableThumb — the address is never guessed, only read.
  // S3-c: a URL from the derivative ladder carries its own 600 px thumb and srcset.
  const ladder = ladderFor(src);
  const thumb = !transformable && !failed ? (ladder?.thumb ?? usableThumb(thumbProp, src)) : null;
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
  /**
   * PHOTO PLAN U2 · BLUR PREVIEW (switch `photo_set_v2`). This backdrop is
   * already "a tiny blurred placeholder, then the real photo fades in"; U2
   * changes only WHICH file it is and WHEN it is fetched:
   *   · a new photo (-l4 / -l4f) → its 320 copy (decision 6), a fraction of the
   *     600 thumb; other CDN photos keep the stored 600 thumb; none → nothing;
   *   · if the sharp photo is ALREADY decoded from cache at mount, no
   *     placeholder is requested at all and the photo shows at once (no fade).
   *     The check runs in a layout effect, before the placeholder <img> exists
   *     and before paint, so neither a request nor a flash happens.
   * PHOTO PLAN UNIT B (audit M1/M4): decided by the FILE, never by the
   * viewer's switch — and so never frozen. U2 decided this once per mount from
   * the switch answer (`useState(initial)`), which left one card half ON, half
   * OFF whenever the answer arrived after the first paint (every cold start).
   * A set photo's name is fixed for the life of the card, so there is nothing
   * to freeze and no second request: a set photo gets its 320 placeholder and
   * the "already cached" check for every viewer; any other photo keeps today's
   * expression exactly. The frame and the srcset are untouched: no layout shift.
   */
  const setPhoto = !!photoSetMarker(src);
  const sharpRef = useRef<HTMLImageElement | null>(null);
  // set photos only: null = not checked yet (no placeholder yet), true = sharp photo was already cached.
  const [cached, setCached] = useState<boolean | null>(null);
  useLayoutEffect(() => {
    if (!setPhoto) return;
    const img = sharpRef.current;
    const ready = !!img && img.complete && img.naturalWidth > 0;
    if (ready) setLoaded(true);
    setCached(ready);
  }, [setPhoto]);
  // Not a set photo: exactly the pre-U2 expression. Credit fix U1: a set photo is
  // never transformed from its own URL (a `-l4` URL is the credited master).
  const blurByUrl = transformable && !setPhoto;
  const lqip = backdropFailed || (setPhoto && cached !== false)
    ? null
    : blurByUrl
      ? buildLqipUrl(src)
      : (setPhoto ? photoSetBlurUrl(src) : null) ?? thumb ?? null;
  // The sharp layer is the ORIGINAL again. The thumbnail has not been dropped —
  // it still paints the backdrop instantly, and it is the small end of the
  // srcset below, so a slot that only needs 600px still downloads only 600px.
  /**
   * PHOTO PLAN U4 (switch `photo_set_v2`; Unit B: read live, never frozen):
   *   · a new photo (-l4 / -l4f) → its 600 + 1080 copies, src = 1080 — the
   *     feed keeps 1080; the credited 2048 is for full screen only;
   *   · "Save mobile data" on mobile data → one size down: the 600 copy alone,
   *     and old photos are told the slot is small (SLOW_FEED_SIZES → their 600).
   * Switch off: `v2Set` is null and `saving` false — exactly the pre-U4 render.
   */
  const saving = useDataSaver().saving;
  // Unit A (audit B1): a SET photo's copies are chosen by its file name for
  // EVERY viewer — signed out, switch answer not in yet, switch off — because
  // the name says which file carries the credit (a `-l4` URL is the credited
  // 2048 itself). Only "Save mobile data" stays behind the switch (useDataSaver
  // answers false while the switch is off or unknown).
  const v2Set = feedPhotoSet(src, saving);
  // Credit fix U1 (review of #874): a set photo WITHOUT widths in its name
  // (feedPhotoSet null) still never paints its own URL raw or transformed — a
  // `-l4` URL is the credited master — but its clean copy, with no srcset.
  const sharpSrc = v2Set ? v2Set.src : setPhoto ? (memberPhotoSrc(src, saving ? 600 : 1080) ?? src) : transformable ? buildRenderUrl(src, 800) : src;
  let srcSet: string | undefined = transformable ? buildSrcSet(src) : buildThumbFirstSrcSet(thumb, src);
  if (ladder) srcSet = ladder.srcSet; // S3-c: 600/1080/1440 derivatives, never the original
  if (v2Set) srcSet = v2Set.srcSet;
  else if (setPhoto) srcSet = undefined;
  // A set copy that fails falls back to the set's largest CLEAN copy — never a
  // credited file, never a competition full size (Unit A).
  const failSrc = setPhoto ? photoSetCleanUrl(src) : src;
  // Fault 2 (Owner, 3 Nov): a web right-click / long-press "save image" on the
  // feed photo gets the CREDITED copy; the screen keeps the clean one. Armed
  // only at that moment (src/lib/photoSaveTarget.ts), so scrolling never
  // downloads a credited file. Stable per photo (a long-press timer must
  // survive a re-render). An OLD photo (no set marker) gets its credited copy
  // once the lookup answers (20261110_0109, photoOldCredit.ts) — the version
  // makes this photo re-render then.
  useOldPhotoCreditVersion();
  const saveTarget = saveAsPhotoUrl(src);
  const saveProps = useMemo(() => photoSaveProps(src, saveTarget), [src, saveTarget]); // -l6: credit drawn on save

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
        ref={sharpRef}
        {...saveProps}
        src={failed ? failSrc : sharpSrc}
        srcSet={failed ? undefined : srcSet}
        sizes={!failed && srcSet ? (slowLink || saving ? SLOW_FEED_SIZES : FEED_SIZES) : undefined}
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
        onError={(e) => {
          // A missing credited save file: armCreditedSave puts the clean copy back.
          if (isSaveTargetCreditedUrl(e.currentTarget.getAttribute("src") ?? "")) return;
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

/* ── Gestures ──
 *
 * Owner order, 4 Nov 2026 — "exactly like Instagram": a tap opens NOTHING (the
 * feed viewer that BUILD 1055 added is gone, web and app), a double-tap likes
 * with a heart, two fingers pinch the photograph in place. All of it lives in
 * the ONE shared hook, src/components/post/useFeedPhotoGestures.tsx; both
 * renderers below use it and neither has a tap or touch handler of its own.
 * `touch-action: pan-x pan-y` on the frame keeps one-finger scrolling with the
 * browser and stops the browser's own pinch/double-tap page zoom from starting
 * on a photograph (the app already sets the same rule on <html>).
 */
const FRAME_TOUCH = { touchAction: "pan-x pan-y" } as const;

/* ── Single Image ── */
const SingleImagePost = ({ src, thumb, frameAspect, onNaturalSize, onDoubleTapLike, interceptFirstTap }: { src: string; thumb?: string | null; frameAspect: number; onNaturalSize?: (w: number, h: number) => void; onDoubleTapLike?: () => void; interceptFirstTap?: () => boolean }) => {
  // U3: posts are member photos — with photo_set_v2 on, nobody is offered download. Off: today.
  const { canDownload, downloading, download } = usePhotoDownload(false);
  // A single tap only ever reveals the figures (see `interceptFirstTap`); it opens nothing.
  const gestures = useFeedPhotoGestures({ onDoubleTap: onDoubleTapLike, onSingleTap: useCallback(() => { interceptFirstTap?.(); }, [interceptFirstTap]) });

  return (
    <div ref={gestures.frameRef} data-feed-photo="" className="relative group/img w-full overflow-hidden rounded-sm bg-muted/30 select-none" style={{ aspectRatio: String(frameAspect), ...FRAME_TOUCH }} onClick={gestures.onClick}>
      <ProgressiveImage src={src} thumb={thumb} onNaturalSize={onNaturalSize} />
      {gestures.heart}
      {canDownload && (
        <DownloadButton
          downloading={downloading === src}
          onClick={(e) => { e.stopPropagation(); download(src); }}
          className="absolute bottom-3 right-3 grid h-11 w-11 place-items-center rounded-full bg-card/80 backdrop-blur-sm text-foreground opacity-0 group-hover/img:opacity-100 transition-opacity hover:bg-card shadow-sm"
        />
      )}
    </div>
  );
};

/* ── Preload helper ── */
function preloadImage(url: string | undefined) { if (!url) return; const img = new Image(); img.src = url; }

/* ── Album Carousel (Framer Motion drag) ── */
const SWIPE_THRESHOLD = 50;
const SWIPE_VELOCITY = 300;

const AlbumCarousel = ({ urls, thumbUrls, frameAspect, onNaturalSize, onDoubleTapLike, interceptFirstTap, onSlideChange }: { urls: string[]; thumbUrls?: (string | null | undefined)[]; frameAspect: number; onNaturalSize?: (w: number, h: number) => void; onDoubleTapLike?: () => void; interceptFirstTap?: () => boolean; onSlideChange?: (index: number) => void }) => {
  const [current, setCurrent] = useState(0);
  const [direction, setDirection] = useState(0);
  const { canDownload, downloading, download } = usePhotoDownload(false); // U3: see SingleImagePost

  /**
   * A swipe ends in a click event. Without this a member flicking to the next
   * photograph would have that flick counted as the "reveal" tap. Set by
   * handleDragEnd, checked by the tap.
   */
  const swipedUntilRef = useRef(0);

  const gestures = useFeedPhotoGestures({
    onDoubleTap: onDoubleTapLike,
    onSingleTap: useCallback(() => {
      if (Date.now() < swipedUntilRef.current) return;
      interceptFirstTap?.();
    }, [interceptFirstTap]),
  });

  useEffect(() => {
    preloadImage(urls[(current + 1) % urls.length]);
    preloadImage(urls[(current - 1 + urls.length) % urls.length]);
  }, [current, urls]);

  // U2: the card's camera line/strip follows the slide (wired only while photo_set_v2 is on).
  useEffect(() => { onSlideChange?.(current); }, [current, onSlideChange]);

  const navigate = useCallback((newDir: number) => {
    setDirection(newDir);
    setCurrent((c) => { if (newDir > 0) return c < urls.length - 1 ? c + 1 : 0; return c > 0 ? c - 1 : urls.length - 1; });
  }, [urls.length]);

  const { pinchActive } = gestures;
  const handleDragEnd = useCallback((_: unknown, info: PanInfo) => {
    const { offset, velocity } = info;
    // Anything past a few pixels was a drag, not a tap — even if it did not
    // travel far enough to page. The window covers the click that follows.
    if (Math.abs(offset.x) > 5) swipedUntilRef.current = Date.now() + 400;
    // The first finger of a pinch also drags the slide; a pinch never pages.
    if (pinchActive()) return;
    if (Math.abs(offset.x) > SWIPE_THRESHOLD || Math.abs(velocity.x) > SWIPE_VELOCITY) navigate(offset.x < 0 ? 1 : -1);
  }, [navigate, pinchActive]);

  const slideVariants = {
    enter: (d: number) => ({ x: d > 0 ? "100%" : "-100%", opacity: 0.5 }),
    center: { x: 0, opacity: 1 },
    exit: (d: number) => ({ x: d > 0 ? "-100%" : "100%", opacity: 0.5 }),
  };

  return (
    <div ref={gestures.frameRef} data-feed-photo="" className="relative group/album w-full overflow-hidden rounded-sm bg-muted/30 select-none" style={{ aspectRatio: String(frameAspect), ...FRAME_TOUCH }} onClick={gestures.onClick}>
      <AnimatePresence initial={false} custom={direction} mode="popLayout">
        <motion.div key={current} custom={direction} variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.3, ease: "easeOut" }} drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={0.15} onDragEnd={handleDragEnd} className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing">
          {/* Only slide 0 may set the frame — an album has ONE shape and it
              belongs to the first photo. Swiping must never resize the card. */}
          <ProgressiveImage src={urls[current]} thumb={thumbUrls?.[current]} onNaturalSize={current === 0 ? onNaturalSize : undefined} />
        </motion.div>
      </AnimatePresence>
      {gestures.heart}

      {/* F-D3-10: named buttons (axe button-name). */}
      <button onClick={(e) => { e.stopPropagation(); navigate(-1); }} aria-label="Previous photo" className="absolute left-2 top-1/2 -translate-y-1/2 z-10 h-11 w-11 rounded-full bg-card/70 backdrop-blur-sm flex items-center justify-center text-foreground opacity-0 group-hover/album:opacity-100 transition-opacity shadow-sm">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button onClick={(e) => { e.stopPropagation(); navigate(1); }} aria-label="Next photo" className="absolute right-2 top-1/2 -translate-y-1/2 z-10 h-11 w-11 rounded-full bg-card/70 backdrop-blur-sm flex items-center justify-center text-foreground opacity-0 group-hover/album:opacity-100 transition-opacity shadow-sm">
        <ChevronRight className="h-4 w-4" />
      </button>

      <div data-pinch-hide="" className="absolute top-3 right-3 z-10 px-2 py-0.5 rounded-full bg-black/50 text-white text-xs font-medium">{current + 1}/{urls.length}</div>

      {canDownload && (
        <DownloadButton
          downloading={downloading === urls[current]}
          onClick={(e) => { e.stopPropagation(); download(urls[current]); }}
          className="absolute bottom-3 right-3 grid h-11 w-11 place-items-center rounded-full bg-card/80 backdrop-blur-sm text-foreground opacity-0 group-hover/album:opacity-100 transition-opacity hover:bg-card shadow-sm z-10"
        />
      )}

      {/* THE DOTS ARE AN INDICATOR, CLOSE TOGETHER (Owner, 3 Nov 2026: "the
          slider dots have a huge gap"). From 16 Aug (5c4420ae) each dot sat in
          its own 44x32 tap box with no gap, so the dots were 44px apart. The
          album is already navigable without them — Previous / Next buttons
          (44px, keyboard and screen reader), the "1/3" counter and swipe — so
          the dots go back to what Instagram draws: 6px / 8px dots, 6px apart,
          centre line 16px above the image edge as before, hidden from
          assistive tech (the counter says the same thing), no tap target. */}
      <div data-slider-dots="" aria-hidden="true" className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 flex h-2 items-center gap-1.5 z-10">
        {urls.map((_, i) => (
          <span key={i} className={`rounded-full transition-all ${i === current ? "w-2 h-2 bg-white" : "w-1.5 h-1.5 bg-white/50"}`} />
        ))}
      </div>
    </div>
  );
};

export default PostMedia;

