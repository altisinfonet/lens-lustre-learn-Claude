/**
 * POST /api/video/takedown {video_id, reason?, report_id?}   (S7-b · VID-4)
 *
 * Admin only (the SQL refuses anyone else): video_takedown moves the video to
 * 'taken_down' — from that moment no read path shows it and play-token refuses
 * it (VID-1 §4.4, §9). This route then puts the video on the media-authz
 * Worker's revoked list (KV, key = video uuid), so a play token minted BEFORE
 * the takedown stops within seconds instead of at its 15-minute expiry.
 *
 * ENVIRONMENT: VIDEO_REVOKED — the SAME KV namespace the lane's media-authz
 * Worker reads (cloudflare/media-authz/handler.ts), bound to the Pages
 * project. Missing → the takedown still happens; the answer says
 * revoked_list:false so the admin page can say "stops within 15 minutes".
 */
import { HttpError, asMember, handleError, json, member, readJson, UUID_RE, withCors, type VideoEnv } from "./_lib";

export interface TakedownEnv extends VideoEnv {
  VIDEO_REVOKED?: { put(key: string, value: string): Promise<void> };
}

export function handleTakedown(request: Request, env: TakedownEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  return withCors(request, env, () => takedown(request, env, fetchImpl));
}

async function takedown(request: Request, env: TakedownEnv, fetchImpl: typeof fetch): Promise<Response> {
  try {
    if (request.method !== "POST") throw new HttpError(405, "VID-REQ-000", "POST only");
    const who = await member(request, env, fetchImpl);
    const body = await readJson<{ video_id?: unknown; reason?: unknown; report_id?: unknown }>(request);
    const videoId = String(body.video_id ?? "");
    if (!UUID_RE.test(videoId)) throw new HttpError(400, "VID-TD-000", "video_id must be a uuid");
    const reportId = typeof body.report_id === "string" && UUID_RE.test(body.report_id) ? body.report_id : null;
    const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : null;
    const status = await asMember<string>(env, who.jwt, "rpc/video_takedown",
      { method: "POST", body: JSON.stringify({ _video_id: videoId, _reason: reason, _report_id: reportId }) }, fetchImpl);
    let revokedList = false;
    if (env.VIDEO_REVOKED) {
      await env.VIDEO_REVOKED.put(videoId, "taken_down");
      revokedList = true;
    }
    return json(200, { video_id: videoId, status, revoked_list: revokedList });
  } catch (e) {
    return handleError(e);
  }
}

export const onRequest = (context: { request: Request; env: TakedownEnv }) => handleTakedown(context.request, context.env);
