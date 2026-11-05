/**
 * POST /api/media/hold {op: "move" | "restore", limit?, after?, dry_run?}
 * (photo clean-up, Owner 5 Nov 2026: "GO MOVE"; SQL 20261110_0113)
 *
 * MOVE: the old extra copies the database queued (photo_retire, kind
 * post_extra, state hold_due) go from the public PHOTOS bucket to the private
 * MEDIA bucket at `photo-holding/<key>`, one batch of ≤ 50 per call:
 *   1. SQL `photo_extra_claim` AS the caller (admin or converter only —
 *      PHOTO-EX-002 for everyone else) → (id, key) rows after `after`. The
 *      claim re-checks that no post shows the file right now.
 *   2. isHoldKey (src/lib/media/photoHold.ts): any other key is REFUSED and
 *      left alone (reported by id) — whatever the database said.
 *   3. COPY: each file is written to MEDIA with its own metadata (cache
 *      headers kept) and read back (HEAD, same size). A file already at the
 *      destination counts only when it is the SAME file (same size and the
 *      same single-part etag); anything else there = refused, nothing touched.
 *   4. RECORD: ONE `photo_extra_record("move", rows)` for the batch — before
 *      any source file is deleted, so a failure here leaves every file where it
 *      was (plus a harmless copy) and the rows still queued.
 *   5. DELETE the public copies of the recorded rows.
 * A file in neither bucket is recorded `absent` (the SQL keeps the row as
 * 'kept': nothing to hold, nothing to restore).
 * RESTORE: the same steps the other way for held rows — never over a different
 * public file.
 * dry_run: counts + bytes only, nothing written, moved or recorded.
 */
import { asMember, handleError, json, member, readJson, HttpError, type R2BucketLike } from "../video/_lib";
import { bucketFor, rpc, type MediaEnv } from "./derivatives/_lib";
import { holdKeyFor, isHoldKey } from "../../../src/lib/media/photoHold";

interface ClaimRow { id: number; object_key: string }
type Op = "move" | "restore";
type Head = { size: number; etag?: string } | null;
interface Meta { httpMetadata?: Record<string, string>; customMetadata?: Record<string, string> }

/** The same stored file: equal size AND equal single-part (MD5) etags. Unknown = not the same. */
function sameFile(a: Head, b: Head): boolean {
  if (!a || !b || a.size !== b.size || !a.etag || !b.etag) return false;
  if (a.etag.includes("-") || b.etag.includes("-")) return false;
  return a.etag.replace(/"/g, "") === b.etag.replace(/"/g, "");
}

async function copy(from: R2BucketLike, to: R2BucketLike, srcKey: string, dstKey: string, size: number): Promise<boolean> {
  const obj = await from.get(srcKey);
  if (!obj) return false;
  const meta = obj as unknown as Meta;
  await to.put(dstKey, await obj.arrayBuffer(), {
    httpMetadata: { contentType: "image/webp", ...(meta.httpMetadata ?? {}) },
    ...(meta.customMetadata ? { customMetadata: meta.customMetadata } : {}),
  });
  const check = await to.head(dstKey);
  return !!check && check.size === size;
}

export async function handleHold(request: Request, env: MediaEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  try {
    if (request.method !== "POST") throw new HttpError(405, "PHOTO-HOLD-REQ-000", "POST only");
    const who = await member(request, env, fetchImpl);
    const body = await readJson<{ op?: unknown; limit?: unknown; after?: unknown; dry_run?: unknown }>(request);
    if (body.op !== "move" && body.op !== "restore") throw new HttpError(400, "PHOTO-HOLD-REQ-001", "op must be move or restore");
    const op: Op = body.op;
    const limit = typeof body.limit === "number" && Number.isInteger(body.limit) ? Math.min(Math.max(body.limit, 1), 50) : 50;
    const after = typeof body.after === "number" && Number.isInteger(body.after) && body.after > 0 ? body.after : 0;
    const dryRun = body.dry_run === true;
    const rows = await asMember<ClaimRow[]>(env, who.jwt, ...rpc("photo_extra_claim", { _op: op, _limit: limit, _after: after }), fetchImpl);
    const list = Array.isArray(rows) ? rows : [];
    const from = bucketFor(env, op === "move" ? "public" : "private");
    const to = bucketFor(env, op === "move" ? "private" : "public");
    let absent = 0, bytes = 0;
    const refused: number[] = [];
    const record: Array<{ id: number; bytes: number; absent?: true }> = [];
    const toDelete: string[] = [];
    for (const r of list) {
      if (!isHoldKey(r.object_key)) { refused.push(r.id); continue; }
      const srcKey = op === "move" ? r.object_key : holdKeyFor(r.object_key);
      const dstKey = op === "move" ? holdKeyFor(r.object_key) : r.object_key;
      const [src, dst] = await Promise.all([from.head(srcKey), to.head(dstKey)]);
      if (!src) {
        // Nothing left to carry: already at the destination (a retry) or never stored.
        if (dst) { bytes += dst.size; record.push({ id: r.id, bytes: dst.size }); }
        else if (op === "move") { absent++; record.push({ id: r.id, bytes: 0, absent: true }); }
        else refused.push(r.id); // restore with the file in neither bucket: never marked restored
        continue;
      }
      if (dryRun) { bytes += src.size; record.push({ id: r.id, bytes: src.size }); continue; }
      if (dst) {
        if (!sameFile(src, dst)) { refused.push(r.id); continue; } // a different file is in the way: touch nothing
      } else if (!(await copy(from, to, srcKey, dstKey, src.size))) { refused.push(r.id); continue; }
      bytes += src.size;
      record.push({ id: r.id, bytes: src.size });
      toDelete.push(srcKey);
    }
    const done = record.filter((x) => !x.absent).length;
    if (!dryRun && record.length) {
      await asMember<number>(env, who.jwt, ...rpc("photo_extra_record", { _op: op, _rows: record }), fetchImpl);
      for (const k of toDelete) await from.delete(k);
    }
    const last_id = list.length ? list[list.length - 1].id : null;
    return json(200, { op, dry_run: dryRun, checked: list.length, [dryRun ? "would_move" : "moved"]: done, bytes, absent, refused, last_id });
  } catch (e) {
    return handleError(e);
  }
}

export const onRequest = (context: { request: Request; env: MediaEnv }) => handleHold(context.request, context.env);
