/**
 * POST /api/video/play-token {video_id}   (VID-1 §9 step 2)
 *
 * As the VIEWER (their JWT, or the lane's anon key when signed out — the same
 * reach RLS already gives anon on `videos`/`post_videos`). It reads the video
 * row THROUGH RLS: `videos_read` only returns a row the viewer may see (own,
 * admin, or ready and linked to a post/ad they can already see). Then:
 *
 *   visible AND state = 'ready'  → 200 {master_url, poster_url, expires_at, …}
 *                                  each URL carries a 15-min PREFIX token for
 *                                  exactly video/<owner>/<id>/v<current>/
 *   anything else                → 404, never 403 (VID-1 §9.2): a stranger
 *                                  learns nothing about whether the video exists.
 *
 * Environment (Pages, per lane, in addition to _lib.ts):
 *   MEDIA_TOKEN_KEY  — the D-003 key, base64 of 32 bytes; the SAME value the
 *                      media-authz Worker holds. Never in the repo or the app.
 *   MEDIA_CDN_HOST   — the lane's own CDN host, set per Pages project (never
 *                      written in the repo: the isolation guard forbids the other
 *                      lane's host name in any shipped file). It is also the
 *                      token's `aud`.
 *   VIDEO_DELIVERY_PRIVATE = "1" — as for upload (F-D3-18). Until the Worker
 *                      is live a token would protect nothing, so: 503.
 *
 * No service role, no database write, nothing cached (`no-store`).
 */
import { PLAY_TOKEN_TTL_S, playPrefix, signPlayToken } from "../../../src/lib/video/shared/playToken";
import { supabaseUrl, supabaseAnon } from "../../_seo";
import { HttpError, asMember, handleError, json, needEnv, readJson, requirePrivateDelivery, type VideoEnv } from "./_lib";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export interface PlayTokenResponse {
  video_id: string;
  master_url: string;
  poster_url: string;
  /** epoch seconds; the player asks again before this */
  expires_at: number;
  width: number | null;
  height: number | null;
  duration_s: number;
  has_audio: boolean;
}

/** The viewer: their own JWT when signed in (401 if it is bad), else the lane's anon key. */
async function viewer(request: Request, env: VideoEnv, fetchImpl: typeof fetch): Promise<{ sub: string; jwt: string }> {
  const auth = request.headers.get("authorization");
  if (!auth) return { sub: "anon", jwt: supabaseAnon(env) };
  const m = /^Bearer\s+(\S+)$/i.exec(auth);
  if (!m) throw new HttpError(401, "VID-AUTH-001", "sign in first");
  const res = await fetchImpl(`${supabaseUrl(env)}/auth/v1/user`, {
    headers: { apikey: supabaseAnon(env), authorization: `Bearer ${m[1]}` },
  });
  if (!res.ok) throw new HttpError(401, "VID-AUTH-001", "sign in first");
  const user = (await res.json()) as { id?: string };
  if (!user?.id || !UUID_RE.test(user.id)) throw new HttpError(401, "VID-AUTH-001", "sign in first");
  return { sub: user.id, jwt: m[1] };
}

const notFound = () => new HttpError(404, "VID-PLAY-404", "no such video");

export async function handlePlayToken(request: Request, env: VideoEnv, now: Date = new Date(), fetchImpl: typeof fetch = fetch): Promise<Response> {
  try {
    if (request.method !== "POST") throw new HttpError(405, "VID-REQ-000", "POST only");
    requirePrivateDelivery(env);
    const keyB64 = needEnv(env, "MEDIA_TOKEN_KEY");
    const host = needEnv(env, "MEDIA_CDN_HOST").toLowerCase();
    if (!HOST_RE.test(host)) throw new HttpError(500, "VID-ENV-001", "MEDIA_CDN_HOST must be a bare host name");
    const body = await readJson<{ video_id?: unknown }>(request);
    const videoId = typeof body.video_id === "string" ? body.video_id : "";
    if (!UUID_RE.test(videoId)) throw new HttpError(400, "VID-REQ-002", "video_id must be a lowercase uuid");
    const who = await viewer(request, env, fetchImpl);

    const rows = await asMember<Array<{ id: string; owner_id: string; current_version: number; state: string }>>(
      env, who.jwt, `videos?id=eq.${videoId}&select=id,owner_id,current_version,state`, {}, fetchImpl,
    );
    const v = Array.isArray(rows) ? rows[0] : undefined;
    // RLS hid it, or it exists but is not playable: the same 404 either way.
    if (!v || v.state !== "ready" || !UUID_RE.test(v.owner_id) || !Number.isInteger(v.current_version)) throw notFound();

    const versions = await asMember<Array<{ width: number | null; height: number | null; declared_duration_s: number | string; has_audio: boolean; renditions: string[] }>>(
      env, who.jwt,
      `video_versions?video_id=eq.${videoId}&version_no=eq.${v.current_version}&select=width,height,declared_duration_s,has_audio,renditions`,
      {}, fetchImpl,
    );
    const ver = Array.isArray(versions) ? versions[0] : undefined;
    if (!ver || !Array.isArray(ver.renditions) || !ver.renditions.includes("240p")) throw notFound();

    const prefix = playPrefix(v.owner_id, v.id, v.current_version);
    const exp = Math.floor(now.getTime() / 1000) + PLAY_TOKEN_TTL_S;
    const token = await signPlayToken({ prefix, exp, sub: who.sub, aud: host }, keyB64);
    const base = `https://${host}/${prefix}`;
    const t = `t=${encodeURIComponent(token)}`;
    const out: PlayTokenResponse = {
      video_id: v.id,
      master_url: `${base}master.m3u8?${t}`,
      poster_url: `${base}poster.jpg?${t}`,
      expires_at: exp,
      width: ver.width ?? null,
      height: ver.height ?? null,
      duration_s: Number(ver.declared_duration_s),
      has_audio: ver.has_audio === true,
    };
    return json(200, out);
  } catch (e) {
    if (e instanceof Error && !(e instanceof HttpError) && /^VID-TOK-002/.test(e.message)) {
      return handleError(new HttpError(500, "VID-ENV-001", "MEDIA_TOKEN_KEY is not a base64 32-byte key"));
    }
    return handleError(e);
  }
}

export const onRequest = (context: { request: Request; env: VideoEnv }) => handlePlayToken(context.request, context.env);
