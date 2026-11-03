/**
 * POST /api/media/clean-copy?key=<public key>-r2048.webp
 * body: the WebP bytes of the photo's CLEAN 2048 copy.   (photo plan Unit A)
 *
 * Stores the private clean 2048 of a v3 photo (`-l5` post, `-l5f` entry) in the
 * lane's MEDIA bucket under `photo-clean/` — a bucket with no public host, so
 * nobody can load it. It exists so the credit can be redrawn later without the
 * member uploading again (rules: src/lib/media/cleanCopy.ts).
 *
 * REFUSALS (nothing here trusts the client beyond the bytes):
 *   · signed in (401), and the key's folder must be the CALLER's own (403);
 *   · the key must be exactly a v3 clean-copy key (400);
 *   · the body must be a WebP, ≤ 4 MB, of exactly this photo's 2048 size (415 / 413 / 422);
 *   · the photo's public credited copy (-r2048c) must already be stored (409 PHOTO-CLEAN-006);
 *   · NEVER OVERWRITE: a WebP of the same size already there = this copy
 *     (a retry after a lost answer) → 200 "exists"; anything else there → 409.
 * At most 3 R2 operations and 1 auth call. No service key, no database write.
 * POST (not PUT) because the app's cross-origin preflight allows GET/POST only.
 */
import { handleError, json, member, withCors, HttpError } from "../video/_lib";
import { bucketFor, type MediaEnv } from "./derivatives/_lib";
import { MAX_DERIVATIVE_BYTES, webpSize } from "../../../src/lib/media/derivativeRules";
import { cleanCopySizeOk, cleanCopyTarget } from "../../../src/lib/media/cleanCopy";
import { CLEAN_PREFIX } from "../../../src/lib/imageLadder";

export function handleCleanCopy(request: Request, env: MediaEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  return withCors(request, env, () => store(request, env, fetchImpl));
}

async function store(request: Request, env: MediaEnv, fetchImpl: typeof fetch): Promise<Response> {
  try {
    if (request.method !== "POST") throw new HttpError(405, "PHOTO-CLEAN-000", "POST only");
    const t = cleanCopyTarget(new URL(request.url).searchParams.get("key") ?? "");
    if (!t) throw new HttpError(400, "PHOTO-CLEAN-001", "key must be a photo's clean-copy key (…-l5-r2048.webp / …-l5f-r2048.webp)");
    const who = await member(request, env, fetchImpl);
    if (who.uid !== t.owner) throw new HttpError(403, "PHOTO-CLEAN-002", "you can only store the clean copy of your own photo");

    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > MAX_DERIVATIVE_BYTES) throw new HttpError(413, "PHOTO-CLEAN-003", "copy too large");
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_DERIVATIVE_BYTES) throw new HttpError(413, "PHOTO-CLEAN-003", "copy empty or too large");
    const dims = webpSize(bytes);
    if (!dims) throw new HttpError(415, "PHOTO-CLEAN-004", "body is not a WebP");
    if (!cleanCopySizeOk(t, dims.width, dims.height)) {
      throw new HttpError(422, "PHOTO-CLEAN-005", `a ${dims.width}x${dims.height} copy is not this photo's 2048`);
    }

    // Unit B review follow-up: a clean copy is kept only for a REAL photo — its
    // public credited sibling (uploaded before this call by both upload paths)
    // must already be in the photo bucket. Without this a member could park
    // any 4 MB file under a made-up name in their own private folder.
    const creditedKey = t.privateKey.slice(CLEAN_PREFIX.length).replace(/-r2048\.webp$/, "-r2048c.webp");
    if (!(await bucketFor(env, "public").head(creditedKey))) {
      throw new HttpError(409, "PHOTO-CLEAN-006", "this photo's public copies are not in the store — a clean copy is kept only for a stored photo");
    }

    const bucket = bucketFor(env, "private");
    const existing = await bucket.get(t.privateKey, { range: { offset: 0, length: 64 } });
    if (existing) {
      const was = webpSize(new Uint8Array(await existing.arrayBuffer()));
      if (!was || was.width !== dims.width || was.height !== dims.height) {
        throw new HttpError(409, "PHOTO-CLEAN-409", "a different object already sits at this key — not overwritten");
      }
      return json(200, { status: "exists" });
    }
    await bucket.put(t.privateKey, bytes, {
      httpMetadata: { contentType: "image/webp" },
      customMetadata: { role: "clean-2048", owner: t.owner },
    });
    return json(201, { status: "stored" });
  } catch (e) {
    return handleError(e);
  }
}

export const onRequest = (context: { request: Request; env: MediaEnv }) => handleCleanCopy(context.request, context.env);
