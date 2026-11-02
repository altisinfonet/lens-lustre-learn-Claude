/**
 * GET /api/media/photoset/source?post_id=<uuid>&ord=<0-49>   (photo plan U5)
 * The old photo's bytes for the worker to re-encode, read through the PHOTOS
 * binding (not the public CDN), with the copy plan in `x-photo-set-plan`.
 * Read-only: nothing is written.
 */
import { handleError, member, HttpError } from "../../video/_lib";
import { bucketFor, loadTarget, parsePhoto } from "./_lib";
import type { MediaEnv } from "../derivatives/_lib";

export async function handlePhotoSetSource(request: Request, env: MediaEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  try {
    if (request.method !== "GET") throw new HttpError(405, "PHOTO-BF-REQ-000", "GET only");
    const q = new URL(request.url).searchParams;
    const { postId, ord } = parsePhoto(q.get("post_id"), q.get("ord"));
    const who = await member(request, env, fetchImpl);
    const t = await loadTarget(env, who.jwt, postId, ord, fetchImpl);
    const obj = await bucketFor(env, "public").get(t.sourceKey);
    if (!obj) throw new HttpError(404, "PHOTO-BF-404", "the old photo is not in the photo bucket");
    return new Response(await obj.arrayBuffer(), {
      status: 200,
      headers: {
        "content-type": "application/octet-stream", "cache-control": "no-store", "x-content-type-options": "nosniff",
        // The copies put.ts will accept — exact sizes, quality, which one carries the credit.
        "x-photo-set-plan": JSON.stringify(t.plan.map(({ slot, width, height, quality, credit }) => ({ slot, width, height, quality, credit }))),
      },
    });
  } catch (e) {
    return handleError(e);
  }
}

export const onRequest = (context: { request: Request; env: MediaEnv }) => handlePhotoSetSource(context.request, context.env);
