import { useState, useCallback, useEffect, useRef } from "react";
import { X, ChevronLeft, ChevronRight, Heart } from "lucide-react";
import { useDownloadImage } from "@/hooks/core/useDownloadImage";
import DownloadButton from "@/components/DownloadButton";
import { motion, AnimatePresence, type PanInfo } from "framer-motion";

interface PostMediaProps {
  urls: string[];
  onDoubleTapLike?: () => void;
}

const PostMedia = ({ urls, onDoubleTapLike }: PostMediaProps) => {
  if (urls.length === 0) return null;
  if (urls.length === 1) return <SingleImagePost src={urls[0]} onDoubleTapLike={onDoubleTapLike} />;
  return <AlbumCarousel urls={urls} onDoubleTapLike={onDoubleTapLike} />;
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

function isTransformable(url: string): boolean {
  if (!url || url.startsWith("data:") || url.startsWith("blob:")) return false;
  if (SUPABASE_RENDER_RE.test(url)) return false; // already transformed
  if (!SUPABASE_PUBLIC_RE.test(url)) return false;
  if (/\.(gif|svg)(\?|$)/i.test(url)) return false; // preserve animation/vector
  return true;
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

function buildSrcSet(url: string): string | undefined {
  if (!isTransformable(url)) return undefined;
  return [480, 800, 1200].map((w) => `${buildRenderUrl(url, w)} ${w}w`).join(", ");
}

const FEED_SIZES = "(max-width: 768px) 100vw, 600px";

/* ── Progressive Image (Phase 1: LQIP + srcset) ── */
const ProgressiveImage = ({ src, className }: { src: string; className?: string }) => {
  const [loaded, setLoaded] = useState(false);
  const transformable = isTransformable(src);
  const lqip = transformable ? buildLqipUrl(src) : src;
  const sharpSrc = transformable ? buildRenderUrl(src, 800) : src;
  const srcSet = buildSrcSet(src);

  return (
    <>
      <img
        src={lqip}
        alt=""
        aria-hidden="true"
        className={`absolute inset-0 w-full h-full object-cover scale-105 blur-md transition-opacity duration-500 ${loaded ? "opacity-0" : "opacity-100"} ${className ?? ""}`}
        loading="eager"
        decoding="async"
        style={{ imageRendering: "pixelated" }}
      />
      <img
        src={sharpSrc}
        srcSet={srcSet}
        sizes={srcSet ? FEED_SIZES : undefined}
        alt=""
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${loaded ? "opacity-100" : "opacity-0"} ${className ?? ""}`}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
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
const SingleImagePost = ({ src, onDoubleTapLike }: { src: string; onDoubleTapLike?: () => void }) => {
  const [heart, setHeart] = useState<{ x: number; y: number; id: number } | null>(null);
  const { downloading, download } = useDownloadImage();

  const handleDoubleTap = useDoubleTap((x, y) => {
    setHeart({ x, y, id: Date.now() });
    onDoubleTapLike?.();
  });

  return (
    <div className="relative group/img w-full overflow-hidden rounded-sm bg-muted/30" style={{ aspectRatio: "4/5" }} onClick={handleDoubleTap}>
      <ProgressiveImage src={src} />
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

const AlbumCarousel = ({ urls, onDoubleTapLike }: { urls: string[]; onDoubleTapLike?: () => void }) => {
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
      <div className="relative group/album w-full overflow-hidden rounded-sm bg-muted/30" style={{ aspectRatio: "4/5" }} onClick={handleDoubleTap}>
        <AnimatePresence initial={false} custom={direction} mode="popLayout">
          <motion.div key={current} custom={direction} variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.3, ease: "easeOut" }} drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={0.15} onDragEnd={handleDragEnd} className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing">
            <ProgressiveImage src={urls[current]} />
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
