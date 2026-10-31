/**
 * PUT /api/media/derivatives/put?media_id=&target=public|private&rung=600|1080|1440
 * body: the WebP bytes of ONE rung.   (S3-b)
 *
 * Order, and why:
 *   1. SQL `media_derivative_target` AS the caller → key + exact dimensions
 *      (refuses non-admin/non-converter, unknown audience, unneeded rung).
 *      Already recorded → 200 "already", nothing touched.
 *   2. The key must match the derivative pattern for this media/rung/audience
 *      (src/lib/media/derivativeRules.ts) — a second, independent refusal so no
 *      bug can aim this writer at an original.
 *   3. The body must be a WebP of exactly those dimensions, ≤ 4 MB.
 *   4. NEVER OVERWRITE: if an object already sits at the key, a same-size one is
 *      taken as this rung (a retry after a lost answer); any other is 409.
 *   5. Put, then record (`media_derivative_record`). If the record fails the
 *      object stays and the next run records it via step 4 — nothing is lost
 *      and nothing is deleted.
 * At most 2 R2 operations and 2 database calls per request.
 */
import { asMember, handleError, json, member, UUID_RE, HttpError } from "../../video/_lib";
import { isDerivativeKey, isRung, MAX_DERIVATIVE_BYTES, webpSize, type DerivativeTarget } from "../../../../src/lib/media/derivativeRules";
import { bucketFor, rpc, type MediaEnv } from "./_lib";

interface TargetRow { object_key: string; width: number; height: number; done: boolean }

export async function handlePut(request: Request, env: MediaEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  try {
    if (request.method !== "PUT") throw new HttpError(405, "MEDIA-REQ-000", "PUT only");
    const q = new URL(request.url).searchParams;
    const mediaId = q.get("media_id") ?? "";
    const target = q.get("target") as DerivativeTarget;
    const rung = Number(q.get("rung"));
    if (!UUID_RE.test(mediaId) || (target !== "public" && target !== "private") || !isRung(rung)) {
      throw new HttpError(400, "MEDIA-REQ-002", "media_id (uuid), target (public|private) and rung (600|1080|1440) are required");
    }
    const who = await member(request, env, fetchImpl);
    const rows = await asMember<TargetRow[]>(env, who.jwt, ...rpc("media_derivative_target", { _media_id: mediaId, _target: target, _rung: rung }), fetchImpl);
    const t = Array.isArray(rows) ? rows[0] : undefined;
    if (!t) throw new HttpError(404, "MEDIA-404", "no such derivative target");
    if (t.done) return json(200, { status: "already" });
    if (!isDerivativeKey(t.object_key, target, mediaId, rung)) throw new HttpError(500, "MEDIA-KEY-001", "the database named a key outside the derivative folder — refused");

    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > MAX_DERIVATIVE_BYTES) throw new HttpError(413, "MEDIA-REQ-003", "derivative too large");
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_DERIVATIVE_BYTES) throw new HttpError(413, "MEDIA-REQ-003", "derivative empty or too large");
    const dims = webpSize(bytes);
    if (!dims) throw new HttpError(415, "MEDIA-REQ-004", "body is not a WebP");
    if (dims.width !== t.width || dims.height !== t.height) {
      throw new HttpError(422, "MEDIA-REQ-005", `expected ${t.width}x${t.height}, got ${dims.width}x${dims.height}`);
    }

    const bucket = bucketFor(env, target);
    const existing = await bucket.head(t.object_key);
    if (existing && existing.size !== bytes.length) throw new HttpError(409, "MEDIA-409", "a different object already sits at this key — not overwritten");
    if (!existing) {
      await bucket.put(t.object_key, bytes, {
        httpMetadata: {
          contentType: "image/webp",
          ...(target === "public" ? { cacheControl: "public, max-age=31536000, immutable" } : {}),
        } as { contentType?: string },
      });
    }
    await asMember<boolean>(env, who.jwt, ...rpc("media_derivative_record", { _media_id: mediaId, _target: target, _rung: rung, _object_key: t.object_key }), fetchImpl);
    return json(201, { status: existing ? "recorded-existing" : "stored" });
  } catch (e) {
    return handleError(e);
  }
}

export const onRequest = (context: { request: Request; env: MediaEnv }) => handlePut(context.request, context.env);
