/**
 * /api/media/photoset/setcredit — CREDIT U3: the server draws a new photo's
 * credit (the browser no longer does). 20261110_0111.
 * Worker: tools/media-derivatives/set-credit.mjs. Keys: src/lib/media/photoSetCredit.ts.
 *
 *   POST {op:"claim", limit?, after?}  → v3 photos a post or entry names with no
 *                                        record yet: their key + the finished credit line
 *   POST {op:"source", key}            → the photo's clean bytes (the private clean
 *                                        2048; if none was kept, the public clean file).
 *                                        JSON instead when there is nothing to draw:
 *                                        {status:"already"} recorded,
 *                                        {status:"existing"} a credited file is already
 *                                        stored (an older client's canvas, a rectified
 *                                        photo): recorded as older, never drawn over
 *   PUT  ?op=credited&key=&version=&drawn=  body: the credited copy → stored at the
 *                                        derived key, one HEAD, then recorded (SQL)
 *
 * Same rules as the other photoset writers: every call asks SQL AS the caller's
 * JWT and the SQL refuses everybody but an admin or the converter account
 * (PHOTO-SC-001); a key must be a v3 photo some row names; the only bytes taken
 * from the worker are the credited copy, a WebP of this photo's size, ≤ 4 MB;
 * NEVER OVERWRITE, NEVER DELETE (an object already at the key is taken as this
 * copy only when it is a WebP of the same size, a retry; else 409). The client
 * never gets a new file name: the name is derived from the photo's.
 */
import { handleError, json, member, readJson, HttpError } from "../../video/_lib";
import { asMember, bucketFor, rpc } from "./_lib";
import type { MediaEnv } from "../derivatives/_lib";
import { MAX_DERIVATIVE_BYTES, webpSize } from "../../../../src/lib/media/derivativeRules";
import { creditedSizeOk, photoSetCreditTarget, type PhotoSetCreditTarget } from "../../../../src/lib/media/photoSetCredit";
import { CREDIT_GEOMETRY } from "../../../../src/lib/creditGeometry.mjs";
import { creditFor } from "./claim";

interface QueueRow { photo_key: string; owner_full_name: string | null; owner_handle: string | null; owner_is_admin: boolean }

/** Every credited file drawn before the one renderer is v4 or older; which one is not knowable from the file. */
const OLDER_THAN_V5 = 4;
const IMMUTABLE = { contentType: "image/webp", cacheControl: "public, max-age=31536000, immutable" } as { contentType?: string };

async function target(env: MediaEnv, jwt: string, key: unknown, fetchImpl: typeof fetch): Promise<{ t: PhotoSetCreditTarget; done: boolean }> {
  const t = photoSetCreditTarget(key);
  if (!t) throw new HttpError(400, "PHOTO-SC-REQ-001", "key must be a v3 photo (…-l5.webp / …-l5f.webp)");
  const rows = await asMember<Array<{ done: boolean }>>(env, jwt, ...rpc("photo_set_credit_target", { _key: t.photoKey }), fetchImpl);
  const row = Array.isArray(rows) ? rows[0] : undefined;
  if (!row) throw new HttpError(404, "PHOTO-SC-404", "no post or entry names this photo");
  return { t, done: !!row.done };
}

const record = (env: MediaEnv, jwt: string, key: string, version: number, drawn: boolean, origin: "server" | "existing", fetchImpl: typeof fetch) =>
  asMember(env, jwt, ...rpc("photo_set_credit_record", { _key: key, _version: version, _drawn: drawn, _origin: origin }), fetchImpl);

export async function handleSetCredit(request: Request, env: MediaEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  try {
    const q = new URL(request.url).searchParams;
    const who = await member(request, env, fetchImpl);

    if (request.method === "PUT" && q.get("op") === "credited") {
      if (Number(q.get("version")) !== CREDIT_GEOMETRY.version) throw new HttpError(409, "PHOTO-SC-VER-001", `version must be the current credit geometry (${CREDIT_GEOMETRY.version})`);
      const { t, done } = await target(env, who.jwt, q.get("key"), fetchImpl);
      if (done) return json(200, { status: "already" });
      const declared = Number(request.headers.get("content-length") ?? "0");
      if (declared > MAX_DERIVATIVE_BYTES) throw new HttpError(413, "PHOTO-SC-REQ-003", "copy too large");
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length === 0 || bytes.length > MAX_DERIVATIVE_BYTES) throw new HttpError(413, "PHOTO-SC-REQ-003", "copy empty or too large");
      const dims = webpSize(bytes);
      if (!dims) throw new HttpError(415, "PHOTO-SC-REQ-004", "body is not a WebP");
      if (!creditedSizeOk(t, dims.width, dims.height)) throw new HttpError(422, "PHOTO-SC-REQ-005", `a ${dims.width}x${dims.height} copy is not this photo's credited size`);
      const bucket = bucketFor(env, "public");
      const was = await bucket.get(t.creditedKey, { range: { offset: 0, length: 64 } });
      if (was) {
        const d = webpSize(new Uint8Array(await was.arrayBuffer()));
        if (!d || d.width !== dims.width || d.height !== dims.height) {
          throw new HttpError(409, "PHOTO-SC-409", "a different object already sits at this key — not overwritten");
        }
      } else {
        await bucket.put(t.creditedKey, bytes, { httpMetadata: IMMUTABLE });
      }
      if (!(await bucket.head(t.creditedKey))) throw new HttpError(409, "PHOTO-SC-INCOMPLETE", "the copy is not in the store after writing it");
      await record(env, who.jwt, t.photoKey, CREDIT_GEOMETRY.version, q.get("drawn") !== "0", "server", fetchImpl);
      return json(201, { status: was ? "recorded (copy was there)" : "recorded" });
    }

    if (request.method === "POST") {
      const body = await readJson<{ op?: unknown; limit?: unknown; after?: unknown; key?: unknown }>(request);
      if (body.op === "claim") {
        const limit = typeof body.limit === "number" && Number.isInteger(body.limit) ? Math.min(Math.max(body.limit, 1), 200) : 50;
        const after = typeof body.after === "string" && photoSetCreditTarget(body.after) ? body.after : null;
        const rows = await asMember<QueueRow[]>(env, who.jwt, ...rpc("photo_set_credit_queue", { _limit: limit, _after: after }), fetchImpl);
        return json(200, { version: CREDIT_GEOMETRY.version, jobs: (Array.isArray(rows) ? rows : []).map((r) => ({ key: r.photo_key, credit: creditFor(r) })) });
      }
      if (body.op === "source") {
        const { t, done } = await target(env, who.jwt, body.key, fetchImpl);
        if (done) return json(200, { status: "already" });
        const photos = bucketFor(env, "public");
        if (await photos.head(t.creditedKey)) {
          await record(env, who.jwt, t.photoKey, OLDER_THAN_V5, true, "existing", fetchImpl);
          return json(200, { status: "existing" });
        }
        const clean = await bucketFor(env, "private").get(t.cleanKey);
        const obj = clean ?? (await photos.get(t.photoKey));
        if (!obj) throw new HttpError(404, "PHOTO-SC-404", "the photo is not in the store");
        return new Response(await obj.arrayBuffer(), {
          status: 200,
          headers: { "content-type": "application/octet-stream", "cache-control": "no-store", "x-content-type-options": "nosniff", "x-credit-source": clean ? "clean2048" : "public" },
        });
      }
    }
    throw new HttpError(400, "PHOTO-SC-REQ-000", "op must be claim or source (POST) or credited (PUT)");
  } catch (e) {
    return handleError(e);
  }
}

export const onRequest = (context: { request: Request; env: MediaEnv }) => handleSetCredit(context.request, context.env);
