/**
 * The worker loop (CONVERTER-DESIGN.md v2 §3 step 4, §6): one job at a time.
 *
 *   • a claim left on disk by an earlier run is ended first (finish fail
 *     internal → requeued), so a restart never stalls the queue;
 *   • POST /convert/claim every 10 s; while the queue is empty the wait doubles
 *     up to ~60 s; after a job the next claim is asked for at once;
 *   • the claim is written to the state file (0600) before any work starts and
 *     removed once the database has heard how the job ended;
 *   • after a job ends 'internal' (or its end could not be delivered) the
 *     worker backs off before claiming again: 30 s, 1, 2, 4 min … (at most
 *     15 min), and after every 3rd such job in a row it re-runs its self-test
 *     and claims NOTHING until that passes (review of #420, M3) — a broken VM
 *     must not burn every member's three attempts. A job whose claim was lost
 *     (most often: the member cancelled it) neither counts nor resets (re-review
 *     N6e); any other ending (done, or a final code about the file) resets it;
 *   • a presigned URL outside this lane's R2 pin (StorageUrlRefused) ends that
 *     job and STOPS the loop with an ALERT — main exits 4, which converter.service
 *     does not restart (re-review N4): a misconfiguration must not fail every job;
 *   • a sign-in that needs a person (ReseedRequired: live CAPTCHA, no usable
 *     refresh token) keeps the worker ALIVE — no crash loop, nothing claimed: the
 *     session backs its network sign-ins off up to 1 h, and the loop only looks
 *     at the session file every minute for a seeded token (logged when a network
 *     try was made, not on every look).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { ApiError, type Api } from "./api";
import { ReseedRequired, SessionPersistError } from "./auth";
import { scrub, vidCode } from "./failures";
import { runJob, type Fatal, type JobDeps, type JobOutcome } from "./job";
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
  /** S7-f: drain POST /api/video/purge at most this often (ms); 0 or absent = off */
  purgeEveryMs?: number;
  /** the clock the purge tick is timed by (tests); Date.now when absent */
  now?: () => number;
}

export const SELFTEST_AFTER = 3;

/**
 * S7-f · the purge tick. Rows per POST /api/video/purge: the route's own default,
 * sized for Cloudflare's per-request call budget (functions/api/video/purge.ts
 * clamps to 1–10). At most PURGE_MAX_CALLS requests per tick — ONE per loop turn,
 * before the claim, so a job waits for at most one purge request.
 */
export const PURGE_LIMIT = 5;
export const PURGE_MAX_CALLS = 20;

interface PurgeTally { startedAt: number; calls: number; claimed: number; done: number; failed: number; objects: number }

/** A VID-… style code from a response body, or "" — never a free-text server message. */
function safeCode(v: unknown): string {
  const s = String(v ?? "");
  return /^[A-Z][A-Z0-9-]{0,39}$/.test(s) ? s : "";
}

/**
 * The purge tick's state. step() makes at most one purge request, and only when a
 * tick is due or under way; it never throws. A tick ends on a short page (the queue
 * is drained), a page that deleted nothing (failed rows are left for the next tick),
 * the cap, or any error — each with exactly one "worker.purge" log line of counts.
 * A 401 has already been retried once after a fresh sign-in by Api.send itself.
 */
export class PurgeTicker {
  private dueAt: number;
  private tick: PurgeTally | null = null;
  private readonly now: () => number;
  constructor(private readonly d: Pick<WorkerDeps, "api" | "log" | "purgeEveryMs" | "now">) {
    this.now = d.now ?? Date.now;
    this.dueAt = this.now(); // the first tick right after start-up (main runs the self-test before the loop)
  }

  get enabled(): boolean { return (this.d.purgeEveryMs ?? 0) > 0; }

  async step(): Promise<void> {
    if (!this.enabled) return;
    const every = this.d.purgeEveryMs!;
    if (!this.tick) {
      const t = this.now();
      if (t < this.dueAt) return;
      this.tick = { startedAt: t, calls: 0, claimed: 0, done: 0, failed: 0, objects: 0 };
    }
    const tick = this.tick;
    const end = (fields: Record<string, unknown>, nextAt: number) => {
      const { startedAt: _s, ...counts } = tick;
      this.d.log("worker.purge", { ...fields, ...counts });
      this.dueAt = nextAt;
      this.tick = null;
    };
    tick.calls++;
    try {
      const a = await this.d.api.pages("/api/video/purge", { limit: PURGE_LIMIT });
      if (a.status !== 200) {
        end({ ok: false, http: a.status, code: safeCode(a.body.error ?? a.body.code), retry_in_ms: every }, this.now() + every);
        return;
      }
      const claimed = Number.isInteger(a.body.claimed) ? Number(a.body.claimed) : 0;
      const done = Array.isArray(a.body.done) ? (a.body.done as Array<{ objects?: unknown }>) : [];
      const failed = Array.isArray(a.body.failed) ? a.body.failed.length : 0;
      tick.claimed += claimed;
      tick.done += done.length;
      tick.failed += failed;
      tick.objects += done.reduce((n, r) => n + (Number.isInteger(r?.objects) ? Number(r.objects) : 0), 0);
      const more = claimed >= PURGE_LIMIT && done.length > 0;
      if (!more || tick.calls >= PURGE_MAX_CALLS) end({ ok: true, capped: more }, tick.startedAt + every);
    } catch (e) {
      const http = e instanceof ApiError ? e.status : 0;
      const code = e instanceof ApiError ? safeCode(e.code) : e instanceof ReseedRequired ? "RESEED-REQUIRED" : e instanceof SessionPersistError ? "SESSION-FILE" : "ERROR";
      end({ ok: false, http, code, retry_in_ms: every }, this.now() + every);
    }
  }
}

/** Did this job end in a way that says more about the VM than about the file? */
export function endedInternal(o: JobOutcome): boolean {
  return (o.result === "failed" && o.code === "internal") || o.result === "unfinished";
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
    // Waiting for a seeded session (or for the session file to be writable) is not "the claim is gone":
    // keep it on disk and end it once signed in. Neither makes a network call while it waits.
    if (e instanceof ReseedRequired || e instanceof SessionPersistError) {
      if (!(e instanceof ReseedRequired) || e.attempted) d.log("worker.recover_retry", { source_id: saved.source_id, error: scrub(e.message) });
      return false;
    }
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
  // Waiting for a seeded session: look again at most every pollMaxMs, never sooner than pollMs (the
  // session itself makes no network sign-in before its back-off ends).
  if (e instanceof ReseedRequired) return Math.min(Math.max(e.retryInMs, d.pollMs), d.pollMaxMs);
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

export async function workerLoop(d: WorkerDeps, stop?: AbortSignal): Promise<{ jobs: JobOutcome[]; fatal?: Fatal }> {
  const wait = interruptible(d.sleep, stop);
  const jobs: JobOutcome[] = [];
  let idle = d.pollMs;
  let internalStreak = 0;
  const base = d.internalBackoffMs ?? 30_000;
  const max = d.internalBackoffMaxMs ?? 15 * 60_000;
  const purge = new PurgeTicker(d);
  for (let turn = 0; !stop?.aborted; turn++) {
    if (d.maxTurns !== undefined && turn >= d.maxTurns) break;
    if (!(await recoverStaleClaim(d).catch((e) => { d.log("worker.recover_error", { error: scrub(String(e)) }); return false; }))) {
      await wait(d.pollMs);
      continue;
    }
    // S7-f: between job polls, never inside a job — at most one purge request per turn.
    await purge.step().catch(() => undefined);
    if (stop?.aborted) break;
    let claim;
    try {
      claim = await d.api.claim();
    } catch (e) {
      const delay = claimErrorDelay(e, idle, d);
      if (!(e instanceof ReseedRequired) || e.attempted) d.log("worker.claim_error", { error: scrub((e as Error)?.message ?? String(e)), retry_in_ms: delay });
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
    if (outcome.result !== "done" && outcome.fatal) {
      d.log("worker.stopped_not_claiming", {
        level: "ALERT", reason: outcome.fatal,
        detail: "a presigned URL was not this lane's R2 host/bucket (CONVERTER_R2_HOST / CONVERTER_R2_BUCKET, or Pages changed) — fix the configuration, then start converter.service again",
      });
      return { jobs, fatal: outcome.fatal };
    }
    if (d.maxJobs !== undefined && jobs.length >= d.maxJobs) break;

    if (outcome.result === "lost") continue; // usually a member's cancel: neither counts nor resets
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
