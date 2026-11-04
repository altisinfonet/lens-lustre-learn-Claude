/**
 * /api/media/photoset/oldcredit — PHOTO PLAN · the OLD photos' credited copy
 * (Owner 3 Nov 2026: "credit old all photos from starting: yes"; 20261110_0109).
 * Worker: tools/media-derivatives/old-credit.mjs.
 *
 *   POST {op:"claim", limit?, after?}   → old photos still without a credited copy:
 *                                         post_id, ord, src_url (the CLEAN original the
 *                                         post shows) and the finished credit line
 *   POST {op:"failed", post_id, ord, error}  → counts a photo that could not be drawn;
 *                                         after a few the queue parks it (20261110_0111)
 *   PUT  ?op=credited&post_id=&ord=&version=  body: that photo with the credit (WebP,
 *                                         long edge 1–2048, ≤ 4 MB) → stored at the DERIVED
 *                                         key, one HEAD, then recorded with the version (SQL)
 *
 * Same rules as the U5 / rectify writers: every call asks SQL AS the caller's
 * JWT and the SQL refuses everybody but an admin or the converter account
 * (PHOTO-OC-001); the key is derived by SQL from the photo's current URL
 * (`post-images/<owner>/posts/credit/<post>-<ord>-<md5(url)[:12]>.webp`) and
 * checked again here; the only bytes taken from the worker are the credited
 * copy; NEVER OVERWRITE, NEVER DELETE (an object already at the key is taken
 * as this copy only when it is a WebP of the same size — a retry — else 409).
 * No post is changed: the web finds the copy through post_photo_credit_for.
 */
import { handleError, json, member, readJson, HttpError, UUID_RE } from "../../video/_lib";
import { asMember, bucketFor, parsePhoto, rpc } from "./_lib";
import type { MediaEnv } from "../derivatives/_lib";
import { MAX_DERIVATIVE_BYTES, webpSize } from "../../../../src/lib/media/derivativeRules";
import { CREDIT_GEOMETRY } from "../../../../src/lib/creditGeometry.mjs";
import { isFeedPhotoSet } from "../../../../src/lib/feedPhotoSet.mjs";
import { creditFor } from "./claim";

interface QueueRow { post_id: string; ord: number; src_url: string; owner_full_name: string | null; owner_handle: string | null; owner_is_admin: boolean }

/** The derived key, as SQL names it — re-checked so a wrong row can never point the write elsewhere. */
export const OLD_CREDIT_KEY_RE = /^post-images\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/posts\/credit\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-\d{1,2}-[0-9a-f]{12}\.webp$/;

const IMMUTABLE = { contentType: "image/webp", cacheControl: "public, max-age=31536000, immutable" } as { contentType?: string };

export async function handleOldCredit(request: Request, env: MediaEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  try {
    const q = new URL(request.url).searchParams;
    const who = await member(request, env, fetchImpl);

    if (request.method === "PUT" && q.get("op") === "credited") {
      if (Number(q.get("version")) !== CREDIT_GEOMETRY.version) throw new HttpError(409, "PHOTO-OC-VER-001", `version must be the current credit geometry (${CREDIT_GEOMETRY.version})`);
      const { postId, ord } = parsePhoto(q.get("post_id"), q.get("ord"));
      const rows = await asMember<Array<{ src_url: string; credited_key: string; done: boolean }>>(
        env, who.jwt, ...rpc("photo_old_credit_target", { _post_id: postId, _ord: ord }), fetchImpl);
      const t = Array.isArray(rows) ? rows[0] : undefined;
      if (!t) throw new HttpError(404, "PHOTO-OC-404", "not old-credit work (the post does not name an old photo here)");
      // Owner order, 4 Nov 2026: a feed set photo's credit is NEVER stored (drawn on save in the browser).
      // The SQL class still counts `-l6` as old; this route never writes for one.
      if (isFeedPhotoSet(t.src_url)) throw new HttpError(409, "PHOTO-OC-FEED-001", "a feed set photo (-l6) never gets a stored credited copy — refused");
      if (!OLD_CREDIT_KEY_RE.test(t.credited_key) || !t.credited_key.includes(`/posts/credit/${postId}-${ord}-`)) {
        throw new HttpError(500, "PHOTO-OC-KEY-001", "the database named a key that is not this photo's credited copy — refused");
      }
      if (t.done) return json(200, { status: "already" });
      const declared = Number(request.headers.get("content-length") ?? "0");
      if (declared > MAX_DERIVATIVE_BYTES) throw new HttpError(413, "PHOTO-OC-REQ-003", "copy too large");
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length === 0 || bytes.length > MAX_DERIVATIVE_BYTES) throw new HttpError(413, "PHOTO-OC-REQ-003", "copy empty or too large");
      const dims = webpSize(bytes);
      if (!dims) throw new HttpError(415, "PHOTO-OC-REQ-004", "body is not a WebP");
      if (Math.max(dims.width, dims.height) > 2048 || Math.min(dims.width, dims.height) < 1) {
        throw new HttpError(422, "PHOTO-OC-REQ-005", `a credited copy is at most 2048 px on its long edge, got ${dims.width}x${dims.height}`);
      }
      const bucket = bucketFor(env, "public");
      const was = await bucket.get(t.credited_key, { range: { offset: 0, length: 64 } });
      if (was) {
        const d = webpSize(new Uint8Array(await was.arrayBuffer()));
        if (!d || d.width !== dims.width || d.height !== dims.height) {
          throw new HttpError(409, "PHOTO-OC-409", "a different object already sits at this key — not overwritten");
        }
      } else {
        await bucket.put(t.credited_key, bytes, { httpMetadata: IMMUTABLE });
      }
      if (!(await bucket.head(t.credited_key))) throw new HttpError(409, "PHOTO-OC-INCOMPLETE", "the copy is not in the store after writing it");
      await asMember(env, who.jwt, ...rpc("photo_old_credit_record", { _post_id: postId, _ord: ord, _key: t.credited_key, _version: CREDIT_GEOMETRY.version }), fetchImpl);
      return json(201, { status: was ? "recorded (copy was there)" : "recorded" });
    }

    if (request.method === "POST") {
      const body = await readJson<{ op?: unknown; limit?: unknown; after?: unknown; post_id?: unknown; ord?: unknown; error?: unknown }>(request);
      if (body.op === "claim") {
        const limit = typeof body.limit === "number" && Number.isInteger(body.limit) ? Math.min(Math.max(body.limit, 1), 200) : 50;
        const after = typeof body.after === "string" && UUID_RE.test(body.after) ? body.after : null;
        const rows = await asMember<QueueRow[]>(env, who.jwt, ...rpc("photo_old_credit_queue", { _limit: limit, _after: after }), fetchImpl);
        const parked = await asMember<number>(env, who.jwt, ...rpc("photo_credit_parked_count", {}), fetchImpl);
        // `-l6` feed set photos are never old-credit work, but the SQL class still lists them: they
        // stay in the list (the worker's keyset paging counts every row) and are flagged `skip`;
        // the worker never draws them and the PUT above refuses them.
        return json(200, { parked, jobs: (Array.isArray(rows) ? rows : []).map((r) => ({ post_id: r.post_id, ord: r.ord, src_url: r.src_url, credit: creditFor(r), ...(isFeedPhotoSet(r.src_url) ? { skip: "feed_set" } : {}) })) });
      }
      if (body.op === "failed") {
        const { postId, ord } = parsePhoto(body.post_id, body.ord);
        const attempts = await asMember<number>(env, who.jwt, ...rpc("photo_credit_failed", { _subject: `old/${postId}/${ord}`, _error: String(body.error ?? "") }), fetchImpl);
        return json(200, { attempts });
      }
    }
    throw new HttpError(400, "PHOTO-OC-REQ-000", "op must be claim (POST) or credited (PUT)");
  } catch (e) {
    return handleError(e);
  }
}

export const onRequest = (context: { request: Request; env: MediaEnv }) => handleOldCredit(context.request, context.env);
