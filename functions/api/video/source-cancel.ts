/**
 * POST /api/video/source-cancel {source_id}   (server conversion, R8)
 *
 * As the member: stop a job that has not finished (video_source_cancel —
 * the database decides; a half-made video is deleted there) and delete the
 * original from the bucket at once. If the member reaches the RPC some other
 * way, the bucket's 2-day lifecycle rule on upload/ removes the original.
 */
import { HttpError, asMember, handleError, json, member, needEnv, readJson, requirePrivateDelivery, sourceKey, type VideoEnv } from "./_lib";
import { loadOwnSource } from "./source-url";

export async function handleSourceCancel(request: Request, env: VideoEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  try {
    if (request.method !== "POST") throw new HttpError(405, "VID-REQ-000", "POST only");
    requirePrivateDelivery(env);
    const who = await member(request, env, fetchImpl);
    const body = await readJson<{ source_id?: string }>(request);
    const s = await loadOwnSource(env, who, String(body.source_id ?? ""), fetchImpl);
    const status = await asMember<string>(env, who.jwt, "rpc/video_source_cancel",
      { method: "POST", body: JSON.stringify({ _source_id: s.id }) }, fetchImpl);
    if (status === "cancelled" || status === "failed" || status === "done") await needEnv(env, "MEDIA").delete(sourceKey(s.id));
    return json(200, { source_id: s.id, status });
  } catch (e) {
    return handleError(e);
  }
}

export const onRequest = (context: { request: Request; env: VideoEnv }) => handleSourceCancel(context.request, context.env);
