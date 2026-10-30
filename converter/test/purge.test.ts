// @vitest-environment node
/**
 * S7-f · the purge tick: the worker drains POST /api/video/purge (S7-a) with its
 * own refreshing converter session, at most once per CONVERTER_PURGE_EVERY_MS
 * (default 1 h, 0 = off), ONE purge request per loop turn (between job polls,
 * never inside a job), until a page comes back short / with nothing deleted, or
 * the per-tick cap. A failure is one log line and a wait for the next interval —
 * never a crash, never a job failure. Logs carry counts only.
 */
import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/config";
import { jsonLogger } from "../src/log";
import { ClaimStateStore } from "../src/state";
import { PURGE_LIMIT, PURGE_MAX_CALLS, workerLoop, type WorkerDeps } from "../src/worker";
import { apiFor, FakeLauncher, fakeServer, OWNER, probeJson, send, SRC, tempDir, TOKEN, withAuth, type FakeServer } from "./helpers";

let server: FakeServer | null = null;
const dirs: string[] = [];
afterEach(async () => {
  await server?.close(); server = null;
  for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

const HOUR = 3_600_000;

async function base(purgeEveryMs: number | undefined) {
  const s = await fakeServer();
  server = s;
  const counters = withAuth(s);
  const root = await tempDir();
  dirs.push(root);
  const clock = { now: 0 };
  const sleeps: number[] = [];
  const logs: Array<{ e: string; f: Record<string, unknown> }> = [];
  const { api } = apiFor(s);
  const deps = {
    api, state: new ClaimStateStore(path.join(root, "state", "claim.json")), launcher: new FakeLauncher({ probe: probeJson({ width: 640, height: 360, duration: 6 }) }),
    jobsRoot: path.join(root, "jobs"), preset: "veryfast", heartbeatMs: 60_000, pollMs: 10_000, pollMaxMs: 60_000,
    sleep: async (ms: number) => { sleeps.push(ms); clock.now += ms; },
    log: (e: string, f: Record<string, unknown> = {}) => { logs.push({ e, f }); }, allowUrl: () => true,
    now: () => clock.now,
    ...(purgeEveryMs === undefined ? {} : { purgeEveryMs }),
  } as WorkerDeps;
  await fs.mkdir(deps.jobsRoot);
  const order: string[] = [];
  const purgeAt: number[] = [];
  s.on("POST", "/api/video/convert/claim", (_req, res) => { order.push("claim"); send(res, 200, { job: null }); });
  return { s, deps, sleeps, logs, clock, order, purgeAt, counters };
}

const page = (claimed: number, done: number, failed = 0) => ({
  claimed,
  done: Array.from({ length: done }, (_, i) => ({ id: i + 1, objects: 3 })),
  failed: Array.from({ length: failed }, (_, i) => ({ id: 100 + i, error: "boom" })),
});

describe("converter · the purge tick (S7-f)", { timeout: 30_000 }, () => {
  it("fires at start, then once per interval and never more often (fake clock, idle queue)", async () => {
    const { s, deps, order, purgeAt, clock, logs } = await base(HOUR);
    s.on("POST", "/api/video/purge", (req, res) => { order.push("purge"); purgeAt.push(clock.now); expect(req.json).toEqual({ limit: PURGE_LIMIT }); send(res, 200, page(0, 0)); });
    // idle claims at 0, 10 s, 30 s, 70 s, then every 60 s: turn 122 is at 7 210 s
    await workerLoop({ ...deps, maxTurns: 130 });
    expect(purgeAt).toEqual([0, 3_610_000, 7_210_000]);
    for (let i = 1; i < purgeAt.length; i++) expect(purgeAt[i] - purgeAt[i - 1]).toBeGreaterThanOrEqual(HOUR);
    expect(order.filter((o) => o === "claim")).toHaveLength(130);            // every turn still polled for a job
    expect(logs.filter((l) => l.e === "worker.purge")).toHaveLength(3);      // one line per tick
    expect(logs.find((l) => l.e === "worker.purge")!.f).toMatchObject({ ok: true, calls: 1, claimed: 0, done: 0, failed: 0, objects: 0 });
  });

  it("disabled with 0 (and when the worker is given no interval at all)", async () => {
    for (const every of [0, undefined]) {
      const { s, deps, order, logs } = await base(every);
      s.on("POST", "/api/video/purge", (_req, res) => { order.push("purge"); send(res, 200, page(0, 0)); });
      await workerLoop({ ...deps, maxTurns: 10 });
      expect(order).not.toContain("purge");
      expect(logs.some((l) => l.e === "worker.purge")).toBe(false);
      await server?.close(); server = null;
    }
  });

  it("drains page after page — one purge request per turn, a claim between each — until a short page", async () => {
    const { s, deps, order, logs } = await base(HOUR);
    const pages = [page(5, 5), page(5, 4, 1), page(5, 5), page(2, 2)];
    let n = 0;
    s.on("POST", "/api/video/purge", (_req, res) => { order.push("purge"); send(res, 200, pages[n++] ?? page(0, 0)); });
    await workerLoop({ ...deps, maxTurns: 8 });
    expect(n).toBe(4);
    expect(order.slice(0, 8)).toEqual(["purge", "claim", "purge", "claim", "purge", "claim", "purge", "claim"]);
    const ticks = logs.filter((l) => l.e === "worker.purge");
    expect(ticks).toHaveLength(1);
    expect(ticks[0].f).toMatchObject({ ok: true, calls: 4, claimed: 17, done: 16, failed: 1, objects: 48, capped: false });
  });

  it("stops at the per-tick cap while the queue keeps answering full pages; a page with nothing deleted ends the tick", async () => {
    const { s, deps, logs } = await base(HOUR);
    let n = 0;
    s.on("POST", "/api/video/purge", (_req, res) => { n++; send(res, 200, page(PURGE_LIMIT, PURGE_LIMIT)); });
    await workerLoop({ ...deps, maxTurns: PURGE_MAX_CALLS + 10 });
    expect(n).toBe(PURGE_MAX_CALLS);
    expect(logs.filter((l) => l.e === "worker.purge")).toEqual([
      { e: "worker.purge", f: expect.objectContaining({ ok: true, calls: PURGE_MAX_CALLS, claimed: PURGE_LIMIT * PURGE_MAX_CALLS, capped: true }) },
    ]);
    expect(PURGE_LIMIT).toBeGreaterThanOrEqual(1);
    expect(PURGE_LIMIT).toBeLessThanOrEqual(10);                           // the route's own clamp

    const b = await base(HOUR);
    let m = 0;
    b.s.on("POST", "/api/video/purge", (_req, res) => { m++; send(res, 200, page(PURGE_LIMIT, 0, PURGE_LIMIT)); });
    await workerLoop({ ...b.deps, maxTurns: 10 });
    expect(m).toBe(1);                                                    // failed rows are not re-churned in the same tick
  });

  it("a failing purge (5xx, then 401 after the session's own refresh) is logged, waits for the next interval, and jobs are still claimed and run", async () => {
    const { s, deps, logs, clock, purgeAt, counters } = await base(HOUR);
    let status = 503;
    s.on("POST", "/api/video/purge", (_req, res) => { purgeAt.push(clock.now); send(res, status, { error: "VID-ENV-002", message: "down" }); status = 401; });
    let claims = 0;
    s.on("POST", "/api/video/convert/claim", (_req, res) => {
      claims++;
      if (claims !== 2) { send(res, 200, { job: null }); return; }
      send(res, 200, {
        job: { source_id: SRC, owner_id: OWNER, purpose: "post", source_bytes: 4, source_etag: "e", claim_token: TOKEN, lease_until: new Date(Date.now() + 1_800_000).toISOString(), attempt: 1 },
        source: { url: `${s.url}/r2/source`, headers: { "if-match": '"e"' }, bytes: 4, expires_in: 600 },
      });
    });
    s.on("GET", "/r2/source", (_req, res) => { res.writeHead(200, { etag: '"e"', "content-length": "4" }); res.end("abcd"); });
    deps.launcher = new FakeLauncher({ probe: JSON.stringify({ format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "4" }, streams: [] }) });
    s.on("POST", "/api/video/convert/finish", (_req, res) => send(res, 200, { source_id: SRC, status: "failed" }));
    const { jobs, fatal } = await workerLoop({ ...deps, maxTurns: 130 });
    expect(fatal).toBeUndefined();
    expect(jobs).toEqual([{ result: "failed", code: "no_video", detail: "no video stream", status: "failed" }]); // the job's own ending, not the purge's
    expect(claims).toBe(130);
    // the 503 at start; nothing until an hour later; the 401 was retried once by Api after a fresh sign-in
    expect(purgeAt[0]).toBe(0);
    expect(purgeAt.slice(1).every((t) => t >= HOUR)).toBe(true);
    expect(counters.refresh).toBeGreaterThanOrEqual(1);                // Api's own 401 path: invalidate → refresh → retry once
    const ticks = logs.filter((l) => l.e === "worker.purge").map((l) => l.f);
    expect(ticks[0]).toMatchObject({ ok: false, http: 503, code: "VID-ENV-002", calls: 1, retry_in_ms: HOUR });
    expect(ticks[1]).toMatchObject({ ok: false, http: 401, calls: 1 });
  });

  it("a thrown purge (no network) never escapes the loop", async () => {
    const { s, deps, logs } = await base(HOUR);
    const pages = deps.api.pages.bind(deps.api);
    deps.api.pages = async (p, b) => { if (p === "/api/video/purge") throw new Error("socket hang up"); return pages(p, b); };
    const { jobs } = await workerLoop({ ...deps, maxTurns: 3 });
    expect(s.requests.filter((r) => r.path.endsWith("/claim"))).toHaveLength(3);
    expect(jobs).toEqual([]);
    expect(logs.find((l) => l.e === "worker.purge")?.f).toMatchObject({ ok: false, calls: 1 });
  });

  it("no token, key, password or server message ever reaches the log line", async () => {
    const { s, deps } = await base(HOUR);
    const lines: string[] = [];
    let n = 0;
    s.on("POST", "/api/video/purge", (req, res) => {
      n++;
      const auth = String(req.headers.authorization);
      if (n === 1) send(res, 200, page(5, 5));
      else send(res, 500, { error: "VID-DB-001", message: `leaked ${auth} ?X-Amz-Signature=abc anon-test` });
    });
    await workerLoop({ ...deps, log: jsonLogger((l) => lines.push(l)), maxTurns: 4 });
    const out = lines.filter((l) => l.includes("worker.purge")).join("\n");
    expect(out).toContain("worker.purge");
    for (const bad of ["access-", "refresh-", "Bearer", "anon-test", "not-a-real-password", "X-Amz", "leaked", "http://127.0.0.1"]) expect(out).not.toContain(bad);
  });
});

describe("converter · CONVERTER_PURGE_EVERY_MS", () => {
  const env = (v?: string): NodeJS.ProcessEnv => ({ CONVERTER_LAUNCHER: "direct", ...(v === undefined ? {} : { CONVERTER_PURGE_EVERY_MS: v }) });
  it("defaults to 1 h; 0 turns it off; otherwise 1 min .. 1 day", () => {
    expect(loadConfig(env(), { requireNetwork: false }).purgeEveryMs).toBe(HOUR);
    expect(loadConfig(env("0"), { requireNetwork: false }).purgeEveryMs).toBe(0);
    expect(loadConfig(env("600000"), { requireNetwork: false }).purgeEveryMs).toBe(600_000);
    for (const bad of ["1000", "59999", "86400001", "-1", "1h", "1.5"]) {
      expect(() => loadConfig(env(bad), { requireNetwork: false })).toThrow(/CONVERTER_PURGE_EVERY_MS/);
    }
  });
});
