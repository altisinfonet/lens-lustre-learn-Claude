/**
 * /api/media/photoset/rectify — PHOTO PLAN · rectify the `-l4` posts (Owner-approved 3 Nov 2026).
 * Key rules: src/lib/media/photoL4Rectify.ts. Worker: tools/media-derivatives/rectify-l4.mjs.
 *
 *   POST {op:"claim"}                    → the `-l4` photos still to do, with the credit line
 *   GET  ?op=source&post_id=&ord=        → the photo's CLEAN 1080 (`-l4-r1080`) bytes + x-rectify-size
 *   PUT  ?op=credited&post_id=&ord=      body: that 1080 with the small credit → `-l5-r2048c`
 *   POST {op:"done", post_id, ord}       → server-side copies (clean 1080 → `-l5`, thumb, 320),
 *                                          one HEAD per copy, then the record (SQL)
 *
 * Same rules as the U5 writer (./_lib.ts): every route asks SQL AS the caller's
 * JWT and the SQL refuses everybody but an admin or the converter account
 * (PHOTO-RX-001); every key is DERIVED here from the photo's current URL and
 * the real size of its clean 1080; the only bytes taken from the worker are the
 * credited copy, which must be a WebP of exactly that size, ≤ 4 MB; NEVER
 * OVERWRITE, NEVER DELETE (an object already at a key is accepted only when it
 * is a WebP of the planned size, else 409). Changes nothing a member sees: the
 * post is repointed only by 20261110_0107 (reversible).
 */
import { handleError, json, member, readJson, HttpError } from "../../video/_lib";
import { asMember, bucketFor, parsePhoto, rpc } from "./_lib";
import type { MediaEnv } from "../derivatives/_lib";
import { MAX_DERIVATIVE_BYTES, webpSize } from "../../../../src/lib/media/derivativeRules";
import { rectifyCleanKey, rectifyKeys, type RectifyKeys } from "../../../../src/lib/media/photoL4Rectify";
import { creditFor } from "./claim";
import { CREDIT_GEOMETRY } from "../../../../src/lib/creditGeometry.mjs";

type Bucket = ReturnType<typeof bucketFor>;
interface QueueRow { post_id: string; ord: number; owner_full_name: string | null; owner_handle: string | null; owner_is_admin: boolean }

async function header(bucket: Bucket, key: string): Promise<{ width: number; height: number } | null> {
  const o = await bucket.get(key, { range: { offset: 0, length: 64 } });
  return o ? webpSize(new Uint8Array(await o.arrayBuffer())) : null;
}

/** The SQL target AS the caller, then the keys from the clean 1080's real size. */
async function target(env: MediaEnv, jwt: string, postId: string, ord: number, fetchImpl: typeof fetch): Promise<{ keys: RectifyKeys; w: number; h: number; done: boolean }> {
  const rows = await asMember<Array<{ source_key: string; done: boolean }>>(env, jwt, ...rpc("photo_l4_rectify_target", { _post_id: postId, _ord: ord }), fetchImpl);
  const t = Array.isArray(rows) ? rows[0] : undefined;
  if (!t) throw new HttpError(404, "PHOTO-RX-404", "not rectify work (the post does not name a -l4 photo here)");
  const clean = rectifyCleanKey(t.source_key);
  if (!clean) throw new HttpError(500, "PHOTO-RX-KEY-001", "the database named a key that is not a large -l4 post photo — refused");
  const dims = await header(bucketFor(env, "public"), clean);
  if (!dims) throw new HttpError(404, "PHOTO-RX-404", "the photo's clean 1080 is not in the photo bucket");
  const keys = rectifyKeys(t.source_key, dims.width, dims.height);
  if (!keys) throw new HttpError(422, "PHOTO-RX-SRC-001", `the clean copy (${dims.width}x${dims.height}) is not this photo's 1080`);
  return { keys, w: dims.width, h: dims.height, done: !!t.done };
}

/** Never overwrite: true when a WebP of exactly w×h is already there (a retry), 409 when anything else is. */
async function alreadyThere(bucket: Bucket, key: string, w: number | null, h: number | null): Promise<boolean> {
  const was = await bucket.head(key);
  if (!was) return false;
  const d = await header(bucket, key);
  if (!d || (w !== null && (d.width !== w || d.height !== h))) {
    throw new HttpError(409, "PHOTO-RX-409", "a different object already sits at this key — not overwritten");
  }
  return true;
}

const IMMUTABLE = { contentType: "image/webp", cacheControl: "public, max-age=31536000, immutable" } as { contentType?: string };

/*
 * REDRAW (photo plan v3, 20261110_0108; Owner 3 Nov 12:45Z "1/3 text font small
 * and 50% opacity down"): a RECORDED rectified photo's credited copy is redrawn
 * with the current shared geometry. The ONLY overwrite this route ever does:
 *   · the key is derived here from the SQL target (the -l5 URL the post shows)
 *     → `<that>-r2048c.webp`, nothing else;
 *   · the body must be a WebP of exactly the credited copy's CURRENT size;
 *   · `version` must be the current geometry version (src/lib/creditGeometry.mjs).
 * The credited copy is a derived file (the clean copy is untouched), and the
 * web loads credited copies as `?cv=<urlVersion>` (raised only after the redraw ran on the lane), so no cache keeps the old one.
 */
const L5_KEY_RE = /^post-images\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/posts\/[A-Za-z0-9_.-]+-w\d{1,4}h\d{1,4}-l5\.webp$/;
async function redrawTarget(env: MediaEnv, jwt: string, postId: string, ord: number, fetchImpl: typeof fetch): Promise<{ urlKey: string; credKey: string; w: number; h: number; version: number }> {
  const rows = await asMember<Array<{ url_key: string; credit_version: number }>>(env, jwt, ...rpc("photo_credit_redraw_target", { _post_id: postId, _ord: ord }), fetchImpl);
  const t = Array.isArray(rows) ? rows[0] : undefined;
  if (!t) throw new HttpError(404, "PHOTO-RX-404", "not a recorded rectified photo the post still shows");
  if (!L5_KEY_RE.test(t.url_key) || t.url_key.includes("..")) throw new HttpError(500, "PHOTO-RX-KEY-001", "the database named a key that is not a -l5 post photo — refused");
  const credKey = t.url_key.replace(/\.webp$/, "-r2048c.webp");
  const dims = await header(bucketFor(env, "public"), credKey);
  if (!dims) throw new HttpError(404, "PHOTO-RX-404", "this photo has no credited copy to redraw");
  return { urlKey: t.url_key, credKey, w: dims.width, h: dims.height, version: t.credit_version };
}

export async function handleRectify(request: Request, env: MediaEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  try {
    const q = new URL(request.url).searchParams;
    const who = await member(request, env, fetchImpl);

    if (request.method === "GET" && q.get("op") === "redraw-source") {
      const { postId, ord } = parsePhoto(q.get("post_id"), q.get("ord"));
      const t = await redrawTarget(env, who.jwt, postId, ord, fetchImpl);
      const obj = await bucketFor(env, "public").get(t.urlKey);
      if (!obj) throw new HttpError(404, "PHOTO-RX-404", "the photo's clean copy is not in the photo bucket");
      return new Response(await obj.arrayBuffer(), {
        status: 200,
        headers: { "content-type": "application/octet-stream", "cache-control": "no-store", "x-content-type-options": "nosniff", "x-rectify-size": `${t.w}x${t.h}`, "x-credit-version": String(CREDIT_GEOMETRY.version) },
      });
    }

    if (request.method === "PUT" && q.get("op") === "redraw") {
      const { postId, ord } = parsePhoto(q.get("post_id"), q.get("ord"));
      if (Number(q.get("version")) !== CREDIT_GEOMETRY.version) throw new HttpError(409, "PHOTO-RX-VER-001", `version must be the current credit geometry (${CREDIT_GEOMETRY.version})`);
      const t = await redrawTarget(env, who.jwt, postId, ord, fetchImpl);
      if (t.version >= CREDIT_GEOMETRY.version) return json(200, { status: "already" });
      const declared = Number(request.headers.get("content-length") ?? "0");
      if (declared > MAX_DERIVATIVE_BYTES) throw new HttpError(413, "PHOTO-RX-REQ-003", "copy too large");
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length === 0 || bytes.length > MAX_DERIVATIVE_BYTES) throw new HttpError(413, "PHOTO-RX-REQ-003", "copy empty or too large");
      const dims = webpSize(bytes);
      if (!dims) throw new HttpError(415, "PHOTO-RX-REQ-004", "body is not a WebP");
      if (dims.width !== t.w || dims.height !== t.h) throw new HttpError(422, "PHOTO-RX-REQ-005", `expected ${t.w}x${t.h}, got ${dims.width}x${dims.height}`);
      await bucketFor(env, "public").put(t.credKey, bytes, { httpMetadata: IMMUTABLE });
      await asMember(env, who.jwt, ...rpc("photo_credit_redraw_record", { _post_id: postId, _ord: ord, _version: CREDIT_GEOMETRY.version }), fetchImpl);
      return json(201, { status: "redrawn" });
    }

    if (request.method === "GET" && q.get("op") === "source") {
      const { postId, ord } = parsePhoto(q.get("post_id"), q.get("ord"));
      const t = await target(env, who.jwt, postId, ord, fetchImpl);
      const obj = await bucketFor(env, "public").get(t.keys.from.r1080);
      if (!obj) throw new HttpError(404, "PHOTO-RX-404", "the photo's clean 1080 is not in the photo bucket");
      return new Response(await obj.arrayBuffer(), {
        status: 200,
        headers: { "content-type": "application/octet-stream", "cache-control": "no-store", "x-content-type-options": "nosniff", "x-rectify-size": `${t.w}x${t.h}` },
      });
    }

    if (request.method === "PUT" && q.get("op") === "credited") {
      const { postId, ord } = parsePhoto(q.get("post_id"), q.get("ord"));
      const t = await target(env, who.jwt, postId, ord, fetchImpl);
      if (t.done) return json(200, { status: "already" });
      const declared = Number(request.headers.get("content-length") ?? "0");
      if (declared > MAX_DERIVATIVE_BYTES) throw new HttpError(413, "PHOTO-RX-REQ-003", "copy too large");
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length === 0 || bytes.length > MAX_DERIVATIVE_BYTES) throw new HttpError(413, "PHOTO-RX-REQ-003", "copy empty or too large");
      const dims = webpSize(bytes);
      if (!dims) throw new HttpError(415, "PHOTO-RX-REQ-004", "body is not a WebP");
      if (dims.width !== t.w || dims.height !== t.h) throw new HttpError(422, "PHOTO-RX-REQ-005", `expected ${t.w}x${t.h}, got ${dims.width}x${dims.height}`);
      const bucket = bucketFor(env, "public");
      if (await alreadyThere(bucket, t.keys.to.credited, t.w, t.h)) return json(200, { status: "exists" });
      await bucket.put(t.keys.to.credited, bytes, { httpMetadata: IMMUTABLE });
      return json(201, { status: "stored" });
    }

    if (request.method === "POST") {
      const body = await readJson<{ op?: unknown; post_id?: unknown; ord?: unknown; limit?: unknown }>(request);
      if (body.op === "redraw-claim") {
        const rows = await asMember<QueueRow[]>(env, who.jwt, ...rpc("photo_credit_redraw_queue", { _version: CREDIT_GEOMETRY.version }), fetchImpl);
        return json(200, { version: CREDIT_GEOMETRY.version, jobs: (Array.isArray(rows) ? rows : []).map((r) => ({ post_id: r.post_id, ord: r.ord, credit: creditFor(r) })) });
      }
      if (body.op === "claim") {
        const rows = await asMember<QueueRow[]>(env, who.jwt, ...rpc("photo_l4_rectify_queue", {}), fetchImpl);
        return json(200, { jobs: (Array.isArray(rows) ? rows : []).map((r) => ({ post_id: r.post_id, ord: r.ord, credit: creditFor(r) })) });
      }
      if (body.op === "done") {
        const { postId, ord } = parsePhoto(body.post_id, body.ord);
        const t = await target(env, who.jwt, postId, ord, fetchImpl);
        if (t.done) return json(200, { status: "already" });
        const bucket = bucketFor(env, "public");
        if (!(await alreadyThere(bucket, t.keys.to.credited, t.w, t.h))) {
          throw new HttpError(409, "PHOTO-RX-INCOMPLETE", "the credited copy is not in the store yet — PUT op=credited first");
        }
        // Server-side copies of the clean files the photo already has (no bytes from the worker).
        for (const [from, to] of [[t.keys.from.r1080, t.keys.to.url], [t.keys.from.thumb, t.keys.to.thumb], [t.keys.from.r320, t.keys.to.r320]] as const) {
          const src = await bucket.get(from);
          if (!src) throw new HttpError(404, "PHOTO-RX-404", `a clean copy of this photo is missing (${from.split("-").pop()})`);
          const buf = new Uint8Array(await src.arrayBuffer());
          const d = webpSize(buf);
          if (!d) throw new HttpError(422, "PHOTO-RX-SRC-002", "a clean copy is not a WebP");
          if (await alreadyThere(bucket, to, d.width, d.height)) continue;
          await bucket.put(to, buf, { httpMetadata: IMMUTABLE });
        }
        for (const k of [t.keys.to.url, t.keys.to.credited, t.keys.to.thumb, t.keys.to.r320]) {
          if (!(await bucket.head(k))) throw new HttpError(409, "PHOTO-RX-INCOMPLETE", "a copy is not in the store after writing it");
        }
        await asMember(env, who.jwt, ...rpc("photo_l4_rectify_record", { _post_id: postId, _ord: ord, _new_key: t.keys.to.url }), fetchImpl);
        return json(201, { status: "recorded" });
      }
    }
    throw new HttpError(400, "PHOTO-RX-REQ-000", "op must be claim / done / redraw-claim (POST), source / redraw-source (GET) or credited / redraw (PUT)");
  } catch (e) {
    return handleError(e);
  }
}

export const onRequest = (context: { request: Request; env: MediaEnv }) => handleRectify(context.request, context.env);
