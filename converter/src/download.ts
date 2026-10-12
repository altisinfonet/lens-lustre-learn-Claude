/**
 * Step 2 · fetch the member's original with the presigned GET the claim gave
 * (pinned to the ETag recorded at source-complete — the signed If-Match header
 * is sent exactly as given, design §3 step 4 [R6], review #417 finding 2):
 *   • never more than the declared byte count is written;
 *   • the response's ETag must be the job's source_etag, its size the job's
 *     source_bytes — otherwise the original changed or is not there:
 *     source_missing (final);
 *   • a dropped connection, a stall or a refused signature is the VM's or the
 *     network's problem: internal (retried by the database).
 */
import { createWriteStream } from "node:fs";
import { once } from "node:events";
import { JobFailure } from "./failures";
import type { ClaimedJob, ClaimedSource } from "./api";

export const DOWNLOAD_IDLE_MS = 60_000;

/**
 * Presigned URLs from the API may only point at R2's S3 endpoint over HTTPS —
 * never at an internal address (the cloud's metadata service, localhost), even
 * if whoever answers the API is not who it should be.
 */
export function isStorageUrl(u: string): boolean {
  try {
    const x = new URL(u);
    return x.protocol === "https:" && x.hostname.endsWith(".r2.cloudflarestorage.com") && !x.username && !x.password && (x.port === "" || x.port === "443");
  } catch {
    return false;
  }
}

function bareEtag(v: string | null): string {
  return String(v ?? "").trim().replace(/^W\//, "").replace(/"/g, "");
}

export async function downloadSource(
  job: Pick<ClaimedJob, "source_bytes" | "source_etag">,
  source: ClaimedSource,
  file: string,
  opts: { fetch?: typeof fetch; signal?: AbortSignal; idleMs?: number; allowUrl?: (u: string) => boolean } = {},
): Promise<number> {
  const f = opts.fetch ?? fetch;
  if (!(opts.allowUrl ?? isStorageUrl)(source.url)) throw new JobFailure("internal", "the source URL is not an R2 storage URL");
  const declared = Number(job.source_bytes);
  if (!Number.isSafeInteger(declared) || declared < 1) throw new JobFailure("internal", "the claim has no declared size");
  if (Number(source.bytes) !== declared) throw new JobFailure("internal", "the claim's source size disagrees with the job");

  const idle = new AbortController();
  const signals = [idle.signal, ...(opts.signal ? [opts.signal] : [])];
  const signal = AbortSignal.any(signals);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const poke = () => { clearTimeout(timer); timer = setTimeout(() => idle.abort(new Error("stalled")), opts.idleMs ?? DOWNLOAD_IDLE_MS); };
  poke();

  let res: Response;
  try {
    // The signed headers exactly as given (If-Match); identity so the byte count is the object's.
    res = await f(source.url, { method: "GET", headers: { ...source.headers, "accept-encoding": "identity" }, signal, redirect: "error" });
  } catch (e) {
    clearTimeout(timer);
    throw new JobFailure("internal", `GET the original: ${(e as Error)?.message ?? String(e)}`);
  }
  if (res.status !== 200) {
    clearTimeout(timer);
    await res.body?.cancel().catch(() => undefined);
    // 412: If-Match failed — the object was overwritten. 404: it is gone. 403 is a signature/clock problem of ours.
    if (res.status === 404 || res.status === 412) throw new JobFailure("source_missing", `GET the original: HTTP ${res.status}`);
    throw new JobFailure("internal", `GET the original: HTTP ${res.status}`);
  }
  const etag = bareEtag(res.headers.get("etag"));
  const length = res.headers.get("content-length");
  if (etag !== bareEtag(job.source_etag)) {
    clearTimeout(timer);
    await res.body?.cancel().catch(() => undefined);
    throw new JobFailure("source_missing", "the original's ETag is not the one recorded when it was queued");
  }
  if (length !== null && Number(length) !== declared) {
    clearTimeout(timer);
    await res.body?.cancel().catch(() => undefined);
    throw new JobFailure("source_missing", `the original is ${length} bytes, ${declared} were declared`);
  }
  if (!res.body) { clearTimeout(timer); throw new JobFailure("internal", "GET the original: no body"); }

  const out = createWriteStream(file, { mode: 0o640, flags: "wx" });
  let diskError: Error | null = null;
  out.on("error", (e) => { diskError = e; });
  let written = 0;
  let over = false;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      poke();
      let chunk = value;
      if (written + chunk.length > declared) {
        // Stop at the declared count — and the server sent more than it said: the original is not the declared one.
        chunk = chunk.subarray(0, declared - written);
        over = true;
      }
      if (chunk.length && !out.write(chunk)) await once(out, "drain");
      written += chunk.length;
      if (diskError) break;
      if (over) break;
      if (written === declared) {
        // Without a Content-Length, one more read tells whether there is more than declared.
        if (length === null) {
          const more = await reader.read();
          if (!more.done && more.value && more.value.length > 0) over = true;
        }
        break;
      }
    }
  } catch (e) {
    throw new JobFailure("internal", `downloading the original: ${(e as Error)?.message ?? String(e)}`);
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => undefined);
    out.end();
    await once(out, "close").catch(() => undefined);
  }
  if (diskError) throw new JobFailure("internal", `writing the original: ${(diskError as Error).message}`);
  if (over) throw new JobFailure("source_missing", "the original is larger than declared");
  if (written !== declared) throw new JobFailure("source_missing", `the original ended after ${written} of ${declared} bytes`);
  return written;
}
