/**
 * ONE COVER PICTURE FOR EVERY COURSE, ARTICLE, COMPETITION AND FEATURED ARTIST.
 *
 * Owner, 2026-11-10 (app, signed out, slow connection): the course card cover
 * was "a big empty dark block". Measured: every page drew its cover as a plain
 * <img> of the FULL original (357 KB for a 1918px course cover) with
 * `loading="lazy"`, no background, no right-sized copy. On a slow link the slot
 * stayed the card's dark background for seconds.
 *
 * Central control (Owner, 2026-11-04): the fix lives here once, and
 * coverAndChipRowGate.test.ts fails if a page draws `cover_image_url` itself again.
 *
 *  - a muted placeholder behind the picture, so the slot is never "empty";
 *  - a right-sized copy from OUR CDN via lib/cdnImage (`srcset` + `sizes`), with
 *    `originalOnError` — if the transformer ever fails the original loads, never
 *    nothing (see the August story at the top of cdnImage.ts). Other hosts
 *    (Unsplash) are left exactly as they are;
 *  - `priority` for the first cover on a page: eager + fetchpriority high.
 *
 * It renders only the <img>; the caller keeps its own box (aspect, rounding).
 * NOT for a carousel that unmounts every few seconds — see PhotoOfTheDay.tsx.
 */
import { cdnSrcSet, originalOnError } from "@/lib/cdnImage";
import { cn } from "@/lib/utils";

const WIDTHS = [400, 640, 960, 1280];

export interface CoverImageProps {
  src: string;
  alt: string;
  className?: string;
  /** How wide the slot is, for the browser's pick from srcset. */
  sizes?: string;
  /** The first, above-the-fold cover on the page. */
  priority?: boolean;
}

export default function CoverImage({ src, alt, className, sizes = "(min-width: 768px) 50vw, 100vw", priority = false }: CoverImageProps) {
  const srcSet = cdnSrcSet(src, WIDTHS);
  return (
    <img
      src={src}
      srcSet={srcSet || undefined}
      sizes={srcSet ? sizes : undefined}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={priority ? "high" : "auto"}
      onError={srcSet ? originalOnError(src) : undefined}
      data-cover-image=""
      className={cn("bg-muted", className)}
    />
  );
}
