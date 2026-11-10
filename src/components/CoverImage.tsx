/**
 * ONE COVER PICTURE FOR COURSES, ARTICLES AND COMPETITIONS.
 *
 * Owner, 2026-11-10 (app, signed out, slow connection): the course card cover
 * was "a big empty dark block". Measured: every page drew its cover as a plain
 * <img> of the FULL original (357 KB for a 1918px course cover) with
 * `loading="lazy"`, no background, no right-sized copy. On a slow link the slot
 * stayed the card's dark background for seconds.
 *
 * Central control (Owner, 2026-11-04): the cover RULES live here once, and the
 * picture itself is drawn by the shared OptimizedImage (the no-bare-img ratchet
 * keeps pages off raw <img>); coverAndChipRowGate.test.ts fails if a page draws
 * `cover_image_url` itself again.
 *  - a muted placeholder behind the picture, so the slot is never "empty";
 *  - right-sized copies from OUR CDN (`srcSetWidths`), original as fallback;
 *  - `priority` for the first, above-the-fold cover: eager + fetchpriority high.
 *
 * It renders only the picture; the caller keeps its own box (aspect, rounding).
 */
import OptimizedImage from "@/components/OptimizedImage";
import { cn } from "@/lib/utils";

const COVER_WIDTHS = [400, 640, 960, 1280];

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
  return (
    <OptimizedImage
      src={src}
      alt={alt}
      sizes={sizes}
      srcSetWidths={COVER_WIDTHS}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      className={cn("bg-muted", className)}
    />
  );
}
