/**
 * The worker loop (CONVERTER-DESIGN.md v2 §3 step 4, §6): one job at a time.
 *
 *   • a claim left on disk by an earlier run is ended first (finish fail
 *     internal → requeued), so a restart never stalls the queue;
 *   • POST /convert/claim every 10 s; while the queue is empty the wait doubles
 *     up to ~60 s; after a job the next claim is asked for at once;
 *   • the claim is written to the state file (0600) before any work starts and
 *     removed once the database has heard how the job ended;
 *   • after a job ends 'internal' (or its claim was lost, or its end could not
 *     be delivered) the worker backs off before claiming again: 30 s, 1, 2,
 *     4 min … (at most 15 min), and after every 3rd such job in a row it
 *     re-runs its self-test and claims NOTHING until that passes (review of
 *     #420, M3) — a broken VM must not burn every member's three attempts. Any
 *     job that ends otherwise (done, or a final code about the file) resets it.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { ApiError, type Api } from "./api";
import { scrub, vidCode } from "./failures";
import { runJob, type JobDeps, type JobOutcome } from "./job";
import { UUID_RE } from "./launcher";
import type { ClaimStateStore } from "./state";

export interface WorkerDeps extends JobDeps {
  api: Api;
  state: ClaimStateStore;
  pollMs: number;
  pollMaxMs: number;
  /** stop after this many jobs (tests); unlimited when absent */
  maxJobs?: number;
  /** stop after this many loop turns (tests) */
  maxTurns?: number;
  /** the self-test, re-run after every SELFTEST_AFTER internal results in a row (main.ts passes the real one) */
  selfTest?: () => Promise<{ ok: boolean; code?: string; detail?: string }>;
  /** first back-off after an internal result (default 30 s) and its ceiling (default 15 min) */
  internalBackoffMs?: number;
  internalBackoffMaxMs?: number;
}

export const SELFTEST_AFTER = 3;

/** Did this job end in a way that says more about the VM than about the file? */
export function endedInternal(o: JobOutcome): boolean {
  return (o.result === "failed" && o.code === "internal") || o.result === "lost" || o.result === "unfinished";
}

/** 30 s, 1 min, 2 min, 4 min … for the 1st, 2nd, 3rd … internal result in a row; at most `max`. */
export function internalBackoff(streak: number, base = 30_000, max = 15 * 60_000): number {
  if (streak <= 0) return 0;
  return Math.min(max, base * 2 ** Math.min(streak - 1, 20));
}

/** Remove job directories a crash left behind (only uuid-named ones). */
export async function sweepJobsRoot(root: string, log: JobDeps["log"]): Promise<number> {
  let n = 0;
  let entries: string[] = [];
  try { entries = await fs.readdir(root); } catch { return 0; }
  for (const name of entries) {
    if (!UUID_RE.test(name)) continue;
    await fs.rm(path.join(root, name), { recursive: true, force: true }).then(() => { n++; }, (e) => log("worker.sweep_failed", { error: scrub(String(e)) }));
  }
  return n;
}

/** End a claim an earlier run left on disk. True when nothing is left to end. */
export async function recoverStaleClaim(d: Pick<WorkerDeps, "api" | "state" | "log">): Promise<boolean> {
  const saved = await d.state.load();
  if (!saved) return true;
  try {
    const status = await d.api.finish(saved.source_id, saved.claim_token, { code: "internal", detail: "the converter restarted during this job" });
    d.log("worker.recovered", { source_id: saved.source_id, status });
  } catch (e) {
    if (e instanceof ApiError && e.transient) {
      d.log("worker.recover_retry", { source_id: saved.source_id, error: scrub(e.message) });
      return false;
    }
    // Refused (the claim is not held any more, its lease ran out, …): nothing left to end.
    d.log("worker.recover_gone", { source_id: saved.source_id, error: scrub((e as Error).message) });
  }
  await d.state.clear();
  return true;
}

/** How long to wait after /convert/claim said no. */
export function claimErrorDelay(e: unknown, idleMs: number, d: Pick<WorkerDeps, "pollMs" | "pollMaxMs">): number {
  if (!(e instanceof ApiError)) return d.pollMaxMs;
  const inner = vidCode(String(e.body.message ?? e.message)) ?? e.code;
  if (inner === "VID-SRC-007") return 0;                     // that original was unusable; the job is failed — next one
  if (inner === "VID-CONV-007") return d.pollMaxMs;          // a claim is still live (one whose answer was lost): wait out its lease
  const { status: http } = e;
  if (http === 401 || http === 403 || /^VID-(ENV|CONV-001)/.test(inner)) return d.pollMaxMs;
  return Math.min(Math.max(idleMs * 2, d.pollMs), d.pollMaxMs);
}

function interruptible(sleep: (ms: number) => Promise<void>, signal?: AbortSignal) {
  return (ms: number) => new Promise<void>((resolve) => {
    if (signal?.aborted || ms <= 0) { resolve(); return; }
    const done = () => { signal?.removeEventListener("abort", done); resolve(); };
    signal?.addEventListener("abort", done, { once: true });
    void sleep(ms).then(done);
  });
}

export async function workerLoop(d: WorkerDeps, stop?: AbortSignal): Promise<{ jobs: JobOutcome[] }> {
  const wait = interruptible(d.sleep, stop);
  const jobs: JobOutcome[] = [];
  let idle = d.pollMs;
  let internalStreak = 0;
  const base = d.internalBackoffMs ?? 30_000;
  const max = d.internalBackoffMaxMs ?? 15 * 60_000;
  for (let turn = 0; !stop?.aborted; turn++) {
    if (d.maxTurns !== undefined && turn >= d.maxTurns) break;
    if (!(await recoverStaleClaim(d).catch((e) => { d.log("worker.recover_error", { error: scrub(String(e)) }); return false; }))) {
      await wait(d.pollMs);
      continue;
    }
    let claim;
    try {
      claim = await d.api.claim();
    } catch (e) {
      const delay = claimErrorDelay(e, idle, d);
      d.log("worker.claim_error", { error: scrub((e as Error)?.message ?? String(e)), retry_in_ms: delay });
      if (delay > 0) idle = Math.max(idle, Math.min(delay, d.pollMaxMs));
      await wait(delay);
      continue;
    }
    if (!claim) {
      await wait(idle);
      idle = Math.min(idle * 2, d.pollMaxMs);
      continue;
    }
    idle = d.pollMs;
    await d.state.save({ source_id: claim.job.source_id, claim_token: claim.job.claim_token, claimed_at: new Date().toISOString() });
    const outcome = await runJob(claim, d, stop);
    jobs.push(outcome);
    // Kept on disk only while the database has not heard how it ended.
    if (outcome.result !== "unfinished") await d.state.clear();
    if (d.maxJobs !== undefined && jobs.length >= d.maxJobs) break;

    if (!endedInternal(outcome)) { internalStreak = 0; continue; }
    internalStreak++;
    let delay = internalBackoff(internalStreak, base, max);
    d.log("worker.internal_backoff", { in_a_row: internalStreak, wait_ms: delay });
    await wait(delay);
    if (d.selfTest && internalStreak % SELFTEST_AFTER === 0) {
      // Claim nothing until this machine converts its own test video again.
      for (let tries = 1; !stop?.aborted; tries++) {
        const r = await d.selfTest().catch((e) => ({ ok: false, code: "internal", detail: scrub(String(e)) }));
        if (r.ok) { d.log("worker.selftest_recheck", { ok: true, in_a_row: internalStreak, tries }); break; }
        delay = internalBackoff(internalStreak + tries, base, max);
        d.log("worker.selftest_failed_not_claiming", { level: "ALERT", in_a_row: internalStreak, tries, code: r.code, detail: r.detail, retry_in_ms: delay });
        await wait(delay);
      }
    }
  }
  return { jobs };
}
