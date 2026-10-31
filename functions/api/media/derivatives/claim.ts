/**
 * POST /api/media/derivatives/claim {limit?, after?}   (S3-b)
 * The next slice of missing derivative work, grouped by media. Read-only: the
 * queue IS the missing work, so a crashed or stopped worker resumes by asking
 * again. `after` is a media id cursor so one bad object never blocks the rest.
 */
import { asMember, handleError, json, member, readJson, UUID_RE, HttpError } from "../../video/_lib";
import { rpc, type MediaEnv } from "./_lib";

interface QueueRow { media_id: string; target: "public" | "private"; rung: number; width: number; height: number; src_width: number; src_height: number }

export async function handleClaim(request: Request, env: MediaEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  try {
    if (request.method !== "POST") throw new HttpError(405, "MEDIA-REQ-000", "POST only");
    const who = await member(request, env, fetchImpl);
    const body = await readJson<{ limit?: unknown; after?: unknown }>(request);
    const limit = typeof body.limit === "number" && Number.isInteger(body.limit) ? Math.min(Math.max(body.limit, 1), 50) : 20;
    const after = typeof body.after === "string" && UUID_RE.test(body.after) ? body.after : null;
    const rows = await asMember<QueueRow[]>(env, who.jwt, ...rpc("media_derivative_queue", { _limit: limit, _after: after }), fetchImpl);
    const jobs = new Map<string, { media_id: string; target: string; src_width: number; src_height: number; rungs: Array<{ rung: number; width: number; height: number }> }>();
    for (const r of Array.isArray(rows) ? rows : []) {
      const k = `${r.media_id}|${r.target}`;
      if (!jobs.has(k)) jobs.set(k, { media_id: r.media_id, target: r.target, src_width: r.src_width, src_height: r.src_height, rungs: [] });
      jobs.get(k)!.rungs.push({ rung: r.rung, width: r.width, height: r.height });
    }
    return json(200, { jobs: [...jobs.values()] });
  } catch (e) {
    return handleError(e);
  }
}

export const onRequest = (context: { request: Request; env: MediaEnv }) => handleClaim(context.request, context.env);
