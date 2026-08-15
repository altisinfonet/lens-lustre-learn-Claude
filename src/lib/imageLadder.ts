/**
 * THE DERIVATIVE LADDER — 600 / 1080 / 1440 / original. (B3d-1)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The sizes are MEASURED, not round numbers (IMAGE_DERIVATIVE_MEASUREMENTS,
 * 2026-08-13): 600 covers the 117px grid at every DPR and the 590px desktop
 * card at DPR 1; 1080 is the phone feed card at the dominant DPR cluster and
 * within 10% of desktop-retina's 1180; 1440 covers 412×3.5 phones; the
 * original stays for zoom and download ONLY — and must remain the
 * untransformed URL, because `/cdn-cgi/image/` responses carry no CORS headers
 * and a transformed URL in the download path silently breaks "Save".
 * Approximate effect on a phone feed card: 335 KB → ~56 KB.
 *
 * WHY A FILENAME MARKER. Rung availability must be knowable from the URL
 * alone: the feed renders from `posts.image_urls` and there is no column
 * saying "this post has rungs" (and adding one would touch `get_broadcast_feed`,
 * the riskiest RPC, for a presentation detail — the same reasoning that put
 * dimensions in the filename). Offering rung URLs speculatively for legacy
 * posts would 404-then-fallback on first paint for every old photo. So new
 * uploads carry `-l3` (ladder, 3 stored sizes) in the name, and only marked
 * URLs are offered rungs.
 *
 * NO UPSCALING, same rule the media state machine enforces server-side (B2):
 * an image narrower than a rung has no honest derivative at that rung, and a
 * fabricated one would be a lie with a file size.
 *
 * ⚠ DELETION SAFETY: rung files are DERIVED addresses — no database column
 * stores them. `detect-orphan-files` derives them from the marker exactly as
 * written here. If the naming here changes, that derivation changes WITH it,
 * or every rung in the store becomes an "orphan". The pair of tests locking
 * this lives in imageLadder.test.ts and orphanReferenceSet.test.ts.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Stored rung long-edge sizes, ascending. 600 is the existing `-thumb`. */
export const LADDER_RUNGS = [1080, 1440] as const;

/**
 * WebP quality for the RUNGS — the display tier. B3d-4.
 *
 * The ladder's byte targets were MEASURED at q82 (2026-08-13, browser canvas
 * on a representative 2000px production photo): ~56 KB @1080, ~83 KB @1440.
 * Left to the encoder default (0.92), rungs come out roughly 2× those targets
 * — the "encoder heaviness" line item. 0.82 is the number the measurements
 * were taken at, not a taste choice.
 *
 * The FULL-RES original deliberately KEEPS 0.92: after B3d-1 it serves only
 * lightbox zoom and download — the two moments a photography platform must
 * not soften. Feed bytes come from the rungs and thumb, which is where the
 * saving belongs.
 */
export const RUNG_QUALITY = 0.82;

/** Filename marker announcing "this upload stored its rungs". */
export const LADDER_MARKER = "-l3";

/** `…-w1620h1080-l3.webp` → true. Query strings and fragments tolerated. */
export function hasLadderMarker(url: string): boolean {
  return /-l3(?:-thumb)?\.[a-z0-9]+(?:[?#]|$)/i.test(url);
}

/**
 * Rungs an image of these dimensions honestly supports (long edge strictly
 * larger than the rung — equal size would duplicate the original).
 */
export function rungPlan(width: number, height: number): number[] {
  const longEdge = Math.max(width, height);
  return LADDER_RUNGS.filter((r) => longEdge > r);
}

/** `…-l3.webp` + 1080 → `…-l3-r1080.webp`. Works for keys and full URLs. */
export function rungPath(fullPath: string, rung: number): string {
  return fullPath.replace(/(\.[a-z0-9]+)((?:[?#].*)?)$/i, `-r${rung}$1$2`);
}

/**
 * The WIDTH descriptor a rung deserves in `srcset`. Rungs cap the LONG edge,
 * so a portrait's width is smaller than the rung number — declaring `1080w`
 * for a 720px-wide file would make the browser skip larger copies it needs.
 * (Same correction the thumbnail path already makes.)
 */
export function rungWidthFor(rung: number, w: number, h: number): number {
  return w >= h ? rung : Math.max(1, Math.round((rung * w) / h));
}
