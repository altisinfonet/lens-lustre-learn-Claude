/**
 * THE ONE CLIENT WRITE PATH INTO THE MEDIA ENGINE.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS EXISTS TO STOP. Before this module, every photograph published on
 * 50mm Retina World became an `image_urls`-only post: bytes in a bucket and a
 * string in an array, with no `media_objects` row, no server-side verification
 * that the stored file is the file the member chose, and no `post_media`
 * reference. The fenced migration reached zero on 2026-08-20 and would have
 * gone non-zero again with the very next upload. Fixing the migration without
 * fixing this would have been bailing with the tap running.
 *
 * THE SEQUENCE, and why it is in this order:
 *
 *   1. upload           `uploadImageWithThumbnail` — UNCHANGED. Same encoder,
 *                        same 2560 cap, same `-thumb` sibling, same `-l3`
 *                        rungs, same object path. It now also reports what it
 *                        stored.
 *   2. declare          `media_begin_upload(sha256, w, h, bytes, mime)` →
 *                        media_id. Idempotent on UNIQUE(owner, sha256), so a
 *                        retry of the same bytes resolves to the same object
 *                        instead of a second one.
 *   3. register         `media-register-upload(media_id, object_path)` — the
 *                        server re-reads the object out of R2 and re-computes
 *                        the fingerprint. Match → ready. Mismatch →
 *                        quarantined, terminal.
 *   4. publish          `post_publish_with_media(...)` — ONE transaction:
 *                        the post, every `post_media` reference with ords from
 *                        the array's own ordinality, and the legacy arrays.
 *
 * Steps 2–3 happen AFTER the upload, not before, because the object path is
 * the production layout (`post-images/<uid>/posts/<name>-w{W}h{H}[-l3].webp`)
 * and not derived from the media id. docs/WRITE_PATH.md records why: all 229
 * migrated rows use that layout, the responsive ladder and the thumbnail are
 * filename conventions parsed from it, and moving new uploads to
 * `media/<id>/original.webp` would silently disable both.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ⚠ THE FALLBACK IS DELIBERATE AND MUST NOT BECOME SILENT.
 *
 * If any step of the media path fails, `publishPost` falls back to the legacy
 * insert so the member's post still goes out. A photographer who has waited
 * through an upload must not lose it because a verification endpoint was slow.
 * But every fallback is logged at WARN with `MEDIA-4001`, because a fallback
 * that nobody counts is a regression that reintroduces itself: the legacy-only
 * population starts growing again and the graph looks flat.
 *
 * ⚠ DO NOT MAKE THE FALLBACK THE DEFAULT ORDER. Trying legacy first "because
 * it is simpler" means the media path is never exercised and rots.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { supabase } from "@/integrations/supabase/client";
import { logger } from "@/lib/logger";
import type { StoredObjectFacts } from "@/lib/media/storedObject";

const FILE = "src/lib/media/postMediaWrite.ts";

/** One uploaded photograph, as the composer knows it after the upload. */
export interface UploadedPhoto {
  url: string;
  thumbnailUrl: string;
  stored: StoredObjectFacts | null;
}

/** Postgres `bytea` literal for a hex digest — what `media_begin_upload` takes. */
export function shaToBytea(sha256: string): string | null {
  if (typeof sha256 !== "string") return null;
  const hex = sha256.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) return null;
  return `\\x${hex}`;
}

/**
 * The bucket-relative key for an uploaded photograph.
 *
 * The uploader returns a public CDN URL; the engine stores a bucket-relative
 * path. Deriving one from the other in exactly one place is what stops the two
 * from drifting — and the edge function re-derives and re-checks it anyway
 * against the row's owner, so this is convenience, never authorization.
 */
export function objectPathFromUrl(url: string): string | null {
  if (typeof url !== "string" || !url.trim()) return null;
  const m = /^https?:\/\/[^/]+\/(.+)$/i.exec(url.trim());
  const key = (m ? m[1] : url.trim()).split("?")[0].split("#")[0];
  if (!key || key.startsWith("/") || key.includes("..")) return null;
  return key;
}

/**
 * Drive one photograph from "uploaded" to "ready", returning its media id.
 * Returns null on any refusal — the caller decides what a null means for the
 * post as a whole, and it always means "do not claim this slide is migrated".
 */
export async function registerUploadedPhoto(
  photo: UploadedPhoto,
  correlationId?: string,
): Promise<string | null> {
  if (!photo.stored) return null;
  const bytea = shaToBytea(photo.stored.sha256);
  const objectPath = objectPathFromUrl(photo.url);
  if (!bytea || !objectPath) return null;

  const { data: mediaId, error: beginErr } = await supabase.rpc("media_begin_upload", {
    _sha256: bytea,
    _width: photo.stored.width,
    _height: photo.stored.height,
    _bytes: photo.stored.bytes,
    _mime: photo.stored.mime,
  } as never);

  if (beginErr || typeof mediaId !== "string") {
    logger.warn({
      code: "MEDIA-4002",
      event: "MEDIA_BEGIN_UPLOAD_REFUSED",
      fn: "registerUploadedPhoto",
      file: FILE,
      message: "The server would not open a media record for this photograph.",
      reason: beginErr?.message ?? "no media id returned",
      expected: "A media object id",
      actual: "refused",
      nextStep:
        "The post still publishes on the legacy path — the member loses nothing. Repeated MEDIA-4002 means the in-flight upload cap (50) or a declaration the schema refuses; the reason field says which.",
      correlationId,
      detail: { bytes: photo.stored.bytes, mime: photo.stored.mime },
    });
    return null;
  }

  const { data: reg, error: regErr } = await supabase.functions.invoke("media-register-upload", {
    body: { media_id: mediaId, object_path: objectPath },
  });

  if (regErr || (reg as { state?: string } | null)?.state !== "ready") {
    logger.warn({
      code: "MEDIA-4003",
      event: "MEDIA_REGISTRATION_NOT_READY",
      fn: "registerUploadedPhoto",
      file: FILE,
      message: "The server did not confirm this photograph as ready.",
      reason: regErr?.message ?? `state=${(reg as { state?: string } | null)?.state ?? "unknown"}`,
      expected: "state ready after the server re-read and re-hashed the stored object",
      actual: (reg as { state?: string } | null)?.state ?? "no answer",
      nextStep:
        "'quarantined' means the stored bytes are not the bytes that were declared — investigate before dismissing. 'pending'/retryable means the PUT has not landed yet and a retry will succeed.",
      correlationId,
      detail: { mediaId, objectPath },
    });
    return null;
  }

  return mediaId;
}

export interface PublishInput {
  photos: UploadedPhoto[];
  content: string;
  privacy: string;
  categories: string[];
  indexingDisabled: boolean;
  idempotencyKey: string;
}

export interface PublishOutcome {
  postId: string | null;
  /** true when the post carries post_media rows; false when it is legacy-only. */
  viaMedia: boolean;
}

/**
 * Publish through the media engine, or report honestly that it could not.
 *
 * ALL-OR-NOTHING PER POST, deliberately. A post whose slide 2 failed to
 * register would otherwise publish with two `post_media` rows for three
 * photographs — a gap that `post_publish_with_media`'s completeness gate is
 * built to make unrepresentable, arriving through the client instead. So a
 * single unregistered slide sends the WHOLE post down the legacy path, where
 * every photograph is present and the post is simply not migrated yet.
 */
export async function publishViaMedia(input: PublishInput): Promise<PublishOutcome> {
  const ids: string[] = [];
  for (const photo of input.photos) {
    const id = await registerUploadedPhoto(photo, input.idempotencyKey);
    if (!id) return { postId: null, viaMedia: false };
    ids.push(id);
  }
  if (ids.length === 0 || ids.length !== input.photos.length) {
    return { postId: null, viaMedia: false };
  }

  const { data: postId, error } = await supabase.rpc("post_publish_with_media", {
    _media_ids: ids,
    _content: input.content,
    _privacy: input.privacy,
    _categories: input.categories,
    _indexing_disabled: input.indexingDisabled,
    _idempotency_key: input.idempotencyKey,
    _thumbnail_urls: input.photos.map((p) => p.thumbnailUrl),
  } as never);

  if (error || typeof postId !== "string") {
    logger.warn({
      code: "MEDIA-4004",
      event: "ATOMIC_PUBLISH_REFUSED",
      fn: "publishViaMedia",
      file: FILE,
      message: "The atomic publish refused this post.",
      reason: error?.message ?? "no post id returned",
      expected: "A post id, with every photograph attached in one transaction",
      actual: "refused",
      nextStep:
        "NOTHING WAS WRITTEN — the transaction rolls back, so there is no half-published post to clean up. The caller falls back to the legacy insert. A rate-limit or duplicate-post trigger reads the same way here as it does on the legacy path.",
      correlationId: input.idempotencyKey,
      detail: { photographs: ids.length, privacy: input.privacy },
    });
    return { postId: null, viaMedia: false };
  }

  return { postId, viaMedia: true };
}

/**
 * Say out loud that a post was published without media rows.
 *
 * ⚠ THIS IS THE ONLY THING THAT KEEPS THE DELTA HONEST. The legacy-only
 * population was measured at 56 posts / 83 slides on 2026-08-20; if it starts
 * growing again, this counter is where it shows up first. Deleting this call
 * makes the regression invisible, which is worse than the regression.
 */
export function reportLegacyOnlyPublish(reason: string, correlationId?: string): void {
  logger.warn({
    code: "MEDIA-4001",
    event: "POST_PUBLISHED_LEGACY_ONLY",
    fn: "createPost",
    file: FILE,
    message: "A post was published without media_objects/post_media rows.",
    reason,
    expected: "Every new post carries post_media rows (Phase 2 write path)",
    actual: "image_urls only — this post joins the legacy-only population",
    nextStep:
      "The member's post SUCCEEDED and nothing is lost. But this is the counter that proves the delta is not growing; a rising MEDIA-4001 rate means the media write path is failing in production and the legacy-only population is increasing again.",
    correlationId,
  });
}
