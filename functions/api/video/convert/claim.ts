/**
 * POST /api/video/convert/claim   (server conversion, CONVERTER-DESIGN.md v2 §3 step 4)
 *
 * The converter VM, with its own JWT, takes the next job (video_source_claim —
 * the database decides who may claim: only the account in
 * video_converter_accounts, one live claim at a time, round-robin by member,
 * never a job whose owner is switched off). Before the original is handed
 * out it is checked AGAIN here — present, the declared size, the ETag recorded
 * at source-complete — because a member could have queued it by calling the
 * RPC directly [R6, review #416 finding 7]. A missing or changed original fails
 * the job as source_missing (final) and is deleted.
 *
 * Answers 200 {job:null} when there is nothing to do, else 200 {job, source}:
 * one presigned GET pinned to that ETag (the signed If-Match header — the VM
 * must send it exactly, and checks the response's ETag and size itself),
 * living no longer than the claim's lease [R2].
 *
 * NO STRANDED CLAIM (review #417 finding 1): everything this needs from the
 * lane is read BEFORE the claim is taken, and anything that goes wrong after
 * it (a storage error, a database hiccup) hands the claim back at once —
 * video_source_fail 'internal', which requeues while attempts remain — instead
 * of leaving a 30-minute claim whose token never reached the VM, which would
 * stall the only converter (one live claim) until the lease ran out.
 */
import {
  HttpError, amzDateOf, asMember, handleError, json, member, needEnv, presign, requirePrivateDelivery, sourceKey, ttlWithinLease,
  type VideoEnv,
} from "../_lib";

export const SOURCE_GET_MAX_TTL_S = 3600;

export interface ClaimedJob {
  source_id: string; owner_id: string; purpose: "post" | "ad"; source_bytes: number; source_etag: string;
  claim_token: string; lease_until: string; attempt: number;
}

export async function handleConvertClaim(request: Request, env: VideoEnv, now: Date = new Date(), fetchImpl: typeof fetch = fetch): Promise<Response> {
  try {
    if (request.method !== "POST") throw new HttpError(405, "VID-REQ-000", "POST only");
    requirePrivateDelivery(env);
    // The lane's configuration first: a missing variable must refuse BEFORE a claim is taken.
    const bucket = needEnv(env, "MEDIA");
    const host = `${needEnv(env, "R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`;
    const bucketName = needEnv(env, "R2_BUCKET");
    const keyId = needEnv(env, "R2_UPLOAD_KEY_ID");
    const secret = needEnv(env, "R2_UPLOAD_KEY_SECRET");
    const who = await member(request, env, fetchImpl);
    const job = await asMember<ClaimedJob | null>(env, who.jwt, "rpc/video_source_claim", { method: "POST", body: "{}" }, fetchImpl);
    if (!job) return json(200, { job: null });

    const fail = (code: "internal" | "source_missing", detail: string) => asMember<string>(env, who.jwt, "rpc/video_source_fail", {
      method: "POST",
      body: JSON.stringify({ _source_id: job.source_id, _claim_token: job.claim_token, _code: code, _detail: detail.slice(0, 250) }),
    }, fetchImpl);

    let problem: string | null = null;
    let obj: { size: number; etag?: string } | null = null;
    let response: Response;
    try {
      const key = sourceKey(job.source_id);
      obj = await bucket.head(key);
      const etag = String(obj?.etag ?? "").replace(/"/g, "");
      problem = !obj ? "no original in the bucket" : obj.size !== Number(job.source_bytes) ? `size ${obj.size} ≠ ${job.source_bytes}`
        : etag !== job.source_etag ? "the original changed after it was queued" : null;
      if (problem) {
        const status = await fail("source_missing", `at claim: ${problem}`);
        // Only a job the database has ended loses its original.
        if (obj && (status === "failed" || status === "done")) await bucket.delete(key);
        throw new HttpError(409, "VID-SRC-007", `the original is not usable (${problem}) — the job was failed`, { source_id: job.source_id });
      }
      const ttl = ttlWithinLease(Date.parse(job.lease_until), now.getTime(), SOURCE_GET_MAX_TTL_S);
      const headers = { "if-match": `"${etag}"` };
      const url = await presign({
        method: "GET", host, path: `/${bucketName}/${key}`, region: "auto", service: "s3",
        accessKeyId: keyId, secretAccessKey: secret, amzDate: amzDateOf(now), expires: ttl, headers,
      });
      response = json(200, { job, source: { url, headers, bytes: Number(job.source_bytes), expires_in: ttl } });
    } catch (e) {
      if (!problem) {
        // Anything else after the claim: hand it back now (best effort), so the VM is not stalled.
        try { await fail("internal", `claim handed back: ${e instanceof Error ? e.message : String(e)}`); } catch { /* the lease runs out */ }
      }
      throw e;
    }
    return response;
  } catch (e) {
    return handleError(e);
  }
}

export const onRequest = (context: { request: Request; env: VideoEnv }) => handleConvertClaim(context.request, context.env);
