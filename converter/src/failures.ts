/**
 * The converter's failure vocabulary — the fixed list video_source_fail
 * accepts (20261012_0002; functions/api/video/convert/finish.ts FAIL_CODES).
 *
 * The member never reads the VM's words: the database turns the CODE into
 * fixed text (video_source_reason_text). `detail` reaches the audit trail
 * only, and is scrubbed of anything that looks like a URL query, a token or
 * a key before it leaves the VM.
 *
 * 'internal' is the only code the database retries (attempts < 3); every
 * other code ends the job. So 'internal' is for what may go better next time
 * — the network, the VM, a limit of ours, a bug of ours — and the final codes
 * are for what is true of the member's FILE.
 */

export const FAIL_CODES = ["internal", "unsupported_format", "no_video", "too_long", "too_big", "damaged", "source_missing"] as const;
export type FailCode = (typeof FAIL_CODES)[number];

export class JobFailure extends Error {
  constructor(public readonly code: FailCode, public readonly detail: string) {
    super(`${code}: ${detail}`);
    this.name = "JobFailure";
  }
}

/** The claim is no longer ours (wrong token, lease ran out, 6 h ceiling): nothing more can be said about the job. */
export class ClaimLost extends Error {
  constructor(detail: string) {
    super(`claim lost: ${detail}`);
    this.name = "ClaimLost";
  }
}

/** Anything thrown during a job → the code and audit detail sent to /convert/finish. */
export function toFailure(e: unknown): { code: FailCode; detail: string } {
  if (e instanceof JobFailure) return { code: e.code, detail: scrub(e.detail) };
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return { code: "internal", detail: scrub(msg) };
}

/**
 * Never log or send a presigned URL, a bearer token, a JWT or a password.
 * Applied to every log line and every `detail`.
 */
export function scrub(s: string): string {
  return String(s)
    // presigned query strings (X-Amz-Signature, X-Amz-Credential, …) and any query at all
    .replace(/(https?:\/\/[^\s"'?#]+)\?[^\s"']*/gi, "$1?[redacted]")
    .replace(/X-Amz-[A-Za-z-]+=[^&\s"']*/g, "X-Amz-[redacted]")
    // bearer tokens / JWTs
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[jwt]")
    // "password":"…", "refresh_token":"…", "access_token":"…"
    .replace(/("?(?:password|refresh_token|access_token|claim_token)"?\s*[:=]\s*)"[^"]*"/gi, '$1"[redacted]"')
    .slice(0, 2000);
}

/** The database's VID-… code in an error message, if any. */
export function vidCode(message: string): string | undefined {
  return /\b(VID-[A-Z0-9]+-\d{3})\b/.exec(message)?.[1];
}

/**
 * ffprobe/ffmpeg said no. Decide whether the FILE is at fault (final code) or
 * this run was (internal: killed, out of time, out of memory, out of disk).
 */
export function classifyToolFailure(
  tool: "ffprobe" | "ffmpeg",
  r: { exitCode: number | null; timedOut: boolean; killed: boolean; stderr: string },
): JobFailure {
  const tail = scrub(r.stderr.trim().split(/\r?\n/).slice(-3).join(" | ")).slice(0, 220);
  const detail = `${tool} exit ${r.exitCode ?? "none"}${r.timedOut ? " (time limit)" : ""}${r.killed ? " (killed)" : ""}: ${tail}`;
  if (r.timedOut || r.killed) return new JobFailure("internal", detail);
  const s = r.stderr;
  if (/No space left on device|Cannot allocate memory|Resource temporarily unavailable|Too many open files/i.test(s)) {
    return new JobFailure("internal", detail);
  }
  if (/not on whitelist|Protocol not found|Unknown input format/i.test(s)) return new JobFailure("unsupported_format", detail);
  if (/Decoder \(codec [^)]*\) not found|Unsupported codec|unknown codec|Could not find codec parameters|no decoder/i.test(s)) {
    return new JobFailure("unsupported_format", detail);
  }
  if (/moov atom not found|Invalid data found when processing input/i.test(s) && tool === "ffprobe") {
    // ffprobe cannot even open it: a recognisable-but-broken MP4 is damaged; anything else is not a video we know.
    return new JobFailure(/moov atom not found|truncat/i.test(s) ? "damaged" : "unsupported_format", detail);
  }
  if (/Invalid data found|error while decoding|corrupt|truncat|moov atom not found|Error splitting the input|invalid NAL/i.test(s)) {
    return new JobFailure("damaged", detail);
  }
  // Unknown: ours until proven otherwise (retried; three in a row → "kept failing").
  return new JobFailure("internal", detail);
}
