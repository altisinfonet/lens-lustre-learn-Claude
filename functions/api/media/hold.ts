/**
 * POST /api/media/hold {op: "move" | "restore", limit?, after?, dry_run?}
 * (photo clean-up, Owner 5 Nov 2026: "GO MOVE"; SQL 20261110_0113)
 *
 * MOVE: the old extra copies the database queued (photo_retire, kind
 * post_extra, state hold_due) go from the public PHOTOS bucket to the private
 * MEDIA bucket at `photo-holding/<key>`, one batch of ≤ 50 per call:
 *   1. SQL `photo_extra_claim` AS the caller (admin or converter only —
 *      PHOTO-EX-002 for everyone else) → (id, key) rows after `after`.
 *   2. isHoldKey (src/lib/media/photoHold.ts): any other key is REFUSED and
 *      left alone (reported by id) — whatever the database said.
 *   3. the copy is written to MEDIA and read back (HEAD, same size) BEFORE the
 *      public file is deleted. A file already in holding with the same size
 *      (a retry after a crash) is taken as moved. Absent everywhere = recorded
 *      with 0 bytes.
 *   4. ONE `photo_extra_record("move", rows)` for the batch.
 * RESTORE: the reverse for held rows — the file goes back to PHOTOS (never over
 * an existing public file), is read back, and only then leaves holding.
 * dry_run: counts + bytes only, nothing written, moved or recorded.
 * Never deletes a file that is not safe in the other bucket first.
 * At most 5 R2 operations per file and 3 database calls per batch.
 */
import { asMember, handleError, json, member, readJson, HttpError } from "../video/_lib";
import { bucketFor, rpc, type MediaEnv } from "./derivatives/_lib";
import { holdKeyFor, isHoldKey } from "../../../src/lib/media/photoHold";

interface ClaimRow { id: number; object_key: string }
type Op = "move" | "restore";

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
    let done = 0, absent = 0, bytes = 0;
    const refused: number[] = [];
    const record: Array<{ id: number; bytes: number }> = [];
    for (const r of list) {
      if (!isHoldKey(r.object_key)) { refused.push(r.id); continue; }
      const srcKey = op === "move" ? r.object_key : holdKeyFor(r.object_key);
      const dstKey = op === "move" ? holdKeyFor(r.object_key) : r.object_key;
      const src = await from.head(srcKey);
      const dst = await to.head(dstKey);
      if (!src) {
        // Nothing left to carry: already moved (a retry) or never stored.
        if (dst) { done++; bytes += dst.size; record.push({ id: r.id, bytes: dst.size }); }
        else if (op === "move") { absent++; record.push({ id: r.id, bytes: 0 }); }
        else refused.push(r.id); // restore with the file in neither bucket: never mark it restored
        continue;
      }
      if (dryRun) { done++; bytes += src.size; continue; }
      if (dst && dst.size !== src.size) { refused.push(r.id); continue; } // a different file is in the way: touch nothing
      if (!dst) {
        const obj = await from.get(srcKey);
        if (!obj) { refused.push(r.id); continue; }
        await to.put(dstKey, await obj.arrayBuffer(), { httpMetadata: { contentType: "image/webp" } });
        const check = await to.head(dstKey);
        if (!check || check.size !== src.size) { refused.push(r.id); continue; }
      }
      await from.delete(srcKey);
      done++; bytes += src.size;
      record.push({ id: r.id, bytes: src.size });
    }
    if (!dryRun && record.length) {
      await asMember<number>(env, who.jwt, ...rpc("photo_extra_record", { _op: op, _rows: record }), fetchImpl);
    }
    const last_id = list.length ? list[list.length - 1].id : null;
    return json(200, { op, dry_run: dryRun, checked: list.length, [dryRun ? "would_move" : "moved"]: done, bytes, absent, refused, last_id });
  } catch (e) {
    return handleError(e);
  }
}

export const onRequest = (context: { request: Request; env: MediaEnv }) => handleHold(context.request, context.env);
