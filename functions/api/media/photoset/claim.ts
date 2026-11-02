/**
 * POST /api/media/photoset/claim {limit?, after?}   (photo plan U5)
 * The next slice of old post photos without a v2 set, with the credit line the
 * 2048 copy carries. Read-only: the queue IS the missing work, so a stopped
 * worker resumes by asking again. `after` is a post id cursor (all photos of a
 * post come in the same slice). Member data leaves this route only as the
 * finished credit line (owner name rule: src/lib/photoCredit.ts).
 */
import { handleError, json, member, readJson, UUID_RE, HttpError } from "../../video/_lib";
import { asMember, rpc } from "./_lib";
import type { MediaEnv } from "../derivatives/_lib";
import { creditOwnerName, creditText } from "../../../../src/lib/photoCredit";

interface QueueRow { post_id: string; ord: number; source_key: string; owner_full_name: string | null; owner_handle: string | null; owner_is_admin: boolean }

/** An admin's name resolves to the brand (adminBrand.resolveName), so the line is the brand alone. */
export function creditFor(r: Pick<QueueRow, "owner_full_name" | "owner_handle" | "owner_is_admin">): string {
  return creditText(r.owner_is_admin ? "50mm Retina World" : creditOwnerName({ full_name: r.owner_full_name, custom_url: r.owner_handle }));
}

export async function handlePhotoSetClaim(request: Request, env: MediaEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  try {
    if (request.method !== "POST") throw new HttpError(405, "PHOTO-BF-REQ-000", "POST only");
    const who = await member(request, env, fetchImpl);
    const body = await readJson<{ limit?: unknown; after?: unknown }>(request);
    const limit = typeof body.limit === "number" && Number.isInteger(body.limit) ? Math.min(Math.max(body.limit, 1), 50) : 10;
    const after = typeof body.after === "string" && UUID_RE.test(body.after) ? body.after : null;
    const rows = await asMember<QueueRow[]>(env, who.jwt, ...rpc("photo_set_backfill_queue", { _limit: limit, _after: after }), fetchImpl);
    const jobs = (Array.isArray(rows) ? rows : []).map((r) => ({ post_id: r.post_id, ord: r.ord, source_key: r.source_key, credit: creditFor(r) }));
    return json(200, { jobs });
  } catch (e) {
    return handleError(e);
  }
}

export const onRequest = (context: { request: Request; env: MediaEnv }) => handlePhotoSetClaim(context.request, context.env);
