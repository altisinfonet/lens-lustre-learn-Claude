/**
 * POST /api/media/photoset/done {post_id, ord}   (photo plan U5; rules in ./_lib.ts)
 * Records the old photo's v2 set (`photo_set_backfill_record`, AS the caller)
 * ONLY when every planned copy is in the store — checked here, through the
 * binding, one HEAD per copy. A missing copy is 409 and nothing is recorded,
 * so the census never counts a half set. Writes no object.
 */
import { handleError, json, member, readJson, HttpError } from "../../video/_lib";
import { asMember, bucketFor, loadTarget, parsePhoto, rpc } from "./_lib";
import type { MediaEnv } from "../derivatives/_lib";
import { backfillSlotKey } from "../../../../src/lib/media/photoSetBackfill";

export async function handlePhotoSetDone(request: Request, env: MediaEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  try {
    if (request.method !== "POST") throw new HttpError(405, "PHOTO-BF-REQ-000", "POST only");
    const body = await readJson<{ post_id?: unknown; ord?: unknown }>(request);
    const { postId, ord } = parsePhoto(body.post_id, body.ord);
    const who = await member(request, env, fetchImpl);
    const t = await loadTarget(env, who.jwt, postId, ord, fetchImpl);
    if (t.done) return json(200, { status: "already" });
    const bucket = bucketFor(env, "public");
    const missing: string[] = [];
    for (const c of t.plan) {
      if (!(await bucket.head(backfillSlotKey(t.masterKey, c.slot)))) missing.push(c.slot);
    }
    if (missing.length) throw new HttpError(409, "PHOTO-BF-INCOMPLETE", `copies missing: ${missing.join(", ")} — nothing recorded`);
    await asMember<boolean>(env, who.jwt, ...rpc("photo_set_backfill_record", { _post_id: postId, _ord: ord, _master_key: t.masterKey }), fetchImpl);
    return json(201, { status: "recorded", copies: t.plan.length });
  } catch (e) {
    return handleError(e);
  }
}

export const onRequest = (context: { request: Request; env: MediaEnv }) => handlePhotoSetDone(context.request, context.env);
