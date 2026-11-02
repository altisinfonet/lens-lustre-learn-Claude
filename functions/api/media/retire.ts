/**
 * POST /api/media/retire {limit?, kind?, after?, dry_run?}   (photo plan U6 / U7)
 * Deletes the files the database has queued (photo_retire, state 'due', marked
 * in the last 24 hours), one batch of ≤ 50 per call, through the PHOTOS binding.
 *
 *   1. SQL `photo_retire_claim` AS the caller (admin or converter only —
 *      PHOTO-RT-001 for everyone else) → (id, kind, key) rows after `after`.
 *   2. isRetireKey (src/lib/media/photoRetire.ts): a key that is not a v2
 *      competition full-size file / an old post file is REFUSED and left alone
 *      (reported by id) — whatever the database said.
 *      A comp_full file whose `-l4f-r2048` copy is NOT in the store is refused
 *      too: the entry must never be left without a photo.
 *   3. HEAD for the size. dry_run: count + bytes only, nothing deleted, nothing
 *      recorded. run: delete, then `photo_retire_done(id, bytes)`; an object
 *      already absent is recorded with 0 bytes.
 * Never writes an object. At most 3 R2 operations and 1 database call per file.
 */
import { asMember, handleError, json, member, readJson, HttpError } from "../video/_lib";
import { bucketFor, rpc, type MediaEnv } from "./derivatives/_lib";
import { isRetireKey, type RetireKind } from "../../../src/lib/media/photoRetire";

interface ClaimRow { id: number; kind: RetireKind; object_key: string }

export async function handleRetire(request: Request, env: MediaEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  try {
    if (request.method !== "POST") throw new HttpError(405, "PHOTO-RT-REQ-000", "POST only");
    const who = await member(request, env, fetchImpl);
    const body = await readJson<{ limit?: unknown; kind?: unknown; after?: unknown; dry_run?: unknown }>(request);
    const limit = typeof body.limit === "number" && Number.isInteger(body.limit) ? Math.min(Math.max(body.limit, 1), 50) : 50;
    const kind = body.kind === "comp_full" || body.kind === "post_old" ? body.kind : null;
    const after = typeof body.after === "number" && Number.isInteger(body.after) && body.after > 0 ? body.after : 0;
    const dryRun = body.dry_run === true;
    const rows = await asMember<ClaimRow[]>(env, who.jwt, ...rpc("photo_retire_claim", { _limit: limit, _kind: kind, _after: after }), fetchImpl);
    const list = Array.isArray(rows) ? rows : [];
    const bucket = bucketFor(env, "public");
    let present = 0, absent = 0, bytes = 0, deleted = 0;
    const refused: number[] = [];
    for (const r of list) {
      if (!isRetireKey(r.kind, r.object_key)) { refused.push(r.id); continue; }
      // A competition full size goes only while its credited 2048 copy is really there.
      if (r.kind === "comp_full" && !(await bucket.head(r.object_key.replace(/-l4f\.webp$/, "-l4f-r2048.webp")))) { refused.push(r.id); continue; }
      const head = await bucket.head(r.object_key);
      const size = head?.size ?? 0;
      if (head) { present++; bytes += size; } else absent++;
      if (dryRun) continue;
      if (head) { await bucket.delete(r.object_key); deleted++; }
      await asMember<boolean>(env, who.jwt, ...rpc("photo_retire_done", { _id: r.id, _bytes: size }), fetchImpl);
    }
    const last_id = list.length ? list[list.length - 1].id : null;
    return json(200, dryRun
      ? { dry_run: true, checked: list.length, would_delete: present, bytes, absent, refused, last_id }
      : { dry_run: false, checked: list.length, deleted, bytes, absent, refused, last_id });
  } catch (e) {
    return handleError(e);
  }
}

export const onRequest = (context: { request: Request; env: MediaEnv }) => handleRetire(context.request, context.env);
