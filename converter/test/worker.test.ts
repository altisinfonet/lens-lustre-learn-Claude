// @vitest-environment node
/**
 * The worker loop: a claim left on disk is ended first; the claim is polled
 * every 10 s, the wait doubling up to ~60 s while the queue is empty; after a
 * job the next claim is asked for at once; the claim is on disk exactly while
 * the database has not heard how it ended.
 */
import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ApiError } from "../src/api";
import { ClaimStateStore } from "../src/state";
import { claimErrorDelay, endedInternal, internalBackoff, recoverStaleClaim, sweepJobsRoot, workerLoop, type WorkerDeps } from "../src/worker";
import { apiFor, FakeLauncher, fakeServer, probeJson, send, SRC, tempDir, TOKEN, withAuth, OWNER, type FakeServer } from "./helpers";

let server: FakeServer | null = null;
const dirs: string[] = [];
afterEach(async () => {
  await server?.close(); server = null;
  for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

async function base(): Promise<{ s: FakeServer; deps: WorkerDeps; sleeps: number[]; root: string }> {
  const s = await fakeServer();
  server = s;
  withAuth(s);
  const root = await tempDir();
  dirs.push(root);
  const sleeps: number[] = [];
  const { api } = apiFor(s);
  const deps: WorkerDeps = {
    api, state: new ClaimStateStore(path.join(root, "state", "claim.json")), launcher: new FakeLauncher({ probe: probeJson({ width: 640, height: 360, duration: 6 }) }),
    jobsRoot: path.join(root, "jobs"), preset: "veryfast", heartbeatMs: 60_000, pollMs: 10_000, pollMaxMs: 60_000,
    sleep: async (ms) => { sleeps.push(ms); }, log: () => undefined, allowUrl: () => true,
  };
  await fs.mkdir(deps.jobsRoot);
  return { s, deps, sleeps, root };
}

describe("converter · the worker loop", () => {
  it("idle: claims every 10 s, then 20, 40, 60, 60 … while the queue is empty", async () => {
    const { s, deps, sleeps } = await base();
    s.on("POST", "/api/video/convert/claim", (_req, res) => send(res, 200, { job: null }));
    await workerLoop({ ...deps, maxTurns: 6 });
    expect(sleeps).toEqual([10_000, 20_000, 40_000, 60_000, 60_000, 60_000]);
  });

  it("a claim left on disk by a crash is ended (fail internal) BEFORE anything new is claimed", async () => {
    const { s, deps } = await base();
    await deps.state.save({ source_id: SRC, claim_token: TOKEN, claimed_at: "2026-10-12T00:00:00Z" });
    s.on("POST", "/api/video/convert/finish", (_req, res) => send(res, 200, { source_id: SRC, status: "queued" }));
    s.on("POST", "/api/video/convert/claim", (_req, res) => send(res, 200, { job: null }));
    await workerLoop({ ...deps, maxTurns: 1 });
    const order = s.requests.filter((r) => r.path.startsWith("/api/")).map((r) => r.path);
    expect(order).toEqual(["/api/video/convert/finish", "/api/video/convert/claim"]);
    expect(s.requests.find((r) => r.path.endsWith("/finish"))!.json).toEqual({
      source_id: SRC, claim_token: TOKEN, outcome: "fail", code: "internal", detail: "the converter restarted during this job",
    });
    expect(await deps.state.load()).toBeNull();
  });

  it("recovery: a refused finish (claim already gone) clears the file; a network failure keeps it for next time", async () => {
    const { s, deps } = await base();
    await deps.state.save({ source_id: SRC, claim_token: TOKEN, claimed_at: "" });
    s.on("POST", "/api/video/convert/finish", (_req, res) => send(res, 503, { error: "VID-ENV-002" }));
    expect(await recoverStaleClaim(deps)).toBe(false);
    expect(await deps.state.load()).not.toBeNull();
    s.on("POST", "/api/video/convert/finish", (_req, res) => send(res, 409, { error: "VID-DB-001", message: "VID-CONV-002: this claim is not held" }));
    expect(await recoverStaleClaim(deps)).toBe(true);
    expect(await deps.state.load()).toBeNull();
  });

  it("a job: the claim is on disk while it runs, removed after finish; the next claim is asked for at once", async () => {
    const { s, deps, sleeps } = await base();
    let claims = 0;
    let onDisk: unknown = "unset";
    s.on("POST", "/api/video/convert/claim", (_req, res) => {
      claims++;
      if (claims > 1) { send(res, 200, { job: null }); return; }
      send(res, 200, {
        job: { source_id: SRC, owner_id: OWNER, purpose: "post", source_bytes: 4, source_etag: "e", claim_token: TOKEN, lease_until: new Date(Date.now() + 1_800_000).toISOString(), attempt: 1 },
        source: { url: `${s.url}/r2/source`, headers: { "if-match": '"e"' }, bytes: 4, expires_in: 600 },
      });
    });
    s.on("GET", "/r2/source", async (_req, res) => { onDisk = await deps.state.load(); res.writeHead(200, { etag: '"e"', "content-length": "4" }); res.end("abcd"); });
    // the job fails at the probe (no video) — enough to see the loop's bookkeeping
    deps.launcher = new FakeLauncher({ probe: JSON.stringify({ format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "4" }, streams: [] }) });
    s.on("POST", "/api/video/convert/finish", (_req, res) => send(res, 200, { source_id: SRC, status: "failed" }));
    const { jobs } = await workerLoop({ ...deps, maxTurns: 2 });
    expect(jobs).toEqual([{ result: "failed", code: "no_video", detail: "no video stream", status: "failed" }]);
    expect(onDisk).toMatchObject({ source_id: SRC, claim_token: TOKEN });
    expect(await deps.state.load()).toBeNull();
    expect(claims).toBe(2);
    expect(sleeps).toEqual([10_000]); // no wait between the job and the next claim; then idle

  });

  it("claim refusals: a busy claim / unconfigured lane / auth waits the longest; an unusable original goes straight on", () => {
    const d = { pollMs: 10_000, pollMaxMs: 60_000 };
    const err = (status: number, code: string, message = "") => new ApiError(status, code, message, { error: code, message });
    expect(claimErrorDelay(err(409, "VID-DB-001", "VID-CONV-007: a job is already being converted"), 10_000, d)).toBe(60_000);
    expect(claimErrorDelay(err(409, "VID-SRC-007", "the original is not usable"), 10_000, d)).toBe(0);
    expect(claimErrorDelay(err(503, "VID-ENV-002"), 10_000, d)).toBe(60_000);
    expect(claimErrorDelay(err(409, "VID-DB-001", "VID-CONV-001: converter only"), 10_000, d)).toBe(60_000);
    expect(claimErrorDelay(err(401, "VID-AUTH-001"), 10_000, d)).toBe(60_000);
    expect(claimErrorDelay(err(0, "NETWORK"), 10_000, d)).toBe(20_000);
    expect(claimErrorDelay(err(502, "VID-DB-001"), 40_000, d)).toBe(60_000);
  });

  it("stop signal: the loop ends without claiming again", async () => {
    const { s, deps } = await base();
    s.on("POST", "/api/video/convert/claim", (_req, res) => send(res, 200, { job: null }));
    const ac = new AbortController();
    ac.abort();
    const { jobs } = await workerLoop(deps, ac.signal);
    expect(jobs).toEqual([]);
    expect(s.requests.filter((r) => r.path.includes("claim"))).toHaveLength(0);
  });

  it("start-up sweep removes job directories a crash left behind (uuid names only)", async () => {
    const { deps } = await base();
    await fs.mkdir(path.join(deps.jobsRoot, SRC));
    await fs.writeFile(path.join(deps.jobsRoot, SRC, "source"), "x");
    await fs.mkdir(path.join(deps.jobsRoot, "lost+found"));
    expect(await sweepJobsRoot(deps.jobsRoot, () => undefined)).toBe(1);
    expect(await fs.readdir(deps.jobsRoot)).toEqual(["lost+found"]);
  });

  it("after 'internal' jobs (M3): back off 30 s, 1, 2, 4 min; after 3 in a row re-run the self-test and claim nothing until it passes; any other ending resets", async () => {
    const { s, deps, sleeps } = await base();
    const plan = ["internal", "internal", "internal", "internal", "final", "internal"];
    const events: string[] = [];
    let n = 0;
    s.on("POST", "/api/video/convert/claim", (_req, res) => {
      const kind = plan[n++] ?? "none";
      events.push(`claim:${kind}`);
      if (kind === "none") { send(res, 200, { job: null }); return; }
      send(res, 200, {
        job: { source_id: SRC, owner_id: OWNER, purpose: "post", source_bytes: 4, source_etag: "e", claim_token: TOKEN, lease_until: new Date(Date.now() + 1_800_000).toISOString(), attempt: 1 },
        source: { url: `${s.url}/r2/${kind}`, headers: { "if-match": '"e"' }, bytes: 4, expires_in: 600 },
      });
    });
    s.on("GET", "/r2/internal", (_req, res) => { res.writeHead(500); res.end(); });                          // → internal
    s.on("GET", "/r2/final", (_req, res) => { res.writeHead(200, { etag: '"changed"', "content-length": "4" }); res.end("abcd"); }); // → source_missing
    s.on("POST", "/api/video/convert/finish", (req, res) => send(res, 200, { status: (req.json as { code?: string }).code === "internal" ? "queued" : "failed" }));
    let selfTests = 0;
    const selfTest = async () => { selfTests++; events.push(`selftest:${selfTests}`); return { ok: selfTests >= 2, code: "internal", detail: "zscale missing" }; };
    const logs: string[] = [];
    const { jobs } = await workerLoop({ ...deps, selfTest, maxTurns: 6, log: (e) => { logs.push(e); } });
    expect(jobs.map((j) => (j.result === "failed" ? j.code : j.result))).toEqual(["internal", "internal", "internal", "internal", "source_missing", "internal"]);
    // 30 s, 1 min, 2 min; the failed self-test waits 4 min; the 4th in a row waits 4 min; the final ending resets; 30 s again
    expect(sleeps).toEqual([30_000, 60_000, 120_000, 240_000, 240_000, 30_000]);
    // nothing was claimed between the failed and the passing self-test
    expect(events).toEqual(["claim:internal", "claim:internal", "claim:internal", "selftest:1", "selftest:2", "claim:internal", "claim:final", "claim:internal"]);
    expect(logs).toContain("worker.selftest_failed_not_claiming");
    expect(logs.filter((e) => e === "worker.internal_backoff")).toHaveLength(5);
  });

  it("the back-off schedule: 30 s doubling, capped at 15 min; lost claims and undelivered ends count as internal", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 30].map((k) => internalBackoff(k))).toEqual([30_000, 60_000, 120_000, 240_000, 480_000, 900_000, 900_000, 900_000]);
    expect(internalBackoff(0)).toBe(0);
    expect(endedInternal({ result: "failed", code: "internal", detail: "", status: "queued" })).toBe(true);
    expect(endedInternal({ result: "lost", detail: "" })).toBe(true);
    expect(endedInternal({ result: "unfinished", detail: "" })).toBe(true);
    expect(endedInternal({ result: "failed", code: "damaged", detail: "", status: "failed" })).toBe(false);
    expect(endedInternal({ result: "done", videoId: "v", state: "checking" })).toBe(false);
  });
});
