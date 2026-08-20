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
 * ⚠ THE FALLBACK IS DELIBERATE, MUST NOT BECOME SILENT, AND MUST NOT BE ONE
 * UNDIFFERENTIATED THING.
 *
 * If any step of the media path fails, `publishPost` falls back to the legacy
 * insert so the member's post still goes out. A photographer who has waited
 * through an upload must not lose it because a verification endpoint was slow.
 * But every fallback is logged at WARN with `MEDIA-4001`, because a fallback
 * that nobody counts is a regression that reintroduces itself: the legacy-only
 * population starts growing again and the graph looks flat.
 *
 * From 2026-08-20 (WS2) the outcome also says WHICH KIND of failure it was,
 * because two very different things were being counted as one:
 *
 *   `unmigratable-slides` — at least one slide has no `StoredObjectFacts`. In
 *      practice this is a RESUMED DRAFT: the original bytes are gone, so the
 *      photograph can never be declared and the post is legacy-only BY DESIGN.
 *      Expected. Not a defect. Part of the floor, not the leak.
 *
 *   `media-path-failed` — every slide was describable and the media path still
 *      did not complete. That is a DEFECT: a refusal from the server, or an
 *      exception. It is reported at ERROR as `MEDIA-4010` in addition to the
 *      MEDIA-4001 count, so it can be alerted on separately.
 *
 * ⚠ WHY THIS DISTINCTION IS LOAD-BEARING. Under RED-1 the media path threw on
 * its very first call for four days, and every post that still went out looked
 * — in the logs — exactly like a resumed draft. A counter that cannot tell
 * "correctly legacy" from "broken" reports a healthy floor while the leak runs.
 *
 * ⚠ AND THE LEGACY INSERT MUST NEVER BECOME THE NORMAL ROUTE. It is the
 * airbag, not the steering. If `MEDIA-4010` is ever non-trivial, the fix is the
 * media path, not a wider fallback.
 *
 * ⚠ DO NOT MAKE THE FALLBACK THE DEFAULT ORDER. Trying legacy first "because
 * it is simpler" means the media path is never exercised and rots.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ⚠ THE ONE LINE THAT MUST NEVER BE REFACTORED FOR TIDINESS.
 *
 * Both RPCs below are called as `(supabase.rpc as <cast>)(fn, args)` — the cast
 * sits INSIDE the call parentheses. That looks like a stylistic choice. It is
 * not. supabase-js defines rpc as a prototype METHOD:
 *
 *     rpc(fn, args, options) { return this.rest.rpc(fn, args, options) }
 *
 * Hoisting it — `const rpc = supabase.rpc as …; await rpc(…)` — throws away the
 * object it belongs to. The copy then runs with `this === undefined` (ES modules
 * are strict mode) and `this.rest` throws
 * "Cannot read properties of undefined (reading 'rest')".
 *
 * This file SHIPPED with exactly that bug on both call sites. The result was
 * not a degraded post: `publishViaMedia` has no try/catch, so the throw sailed
 * past the legacy fallback and the member got "Could not publish" and no post
 * at all. Proof it never once ran in production: 0 of 252 posts carried an
 * `idempotency_key`, which `post_publish_with_media` always sets. Found by the
 * Workstream 1 audit, 2026-08-20. The identical bug had already cost members
 * the draft-publish path on 2026-08-17 — see `usePostDrafts.ts:89-108`.
 *
 * A cast does not detach anything, and neither does an arrow wrapper
 * (`(fn, a) => (supabase.rpc as X)(fn, a)`), because the member expression is
 * re-resolved on every call. Only STORING the bare method detaches.
 *
 * Locked three ways, all in `src/__tests__/mediaWritePath.test.ts`:
 *   • the client mock is a CLASS whose `rpc` lives on the prototype and returns
 *     `this.rest.rpc(...)`, so a detached call throws there exactly as it does
 *     in production — the old object-literal mock could not reproduce it;
 *   • a regression test asserts the detached form throws and the in-call form
 *     does not;
 *   • a repository-wide static scan forbids the detaching assignment in any
 *     file, so this cannot come back somewhere else.
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
 * ⚠ ONE MEDIA-4006, TWO CALLERS.
 *
 * This must be emitted from BOTH places that can decide a slide is
 * undescribable: `registerUploadedPhotoInner`, and `publishViaMedia`'s
 * up-front classification (added in WS2). When the classification was first
 * moved up front it short-circuited before the registrar ran, and MEDIA-4006
 * silently stopped firing on the composer path — the exact code whose whole
 * purpose is that this case leaves a trace when nothing else does. Extracting
 * it makes that impossible to do by accident again.
 */
function reportUndescribableSlide(photo: UploadedPhoto, correlationId?: string): void {
  logger.warn({
    code: "MEDIA-4006",
    event: "PHOTO_NOT_DESCRIBABLE",
    fn: "registerUploadedPhoto",
    file: FILE,
    message: "A photograph was never offered to the media engine.",
    reason: "No StoredObjectFacts for this slide, so nothing could be declared.",
    expected: "sha256, bytes, width, height and mime for the bytes that were uploaded",
    actual: "null",
    nextStep:
      "If this slide came from a resumed draft the null is correct and the post is legacy-only by design. Otherwise describeStoredObject could not measure the encoded file — check the encoder output and crypto.subtle availability.",
    correlationId,
    detail: { url: photo.url },
  });
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
  // ⚠ NOTHING IN THE MEDIA PATH MAY THROW AT ITS CALLER.
  //
  // Every caller of this function treats `null` as "not migrated" and carries
  // on. None of them expects an exception, and RED-1 proved what happens when
  // one escapes: the throw sailed past the composer's legacy fallback and the
  // member got "Could not publish" and no post at all — a bug strictly worse
  // than the legacy-only post the fallback exists to prevent.
  //
  // So the boundary is closed here rather than at each of the five call sites.
  // A throw is NOT quietly swallowed: MEDIA-4009 is an ERROR, because unlike a
  // refusal it is never expected and always means this module is broken.
  try {
    return await registerUploadedPhotoInner(photo, correlationId);
  } catch (e) {
    logger.error({
      code: "MEDIA-4009",
      event: "MEDIA_PATH_THREW",
      fn: "registerUploadedPhoto",
      file: FILE,
      message: "The media write path threw instead of refusing.",
      reason: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      expected: "A media id, or null on a refusal the caller can handle",
      actual: "an exception",
      nextStep:
        "ALWAYS A DEFECT IN THIS MODULE — a refusal returns null, so an exception means a contract broke. A TypeError mentioning 'rest' is RED-1 returning: supabase.rpc has been stored in a variable somewhere instead of called in call position. See the header.",
      correlationId,
      detail: { url: photo.url },
    });
    return null;
  }
}

async function registerUploadedPhotoInner(
  photo: UploadedPhoto,
  correlationId?: string,
): Promise<string | null> {
  // ⚠ THE ONE REFUSAL THAT MAKES NO NETWORK CALL.
  //
  // Every other path below fails against a server, so it leaves a row in
  // edge_logs even when the client's own warning is lost. This one returns
  // before touching anything, so without its own code a post that landed
  // legacy-only for THIS reason is indistinguishable — in the server logs —
  // from a post published by a browser running an old bundle. Those two need
  // different fixes, so they need different evidence.
  //
  // `stored` is null in exactly two ways: describeStoredObject could not
  // measure the encoded bytes, or the slide came from a RESUMED DRAFT, where
  // the original file is gone and null is the honest answer rather than a
  // guess. `detail.resumed` separates them.
  // ⚠ THE ONE REFUSAL THAT MAKES NO NETWORK CALL — see reportUndescribableSlide.
  if (!photo.stored) {
    reportUndescribableSlide(photo, correlationId);
    return null;
  }
  const bytea = shaToBytea(photo.stored.sha256);
  const objectPath = objectPathFromUrl(photo.url);
  if (!bytea || !objectPath) return null;

  // ⚠ CALL IT IN CALL POSITION. NEVER STORE IT. See the header note "THE ONE
  // LINE THAT MUST NEVER BE REFACTORED FOR TIDINESS".
  //
  // The generated `types.ts` does not carry the media RPCs, so the contract is
  // declared HERE, at the call site, exactly as `postMediaRead.ts:146` does for
  // `post_media_for`. A blanket `as never` would have hidden a wrong argument
  // name as readily as a wrong function name; this narrows to one signature and
  // still fails the moment the shape stops matching. The cast is inside the
  // parentheses of the call, so `supabase.rpc` is resolved as a MEMBER
  // EXPRESSION at invocation time and `this` is still the client.
  const { data: mediaId, error: beginErr } = await (supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: string | null; error: { message: string } | null }>)(
    "media_begin_upload",
    {
      _sha256: bytea,
      _width: photo.stored.width,
      _height: photo.stored.height,
      _bytes: photo.stored.bytes,
      _mime: photo.stored.mime,
    },
  );

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

/**
 * Register every photograph, or none of them.
 *
 * Used by the DEFERRED publish paths — Save draft and Schedule — where the row
 * is written now and becomes a post later. Registering at upload time is the
 * only moment the bytes are known to be in storage and the member is present;
 * `publish_post_draft` and the scheduled publisher run later, and the latter
 * runs with no member at all.
 *
 * ⚠ ALL OR NONE, for the same reason `publishViaMedia` is: a draft carrying two
 * media ids for three photographs would publish a post with an ord gap, which
 * is the one shape every gate in this engine exists to make unreachable.
 * `post_attach_media` refuses it (MEDIA-2204) — but a client that can express
 * it will eventually send it, so it is not expressible here either.
 */
export async function registerAllOrNone(
  photos: readonly UploadedPhoto[],
  correlationId?: string,
): Promise<string[] | null> {
  if (photos.length === 0) return null;
  const ids: string[] = [];
  for (const photo of photos) {
    const id = await registerUploadedPhoto(photo, correlationId);
    if (!id) return null;
    ids.push(id);
  }
  return ids.length === photos.length ? ids : null;
}

export interface PublishInput {
  photos: UploadedPhoto[];
  content: string;
  privacy: string;
  categories: string[];
  indexingDisabled: boolean;
  idempotencyKey: string;
}

/**
 * WHY a post did not go through the media engine. See the header note.
 *
 * ⚠ THESE TWO MUST NOT BE MERGED BACK INTO ONE BOOLEAN. `unmigratable-slides`
 * is the permanent, correct floor; `media-path-failed` is a leak. Counting them
 * together is what let RED-1 run for four days looking like normal behaviour.
 */
export type PublishFailure =
  /** A slide has no StoredObjectFacts — a resumed draft. Legacy-only BY DESIGN. */
  | "unmigratable-slides"
  /** Every slide was describable and the path still failed. A DEFECT. */
  | "media-path-failed";

export interface PublishOutcome {
  postId: string | null;
  /** true when the post carries post_media rows; false when it is legacy-only. */
  viaMedia: boolean;
  /** null on success. Otherwise which of the two failures above. */
  failure: PublishFailure | null;
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
  // ⚠ CLASSIFY BEFORE TRYING, NOT AFTER FAILING.
  //
  // A slide with no StoredObjectFacts cannot be declared to the media engine at
  // all — there is no sha256, no byte count, nothing to verify against. That is
  // the resumed-draft case, and it is legacy-only by design. Deciding it HERE,
  // from the input, is what keeps it distinguishable from a path that was
  // capable of working and did not.
  const undescribable = input.photos.filter((p) => !p.stored);
  if (undescribable.length > 0) {
    for (const p of undescribable) reportUndescribableSlide(p, input.idempotencyKey);
    return { postId: null, viaMedia: false, failure: "unmigratable-slides" };
  }

  const ids: string[] = [];
  for (const photo of input.photos) {
    const id = await registerUploadedPhoto(photo, input.idempotencyKey);
    if (!id) return { postId: null, viaMedia: false, failure: "media-path-failed" };
    ids.push(id);
  }
  if (ids.length === 0 || ids.length !== input.photos.length) {
    return { postId: null, viaMedia: false, failure: "media-path-failed" };
  }

  // ⚠ CALL IT IN CALL POSITION. NEVER STORE IT — same narrow cast as
  // `registerUploadedPhoto`, and the same reason. See the header note.
  const { data: postId, error } = await (supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: string | null; error: { message: string } | null }>)(
    "post_publish_with_media",
    {
      _media_ids: ids,
      _content: input.content,
      _privacy: input.privacy,
      _categories: input.categories,
      _indexing_disabled: input.indexingDisabled,
      _idempotency_key: input.idempotencyKey,
      _thumbnail_urls: input.photos.map((p) => p.thumbnailUrl),
    },
  );

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
    return { postId: null, viaMedia: false, failure: "media-path-failed" };
  }

  return { postId, viaMedia: true, failure: null };
}

/**
 * Say out loud that a post was published without media rows.
 *
 * ⚠ THIS IS THE ONLY THING THAT KEEPS THE DELTA HONEST. The legacy-only
 * population was measured at 56 posts / 83 slides on 2026-08-20; if it starts
 * growing again, this counter is where it shows up first. Deleting this call
 * makes the regression invisible, which is worse than the regression.
 */
export function reportMediaPathFailure(correlationId?: string): void {
  logger.error({
    code: "MEDIA-4010",
    event: "MEDIA_WRITE_PATH_FAILED",
    fn: "createPost",
    file: FILE,
    message: "Every photograph in this post was describable, and the media path still did not complete.",
    reason: "publishViaMedia returned media-path-failed",
    expected:
      "A describable photograph is declared, verified and published through post_publish_with_media",
    actual: "the post fell back to the legacy image_urls-only insert",
    nextStep:
      "⚠ THIS IS A DEFECT, NOT A LEGACY SLIDE — do not treat it as part of the permanent floor. The MEDIA-4002/4003/4004/4009 entry with the same correlation id says which step refused. MEDIA-4009 means the path THREW, which is RED-1's signature. Fix the media path; do not widen the fallback.",
    correlationId,
  });
}

/**
 * Say out loud that a post was published without media rows.
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
