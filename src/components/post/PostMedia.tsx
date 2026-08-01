import { useState, useCallback, useEffect, useRef } from "react";
import { X, ChevronLeft, ChevronRight, Heart } from "lucide-react";
import { useDownloadImage } from "@/hooks/core/useDownloadImage";
import DownloadButton from "@/components/DownloadButton";
import { motion, AnimatePresence, type PanInfo } from "framer-motion";
import { frameAspectFor, frameAspectForUrls, parseImageDims } from "@/lib/imageFrame";

interface PostMediaProps {
  urls: string[];
  onDoubleTapLike?: () => void;
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
const PostMedia = ({ urls, onDoubleTapLike }: PostMediaProps) => {
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
    return <SingleImagePost src={first} frameAspect={frameAspect} onNaturalSize={needsMeasure ? handleNaturalSize : undefined} onDoubleTapLike={onDoubleTapLike} />;
  }
  return <AlbumCarousel urls={urls} frameAspect={frameAspect} onNaturalSize={needsMeasure ? handleNaturalSize : undefined} onDoubleTapLike={onDoubleTapLike} />;
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

/* ── Cloudflare Transformations (2026-08-01) ──
 * Post images live on cdn.50mmretina.com (R2), NOT Supabase storage, so the
 * Supabase render endpoint above never matched them and every feed card was
 * downloading the FULL 2560px original. Measured on production: five visible
 * photos = 3,450 KB, every one displayed at 588px.
 *
 * Cloudflare Transformations is now enabled on the 50mmretina.com zone, so the
 * same five photos come back as AVIF at 800px for 383 KB — 89% less. It also
 * fixes every photo ever posted, retroactively, with no re-upload.
 *
 * TWO THINGS THAT WILL BREAK THIS IF CHANGED CARELESSLY:
 *
 * 1. The base MUST be the hard-coded zone origin, never `location.origin`.
 *    Inside the Android (Capacitor) app the origin is a local scheme, and
 *    `location.origin + "/cdn-cgi/..."` would 404 on every image in the app
 *    while looking perfect on web.
 * 2. /cdn-cgi/image/ responses carry NO CORS headers. That is fine for <img>,
 *    but anything that FETCHES an image — the download button, canvas
 *    re-encoding — must keep using the untransformed URL. It already does.
 */
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
  return isCdnImage(url) || SUPABASE_PUBLIC_RE.test(url);
}

function buildRenderUrl(url: string, width: number, quality = 70): string {
  if (isCdnImage(url)) return buildCfUrl(url, width, quality);
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

function buildSrcSet(url: string): string | undefined {
  if (!isTransformable(url)) return undefined;
  return [480, 800, 1200].map((w) => `${buildRenderUrl(url, w)} ${w}w`).join(", ");
}

const FEED_SIZES = "(max-width: 768px) 100vw, 600px";

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
  className,
  onNaturalSize,
}: {
  src: string;
  className?: string;
  /** Reports the intrinsic size of the backdrop copy — see PostMedia's header. */
  onNaturalSize?: (width: number, height: number) => void;
}) => {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [backdropFailed, setBackdropFailed] = useState(false);
  const transformable = isTransformable(src);
  const lqip = transformable && !backdropFailed ? buildLqipUrl(src) : src;
  const sharpSrc = transformable ? buildRenderUrl(src, 800) : src;
  const srcSet = buildSrcSet(src);

  return (
    <>
      <img
        src={lqip}
        alt=""
        aria-hidden="true"
        className={`absolute inset-0 w-full h-full object-cover scale-125 blur-2xl brightness-[0.8] ${className ?? ""}`}
        loading="eager"
        decoding="async"
        style={{ imageRendering: "pixelated" }}
        onLoad={(e) => {
          const img = e.currentTarget;
          onNaturalSize?.(img.naturalWidth, img.naturalHeight);
        }}
        onError={() => setBackdropFailed(true)}
      />
      <img
        src={failed ? src : sharpSrc}
        srcSet={failed ? undefined : srcSet}
        sizes={!failed && srcSet ? FEED_SIZES : undefined}
        alt=""
        className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-500 ${loaded ? "opacity-100" : "opacity-0"} ${className ?? ""}`}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
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

/* ── Double Tap Hook ── */
function useDoubleTap(onDoubleTap?: (x: number, y: number) => void) {
  const lastTapRef = useRef(0);
  const handleTap = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      const now = Date.now();
      if (now - lastTapRef.current < 300) {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        let clientX: number, clientY: number;
        if ("touches" in e) { clientX = e.changedTouches?.[0]?.clientX ?? 0; clientY = e.changedTouches?.[0]?.clientY ?? 0; }
        else { clientX = e.clientX; clientY = e.clientY; }
        onDoubleTap?.(clientX - rect.left, clientY - rect.top);
        lastTapRef.current = 0;
      } else { lastTapRef.current = now; }
    },
    [onDoubleTap],
  );
  return handleTap;
}

/* ── Single Image ── */
const SingleImagePost = ({ src, frameAspect, onNaturalSize, onDoubleTapLike }: { src: string; frameAspect: number; onNaturalSize?: (w: number, h: number) => void; onDoubleTapLike?: () => void }) => {
  const [heart, setHeart] = useState<{ x: number; y: number; id: number } | null>(null);
  const { downloading, download } = useDownloadImage();

  const handleDoubleTap = useDoubleTap((x, y) => {
    setHeart({ x, y, id: Date.now() });
    onDoubleTapLike?.();
  });

  return (
    <div className="relative group/img w-full overflow-hidden rounded-sm bg-muted/30" style={{ aspectRatio: String(frameAspect) }} onClick={handleDoubleTap}>
      <ProgressiveImage src={src} onNaturalSize={onNaturalSize} />
      <AnimatePresence>{heart && <DoubleTapHeart key={heart.id} x={heart.x} y={heart.y} />}</AnimatePresence>
      <DownloadButton
        downloading={downloading === src}
        onClick={(e) => { e.stopPropagation(); download(src); }}
        className="absolute bottom-3 right-3 p-2 rounded-full bg-card/80 backdrop-blur-sm text-foreground opacity-0 group-hover/img:opacity-100 transition-opacity hover:bg-card shadow-sm"
      />
    </div>
  );
};

/* ── Preload helper ── */
function preloadImage(url: string | undefined) { if (!url) return; const img = new Image(); img.src = url; }

/* ── Album Carousel (Framer Motion drag) ── */
const SWIPE_THRESHOLD = 50;
const SWIPE_VELOCITY = 300;

const AlbumCarousel = ({ urls, frameAspect, onNaturalSize, onDoubleTapLike }: { urls: string[]; frameAspect: number; onNaturalSize?: (w: number, h: number) => void; onDoubleTapLike?: () => void }) => {
  const [current, setCurrent] = useState(0);
  const [direction, setDirection] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [heart, setHeart] = useState<{ x: number; y: number; id: number } | null>(null);
  const { downloading, download } = useDownloadImage();

  const handleDoubleTap = useDoubleTap((x, y) => {
    setHeart({ x, y, id: Date.now() });
    onDoubleTapLike?.();
  });

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
    if (Math.abs(offset.x) > SWIPE_THRESHOLD || Math.abs(velocity.x) > SWIPE_VELOCITY) navigate(offset.x < 0 ? 1 : -1);
  }, [navigate]);

  const slideVariants = {
    enter: (d: number) => ({ x: d > 0 ? "100%" : "-100%", opacity: 0.5 }),
    center: { x: 0, opacity: 1 },
    exit: (d: number) => ({ x: d > 0 ? "-100%" : "100%", opacity: 0.5 }),
  };

  return (
    <>
      <div className="relative group/album w-full overflow-hidden rounded-sm bg-muted/30" style={{ aspectRatio: String(frameAspect) }} onClick={handleDoubleTap}>
        <AnimatePresence initial={false} custom={direction} mode="popLayout">
          <motion.div key={current} custom={direction} variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.3, ease: "easeOut" }} drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={0.15} onDragEnd={handleDragEnd} className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing">
            {/* Only slide 0 may set the frame — an album has ONE shape and it
                belongs to the first photo. Swiping must never resize the card. */}
            <ProgressiveImage src={urls[current]} onNaturalSize={current === 0 ? onNaturalSize : undefined} />
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
          {urls.length > 1 && (
            <>
              <button onClick={(e) => { e.stopPropagation(); goPrev(); }} className="absolute left-4 md:left-8 top-1/2 -translate-y-1/2 z-10 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all">
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button onClick={(e) => { e.stopPropagation(); goNext(); }} className="absolute right-4 md:right-8 top-1/2 -translate-y-1/2 z-10 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all">
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          )}
          <AnimatePresence mode="wait">
            <motion.img key={currentIndex} src={urls[currentIndex]} alt="" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.2 }} className="max-w-[95vw] max-h-[92vh] object-contain rounded-sm shadow-2xl" onClick={(e) => e.stopPropagation()} />
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default PostMedia;
