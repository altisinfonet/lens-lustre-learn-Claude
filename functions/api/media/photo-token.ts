/**
 * POST /api/media/photo-token {post_ids: uuid[] (≤ 50)}   (S3-d)
 *
 * Photo passes for the friends-only / only-me derivatives a member may see.
 * Authorisation is NOT decided here: the route calls `post_media_resolved_for`
 * AS THE MEMBER (their JWT), so `can_view_post`, the `media_ladder_feed` and
 * `media_private_photos` switches and "all or nothing per post" are the SQL's,
 * exactly as for the URLs the client already holds. Every `photo/…` URL that
 * call returns gets one pass for its prefix photo/<owner>/<media>/.
 * Signed out → 401 (non-public posts are never visible to anon).
 *
 * Environment (Pages, per lane): MEDIA_TOKEN_KEY and MEDIA_CDN_HOST (the same
 * values play-token.ts uses), and PHOTO_DELIVERY_PRIVATE = "1" — set by the
 * Owner only after the Worker route `<cdn host>/photo/*` is live and the curl
 * proofs pass. Until then: 503 and the client falls back to today's path.
 * No service role, no write, nothing cached.
 */
import { asMember, handleError, json, member, needEnv, readJson, withCors, HttpError, UUID_RE } from "../video/_lib";
import { PHOTO_TOKEN_TTL_S, photoPrefixOf, signPhotoToken } from "../../../src/lib/media/photoToken";
import type { MediaEnv } from "./derivatives/_lib";

export interface PhotoTokenEnv extends MediaEnv { PHOTO_DELIVERY_PRIVATE?: string }

interface Row { media_id: string; url: string }

export function handlePhotoToken(request: Request, env: PhotoTokenEnv, now: Date = new Date(), fetchImpl: typeof fetch = fetch): Promise<Response> {
  return withCors(request, env, () => mint(request, env, now, fetchImpl));
}

async function mint(request: Request, env: PhotoTokenEnv, now: Date, fetchImpl: typeof fetch): Promise<Response> {
  try {
    if (request.method !== "POST") throw new HttpError(405, "MEDIA-REQ-000", "POST only");
    if (env.PHOTO_DELIVERY_PRIVATE !== "1") throw new HttpError(503, "PHOTO-ENV-002", "private photo delivery is not live on this lane yet");
    const keyB64 = needEnv(env, "MEDIA_TOKEN_KEY");
    const host = needEnv(env, "MEDIA_CDN_HOST").toLowerCase();
    const body = await readJson<{ post_ids?: unknown }>(request);
    const ids = Array.isArray(body.post_ids) ? body.post_ids.filter((x): x is string => typeof x === "string" && UUID_RE.test(x)) : [];
    if (ids.length === 0 || ids.length > 50 || ids.length !== (body.post_ids as unknown[]).length) {
      throw new HttpError(400, "MEDIA-REQ-002", "post_ids must be 1–50 lowercase uuids");
    }
    const who = await member(request, env, fetchImpl);
    if (!UUID_RE.test(who.uid)) throw new HttpError(401, "VID-AUTH-001", "sign in first");
    const rows = await asMember<Row[]>(env, who.jwt, "rpc/post_media_resolved_for",
      { method: "POST", body: JSON.stringify({ _post_ids: ids }) }, fetchImpl);

    const exp = Math.floor(now.getTime() / 1000) + PHOTO_TOKEN_TTL_S;
    const tokens: Record<string, string> = {};
    for (const r of Array.isArray(rows) ? rows : []) {
      if (!r || typeof r.url !== "string" || tokens[r.media_id]) continue;
      let u: URL;
      try { u = new URL(r.url); } catch { continue; }
      if (u.protocol !== "https:" || u.hostname !== host) continue;
      const prefix = photoPrefixOf(u.pathname.slice(1));
      if (!prefix || prefix.split("/")[2] !== r.media_id) continue;
      tokens[r.media_id] = await signPhotoToken({ prefix, exp, sub: who.uid, aud: host }, keyB64);
    }
    return json(200, { tokens, expires_at: exp });
  } catch (e) {
    if (e instanceof Error && !(e instanceof HttpError) && /^VID-TOK-002/.test(e.message)) {
      return handleError(new HttpError(500, "VID-ENV-001", "MEDIA_TOKEN_KEY is not a base64 32-byte key"));
    }
    return handleError(e);
  }
}

export const onRequest = (context: { request: Request; env: PhotoTokenEnv }) => handlePhotoToken(context.request, context.env);
