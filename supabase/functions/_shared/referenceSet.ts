/**
 * THE ORPHAN REFERENCE SET, AS CODE YOU CAN CALL.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * `detect-orphan-files` reports every stored object that the database does not
 * name, and `purge-s3-orphans` deletes on that class of verdict. So the
 * reference set is a DELETION SAFETY LIST: a key missing from it is a file
 * deleted out of live content, and there is no undo.
 *
 * The asymmetry governs every decision in this file:
 *
 *   FALSE ORPHAN      (a live file omitted from the set) — CATASTROPHIC
 *   FALSE NON-ORPHAN  (a dead file kept in the set)      — merely wasteful
 *
 * Every ambiguity below therefore resolves toward RETENTION, and anything this
 * module cannot positively classify is surfaced to the caller rather than
 * dropped. Silence is the failure mode that killed the previous two versions
 * of this logic.
 *
 * ── WHY THIS MODULE EXISTS, 2026-08-19 (Phase 2, Item D) ───────────────────
 *
 * Until Phase 2 the answer to "which objects are live?" was: enumerate URL
 * columns, chiefly `posts.image_urls`. That was true when `posts.image_urls`
 * was the ONLY representation of media ownership. It stopped being true when
 * the media engine shipped:
 *
 *     post_media (post_id, ord, media_id)
 *       └── media_objects (id, owner_id, state, derivatives jsonb)
 *             └── derivatives = { "original": "<bucket>/<path>", "1440": …, … }
 *
 * `media_objects.derivatives` now names storage objects that NO url column
 * mentions. Two live paths produce exactly that:
 *
 *   • `post_publish_with_media` (20260815041256) inserts posts with
 *     `image_urls = '{}'`. A post published that way has ALL of its media in
 *     post_media and NONE of it in image_urls.
 *   • `media-verify-upload` stores originals at
 *     `post-images/<owner>/media/<media_id>/original.<ext>` — a key shape that
 *     appears in no url column at any point in its life.
 *
 * Today production is saved only by an accident of ordering: all 228
 * media_objects were created by the Phase 2 migration FROM `posts.image_urls`,
 * so every `derivatives.original` happens to also be an image_urls entry
 * (measured 2026-08-19: 228/228 present, 0 divergent). The first post
 * published through the new write path ends that accident silently.
 *
 * This module is the thing that has to be correct BEFORE that happens — the
 * same repair-order rule the 2026-08-14 rewrite was written under.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * The managed buckets. A key whose first segment is not one of these is NOT an
 * orphan — it is a gap in this module's knowledge, and it is reported as such.
 */
export const BUCKETS: string[] = [
  "avatars",
  "competition-photos",
  "course-images",
  "email-assets",
  "journal-images",
  "portfolio-images",
  "post-images",
];

/**
 * Extension by mime, mirroring `media-verify-upload`. Kept beside
 * `originalKeyFor` because the two are one decision.
 */
export const EXT_BY_MIME: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/avif": "avif",
};

/**
 * Where `media-verify-upload` stores an original, derived from the row exactly
 * as that function derives it.
 *
 * ⚠ THIS IS A DERIVED ADDRESS — no database column holds it while an upload is
 * still in flight (`state` pending or verified, `derivatives` empty). Without
 * this, every in-flight upload's bytes read as unreferenced. The spelling here
 * and the spelling in `media-verify-upload/index.ts` must stay identical; that
 * pair is locked by orphanMediaReferenceSet.test.ts, the same way the ladder
 * rung derivation is locked by imageLadder.test.ts.
 */
export function originalKeyFor(ownerId: string, mediaId: string, mime: string): string {
  return `post-images/${ownerId}/media/${mediaId}/original.${EXT_BY_MIME[mime] ?? "webp"}`;
}

/**
 * Normalise anything that names a stored object — a public Supabase URL, a
 * signed URL, a CDN/R2 URL, or a bare `<bucket>/<path>` key — down to the one
 * `<bucket>/<path>` form the store is enumerated in.
 *
 * Behaviour is deliberately IDENTICAL to the inline `extractPath` this replaced
 * in detect-orphan-files; it was moved, not rewritten. Returning null means
 * "this module does not recognise it", which the caller must surface, never
 * discard quietly.
 */
export function extractPath(url: string): string | null {
  if (!url) return null;
  // Strip query params (cache busters).
  const cleanUrl = url.split("?")[0];
  // Supabase storage URL: .../storage/v1/object/public/{bucket}/{path}
  const match = cleanUrl.match(/\/storage\/v1\/object\/(?:public|sign)\/([^?]+)/);
  if (match) return match[1];
  // BUG-071: media is served from the R2/CDN host (e.g.
  // https://<this-lane's-cdn-host>/<bucket>/<path>). Strip any absolute origin so
  // an R2/CDN URL normalizes to the same <bucket>/<path> key as the stored
  // object — otherwise referenced files were missed and flagged as orphans.
  let pathPart = cleanUrl;
  const hostMatch = cleanUrl.match(/^https?:\/\/[^/]+\/(.+)$/);
  if (hostMatch) pathPart = hostMatch[1];
  for (const b of BUCKETS) {
    if (pathPart.startsWith(b + "/")) return pathPart;
    if (cleanUrl.startsWith(b + "/")) return cleanUrl;
  }
  return null;
}

/** One row of `media_objects`, as the reference scan needs to see it. */
export interface MediaRow {
  id: string;
  owner_id: string;
  mime: string | null;
  state: string | null;
  derivatives: Record<string, unknown> | null;
}

export interface MediaReferenceResult {
  /** Every `<bucket>/<path>` key these rows protect. */
  keys: string[];
  /**
   * Derivative values this module could not resolve to a managed bucket. NOT
   * dropped — the raw value is still added to `keys` — but reported, because a
   * reference set that quietly shrinks is the exact defect this file exists to
   * prevent.
   */
  unresolved: { media_id: string; value: string }[];
  /** Rows whose original key had to be DERIVED because the upload is in flight. */
  derived_in_flight: number;
  /** Rows seen, by state. Reported so a reader can tell scanned from skipped. */
  by_state: Record<string, number>;
}

/**
 * Every storage key named — or implied — by a set of `media_objects` rows.
 *
 * THREE RULES, EACH ONE A RETENTION BIAS:
 *
 * 1. EVERY derivative value counts, not just `original`. `media_mark_ready`
 *    accepts `original`, `1440`, `1080` and `600`; a reader that took only
 *    `original` would condemn every rung the derivative worker writes — the
 *    same shape of bug as the `-l3` rung addresses, which cost nothing only
 *    because someone wrote the derivation down in time.
 *
 * 2. EVERY state counts, not just `ready`. State is an integrity verdict, not
 *    a liveness verdict:
 *      • pending / verified  — bytes may already be in the store, and the row
 *                              is the only thing that knows about them
 *      • quarantined         — `media_quarantine` DETACHES post_media rows in
 *                              the same transaction, so a quarantined object
 *                              has zero references BY DESIGN. Treating that as
 *                              an orphan would delete the evidence of a
 *                              failed verification.
 *
 * 3. A ROW WITH NO post_media REFERENCE STILL COUNTS. "Referenced by a post"
 *    and "owned by the database" are different questions. Reclaiming genuinely
 *    dereferenced media is a deliberate, separately-reviewed sweep against
 *    `media_objects` itself — not a side effect of a scan that cannot see it.
 */
export function mediaReferenceKeys(rows: MediaRow[]): MediaReferenceResult {
  const keys: string[] = [];
  const unresolved: { media_id: string; value: string }[] = [];
  const by_state: Record<string, number> = {};
  let derived_in_flight = 0;

  for (const row of rows) {
    const state = row.state ?? "<null>";
    by_state[state] = (by_state[state] ?? 0) + 1;

    const derivatives = row.derivatives ?? {};
    let sawOriginal = false;

    for (const value of Object.values(derivatives)) {
      if (typeof value !== "string" || value.length === 0) continue;
      const resolved = extractPath(value);
      if (resolved) {
        keys.push(resolved);
      } else {
        // Unrecognised, so KEPT AS WRITTEN and reported. A value this module
        // cannot parse may still be the literal key in the store, and a
        // reference we do not understand is not a file we may delete.
        unresolved.push({ media_id: row.id, value });
        keys.push(value);
      }
    }

    if (typeof (derivatives as Record<string, unknown>)["original"] === "string") {
      sawOriginal = true;
    }

    // In flight: the row exists, the bytes may be uploaded, and nothing in the
    // database names them yet. Derive the address the upload path uses.
    if (!sawOriginal && row.owner_id) {
      keys.push(originalKeyFor(row.owner_id, row.id, row.mime ?? "image/webp"));
      derived_in_flight++;
    }
  }

  return { keys, unresolved, derived_in_flight, by_state };
}
