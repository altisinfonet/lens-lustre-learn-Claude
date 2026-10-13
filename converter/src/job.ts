/**
 * ONE claimed job, start to end (CONVERTER-DESIGN.md v2 §3 steps 5–7, 10–11):
 *
 *   download (ETag-pinned GET, byte cap) → convert (convert.ts) →
 *   video_converter_begin_version → upload-urls / PUTs / complete rounds →
 *   finish {done}
 *
 * with a heartbeat every 2 min for the whole job. Any failure → finish
 * {fail, code, detail}; 'internal' only for what may go better next time.
 * The job directory is wiped at the end, whatever happened. A claim that is
 * no longer ours (heartbeat refused: wrong token, lease out, 6 h ceiling) stops
 * the job at once — the database has already moved on.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { renditionBytes, totalBytes } from "../../src/lib/video/shared/rules";
import { ApiError, type Api, type Claim } from "./api";
import { convertSource } from "./convert";
import { downloadSource } from "./download";
import type { X264Preset } from "./encode";
import { ClaimLost, JobFailure, scrub, StorageUrlRefused, toFailure, vidCode, type FailCode } from "./failures";
import type { Launcher } from "./launcher";
import type { ProbeFacts } from "./probe";
import { uploadPackage } from "./upload";

export interface JobDeps {
  api: Api;
  launcher: Launcher;
  jobsRoot: string;
  preset: X264Preset;
  heartbeatMs: number;
  sleep: (ms: number) => Promise<void>;
  log: (event: string, fields?: Record<string, unknown>) => void;
  fetch?: typeof fetch;
  now?: () => number;
  /** tests without ffprobe */
  facts?: ProbeFacts;
  /** which presigned URLs may be used (default: R2 over HTTPS only); tests point at a local server */
  allowUrl?: (u: string) => boolean;
}

/** Set when the worker must stop claiming after this job (a presigned URL outside the R2 pin — N4). */
export type Fatal = "storage_url_refused";

export type JobOutcome =
  | { result: "done"; videoId: string; state: string }
  | { result: "failed"; code: FailCode; detail: string; status: string; fatal?: Fatal }
  /** the claim was gone (nothing to tell the database) */
  | { result: "lost"; detail: string; fatal?: Fatal }
  /** finish could not be delivered — keep the claim on disk so the next start (or loop) ends it */
  | { result: "unfinished"; detail: string; fatal?: Fatal };

const isClaimGone = (e: unknown) =>
  e instanceof ApiError && (e.code === "VID-CONV-002" || /VID-CONV-002/.test(e.message));

export async function prepareJobDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
  // 0770 under the unit's UMask=0007. The set-group-ID bit (so what ffjob
  // writes stays group convjob) is INHERITED from the jobs root (setup.sh:
  // 2750) — never requested here: the worker's RestrictSUIDSGID=yes refuses a
  // mkdir/chmod that asks for it (EPERM), and a plain chmod would clear it.
  await fs.mkdir(dir, { recursive: true, mode: 0o770 });
}

export async function wipeJobDir(dir: string, log: JobDeps["log"]): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch (e) {
    log("job.wipe_failed", { error: scrub((e as Error).message) });
  }
}

/** Tell the database how it ended, retrying transient errors. */
async function finish(d: JobDeps, claim: Claim, outcome: { done: true } | { code: FailCode; detail: string }): Promise<{ status: string } | { lost: string } | { unfinished: string }> {
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      return { status: await d.api.finish(claim.job.source_id, claim.job.claim_token, outcome) };
    } catch (e) {
      if (isClaimGone(e)) return { lost: "the claim was no longer held at finish" };
      if (!(e instanceof ApiError) || !e.transient) {
        // A refusal we cannot fix by asking again (bad request, a code the server does not know): stop asking.
        return { unfinished: scrub((e as Error).message) };
      }
      if (attempt < 6) await d.sleep(Math.min(30_000, 1000 * 2 ** attempt));
      else return { unfinished: scrub(e.message) };
    }
  }
  return { unfinished: "finish was not delivered" };
}

function beginVersionFailure(e: unknown): Error {
  if (isClaimGone(e)) return new ClaimLost("begin_version: the claim is not held");
  if (!(e instanceof ApiError)) return e as Error;
  const code = vidCode(e.message) ?? e.code;
  const map: Record<string, FailCode> = { "VID-LIM-001": "too_long", "VID-LIM-002": "too_big", "VID-LIM-005": "too_big", "VID-LIM-006": "too_big" };
  return new JobFailure(map[code] ?? "internal", `begin_version: ${e.message}`);
}

export async function runJob(claim: Claim, d: JobDeps, outer?: AbortSignal): Promise<JobOutcome> {
  const { job, source } = claim;
  const now = d.now ?? Date.now;
  const started = now();
  const dir = path.join(d.jobsRoot, job.source_id);
  const ac = new AbortController();
  let lost: string | null = null;
  const onOuter = () => ac.abort(new Error("the worker is stopping"));
  outer?.addEventListener("abort", onOuter, { once: true });
  if (outer?.aborted) onOuter();

  // The lease: extended every heartbeatMs while anything of this job runs.
  let leaseUntil = Date.parse(job.lease_until);
  let beating: Promise<void> | null = null;
  const beat = async (): Promise<void> => {
    if (beating) return beating;
    beating = (async () => {
      try {
        leaseUntil = await d.api.heartbeat(job.source_id, job.claim_token);
      } catch (e) {
        if (isClaimGone(e)) {
          lost = "the heartbeat was refused: the claim is no longer held";
          ac.abort(new ClaimLost(lost));
        } else {
          d.log("job.heartbeat_failed", { error: scrub((e as Error).message), lease_left_s: Math.round((leaseUntil - now()) / 1000) });
        }
      } finally {
        beating = null;
      }
    })();
    return beating;
  };
  const timer = setInterval(() => { void beat(); }, d.heartbeatMs);

  d.log("job.claimed", { source_id: job.source_id, attempt: job.attempt, bytes: job.source_bytes, purpose: job.purpose });
  try {
    await prepareJobDir(dir);
    let t0 = now();
    await downloadSource(job, source, path.join(dir, "source"), { fetch: d.fetch, signal: ac.signal, allowUrl: d.allowUrl });
    d.log("job.downloaded", { ms: now() - t0 });

    const { pkg } = await convertSource({ launcher: d.launcher, jobDir: dir, purpose: job.purpose, preset: d.preset, signal: ac.signal, log: d.log, facts: d.facts, now });
    if (ac.signal.aborted) throw ac.signal.reason;

    let video: { video_id: string; version_no: number } | null = null;
    t0 = now();
    for (let attempt = 1; ; attempt++) {
      try {
        video = await d.api.rpc<{ video_id: string; version_no: number }>("video_converter_begin_version", {
          _source_id: job.source_id, _claim_token: job.claim_token, _manifest_sha256: pkg.manifestSha256,
          _total_bytes: totalBytes(pkg.manifest), _declared_duration_s: pkg.manifest.duration_s,
          _has_audio: pkg.manifest.has_audio, _rendition_bytes: renditionBytes(pkg.manifest),
        });
        break;
      } catch (e) {
        // Same token + same manifest replays the same video, so a retry is safe.
        if (e instanceof ApiError && e.transient && attempt < 4) { await d.sleep(2000 * attempt); continue; }
        throw beginVersionFailure(e);
      }
    }
    if (!video || !video.video_id || !Number.isInteger(Number(video.version_no))) throw new JobFailure("internal", "begin_version answered without a video");
    d.log("job.version", { video_id: video.video_id, version_no: video.version_no });

    const state = await uploadPackage(pkg, { video_id: video.video_id, version_no: Number(video.version_no), claim_token: job.claim_token }, {
      api: d.api, fetch: d.fetch, sleep: d.sleep, log: d.log, signal: ac.signal, allowUrl: d.allowUrl,
      heartbeat: async () => { await beat(); if (lost) throw new ClaimLost(lost); },
    });
    d.log("job.uploaded", { state, ms: now() - t0 });

    clearInterval(timer);
    const f = await finish(d, claim, { done: true });
    if ("lost" in f) return { result: "lost", detail: f.lost };
    if ("unfinished" in f) return { result: "unfinished", detail: f.unfinished };
    d.log("job.done", { source_id: job.source_id, video_id: video.video_id, state, total_ms: now() - started });
    return { result: "done", videoId: video.video_id, state };
  } catch (e) {
    clearInterval(timer);
    if (lost || e instanceof ClaimLost) {
      const detail = lost ?? (e as Error).message;
      d.log("job.lost", { source_id: job.source_id, detail });
      return { result: "lost", detail };
    }
    const reason = ac.signal.aborted && !(e instanceof JobFailure) ? new JobFailure("internal", "the worker stopped during this job") : e;
    const { code, detail } = toFailure(reason);
    const fatal: Fatal | undefined = e instanceof StorageUrlRefused ? "storage_url_refused" : undefined;
    d.log("job.failed", { source_id: job.source_id, code, detail, total_ms: now() - started, ...(fatal ? { fatal } : {}) });
    const f = await finish(d, claim, { code, detail });
    if ("lost" in f) return { result: "lost", detail: f.lost, ...(fatal ? { fatal } : {}) };
    if ("unfinished" in f) return { result: "unfinished", detail: f.unfinished, ...(fatal ? { fatal } : {}) };
    return { result: "failed", code, detail, status: f.status, ...(fatal ? { fatal } : {}) };
  } finally {
    clearInterval(timer);
    outer?.removeEventListener("abort", onOuter);
    const pending = beating as Promise<void> | null; // assigned inside beat(); TS cannot see it
    if (pending) await pending.catch(() => undefined);
    await wipeJobDir(dir, d.log);
  }
}
