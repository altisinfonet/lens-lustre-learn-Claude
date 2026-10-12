/**
 * Step 5b · the package goes through the SAME gates as a member's device
 * (design §2.1, §3 step 7) — mirrored from src/lib/video/uploadJobs.ts:
 *   upload-urls {video_id, version_no, manifest, claim_token}
 *     → one presigned PUT per file not yet in upload/video/ (headers exact)
 *   PUT each file
 *   complete {video_id, version_no, claim_token}
 *     → 202 rounds (Cloudflare's per-request limit) until 200;
 *       409 + missing/mismatched → another round of upload-urls for just those.
 * A lease about to run out (VID-CONV-010) → heartbeat, then ask again.
 */
import type { HlsPackage } from "../../src/lib/video/hlsPackager";
import { uploadOrder } from "../../src/lib/video/shared/rules";
import { ApiError, type Api, type Answer } from "./api";
import { isStorageUrl } from "./download";
import { JobFailure } from "./failures";

export interface UploadIds { video_id: string; version_no: number; claim_token: string }

export interface UploadDeps {
  api: Api;
  fetch?: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  /** extend the lease now (used when a URL would outlive it) */
  heartbeat: () => Promise<void>;
  log: (event: string, fields?: Record<string, unknown>) => void;
  signal?: AbortSignal;
  /** files PUT in parallel */
  parallel?: number;
  /** which presigned URLs may be used (default: R2 over HTTPS only — download.ts isStorageUrl) */
  allowUrl?: (u: string) => boolean;
}

export const UPLOAD_ROUNDS = 4;
export const MAX_COMPLETE_ROUNDS = 2000;
const PUT_TRIES = 3;

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new JobFailure("internal", "the job was stopped");
}

/** A Pages call with transient retries and the lease nudge. */
async function call(d: UploadDeps, path: string, body: unknown): Promise<Answer> {
  for (let attempt = 1; ; attempt++) {
    throwIfAborted(d.signal);
    let a: Answer;
    try {
      a = await d.api.pages(path, body);
    } catch (e) {
      if (!(e instanceof ApiError) || !e.transient || attempt >= 5) throw e;
      await d.sleep(Math.min(30_000, 1000 * 2 ** attempt));
      continue;
    }
    if ((a.status >= 500 || a.status === 429 || a.status === 408) && attempt < 5) {
      d.log("upload.retry", { path, status: a.status, attempt });
      await d.sleep(Math.min(30_000, 1000 * 2 ** attempt));
      continue;
    }
    if (a.status === 409 && a.body.error === "VID-CONV-010" && attempt < 5) {
      await d.heartbeat();
      continue;
    }
    return a;
  }
}

function refused(path: string, a: Answer): JobFailure {
  return new JobFailure("internal", `${path} ${a.status} ${String(a.body.error ?? "")}: ${String(a.body.message ?? "").slice(0, 160)}`);
}

async function putOne(d: UploadDeps, u: { name: string; url: string; headers: Record<string, string> }, bytes: Uint8Array): Promise<"ok" | "retry-later"> {
  const f = d.fetch ?? fetch;
  for (let attempt = 1; attempt <= PUT_TRIES; attempt++) {
    throwIfAborted(d.signal);
    try {
      const signal = d.signal ? AbortSignal.any([d.signal, AbortSignal.timeout(300_000)]) : AbortSignal.timeout(300_000);
      const res = await f(u.url, { method: "PUT", headers: u.headers, body: bytes, signal, redirect: "error" });
      await res.arrayBuffer().catch(() => undefined);
      if (res.status >= 200 && res.status < 300) return "ok";
      // 403: expired or refused signature — the next round asks for a fresh URL. 4xx: let /complete say what is missing.
      if (res.status < 500 && res.status !== 408 && res.status !== 429) return "retry-later";
    } catch {
      // network: try again
    }
    if (attempt < PUT_TRIES) await d.sleep(1000 * 2 ** attempt);
  }
  return "retry-later";
}

async function putAll(d: UploadDeps, pkg: HlsPackage, urls: Array<{ name: string; url: string; headers: Record<string, string> }>): Promise<number> {
  const byName = new Map(urls.map((u) => [u.name, u]));
  const allow = d.allowUrl ?? isStorageUrl;
  const foreign = urls.find((u) => !allow(u.url));
  if (foreign) throw new JobFailure("internal", `upload-urls gave a URL for ${foreign.name} that is not an R2 storage URL`);
  const queue = uploadOrder(urls.map((u) => u.name));
  let failed = 0;
  const worker = async () => {
    for (;;) {
      const name = queue.shift();
      if (name === undefined) return;
      const bytes = pkg.files.get(name);
      if (!bytes) throw new JobFailure("internal", `upload-urls named ${name}, which is not in the package`);
      if ((await putOne(d, byName.get(name)!, bytes)) !== "ok") failed++;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, d.parallel ?? 6) }, worker));
  return failed;
}

/** Upload and complete. Returns the video's state after /complete (checking, ready, …). */
export async function uploadPackage(pkg: HlsPackage, ids: UploadIds, d: UploadDeps): Promise<string> {
  for (let round = 1; round <= UPLOAD_ROUNDS; round++) {
    const u = await call(d, "/api/video/upload-urls", { video_id: ids.video_id, version_no: ids.version_no, manifest: pkg.manifest, claim_token: ids.claim_token });
    if (u.status !== 200) throw refused("/upload-urls", u);
    const urls = (u.body.urls as Array<{ name: string; url: string; headers: Record<string, string> }> | undefined) ?? [];
    const failed = await putAll(d, pkg, urls);
    d.log("upload.round", { round, put: urls.length - failed, failed, already: Array.isArray(u.body.done) ? u.body.done.length : 0 });

    let last = -1, stuck = 0;
    for (let n = 0; n < MAX_COMPLETE_ROUNDS; n++) {
      const c = await call(d, "/api/video/complete", { video_id: ids.video_id, version_no: ids.version_no, claim_token: ids.claim_token });
      if (c.status === 200) return String(c.body.state ?? "checking");
      if (c.status === 202) {
        const copied = Number(c.body.copied) || 0;
        if (copied <= last) {
          // A round that moved nothing: give the store a moment, but never loop for ever.
          if (++stuck >= 5) throw new JobFailure("internal", `/complete made no progress (${copied}/${c.body.total})`);
          await d.sleep(2000 * stuck);
        } else {
          stuck = 0;
        }
        last = Math.max(last, copied);
        continue;
      }
      if (c.status === 409 && (Array.isArray(c.body.missing) || Array.isArray(c.body.mismatched))) {
        d.log("upload.redo", { missing: (c.body.missing as unknown[] | undefined)?.length ?? 0, mismatched: (c.body.mismatched as unknown[] | undefined)?.length ?? 0 });
        break; // next round: fresh URLs for just those
      }
      throw refused("/complete", c);
    }
  }
  throw new JobFailure("internal", `the upload did not complete after ${UPLOAD_ROUNDS} rounds`);
}
