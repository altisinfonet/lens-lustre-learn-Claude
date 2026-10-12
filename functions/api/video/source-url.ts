/**
 * POST /api/video/source-url {source_id}   (server conversion, CONVERTER-DESIGN.md v2 §3 step 2)
 *
 * As the member. ONE presigned PUT for their original at
 * upload/source/<source_id>/source: content-length = the size they declared to
 * video_source_begin, content-type fixed to application/octet-stream (whatever
 * the file really is — the converter decides that, never a header), valid 1 h.
 * Asking again (a dropped connection) gets a fresh URL for the same key.
 *
 * Refuses: not signed in (401) · not their source (404, never 403 — a stranger
 * learns nothing) · the source is past waiting for its upload (409).
 */
import {
  HttpError, amzDateOf, asMember, handleError, json, member, needEnv, presign, readJson, requirePrivateDelivery, sourceKey, UUID_RE,
  type VideoEnv,
} from "./_lib";

export const SOURCE_URL_TTL_S = 3600;
export const SOURCE_CONTENT_TYPE = "application/octet-stream";

export interface SourceRow { id: string; owner_id: string; status: string; source_bytes: number | string }

/** The member's own source row, through RLS (video_sources_owner_read). */
export async function loadOwnSource(env: VideoEnv, who: { uid: string; jwt: string }, sourceId: string, fetchImpl: typeof fetch): Promise<SourceRow> {
  if (!UUID_RE.test(sourceId)) throw new HttpError(400, "VID-REQ-001", "source_id must be a lowercase uuid");
  const rows = await asMember<SourceRow[]>(env, who.jwt, `video_sources?id=eq.${sourceId}&select=id,owner_id,status,source_bytes`, {}, fetchImpl);
  const s = rows?.[0];
  if (!s || s.owner_id !== who.uid) throw new HttpError(404, "VID-SRC-004", "no such video of yours");
  return s;
}

export async function handleSourceUrl(request: Request, env: VideoEnv, now: Date = new Date(), fetchImpl: typeof fetch = fetch): Promise<Response> {
  try {
    if (request.method !== "POST") throw new HttpError(405, "VID-REQ-000", "POST only");
    requirePrivateDelivery(env);
    const who = await member(request, env, fetchImpl);
    const body = await readJson<{ source_id?: string }>(request);
    const s = await loadOwnSource(env, who, String(body.source_id ?? ""), fetchImpl);
    if (s.status !== "awaiting_upload") throw new HttpError(409, "VID-SRC-008", `the video is ${s.status}, not waiting for its upload`);
    const bytes = Number(s.source_bytes);
    if (!Number.isInteger(bytes) || bytes < 1 || bytes > 524288000) throw new HttpError(409, "VID-SRC-009", "the declared size is not valid");
    const key = sourceKey(s.id);
    const headers = { "content-type": SOURCE_CONTENT_TYPE };
    const url = await presign({
      method: "PUT", host: `${needEnv(env, "R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`, path: `/${needEnv(env, "R2_BUCKET")}/${key}`,
      region: "auto", service: "s3", accessKeyId: needEnv(env, "R2_UPLOAD_KEY_ID"), secretAccessKey: needEnv(env, "R2_UPLOAD_KEY_SECRET"),
      amzDate: amzDateOf(now), expires: SOURCE_URL_TTL_S, headers: { ...headers, "content-length": String(bytes) },
    });
    return json(200, { source_id: s.id, key, url, headers, bytes, expires_in: SOURCE_URL_TTL_S });
  } catch (e) {
    return handleError(e);
  }
}

export const onRequest = (context: { request: Request; env: VideoEnv }) => handleSourceUrl(context.request, context.env);
