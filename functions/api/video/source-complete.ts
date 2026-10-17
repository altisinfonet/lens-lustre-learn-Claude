/**
 * POST /api/video/source-complete {source_id}   (server conversion, CONVERTER-DESIGN.md v2 §3 step 3)
 *
 * As the member. The original must be in the bucket at exactly the size they
 * declared; its ETag is recorded (video_source_uploaded) so the converter's
 * download is pinned to THESE bytes [R6] — /api/video/convert/claim checks
 * the object again before handing it out, so a member who calls the RPC
 * directly gains nothing. Then the job is queued and the member may close
 * the app.
 *
 * Answers: 200 {status:"queued"} · 200 replay (already queued or further) ·
 * 409 VID-SRC-006 (nothing uploaded yet) · 409 VID-SRC-010 (wrong size — the
 * object is deleted, ask /source-url again) · 401/404 as /source-url.
 */
import { HttpError, asMember, handleError, withCors, json, member, needEnv, readJson, requirePrivateDelivery, sourceKey, type VideoEnv } from "./_lib";
import { loadOwnSource } from "./source-url";

/** The route, with CORS for the native app (functions/_cors.ts): OPTIONS 204, every answer carries the headers. */
export function handleSourceComplete(request: Request, env: VideoEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  return withCors(request, env, () => sourceComplete(request, env, fetchImpl));
}

async function sourceComplete(request: Request, env: VideoEnv, fetchImpl: typeof fetch): Promise<Response> {
  try {
    if (request.method !== "POST") throw new HttpError(405, "VID-REQ-000", "POST only");
    requirePrivateDelivery(env);
    const who = await member(request, env, fetchImpl);
    const body = await readJson<{ source_id?: string }>(request);
    const s = await loadOwnSource(env, who, String(body.source_id ?? ""), fetchImpl);
    if (s.status !== "awaiting_upload") return json(200, { source_id: s.id, status: s.status, replayed: true });
    const bucket = needEnv(env, "MEDIA");
    const key = sourceKey(s.id);
    const obj = await bucket.head(key);
    if (!obj) throw new HttpError(409, "VID-SRC-006", "the original has not arrived yet — upload it, then call again");
    if (obj.size !== Number(s.source_bytes)) {
      await bucket.delete(key);
      throw new HttpError(409, "VID-SRC-010", `the original is ${obj.size} bytes, not the ${s.source_bytes} declared — upload it again`);
    }
    const etag = String(obj.etag ?? "").replace(/"/g, "");
    if (!/^[0-9A-Za-z-]{1,80}$/.test(etag)) throw new HttpError(502, "VID-SRC-011", "the stored original has no usable ETag");
    const r = await asMember<{ status?: string }>(env, who.jwt, "rpc/video_source_uploaded",
      { method: "POST", body: JSON.stringify({ _source_id: s.id, _etag: etag }) }, fetchImpl);
    return json(200, { source_id: s.id, status: r?.status ?? "queued", replayed: false });
  } catch (e) {
    return handleError(e);
  }
}

export const onRequest = (context: { request: Request; env: VideoEnv }) => handleSourceComplete(context.request, context.env);
