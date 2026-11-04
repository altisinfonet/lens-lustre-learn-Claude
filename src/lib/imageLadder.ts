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
 * PHOTO SETS — 2048 / 1080 / 600 / 320 (photo plan, switch `photo_set_v2`)
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Owner decision 1 (2026-11-02): every new photo is stored as four WebP copies —
 * 2048 (full screen + zoom), 1080 (feed), 600 (small screens / weak network),
 * 320 (grids). Qualities are the ones U0 measured on live (0.85/0.82/0.78/0.75,
 * docs/evidence/photo-plan/U0/README.md). Decision 4: the credit is printed on
 * the 2048 copy only; every other copy is made from the clean pixels.
 *
 * WHICH copies exist must be knowable from the URL alone, so a marker in the
 * name announces the set. W×H in the name are ALWAYS the dimensions of the file
 * the URL names. Siblings depend on the long edge only.
 *
 * ── v3 · `-l5` / `-l5f` — what the uploader writes now (photo plan Unit A) ──
 *   The URL that `image_urls` stores is ALWAYS A CLEAN COPY. The credited 2048
 *   is a sibling (`-r2048c`) that only full screen asks for; the SERVER draws it
 *   after the post exists (credit U3), so for a few minutes it may not be there
 *   yet (full screen then shows the clean copy and "save image" waits). A clean 2048 is
 *   kept PRIVATE (the lane's MEDIA bucket, no public host) so the credit can be
 *   redrawn later (name change, new wording) without the member re-uploading.
 *
 *   `…-w{W}h{H}-l5.webp`    POSTS. The URL = the clean 1080 copy (long ≤ 1080).
 *                             `-l5-r2048c` credited 2048, by the server (a small photo
 *                                          gets a credited copy of its own size)
 *                             `-l5-thumb`  600 — always
 *                             `-l5-r320`   when the long edge > 320
 *                             private: `-l5-r2048` (clean 2048) — CLEAN_PREFIX
 *   `…-w{W}h{H}-l5f.webp`   COMPETITION. The URL = the kept full-size file
 *                           (decision 5, unchanged). Siblings:
 *                             `-l5f-r2048c` credited 2048, by the server
 *                             `-l5f-r1080`  clean 1080 — ALWAYS (a 601–1080 px
 *                                           entry's "1080" is itself, not the
 *                                           credited copy — audit B2)
 *                             `-l5f-thumb`, `-l5f-r320` (long > 320)
 *                             private: `-l5f-r2048` (clean 2048)
 *
 * ── v2 · `-l4` / `-l4f` — written 2 → 3 Nov 2026, READ ONLY now ──
 *   `-l4`: the URL IS the credited 2048 (the fault the audit called B1);
 *   siblings `-l4-r1080` (long > 1080), `-l4-thumb`, `-l4-r320` (long > 320).
 *   `-l4f`: the URL is the full size; `-l4f-r2048` credited, `-l4f-r1080`
 *   (long > 1080), thumb, r320. These names are still read (and rectified by
 *   the backfill).
 *   RETIRED CREDIT (credit fix U1, Owner 4 Nov 2026 "very big credit"): both v2
 *   credited files — the `-l4` master and `-l4f-r2048` — carry the FIRST credit
 *   geometry (≈50 px, more than half the width). They are never a save target
 *   and never shown: the URL helper answers every size of a v2 set, 2048
 *   included, with its CLEAN copy. A stale client row that still names a `-l4`
 *   URL (posts were repointed by 20261110_0107) therefore saves the clean copy,
 *   never the big credit. The sibling list (deletion safety) still names them.
 *
 * The marker is a PROMISE, published only after every planned PUBLIC sibling is
 * in the store (the uploader strips it on any failure, exactly like `-l3`).
 *
 * ⚠ DELETION SAFETY: the siblings are derived addresses with no column, like
 * the rungs. `detect-orphan-files` derives them from the marker — locked by
 * photoSetV2.test.ts / orphanReferenceSet.test.ts. Old `-l3` and unmarked URLs
 * are untouched by all of this.
 */
export type PhotoSetSize = 2048 | 1080 | 600 | 320;
export type PhotoSetMarker = "-l4" | "-l4f" | "-l5" | "-l5f" | "-l6";

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * FEED PHOTO SET — `-l6` (Owner order, 4 Nov 2026). THE CODE PATH FOR EVERY
 * FEED POST: no switch decides it (photo_set_v2 still decides competition only).
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * EXACTLY THREE stored WebP files, the sizes below — THE ONE LIST. The uploader
 * (photoSetUpload / photoJobs), the display (photoProtection.feedPhotoSet: srcset
 * 600 small · 1080 phones · 2048 big screens), the URL helper and the deletion
 * derivation all read it; change a number here and every one follows.
 *
 *   `…-w{W}h{H}-l6.webp`        the 2048 copy (long edge ≤ 2048; a smaller photo
 *                               its own size — never upscaled). W×H = THIS file.
 *   `…-w{W}h{H}-l6-r1080.webp`  the 1080 copy — ALWAYS stored (a small photo's
 *                               1080 is its own size), so siblings never depend
 *                               on dimensions
 *   `…-w{W}h{H}-l6-thumb.webp`  the 600 copy (recorded in thumbnail_urls too)
 *
 * NO CREDIT IS STORED, anywhere: no `-r2048c`, no private clean 2048, no 320,
 * no 1440, no 2560 "original". The credit is drawn in the BROWSER at the moment
 * someone saves the photo (src/lib/photoCreditSave.ts, CREDIT_GEOMETRY_V5).
 */
export const FEED_PHOTO_SIZES = [2048, 1080, 600] as const;
export type FeedPhotoSize = (typeof FEED_PHOTO_SIZES)[number];
/** The feed photo set's marker. */
export const FEED_PHOTO_MARKER = "-l6";

/** A feed set size's slot: the largest is the URL itself, the smallest the `-thumb`, the rest `-r<size>`. */
export function feedPhotoSlot(size: FeedPhotoSize): "master" | "thumb" | "r1080" {
  if (size === FEED_PHOTO_SIZES[0]) return "master";
  if (size === FEED_PHOTO_SIZES[FEED_PHOTO_SIZES.length - 1]) return "thumb";
  return `r${size}` as "r1080";
}

/** v2 (read only): posts, the URL is the credited 2048 copy. */
export const PHOTO_SET_MARKER = "-l4";
/** v2 (read only): competition, the 2048 copy is `-r2048`. */
export const PHOTO_SET_FULL_MARKER = "-l4f";
/** v3 (written now): posts, the URL is the CLEAN 1080 copy. */
export const PHOTO_SET_V3_MARKER = "-l5";
/** v3 (written now): competition, the URL is the kept full size; `-r2048c` credited, `-r1080` clean. */
export const PHOTO_SET_V3_FULL_MARKER = "-l5f";
/** The credited 2048 sibling's suffix (v3). */
export const CREDITED_SUFFIX = "-r2048c";
/** The private clean 2048's suffix (v3) — a key in the MEDIA bucket under CLEAN_PREFIX, never public. */
export const CLEAN_2048_SUFFIX = "-r2048";
/** Where the private clean 2048 copies live in the lane's MEDIA bucket (no public host serves it). */
export const CLEAN_PREFIX = "photo-clean/";

/** WebP quality per copy — U0's measured settings. */
export const PHOTO_SET_QUALITY: Readonly<Record<PhotoSetSize, number>> = { 2048: 0.85, 1080: 0.82, 600: 0.78, 320: 0.75 };

/**
 * One stored copy of a set. `master` is the file the URL names (posts);
 * `clean2048` is the PRIVATE clean 2048 (v3); `r2048c` the credited 2048 (v3);
 * `r2048` the v2 competition credited copy (read only).
 */
export type PhotoSetSlot = "master" | "clean2048" | "r2048c" | "r2048" | "r1080" | "thumb" | "r320";
export interface PhotoSetCopy {
  slot: PhotoSetSlot;
  /** Long-edge cap; the encoder never upscales. */
  maxDimension: PhotoSetSize;
  quality: number;
  /** Always false in the uploader's plan (credit U3: the server draws the credit). */
  credit: boolean;
  /** True for the copy that is NOT published (the private clean 2048). */
  private?: boolean;
}

/**
 * The v3 copies to store for a source of `width × height`, in upload order
 * (largest first). `keepFull` = competition (the full-size file is stored
 * separately, as today). No copy here is credited: the server draws `-r2048c`
 * from the clean 2048 after the post exists (credit U3).
 */
export function photoSetPlan(width: number, height: number, keepFull: boolean): PhotoSetCopy[] {
  const longEdge = Math.max(width, height);
  const plan: PhotoSetCopy[] = [
    { slot: "clean2048", maxDimension: 2048, quality: PHOTO_SET_QUALITY[2048], credit: false, private: true },
    keepFull
      ? { slot: "r1080", maxDimension: 1080, quality: PHOTO_SET_QUALITY[1080], credit: false }
      : { slot: "master", maxDimension: 1080, quality: PHOTO_SET_QUALITY[1080], credit: false },
    { slot: "thumb", maxDimension: 600, quality: PHOTO_SET_QUALITY[600], credit: false },
  ];
  if (longEdge > 320) plan.push({ slot: "r320", maxDimension: 320, quality: PHOTO_SET_QUALITY[320], credit: false });
  return plan;
}

/** The feed set's three copies (FEED_PHOTO_SIZES), largest first; all clean, all public. */
export function feedPhotoPlan(): PhotoSetCopy[] {
  return FEED_PHOTO_SIZES.map((size) => ({ slot: feedPhotoSlot(size), maxDimension: size, quality: PHOTO_SET_QUALITY[size], credit: false }));
}

/** The file-name suffix of a slot ("" for the URL itself). */
export function photoSetSuffix(slot: PhotoSetSlot): string {
  if (slot === "master") return "";
  if (slot === "thumb") return "-thumb";
  if (slot === "r2048c") return CREDITED_SUFFIX;
  if (slot === "clean2048") return CLEAN_2048_SUFFIX;
  return `-${slot}`;
}

const SET_RE = /^(.*)-w(\d{1,6})h(\d{1,6})(-l[45]f?|-l6)(?:-thumb|-r\d{3,4}c?)?(\.[a-z0-9]+)((?:[?#].*)?)$/i;
const SET_NODIMS_RE = /^(.*)(-l[45]f?|-l6)(?:-thumb|-r\d{3,4}c?)?(\.[a-z0-9]+)((?:[?#].*)?)$/i;

/** A feed set (`-l6`) copy for `size`: the smallest stored size that covers it (320 → the 600). */
function feedSetSuffix(size: PhotoSetSize): string {
  const covering = [...FEED_PHOTO_SIZES].reverse().find((s) => s >= size) ?? FEED_PHOTO_SIZES[0];
  return photoSetSuffix(feedPhotoSlot(covering));
}
const L3_RE = /^(.*?)(?:-w(\d{1,6})h(\d{1,6}))?-l3(?:-thumb|-r\d{3,4})?(\.[a-z0-9]+)((?:[?#].*)?)$/i;

/** The set marker when the URL (or one of its siblings) belongs to a photo set. */
export function photoSetMarker(url: string): PhotoSetMarker | null {
  const m = SET_NODIMS_RE.exec(url);
  return m ? (m[2].toLowerCase() as PhotoSetMarker) : null;
}

interface ParsedSet {
  marker: PhotoSetMarker;
  w: number;
  h: number;
  long: number;
  at: (suffix: string) => string;
}

function parseSet(url: string): ParsedSet | null {
  const set = SET_RE.exec(url);
  if (!set) return null;
  const [, stem, w, h, marker, ext, tail] = set;
  const base = `${stem}-w${w}h${h}${marker}`;
  return {
    marker: marker.toLowerCase() as PhotoSetMarker,
    w: Number(w),
    h: Number(h),
    long: Math.max(Number(w), Number(h)),
    at: (suffix: string) => `${base}${suffix}${ext}${tail}`,
  };
}

/**
 * The largest PUBLIC copy of a set that carries NO credit — what any surface
 * that is not full screen falls back to (a failed 1080, a failed grid tile):
 *   `-l5` the URL · `-l5f` `-r1080` · `-l4`/`-l4f` `-r1080` when stored, else the
 *   600 thumb (a small `-l4` photo has no clean copy above 600). Not a set → the URL.
 */
export function photoSetCleanUrl(url: string): string {
  const s = parseSet(url);
  if (!s) {
    // A set marker without dimensions (never written): its own URL only for `-l5`
    // (clean by construction), else its thumb — the same answer photoSetUrl
    // gives below 2048; never the retired credited `-l4` master (credit fix U1).
    const bare = SET_NODIMS_RE.exec(url);
    if (!bare) return url;
    const [, stem, marker, ext, tail] = bare;
    const m = marker.toLowerCase();
    return m === "-l5" || m === "-l6" ? `${stem}${marker}${ext}${tail}` : `${stem}${marker}-thumb${ext}${tail}`;
  }
  if (s.marker === "-l5" || s.marker === "-l6") return s.at(""); // -l6: the 2048 itself is clean
  if (s.marker === "-l5f") return s.at("-r1080");
  return s.long > 1080 ? s.at("-r1080") : s.at("-thumb");
}

/**
 * THE URL HELPER — the stored copy that best serves `size`, from the URL alone.
 * Never offers a file that was not stored, NEVER a credited file for any size
 * but 2048 (only full screen asks for 2048), and NEVER a retired v2 credited
 * file at all (credit fix U1):
 *
 *   v3 `-l5`   2048 → `-r2048c` · 1080 → the URL · 600 → `-thumb` · 320 → `-r320` (else the URL)
 *   v3 `-l5f`  2048 → `-r2048c` · 1080 → `-r1080` · 600 → `-thumb` · 320 → `-r320` (else `-r1080`)
 *   v2 `-l4`   2048 → the clean copy (`-r1080`, else the thumb) · 1080 the same · 600 → `-thumb` · 320 → `-r320` (else the thumb)
 *   v2 `-l4f`  2048 / 1080 → `-r1080` (else the thumb) · 600 / 320 as `-l4`
 *   old `-l3`  2048 → the URL · 1080 → `-r1080` · 600 and 320 → `-thumb`
 *   unmarked   the URL itself for every size (its thumbnail lives in
 *              `thumbnail_urls`, not in its name)
 *
 * Accepts the URL or any sibling of the same set; keeps a query string.
 */
export function photoSetUrl(storedUrl: string, size: PhotoSetSize): string {
  const s = parseSet(storedUrl);
  if (s?.marker === "-l6") return s.at(feedSetSuffix(size)); // feed set: 2048 the URL · 1080 · 600 (320 → 600)
  if (s) {
    const v3 = s.marker === "-l5" || s.marker === "-l5f";
    if (size === 2048) return v3 ? s.at(CREDITED_SUFFIX) : photoSetCleanUrl(storedUrl); // v2: never the retired credit
    if (size === 600) return s.at("-thumb");
    if (size === 1080) return photoSetCleanUrl(storedUrl);
    return s.long > 320 ? s.at("-r320") : v3 ? photoSetCleanUrl(storedUrl) : s.at("-thumb");
  }
  const bare = SET_NODIMS_RE.exec(storedUrl);
  if (bare) {
    // A set marker without dimensions is never written; never guess at siblings.
    // Only the v3 2048 answer can be honest (its credited copy always exists);
    // a v2 set answers with its thumb at every size (never the retired credit).
    const [, stem, marker, ext, tail] = bare;
    const m = marker.toLowerCase();
    if (m === "-l6") return `${stem}${marker}${ext}${tail}`; // no dimensions: the URL itself (clean), never a guessed sibling
    if (size === 2048 && (m === "-l5" || m === "-l5f")) return `${stem}${marker}${CREDITED_SUFFIX}${ext}${tail}`;
    return m === "-l5" ? `${stem}${marker}${ext}${tail}` : `${stem}${marker}-thumb${ext}${tail}`;
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
 * The real width of the copy photoSetUrl(url, size) names, for srcset `w`
 * descriptors. Null when the URL is not a set with dimensions.
 */
export function photoSetWidth(url: string, size: PhotoSetSize): number | null {
  const s = parseSet(url);
  if (!s || !(s.w > 0 && s.h > 0)) return null;
  const chosen = photoSetUrl(url, size);
  const cap = /-thumb\.[a-z0-9]+(?:[?#]|$)/i.test(chosen) ? 600
    : /-r320\.[a-z0-9]+(?:[?#]|$)/i.test(chosen) ? 320
      : /-r1080\.[a-z0-9]+(?:[?#]|$)/i.test(chosen) ? 1080
        : /-r2048c?\.[a-z0-9]+(?:[?#]|$)/i.test(chosen) ? 2048
          : s.long; // the URL itself (a v3 post's clean 1080, a feed set's 2048, or a small set's own size)
  return s.long <= cap ? s.w : Math.max(1, Math.round((cap * s.w) / s.long));
}

/**
 * True when the file a URL names carries ANY credit — current or retired. Such
 * a file is never PAINTED on screen. Whether it may be a SAVE target is a
 * separate question: isSaveTargetCreditedUrl.
 */
export function isCreditedPhotoUrl(url: string): boolean {
  return isSaveTargetCreditedUrl(url) || isRetiredCreditedUrl(url);
}

/**
 * Credit fix U1: a v2 credited file — the `-l4` master (with or without
 * dimensions in the name) or `-l4f-r2048` — carrying the FIRST, big credit.
 * Never a save target, never shown.
 */
export function isRetiredCreditedUrl(url: string): boolean {
  const path = url.replace(/[?#].*$/, "");
  return /-l4(?:f-r2048)?\.[a-z0-9]+$/i.test(path);
}

/** The ONLY credited files a web "save image" may get: the v3 credited copy `-r2048c`. */
export function isSaveTargetCreditedUrl(url: string): boolean {
  return /-l[45]f?-r2048c\.[a-z0-9]+$/i.test(url.replace(/[?#].*$/, ""));
}

/**
 * U2 · GRIDS (profile grid, My Photos, notification thumbnails) — the 320 copy
 * for a set photo, and NOTHING ELSE changes: an old `-l3` or unmarked URL comes
 * back exactly as given.
 */
export function photoSetGridUrl(url: string): string {
  return photoSetMarker(url) ? photoSetUrl(url, 320) : url;
}

/**
 * U2 · BLUR PLACEHOLDER for a set photo: its 320 copy, or null when the photo is
 * too small to have one or is not a set photo (today's stored thumb serves those).
 */
export function photoSetBlurUrl(url: string): string | null {
  if (!photoSetMarker(url)) return null;
  const small = photoSetUrl(url, 320);
  return /-r320\.[a-z0-9]+(?:[?#]|$)/i.test(small) ? small : null;
}

/**
 * The derived PUBLIC siblings (no column names them) that a set key promises,
 * per the dimensions in its name. The `-thumb` copy is not listed: it is
 * recorded in `thumbnail_urls` / `photo_thumbnails` like every thumb. The
 * private clean 2048 is not listed either (it is not in the photo bucket — see
 * photoSetCleanKey). Old keys → [].
 */
export function photoSetSiblingKeys(key: string): string[] {
  const s = parseSet(key);
  if (!s) return [];
  // Feed set: every size but the URL and the thumb — unconditionally (always stored).
  if (s.marker === "-l6") return FEED_PHOTO_SIZES.map(feedPhotoSlot).filter((sl) => sl !== "master" && sl !== "thumb").map((sl) => s.at(photoSetSuffix(sl)));
  const out: string[] = [];
  if (s.marker === "-l5" || s.marker === "-l5f") {
    out.push(s.at(CREDITED_SUFFIX));
    if (s.marker === "-l5f") out.push(s.at("-r1080"));
  } else {
    if (s.marker === "-l4f") out.push(s.at("-r2048"));
    if (s.long > 1080) out.push(s.at("-r1080"));
  }
  if (s.long > 320) out.push(s.at("-r320"));
  return out;
}

/**
 * The private clean 2048's key in the lane's MEDIA bucket for a v3 set key
 * (bucket-qualified, e.g. `post-images/<uid>/posts/x-w1080h720-l5.webp` →
 * `photo-clean/post-images/<uid>/posts/x-w1080h720-l5-r2048.webp`). Null for
 * anything that is not a v3 set key.
 */
export function photoSetCleanKey(key: string): string | null {
  const s = parseSet(key);
  if (!s || (s.marker !== "-l5" && s.marker !== "-l5f")) return null;
  return `${CLEAN_PREFIX}${s.at(CLEAN_2048_SUFFIX).replace(/[?#].*$/, "")}`;
}
