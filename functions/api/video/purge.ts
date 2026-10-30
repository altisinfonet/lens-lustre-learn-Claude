/**
 * POST /api/video/purge {limit?}   (S7-a · the video FILE deleter)
 *
 * Drains public.video_r2_purge_queue (20261030_0700). Called with the JWT of an
 * admin or the converter account (the SQL refuses anyone else), on a schedule,
 * by tools/video-purge/run.mjs. Per call, at most `limit` (1–10, default 5)
 * rows, to stay inside Cloudflare's per-request call budget.
 *
 * For each row the database hands out (video_purge_claim — it has already
 * decided the files are NOT referenced, and leased the row for 10 minutes):
 *   1. the prefix is checked again here: it must be exactly
 *      video/<owner>/<video>/ or video/<owner>/<video>/v<n>/ for the row's own
 *      owner and video — anything else is refused and recorded as an error;
 *   2. every object under it is listed and deleted through the lane's MEDIA
 *      binding (1,000 keys per call); for a whole video, the matching
 *      upload/video/<owner>/<video>/ leftovers go too;
 *   3. video_purge_done records the count — or the error, which releases the
 *      lease so a later run retries. Deleting is idempotent: a second run over
 *      the same prefix finds nothing and deletes nothing.
 *
 * Never touches photo/, post-images/, upload/source/ or any other folder.
 * Answers counts and row ids only (no member data).
 */
import { HttpError, asMember, handleError, json, member, needEnv, readJson, UUID_RE, withCors, type R2BucketLike, type VideoEnv } from "./_lib";

interface PurgeRow { id: number; video_id: string; owner_id: string; prefix: string; whole: boolean }

const PREFIX_RE = /^video\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/(v[1-9][0-9]{0,5}\/)?$/;

/** The folders this row may empty, or null when its prefix is not one it may name. */
export function purgeFolders(row: PurgeRow): string[] | null {
  const m = PREFIX_RE.exec(row.prefix);
  if (!m || !UUID_RE.test(m[1]) || !UUID_RE.test(m[2]) || m[1] !== row.owner_id || m[2] !== row.video_id) return null;
  const whole = m[3] === undefined;
  if (whole !== row.whole) return null;
  return whole ? [row.prefix, `upload/video/${row.owner_id}/${row.video_id}/`] : [row.prefix];
}

/** Lists and deletes everything under one folder; returns how many objects went. */
export async function emptyFolder(bucket: R2BucketLike, prefix: string): Promise<number> {
  let n = 0;
  let cursor: string | undefined;
  for (let page = 0; page < 50; page++) {
    const res = await bucket.list({ prefix, cursor });
    const keys = res.objects.map((o) => o.key).filter((k) => k.startsWith(prefix));
    if (keys.length > 0) {
      await bucket.delete(keys);
      n += keys.length;
    }
    // Deleting shifts the listing, so a truncated page is re-listed from the start.
    if (!res.truncated) return n;
    cursor = keys.length > 0 ? undefined : res.cursor;
  }
  throw new Error("too many pages under one prefix");
}

export function handlePurge(request: Request, env: VideoEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  return withCors(request, env, () => purge(request, env, fetchImpl));
}

async function purge(request: Request, env: VideoEnv, fetchImpl: typeof fetch): Promise<Response> {
  try {
    if (request.method !== "POST") throw new HttpError(405, "VID-REQ-000", "POST only");
    const bucket = needEnv(env, "MEDIA");
    const who = await member(request, env, fetchImpl);
    const body = await readJson<{ limit?: unknown }>(request);
    const limit = typeof body.limit === "number" && Number.isInteger(body.limit) ? Math.min(Math.max(body.limit, 1), 10) : 5;
    const call = <T>(fn: string, args: Record<string, unknown>) =>
      asMember<T>(env, who.jwt, `rpc/${fn}`, { method: "POST", body: JSON.stringify(args) }, fetchImpl);

    const rows = await call<PurgeRow[]>("video_purge_claim", { _limit: limit });
    const done: Array<{ id: number; objects: number }> = [];
    const failed: Array<{ id: number; error: string }> = [];
    for (const row of Array.isArray(rows) ? rows : []) {
      try {
        const folders = purgeFolders(row);
        if (!folders) throw new Error("refused: prefix does not name this row's video folder");
        let objects = 0;
        for (const f of folders) objects += await emptyFolder(bucket, f);
        await call<string>("video_purge_done", { _id: row.id, _objects: objects, _error: null });
        done.push({ id: row.id, objects });
      } catch (e) {
        const error = (e instanceof Error ? e.message : String(e)).slice(0, 200);
        failed.push({ id: row.id, error });
        try { await call<string>("video_purge_done", { _id: row.id, _objects: 0, _error: error }); } catch { /* the lease lapses in 10 min */ }
      }
    }
    return json(200, { claimed: Array.isArray(rows) ? rows.length : 0, done, failed });
  } catch (e) {
    return handleError(e);
  }
}

export const onRequest = (context: { request: Request; env: VideoEnv }) => handlePurge(context.request, context.env);
