import { memo, useRef, useState, useEffect } from "react";
import { getPlaceholderColor, generateSrcSet } from "@/hooks/core/useProgressiveImage";

interface GalleryImageProps {
  src: string;
  alt: string;
  category: string;
  className?: string;
  eager?: boolean;
  fetchPriority?: "high" | "low" | "auto";
  sizes?: string;
  optimizeUrl: (url: string, isHero: boolean) => string;
  isHero?: boolean;
}

/**
 * Progressive gallery image with:
 * - Dominant-color placeholder background
 * - IntersectionObserver-based lazy loading (200px margin)
 * - srcset for responsive delivery
 * - Smooth fade-in on load
 */
const GalleryImage = memo(({
  src,
  alt,
  category,
  className = "",
  eager = false,
  fetchPriority = "auto",
  sizes,
  optimizeUrl,
  isHero = false,
}: GalleryImageProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(eager);
  const [loaded, setLoaded] = useState(false);

  const placeholderColor = getPlaceholderColor(category);
  const optimizedSrc = optimizeUrl(src, isHero);
  const srcSet = generateSrcSet(src, isHero ? [640, 960, 1280] : [320, 480, 640]);

  useEffect(() => {
    if (eager) { setInView(true); return; }
    const el = containerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setInView(true); obs.disconnect(); } },
      { rootMargin: "300px 0px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [eager]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{ backgroundColor: placeholderColor }}
    >
      {inView && (
        <img
          src={optimizedSrc}
          srcSet={srcSet || undefined}
          sizes={sizes}
          alt={alt}
          className={`${className} transition-opacity duration-500 ${loaded ? "opacity-100" : "opacity-0"}`}
          loading={eager ? "eager" : "lazy"}
          fetchPriority={fetchPriority}
          decoding={eager ? "auto" : "async"}
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(true)}
        />
      )}
    </div>
  );
});

GalleryImage.displayName = "GalleryImage";
export default GalleryImage;
