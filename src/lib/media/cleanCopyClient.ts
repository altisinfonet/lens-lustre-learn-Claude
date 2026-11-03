/**
 * PHOTO PLAN UNIT A · the uploader's side of the private clean 2048
 * (rules: ./cleanCopy.ts; route: functions/api/media/clean-copy.ts).
 *
 * The copy is an ARCHIVE: nothing a member sees depends on it, so a refusal
 * never fails a post. The answers:
 *   "stored" / "exists"   kept (or kept earlier — a retry)
 *   "refused"             the route said no (4xx / 503 — e.g. the lane's MEDIA
 *                         binding is missing); logged as FILE-5015, not retried
 *   throws                the network failed — the caller decides (the
 *                         resumable job retries it like any other part)
 */
import { supabase } from "@/integrations/supabase/client";
import { SITE_API, siteUrl } from "@/lib/net/siteApi";
import { logger } from "@/lib/logger";
import { cleanCopyUploadKey } from "./cleanCopy";

const FILE = "src/lib/media/cleanCopyClient.ts";

export type CleanCopyResult = "stored" | "exists" | "refused";

/** `publicKey` = the photo's bucket-qualified key (`post-images/<uid>/posts/…-l5.webp`). */
export async function storeCleanCopy(publicKey: string, blob: Blob): Promise<CleanCopyResult> {
  const { data } = await supabase.auth.getSession();
  const jwt = data.session?.access_token;
  if (!jwt) return refused(publicKey, 401, "not signed in");
  const res = await fetch(`${siteUrl(SITE_API.mediaCleanCopy)}?key=${encodeURIComponent(cleanCopyUploadKey(publicKey))}`, {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}`, "content-type": "image/webp" },
    body: blob,
  });
  if (res.ok) {
    const body = (await res.json().catch(() => ({}))) as { status?: string };
    return body.status === "exists" ? "exists" : "stored";
  }
  if (res.status >= 500 && res.status !== 503) throw new Error(`clean copy: server ${res.status}`);
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return refused(publicKey, res.status, body.error ?? "");
}

function refused(publicKey: string, status: number, code: string): CleanCopyResult {
  logger.warn({
    code: "FILE-5015",
    event: "PHOTO_CLEAN_COPY_REFUSED",
    fn: "storeCleanCopy",
    file: FILE,
    message: "The private clean 2048 of a new photo was not kept; the post itself is fine.",
    reason: `${status} ${code}`.trim(),
    expected: "201 stored (or 200 exists) from /api/media/clean-copy",
    actual: `HTTP ${status}`,
    nextStep: "Nothing a member sees changes. Many of these: check the lane's MEDIA R2 binding on Pages (503 MEDIA-ENV-001) or the route's refusal code.",
    detail: { bucket: publicKey.split("/")[0] },
  });
  return "refused";
}
