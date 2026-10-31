import { useState, useEffect, useRef } from "react";

/**
 * Progressive image loading hook.
 * Returns loading state and supports IntersectionObserver-based staggered loading.
 */
export function useProgressiveImage(src: string, eager = false) {
  const [loaded, setLoaded] = useState(false);
  const [inView, setInView] = useState(eager);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (eager) {
      setInView(true);
      return;
    }

    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px 0px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [eager]);

  useEffect(() => {
    if (!inView || !src) return;
    setLoaded(false);
    const img = new Image();
    img.src = src;
    if (img.complete) {
      setLoaded(true);
      return;
    }
    img.onload = () => setLoaded(true);
    img.onerror = () => setLoaded(true);
  }, [inView, src]);

  return { ref, loaded, inView };
}

/**
 * Generate a tiny dominant-color SVG as a data URI placeholder.
 * Uses the category to pick a muted tone — fast, no network request.
 */
const categoryColors: Record<string, string> = {
  Portrait: "hsl(25 15% 30%)",
  Wildlife: "hsl(120 12% 28%)",
  Street: "hsl(35 10% 32%)",
  Aerial: "hsl(200 18% 35%)",
  Action: "hsl(15 20% 30%)",
  Landscape: "hsl(195 15% 30%)",
  "Fine Art": "hsl(280 10% 28%)",
  Documentary: "hsl(40 12% 30%)",
  General: "hsl(220 10% 30%)",
};

export function getPlaceholderColor(category: string): string {
  return categoryColors[category] || categoryColors.General;
}

/**
 * Generate srcset for Supabase-hosted images with multiple widths.
 */
export function generateSrcSet(
  url: string,
  widths: number[] = [320, 480, 640, 960]
): string {
  if (!url.includes("/storage/v1/object/public/")) return "";

  const [baseUrl, queryString] = url.split("?");
  const transformedBase = baseUrl.replace(
    "/storage/v1/object/public/",
    "/storage/v1/render/image/public/"
  );

  return widths
    .map((w) => {
      const params = new URLSearchParams(queryString || "");
      params.set("width", String(w));
      params.set("quality", "60");
      params.set("format", "webp");
      return `${transformedBase}?${params.toString()} ${w}w`;
    })
    .join(", ");
}
