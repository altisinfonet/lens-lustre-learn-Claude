/**
 * POST /api/video/convert/finish {source_id, claim_token, outcome, code?, detail?}
 *   (server conversion, CONVERTER-DESIGN.md v2 §3 steps 8–11)
 *
 * The converter VM ends its job: outcome "done" (the package went through
 * /complete — video_source_done) or "fail" with a reason CODE from the fixed
 * list (video_source_fail; the member reads fixed text for it, the VM's
 * `detail` reaches only the audit trail). The database checks the claim first;
 * only when it accepted, and the job is over (done or failed — not requeued),
 * is the original deleted from the bucket here, with the Pages binding: the
 * VM never holds a DELETE URL, and cannot delete anything it did not hold the
 * live claim for.
 */
import { HttpError, asMember, handleError, json, member, needEnv, readJson, requirePrivateDelivery, sourceKey, UUID_RE, type VideoEnv } from "../_lib";

export const FAIL_CODES = ["internal", "unsupported_format", "no_video", "too_long", "too_big", "damaged", "source_missing"] as const;

export async function handleConvertFinish(request: Request, env: VideoEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  try {
    if (request.method !== "POST") throw new HttpError(405, "VID-REQ-000", "POST only");
    requirePrivateDelivery(env);
    const who = await member(request, env, fetchImpl);
    const body = await readJson<{ source_id?: string; claim_token?: string; outcome?: string; code?: string; detail?: string }>(request);
    const sourceId = String(body.source_id ?? ""), token = String(body.claim_token ?? "");
    if (!UUID_RE.test(sourceId) || !UUID_RE.test(token)) throw new HttpError(400, "VID-REQ-001", "source_id and claim_token are required");
    let status: string;
    if (body.outcome === "done") {
      await asMember(env, who.jwt, "rpc/video_source_done",
        { method: "POST", body: JSON.stringify({ _source_id: sourceId, _claim_token: token }) }, fetchImpl);
      status = "done";
    } else if (body.outcome === "fail") {
      if (!FAIL_CODES.includes(body.code as (typeof FAIL_CODES)[number])) throw new HttpError(400, "VID-REQ-001", "code must be one of " + FAIL_CODES.join(", "));
      status = await asMember<string>(env, who.jwt, "rpc/video_source_fail", {
        method: "POST",
        body: JSON.stringify({ _source_id: sourceId, _claim_token: token, _code: body.code, _detail: String(body.detail ?? "").slice(0, 250) }),
      }, fetchImpl);
    } else {
      throw new HttpError(400, "VID-REQ-001", 'outcome must be "done" or "fail"');
    }
    if (status === "done" || status === "failed") await needEnv(env, "MEDIA").delete(sourceKey(sourceId));
    return json(200, { source_id: sourceId, status });
  } catch (e) {
    return handleError(e);
  }
}

export const onRequest = (context: { request: Request; env: VideoEnv }) => handleConvertFinish(context.request, context.env);
