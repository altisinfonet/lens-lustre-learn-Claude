import { memo, useEffect, useRef, useState } from "react";
import { cdnSrcSet, originalOnError } from "@/lib/cdnImage";

interface OptimizedImageProps {
  src: string;
  alt: string;
  className?: string;
  loading?: "lazy" | "eager";
  fetchPriority?: "high" | "low" | "auto";
  sizes?: string;
  /** Optional 256px low-quality placeholder URL shown until in-viewport */
  placeholder?: string;
  /**
   * Opt-in (2026-11-10, covers): right-sized copies from OUR CDN at these
   * widths, as `srcset` + `sizes`, with the original as the onError fallback
   * (lib/cdnImage.ts rules). Other hosts are untouched. NOT for a carousel that
   * unmounts every few seconds (Stories, PhotoOfTheDay) — a size the CDN has
   * not made yet can lose that race; see PhotoOfTheDay.tsx.
   */
  srcSetWidths?: number[];
}

/**
 * Renders a <picture> with WebP source + JPG fallback.
 * Step 7: IntersectionObserver-gated lazy <img> with native fallback.
 *  - Eager images load immediately.
 *  - Lazy images render a 256px placeholder (provided or auto-derived from
 *    Supabase render endpoint) until they intersect the viewport, then swap
 *    to the full source. Native `loading="lazy"` + `decoding="async"` remain
 *    in place as a browser-level safety net.
 */

const ROOT_MARGIN = "200px";

/** Auto-derive a 256px Supabase render-endpoint placeholder when possible. */
function derivePlaceholder(src: string): string | null {
  try {
    const u = new URL(src, window.location.origin);
    const m = u.pathname.match(/^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
    if (!m) return null;
    const params = new URLSearchParams({
      width: "256", height: "256", resize: "contain", quality: "40", format: "webp",
    });
    return `${u.origin}/storage/v1/render/image/public/${m[1]}/${m[2]}?${params}`;
  } catch {
    return null;
  }
}

const OptimizedImage = memo(({
  src,
  alt,
  className,
  loading = "lazy",
  fetchPriority = "auto",
  sizes,
  placeholder,
  srcSetWidths,
}: OptimizedImageProps) => {
  const eager = loading === "eager";
  const ref = useRef<HTMLImageElement | null>(null);
  const [visible, setVisible] = useState(eager);

  useEffect(() => {
    if (eager || visible) return;
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisible(true);
            io.disconnect();
            break;
          }
        }
      },
      { rootMargin: ROOT_MARGIN },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [eager, visible]);

  const lqip = placeholder ?? (eager ? null : derivePlaceholder(src));
  const effectiveSrc = visible ? src : (lqip ?? src);
  const webpSrc = effectiveSrc.replace(/\.(jpg|jpeg|png)$/i, ".webp");
  const isLocalImage = src.startsWith("/images/");
  // "" unless asked for AND the file is on our CDN (cdnSrcSet returns "" otherwise).
  const cdnSet = srcSetWidths ? cdnSrcSet(src, srcSetWidths) : "";

  if (!isLocalImage) {
    return (
      <img
        ref={ref}
        src={effectiveSrc}
        srcSet={cdnSet || undefined}
        sizes={cdnSet ? sizes ?? "100vw" : undefined}
        onError={cdnSet ? originalOnError(src) : undefined}
        alt={alt}
        className={className}
        loading={loading}
        decoding="async"
        fetchPriority={fetchPriority}
      />
    );
  }

  return (
    <picture>
      {visible && <source srcSet={webpSrc} type="image/webp" sizes={sizes} />}
      <img
        ref={ref}
        src={effectiveSrc}
        alt={alt}
        className={className}
        loading={loading}
        fetchPriority={fetchPriority}
        decoding="async"
      />
    </picture>
  );
});

OptimizedImage.displayName = "OptimizedImage";

export default OptimizedImage;
