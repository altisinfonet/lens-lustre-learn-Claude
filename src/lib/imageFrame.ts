/**
 * IMAGE FRAME — how tall or wide a photo's card is allowed to be.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PROBLEM
 *   Until 2026-08-01 every post was force-cropped to 4:5 at upload time and the
 *   card was hard-coded to `aspectRatio: "4/5"` with `object-cover`. On a
 *   PHOTOGRAPHY platform that means the product silently recomposed the
 *   photographer's frame. A 16:9 landscape lost its sides; a panorama was
 *   destroyed. The crop was destructive — the original never reached storage.
 *
 * THE RULE (owner decision 2026-08-01)
 *   A photo is shown at its own aspect ratio, CLAMPED to a range:
 *
 *       tallest allowed   4:5     (0.80)   ← portrait limit
 *       widest  allowed   1.91:1  (1.91)   ← landscape limit
 *
 *   Anything inside that range — 1:1, 3:2, 4:3, 16:9, 4:5, which is virtually
 *   every real photograph — fills the card edge to edge with NO padding at all.
 *   Only a photo outside the range gets blurred bars, and only enough to reach
 *   the nearest limit.
 *
 *   Why clamp instead of letting height run free: a 9:16 phone shot at its true
 *   ratio is taller than a phone screen, so one post swallows the whole feed.
 *   Why clamp instead of a fixed 4:5 frame: measured, a 3:2 photo in a 4:5
 *   frame is 47% blur and a 16:9 is 55% — more than half the card would be
 *   padding. Both extremes look broken; the range is the only version that
 *   doesn't.
 *
 * WHERE THE DIMENSIONS COME FROM
 *   The uploaded filename carries them: `…-w1600h1200.webp`. Deliberately NOT a
 *   column on `posts` — that would mean changing `get_broadcast_feed`, the
 *   single riskiest RPC in this codebase, for a presentation detail. The URL is
 *   already in every payload that renders a post, so it costs nothing.
 *
 *   Reading them from the URL also means the frame is known BEFORE the image
 *   loads. Sizing the frame from `naturalWidth` on load instead would reflow
 *   every card as it decodes — the feed would jump under the reader's thumb.
 *
 *   A URL without the suffix (everything posted before 2026-08-01, and any
 *   external/CDN image) returns null and the caller falls back to 4:5 — exactly
 *   what those posts render today. Nothing already published moves.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Tallest frame: 4:5 portrait. */
export const FRAME_MIN_ASPECT = 0.8;
/** Widest frame: 1.91:1 landscape. */
export const FRAME_MAX_ASPECT = 1.91;
/** What a post with no readable dimensions renders as — today's behaviour. */
export const FRAME_DEFAULT_ASPECT = FRAME_MIN_ASPECT;

export interface ImageDims {
  width: number;
  height: number;
  /** width / height */
  aspect: number;
}

/**
 * Matches the `-w<W>h<H>` segment written by generateImagePath, with or without
 * the `-thumb` suffix that the thumbnail variant appends after it.
 */
// `-l3` is the B3d ladder marker (see imageLadder.ts); it sits between the
// dims and the optional `-thumb`, and parsing must tolerate all four forms.
const DIMS_RE = /-w(\d{1,6})h(\d{1,6})(?:-l3)?(?:-thumb)?\.[a-z0-9]+$/i;

/** Upper bound on a plausible photo edge. Guards against a garbage filename. */
const MAX_EDGE = 100_000;

/**
 * Read the intrinsic dimensions out of an image URL.
 * Returns null when the URL carries none — never throws, never guesses.
 */
export function parseImageDims(url: string | null | undefined): ImageDims | null {
  if (!url || typeof url !== "string") return null;

  // Query strings are stripped first: the Supabase render endpoint appends
  // ?width=…&quality=… and the suffix lives in the path, not the query.
  let path = url;
  const q = path.indexOf("?");
  if (q !== -1) path = path.slice(0, q);
  const hash = path.indexOf("#");
  if (hash !== -1) path = path.slice(0, hash);

  const m = DIMS_RE.exec(path);
  if (!m) return null;

  const width = Number(m[1]);
  const height = Number(m[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  if (width > MAX_EDGE || height > MAX_EDGE) return null;

  return { width, height, aspect: width / height };
}

/** Build the `-w<W>h<H>` segment for an upload path. */
export function dimsSuffix(width: number, height: number): string {
  const w = Math.max(1, Math.min(MAX_EDGE, Math.round(width)));
  const h = Math.max(1, Math.min(MAX_EDGE, Math.round(height)));
  return `-w${w}h${h}`;
}

/** Clamp a photo's aspect into the displayable range. */
export function frameAspectFor(imageAspect: number | null | undefined): number {
  if (typeof imageAspect !== "number" || !Number.isFinite(imageAspect) || imageAspect <= 0) {
    return FRAME_DEFAULT_ASPECT;
  }
  if (imageAspect < FRAME_MIN_ASPECT) return FRAME_MIN_ASPECT;
  if (imageAspect > FRAME_MAX_ASPECT) return FRAME_MAX_ASPECT;
  return imageAspect;
}

/**
 * The frame for a whole card.
 *
 * An album has ONE frame, decided by the FIRST photo — the same rule Instagram
 * uses. Re-sizing the card mid-swipe would move the buttons under the user's
 * finger, and a carousel whose height changes per slide reflows everything
 * below it on every swipe.
 */
export function frameAspectForUrls(urls: readonly (string | null | undefined)[] | null | undefined): number {
  if (!urls || urls.length === 0) return FRAME_DEFAULT_ASPECT;
  const dims = parseImageDims(urls[0]);
  return frameAspectFor(dims?.aspect);
}

export type PadAxis = "none" | "vertical" | "horizontal";

export interface FramePadding {
  /** Where the blurred bars go. "none" means the photo fills the frame. */
  axis: PadAxis;
  /** Total share of the frame taken by bars, 0–1. Both bars combined. */
  fraction: number;
}

/**
 * How much of the frame is blurred bar, and on which axis.
 *
 * Used for reasoning and tests rather than layout — the actual rendering is a
 * CSS `object-contain`, which centres the photo without any arithmetic. Having
 * the numbers explicit is what makes "is this design sane?" a measurable
 * question instead of an opinion.
 */
export function framePadding(
  imageAspect: number | null | undefined,
  frameAspect: number = frameAspectFor(imageAspect),
): FramePadding {
  if (typeof imageAspect !== "number" || !Number.isFinite(imageAspect) || imageAspect <= 0) {
    return { axis: "none", fraction: 0 };
  }
  if (Math.abs(imageAspect - frameAspect) < 1e-9) return { axis: "none", fraction: 0 };

  if (imageAspect > frameAspect) {
    // Photo is wider than the frame → it is width-limited → bars top and bottom.
    return { axis: "vertical", fraction: 1 - frameAspect / imageAspect };
  }
  // Photo is taller than the frame → height-limited → bars left and right.
  return { axis: "horizontal", fraction: 1 - imageAspect / frameAspect };
}

/** True when this photo needs blurred bars at all. */
export function needsPadding(imageAspect: number | null | undefined): boolean {
  return framePadding(imageAspect).axis !== "none";
}
