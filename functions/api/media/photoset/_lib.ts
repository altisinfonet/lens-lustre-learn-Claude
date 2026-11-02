/**
 * PHOTO PLAN U5 · the photo-set backfill writer — shared bits (claim / source / put / done).
 *
 * An OLD post photo gets the v2 set (credited 2048 / 1080 / 600 / 320, names in
 * src/lib/media/photoSetBackfill.ts) written BESIDE it. The worker
 * (tools/media-derivatives/photo-set.mjs) does the image work; these routes
 * decide nothing about WHO may write: every route calls a SQL function AS the
 * caller's JWT and the SQL refuses everybody but an admin or the converter
 * account (PHOTO-BF-001, 42501). They hold no service key.
 *
 * REFUSALS, independent of the database:
 *   · the source must be an old photo in a member's post-images folder
 *     (isBackfillSource) — never an avatar, a derivative, a v2 photo, a path trick;
 *   · every key written is DERIVED here from that source + its own header size —
 *     the worker never names a key;
 *   · the body must be a WebP of exactly the planned size, ≤ 4 MB;
 *   · NEVER OVERWRITE, NEVER DELETE: an object already at the key is taken as
 *     this copy only when it is a WebP of this copy's exact size, else 409.
 *   · done records the set only when EVERY planned copy is in the store.
 * At most 3 R2 operations and 2 database calls per put; 5 R2 heads per done.
 */
import { asMember, HttpError, UUID_RE } from "../../video/_lib";
import { bucketFor, rpc, type MediaEnv } from "../derivatives/_lib";
import { webpSize } from "../../../../src/lib/media/derivativeRules";
import { backfillMasterKey, backfillSlots, isBackfillSource, type BackfillCopy } from "../../../../src/lib/media/photoSetBackfill";

export interface BackfillTarget {
  sourceKey: string;
  done: boolean;
  plan: BackfillCopy[];
  masterKey: string;
}

/** post_id (uuid) + ord (0-based slide index, 0–49) from a query string or body. */
export function parsePhoto(postId: unknown, ord: unknown): { postId: string; ord: number } {
  const o = typeof ord === "string" && /^\d{1,2}$/.test(ord) ? Number(ord) : ord;
  if (typeof postId !== "string" || !UUID_RE.test(postId) || typeof o !== "number" || !Number.isInteger(o) || o < 0 || o > 49) {
    throw new HttpError(400, "PHOTO-BF-REQ-001", "post_id (uuid) and ord (0–49) are required");
  }
  return { postId, ord: o };
}

/**
 * The SQL target AS the caller, then the source's real size from its own WebP
 * header (a 64-byte ranged read). 404 when the photo is not backfill work.
 */
export async function loadTarget(env: MediaEnv, jwt: string, postId: string, ord: number, fetchImpl: typeof fetch): Promise<BackfillTarget> {
  const rows = await asMember<Array<{ source_key: string; done: boolean }>>(
    env, jwt, ...rpc("photo_set_backfill_target", { _post_id: postId, _ord: ord }), fetchImpl);
  const t = Array.isArray(rows) ? rows[0] : undefined;
  if (!t) throw new HttpError(404, "PHOTO-BF-404", "not backfill work (not an old photo in this lane's photo bucket)");
  if (!isBackfillSource(t.source_key)) throw new HttpError(500, "PHOTO-BF-KEY-001", "the database named a source outside a member's post-images folder — refused");
  const obj = await bucketFor(env, "public").get(t.source_key, { range: { offset: 0, length: 64 } });
  if (!obj) throw new HttpError(404, "PHOTO-BF-404", "the old photo is not in the photo bucket");
  const dims = webpSize(new Uint8Array(await obj.arrayBuffer()));
  if (!dims) throw new HttpError(422, "PHOTO-BF-SRC-001", "the old photo is not a WebP — not backfilled");
  const plan = backfillSlots(dims.width, dims.height);
  const master = plan.find((c) => c.slot === "master");
  if (!master) throw new HttpError(422, "PHOTO-BF-SRC-001", "the old photo has no size");
  return { sourceKey: t.source_key, done: !!t.done, plan, masterKey: backfillMasterKey(t.source_key, master.width, master.height) };
}

export { asMember, rpc, bucketFor };
