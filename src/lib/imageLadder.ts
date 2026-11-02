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

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * PHOTO SET V2 — 2048 / 1080 / 600 / 320 (photo plan U1b, switch `photo_set_v2`)
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Owner decision 1 (2026-11-02): every new photo is stored as four WebP copies —
 * 2048 (full screen + zoom), 1080 (feed), 600 (small screens / weak network),
 * 320 (grids). Qualities are the ones U0 measured on live (0.85/0.82/0.78/0.75,
 * docs/evidence/photo-plan/U0/README.md). Decision 4: the 2048 copy carries the
 * credit; the smaller copies are made from the clean pixels.
 *
 * Same reasoning as `-l3` above: WHICH copies exist must be knowable from the
 * URL alone, so a new marker announces the set. Two spellings, because a
 * competition entry keeps its full-size file (decision 5) and a post does not:
 *
 *   `…-w{W}h{H}-l4.webp`   POSTS. The URL itself IS the credited 2048 copy
 *                          (long edge ≤ 2048, never upscaled). Siblings:
 *                            `-l4-r1080`  when the long edge > 1080
 *                            `-l4-thumb`  600 (always; the existing thumb slot)
 *                            `-l4-r320`   when the long edge > 320
 *   `…-w{W}h{H}-l4f.webp`  COMPETITION. The URL is the kept FULL-SIZE file
 *                          (unchanged from today). Siblings:
 *                            `-l4f-r2048` the credited 2048 copy — ALWAYS
 *                                         stored, even for a small entry, because
 *                                         the full size is deleted after the
 *                                         results window (U6) and the credited
 *                                         copy is what stays
 *                            `-l4f-r1080`, `-l4f-thumb`, `-l4f-r320` as above
 *
 * W×H in the name are the dimensions of the file the URL names. The sibling
 * rules depend on the long edge only, and `long > 1080` / `long > 320` is the
 * same test for the full size and its 2048 copy, so one rule serves both.
 *
 * The marker is a PROMISE, published only after every planned sibling is in
 * the store (the uploader strips it on any failure, exactly like `-l3`).
 *
 * ⚠ DELETION SAFETY: the siblings are derived addresses with no column, like
 * the rungs. `detect-orphan-files` derives them from the marker — locked by
 * photoSetV2.test.ts. Old `-l3` and unmarked URLs are untouched by all of this.
 */
export type PhotoSetSize = 2048 | 1080 | 600 | 320;

/** Posts: the URL is the credited 2048 copy. */
export const PHOTO_SET_MARKER = "-l4";
/** Competition: the URL is the kept full-size file; the 2048 copy is `-r2048`. */
export const PHOTO_SET_FULL_MARKER = "-l4f";

/** WebP quality per copy — U0's measured settings. */
export const PHOTO_SET_QUALITY: Readonly<Record<PhotoSetSize, number>> = { 2048: 0.85, 1080: 0.82, 600: 0.78, 320: 0.75 };

/** One stored copy of the set. `master` is the file the URL names (posts only). */
export type PhotoSetSlot = "master" | "r2048" | "r1080" | "thumb" | "r320";
export interface PhotoSetCopy {
  slot: PhotoSetSlot;
  /** Long-edge cap; the encoder never upscales. */
  maxDimension: PhotoSetSize;
  quality: number;
  /** True for the 2048 copy only (decision 4). */
  credit: boolean;
}

/**
 * The copies to store for a source of `width × height`, in upload order
 * (largest first). `keepFull` = competition (the full-size file is stored
 * separately, as today, and the 2048 copy becomes the `-r2048` sibling).
 */
export function photoSetPlan(width: number, height: number, keepFull: boolean): PhotoSetCopy[] {
  const longEdge = Math.max(width, height);
  const plan: PhotoSetCopy[] = [
    { slot: keepFull ? "r2048" : "master", maxDimension: 2048, quality: PHOTO_SET_QUALITY[2048], credit: true },
  ];
  if (longEdge > 1080) plan.push({ slot: "r1080", maxDimension: 1080, quality: PHOTO_SET_QUALITY[1080], credit: false });
  plan.push({ slot: "thumb", maxDimension: 600, quality: PHOTO_SET_QUALITY[600], credit: false });
  if (longEdge > 320) plan.push({ slot: "r320", maxDimension: 320, quality: PHOTO_SET_QUALITY[320], credit: false });
  return plan;
}

const SET_RE = /^(.*)-w(\d{1,6})h(\d{1,6})(-l4f?)(?:-thumb|-r\d{3,4})?(\.[a-z0-9]+)((?:[?#].*)?)$/i;
const SET_NODIMS_RE = /^(.*)(-l4f?)(?:-thumb|-r\d{3,4})?(\.[a-z0-9]+)((?:[?#].*)?)$/i;
const L3_RE = /^(.*?)(?:-w(\d{1,6})h(\d{1,6}))?-l3(?:-thumb|-r\d{3,4})?(\.[a-z0-9]+)((?:[?#].*)?)$/i;

/** `-l4` / `-l4f` when the URL (or one of its siblings) belongs to a v2 set. */
export function photoSetMarker(url: string): "-l4" | "-l4f" | null {
  const m = SET_NODIMS_RE.exec(url);
  if (!m) return null;
  return m[2].toLowerCase() === PHOTO_SET_FULL_MARKER ? PHOTO_SET_FULL_MARKER : PHOTO_SET_MARKER;
}

/**
 * THE URL HELPER — the stored copy that best serves `size`, from the URL alone.
 * Never offers a file that was not stored: a size the photo was too small for
 * resolves to the next LARGER stored copy.
 *
 *   v2 `-l4`   2048 → the URL · 1080 → `-r1080` · 600 → `-thumb` · 320 → `-r320`
 *   v2 `-l4f`  2048 → `-r2048` (never the full size) · 1080 / 600 / 320 as above
 *   old `-l3`  2048 → the URL · 1080 → `-r1080` · 600 and 320 → `-thumb`
 *   unmarked   the URL itself for every size (its thumbnail lives in
 *              `thumbnail_urls`, not in its name)
 *
 * Accepts the master URL or any sibling of the same set; keeps a query string.
 * U2 (display) and U5 (backfill) use this; nothing else should spell suffixes.
 */
export function photoSetUrl(storedUrl: string, size: PhotoSetSize): string {
  const set = SET_RE.exec(storedUrl);
  if (set) {
    const [, stem, w, h, marker, ext, tail] = set;
    const base = `${stem}-w${w}h${h}${marker}`;
    const longEdge = Math.max(Number(w), Number(h));
    const full = marker.toLowerCase() === PHOTO_SET_FULL_MARKER;
    const at = (suffix: string) => `${base}${suffix}${ext}${tail}`;
    const largest = full ? at("-r2048") : at("");
    if (size === 2048) return largest;
    if (size === 1080) return longEdge > 1080 ? at("-r1080") : largest;
    if (size === 600) return at("-thumb");
    return longEdge > 320 ? at("-r320") : largest;
  }
  const bare = SET_NODIMS_RE.exec(storedUrl);
  if (bare) {
    // A v2 marker without dimensions is never written; never guess at siblings.
    const [, stem, marker, ext, tail] = bare;
    return marker.toLowerCase() === PHOTO_SET_FULL_MARKER ? `${stem}${marker}-r2048${ext}${tail}` : `${stem}${marker}${ext}${tail}`;
  }
  const l3 = L3_RE.exec(storedUrl);
  if (l3 && hasLadderMarker(storedUrl)) {
    const [, stem, w, h, ext, tail] = l3;
    const base = `${stem}${w ? `-w${w}h${h}` : ""}${LADDER_MARKER}`;
    const master = `${base}${ext}${tail}`;
    if (size === 2048) return master;
    if (size === 1080) return w && rungPlan(Number(w), Number(h)).includes(1080) ? `${base}-r1080${ext}${tail}` : master;
    return `${base}-thumb${ext}${tail}`;
  }
  return storedUrl;
}

/**
 * The derived rung siblings (no column names them) that a v2 key promises,
 * per the dimensions in its name. The `-thumb` copy is not listed: it is
 * recorded in `thumbnail_urls` / `photo_thumbnails` like every thumb.
 * Old keys → [] (their `-l3` rungs are derived by the code above, unchanged).
 */
export function photoSetSiblingKeys(key: string): string[] {
  const set = SET_RE.exec(key);
  if (!set) return [];
  const [, stem, w, h, marker, ext, tail] = set;
  const base = `${stem}-w${w}h${h}${marker}`;
  const longEdge = Math.max(Number(w), Number(h));
  const out: string[] = [];
  if (marker.toLowerCase() === PHOTO_SET_FULL_MARKER) out.push(`${base}-r2048${ext}${tail}`);
  if (longEdge > 1080) out.push(`${base}-r1080${ext}${tail}`);
  if (longEdge > 320) out.push(`${base}-r320${ext}${tail}`);
  return out;
}
