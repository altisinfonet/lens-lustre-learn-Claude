/**
 * GET /api/media/derivatives/source?media_id=<uuid>   (S3-b)
 * The ORIGINAL's bytes for the worker to resize, read through the PHOTOS
 * binding (not the public CDN), so the backfill keeps working the day a
 * friends-only original leaves the public bucket. Read-only: nothing is written.
 */
import { asMember, handleError, member, UUID_RE, HttpError } from "../../video/_lib";
import { bucketFor, rpc, type MediaEnv } from "./_lib";

export async function handleSource(request: Request, env: MediaEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  try {
    if (request.method !== "GET") throw new HttpError(405, "MEDIA-REQ-000", "GET only");
    const mediaId = new URL(request.url).searchParams.get("media_id") ?? "";
    if (!UUID_RE.test(mediaId)) throw new HttpError(400, "MEDIA-REQ-002", "media_id must be a lowercase uuid");
    const who = await member(request, env, fetchImpl);
    const key = await asMember<string>(env, who.jwt, ...rpc("media_derivative_source", { _media_id: mediaId }), fetchImpl);
    if (typeof key !== "string" || !key.startsWith("post-images/") || key.includes("..")) throw new HttpError(404, "MEDIA-404", "no original");
    const obj = await bucketFor(env, "public").get(key);
    if (!obj) throw new HttpError(404, "MEDIA-404", "the original is not in the photo bucket");
    return new Response(await obj.arrayBuffer(), {
      status: 200,
      headers: { "content-type": "application/octet-stream", "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  } catch (e) {
    return handleError(e);
  }
}

export const onRequest = (context: { request: Request; env: MediaEnv }) => handleSource(context.request, context.env);
