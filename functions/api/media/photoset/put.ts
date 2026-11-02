/**
 * PUT /api/media/photoset/put?post_id=&ord=&slot=master|r1080|thumb|r320
 * body: the WebP bytes of ONE copy.   (photo plan U5; rules in ./_lib.ts)
 *
 *   1. SQL `photo_set_backfill_target` AS the caller → the old photo's key
 *      (refuses non-admin/non-converter; no row = not backfill work).
 *      Already recorded → 200 "already", nothing touched.
 *   2. The key must be an old photo in a member's post-images folder.
 *   3. Its WebP header gives its size → the plan → THIS copy's key and size.
 *   4. The body must be a WebP of exactly that size, ≤ 4 MB.
 *   5. NEVER OVERWRITE: a WebP of this copy's exact size already at the key is
 *      taken as this copy (a retry after a lost answer, or the same old photo
 *      in a second post); anything else there is 409.
 */
import { handleError, json, member, HttpError } from "../../video/_lib";
import { bucketFor, loadTarget, parsePhoto } from "./_lib";
import type { MediaEnv } from "../derivatives/_lib";
import { MAX_DERIVATIVE_BYTES, webpSize } from "../../../../src/lib/media/derivativeRules";
import { backfillSlotKey, isBackfillSlot } from "../../../../src/lib/media/photoSetBackfill";

export async function handlePhotoSetPut(request: Request, env: MediaEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  try {
    if (request.method !== "PUT") throw new HttpError(405, "PHOTO-BF-REQ-000", "PUT only");
    const q = new URL(request.url).searchParams;
    const { postId, ord } = parsePhoto(q.get("post_id"), q.get("ord"));
    const slot = q.get("slot");
    if (!isBackfillSlot(slot)) throw new HttpError(400, "PHOTO-BF-REQ-002", "slot must be master, r1080, thumb or r320");
    const who = await member(request, env, fetchImpl);
    const t = await loadTarget(env, who.jwt, postId, ord, fetchImpl);
    if (t.done) return json(200, { status: "already" });
    const copy = t.plan.find((c) => c.slot === slot);
    if (!copy) throw new HttpError(422, "PHOTO-BF-REQ-005", `this photo has no ${slot} copy (too small)`);
    const key = backfillSlotKey(t.masterKey, slot);

    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > MAX_DERIVATIVE_BYTES) throw new HttpError(413, "PHOTO-BF-REQ-003", "copy too large");
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_DERIVATIVE_BYTES) throw new HttpError(413, "PHOTO-BF-REQ-003", "copy empty or too large");
    const dims = webpSize(bytes);
    if (!dims) throw new HttpError(415, "PHOTO-BF-REQ-004", "body is not a WebP");
    if (dims.width !== copy.width || dims.height !== copy.height) {
      throw new HttpError(422, "PHOTO-BF-REQ-005", `expected ${copy.width}x${copy.height}, got ${dims.width}x${dims.height}`);
    }

    const bucket = bucketFor(env, "public");
    const existing = await bucket.get(key, { range: { offset: 0, length: 64 } });
    if (existing) {
      // Only this route writes a key derived from an old photo's full name, so a
      // WebP of this copy's exact size there is this copy (a retry, or the same
      // photo in a second post). Anything else is left alone.
      const was = webpSize(new Uint8Array(await existing.arrayBuffer()));
      if (!was || was.width !== copy.width || was.height !== copy.height) {
        throw new HttpError(409, "PHOTO-BF-409", "a different object already sits at this key — not overwritten");
      }
      return json(200, { status: "exists" });
    }
    await bucket.put(key, bytes, {
      httpMetadata: { contentType: "image/webp", cacheControl: "public, max-age=31536000, immutable" } as { contentType?: string },
    });
    return json(201, { status: "stored" });
  } catch (e) {
    return handleError(e);
  }
}

export const onRequest = (context: { request: Request; env: MediaEnv }) => handlePhotoSetPut(context.request, context.env);
