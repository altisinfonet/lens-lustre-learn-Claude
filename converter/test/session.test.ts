// @vitest-environment node
/**
 * The persisted session (live CAPTCHA, 2026-10-18): the refresh token lives in
 * this lane's 0600 session file; a start uses it first (refresh grant — never
 * CAPTCHA-gated) without touching the password; every rotation is on disk before
 * its access token is used; a refused refresh whose password fallback answers
 * CAPTCHA logs `auth.reseed_required` and backs off (1 min … 1 h) instead of
 * hammering, until a seeded token appears in the file. Staging (no CAPTCHA)
 * signs in with the password as before.
 */
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Api } from "../src/api";
import { AuthError, ReseedRequired, reseedBackoff, Session, SessionFile, SessionPersistError, type ReseedInfo } from "../src/auth";
import { ClaimStateStore } from "../src/state";
import { claimErrorDelay, workerLoop, type WorkerDeps } from "../src/worker";
import { FakeLauncher, fakeServer, probeJson, send, SRC, tempDir, TOKEN, type FakeServer } from "./helpers";

// Fixture tokens: low-entropy on purpose (the repo's secret scan must not mistake a fixture for a secret).
const PW = "aaaa-bbbb-aaaa";
const T = (n: number) => `token-aaaa-${String(n).padStart(4, "0")}`;
let server: FakeServer | null = null;
const dirs: string[] = [];
afterEach(async () => {
  await server?.close(); server = null;
  for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true });
});
async function dir(): Promise<string> { const d = await tempDir(); dirs.push(d); return d; }
const fileToken = (f: string): unknown => (JSON.parse(readFileSync(f, "utf8")) as { refresh_token?: unknown }).refresh_token;
async function seedFile(f: string, token: string): Promise<void> {
  await fs.mkdir(path.dirname(f), { recursive: true, mode: 0o700 });
  await fs.writeFile(f, JSON.stringify({ refresh_token: token }), { mode: 0o600 });
}

/** /auth/v1/token: refresh → rotate (or `refresh` decides); password → `password` decides (default: CAPTCHA, like live). */
function authServer(s: FakeServer, o: {
  refresh?: (token: string) => [number, unknown] | null;
  password?: () => [number, unknown];
} = {}) {
  const calls = { refresh: [] as string[], password: 0 };
  let n = 100;
  s.on("POST", "/auth/v1/token", (req, res) => {
    const body = req.json as { refresh_token?: string; password?: string };
    if (body.refresh_token !== undefined) {
      calls.refresh.push(body.refresh_token);
      const r = o.refresh?.(body.refresh_token);
      if (r) { send(res, r[0], r[1]); return; }
    } else {
      calls.password++;
      const r = o.password?.() ?? [400, { code: 400, error_code: "captcha_failed", msg: "captcha protection: request disallowed (no captcha response)" }];
      if (r[0] !== 200) { send(res, r[0], r[1]); return; }
    }
    n++;
    send(res, 200, { access_token: `access-${n}`, refresh_token: T(n), expires_in: 3600 });
  });
  return calls;
}

describe("converter · the persisted session", () => {
  it("starts from a seeded session file: ONE refresh grant, NO password call; the rotated token is saved", async () => {
    server = await fakeServer();
    const calls = authServer(server);
    const f = path.join(await dir(), "state", "session.json");
    await seedFile(f, T(1));
    let credentialsRead = 0;
    const s = new Session({
      supabaseUrl: server.url, anonKey: "anon", sessionFile: f,
      credentials: async () => { credentialsRead++; return { email: "c@x.test", password: PW }; },
    });
    expect(await s.token()).toBe("access-101");
    expect(calls.refresh).toEqual([T(1)]);
    expect(calls.password).toBe(0);
    expect(credentialsRead).toBe(0);
    expect(server.requests.map((r) => r.path)).toEqual(["/auth/v1/token"]);
    expect(server.requests[0].body.toString()).not.toContain("password");
    expect(fileToken(f)).toBe(T(101));
    if (process.platform !== "win32") expect((await fs.stat(f)).mode & 0o777).toBe(0o600);
    // no temp file left beside it
    expect((await fs.readdir(path.dirname(f))).sort()).toEqual(["session.json"]);
  });

  it("crash-safety: every rotation is on disk BEFORE its access token reaches the API", async () => {
    server = await fakeServer();
    authServer(server);
    const f = path.join(await dir(), "session.json");
    await seedFile(f, T(1));
    const onDiskWhenUsed: Array<[string | undefined, unknown]> = [];
    server.on("POST", "/api/video/convert/claim", (req, res) => {
      onDiskWhenUsed.push([req.headers.authorization, fileToken(f)]);
      send(res, 200, { job: null });
    });
    let now = 1_000_000;
    const session = new Session({ supabaseUrl: server.url, anonKey: "anon", sessionFile: f, now: () => now, credentials: async () => ({ email: "c@x.test", password: PW }) });
    const api = new Api({ apiBase: server.url, supabaseUrl: server.url, anonKey: "anon", session });
    await api.claim();
    now += 3600_000; // expired → refresh with the SAVED rotation
    await api.claim();
    expect(onDiskWhenUsed).toEqual([["Bearer access-101", T(101)], ["Bearer access-102", T(102)]]);
  });

  it("a rotation that cannot be written: nothing is handed out and NO further grant is made until it is on disk", async () => {
    server = await fakeServer();
    const calls = authServer(server, { password: () => [200, {}] });
    const d = await dir();
    const blocker = path.join(d, "state");
    await fs.writeFile(blocker, "x"); // a FILE where the state directory should be: every write fails
    const f = path.join(blocker, "session.json");
    const problems: string[] = [];
    const s = new Session({
      supabaseUrl: server.url, anonKey: "anon", sessionFile: f, credentials: async () => ({ email: "c@x.test", password: PW }),
      onSessionFileProblem: (m) => problems.push(m),
    });
    await expect(s.token()).rejects.toBeInstanceOf(SessionPersistError);
    await expect(s.token()).rejects.toBeInstanceOf(SessionPersistError);
    expect(calls.password + calls.refresh.length).toBe(1); // one grant; the second call only retried the write
    expect(problems.length).toBeGreaterThan(0);
    await fs.rm(blocker);
    expect(await s.token()).toBe("access-101"); // the SAME session, now saved — not a new grant
    expect(calls.password + calls.refresh.length).toBe(1);
    expect(fileToken(f)).toBe(T(101));
  });

  it("single-flight: concurrent callers share ONE grant (no two-tab race against the reuse detector)", async () => {
    server = await fakeServer();
    const calls = authServer(server);
    const f = path.join(await dir(), "session.json");
    await seedFile(f, T(1));
    const s = new Session({ supabaseUrl: server.url, anonKey: "anon", sessionFile: f, credentials: async () => ({ email: "c@x.test", password: PW }) });
    const got = await Promise.all([s.token(), s.token(), s.token(), s.token()]);
    expect(new Set(got)).toEqual(new Set(["access-101"]));
    expect(calls.refresh).toEqual([T(1)]);
  });

  it("a token another writer put in the file (the seed step) wins over the one in memory", async () => {
    server = await fakeServer();
    const calls = authServer(server);
    const f = path.join(await dir(), "session.json");
    await seedFile(f, T(1));
    let now = 1_000_000;
    const s = new Session({ supabaseUrl: server.url, anonKey: "anon", sessionFile: f, now: () => now, credentials: async () => ({ email: "c@x.test", password: PW }) });
    await s.token();
    await seedFile(f, T(7));
    now += 3600_000;
    await s.token();
    expect(calls.refresh).toEqual([T(1), T(7)]);
  });

  it("captcha_failed after a refused refresh → auth.reseed_required, back-off 1 min … 1 h, NO network call while waiting", async () => {
    server = await fakeServer();
    const calls = authServer(server, { refresh: (t) => (t === T(1) ? [400, { error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" }] : null) });
    const f = path.join(await dir(), "session.json");
    await seedFile(f, T(1));
    let now = 1_000_000;
    const reseed: ReseedInfo[] = [];
    const refused: number[] = [];
    const s = new Session({
      supabaseUrl: server.url, anonKey: "anon", sessionFile: f, now: () => now, credentials: async () => ({ email: "c@x.test", password: PW }),
      onReseedRequired: (i) => reseed.push(i), onRefreshRefused: (st) => refused.push(st),
    });
    const e = (await s.token().then(() => null, (x: unknown) => x)) as ReseedRequired;
    expect(e).toBeInstanceOf(ReseedRequired);
    expect(e).toMatchObject({ status: 400, code: "captcha_failed", retryInMs: 60_000, attempted: true });
    expect(e.message).not.toContain(PW);
    expect(refused).toEqual([400]);
    expect(reseed).toEqual([{ status: 400, code: "captcha_failed", attempt: 1, retryInMs: 60_000 }]);
    // the dead token is gone from the file: a restart goes straight to the password
    expect(fileToken(f)).toBeUndefined();
    await expect(new SessionFile(f).load()).resolves.toBeNull();
    const network = server.requests.length;
    // no tight loop: 50 more calls inside the back-off reach no server at all
    for (let i = 0; i < 50; i++) {
      now += 1000;
      await expect(s.token()).rejects.toMatchObject({ name: "ReseedRequired", attempted: false });
    }
    expect(server.requests.length).toBe(network);
    // each further CAPTCHA answer doubles the wait, up to 1 h
    const waits: number[] = [];
    for (let i = 0; i < 8; i++) {
      now += 3_600_001;
      const r = (await s.token().then(() => null, (x: unknown) => x)) as ReseedRequired;
      waits.push(r.retryInMs);
    }
    expect(waits).toEqual([120_000, 240_000, 480_000, 960_000, 1_920_000, 3_600_000, 3_600_000, 3_600_000]);
    expect(calls.password).toBe(9);
    expect(calls.refresh).toEqual([T(1)]); // the refused token is never presented again
    // the Owner seeds a session: picked up at once, inside the back-off
    await seedFile(f, T(2));
    expect(await s.token()).toBe("access-101");
    expect(calls.refresh).toEqual([T(1), T(2)]);
    expect(fileToken(f)).toBe(T(101));
  });

  it("a 400 whose body says captcha (no error_code) counts as CAPTCHA too", async () => {
    server = await fakeServer();
    authServer(server, { password: () => [400, { msg: "captcha verification process failed" }] });
    const s = new Session({ supabaseUrl: server.url, anonKey: "anon", credentials: async () => ({ email: "c@x.test", password: PW }) });
    await expect(s.token()).rejects.toMatchObject({ name: "ReseedRequired", retryInMs: 60_000 });
  });

  it("staging (no CAPTCHA): a refused refresh falls back to the password exactly as before, and the new token is saved", async () => {
    server = await fakeServer();
    const calls = authServer(server, {
      refresh: (t) => (t === T(1) ? [400, { error_code: "refresh_token_already_used" }] : null),
      password: () => [200, {}],
    });
    const f = path.join(await dir(), "session.json");
    await seedFile(f, T(1));
    const reseed: ReseedInfo[] = [];
    const s = new Session({ supabaseUrl: server.url, anonKey: "anon", sessionFile: f, credentials: async () => ({ email: "c@x.test", password: PW }), onReseedRequired: (i) => reseed.push(i) });
    expect(await s.token()).toBe("access-101");
    expect(calls).toEqual({ refresh: [T(1)], password: 1 });
    expect(reseed).toEqual([]);
    expect(fileToken(f)).toBe(T(101));
  });

  it("staging, no file yet: the password sign-in as today; any other refused password is NOT treated as CAPTCHA", async () => {
    server = await fakeServer();
    authServer(server, { password: () => [400, { error_code: "invalid_credentials", msg: "Invalid login credentials" }] });
    const f = path.join(await dir(), "state", "session.json");
    const s = new Session({ supabaseUrl: server.url, anonKey: "anon", sessionFile: f, credentials: async () => ({ email: "c@x.test", password: PW }) });
    const e = (await s.token().then(() => null, (x: unknown) => x)) as AuthError;
    expect(e).toBeInstanceOf(AuthError);
    expect(e).not.toBeInstanceOf(ReseedRequired);
    expect(e.message).toMatch(/HTTP 400 invalid_credentials/);
    expect(existsSync(f)).toBe(false);
  });

  it.skipIf(process.platform === "win32")("a session file other users could read is refused (not used), and the password is tried instead", async () => {
    server = await fakeServer();
    const calls = authServer(server, { password: () => [200, {}] });
    const f = path.join(await dir(), "session.json");
    await seedFile(f, T(1));
    await fs.chmod(f, 0o644);
    const problems: string[] = [];
    const s = new Session({ supabaseUrl: server.url, anonKey: "anon", sessionFile: f, credentials: async () => ({ email: "c@x.test", password: PW }), onSessionFileProblem: (m) => problems.push(m) });
    expect(await s.token()).toBe("access-101");
    expect(calls).toEqual({ refresh: [], password: 1 });
    expect(problems.join(" ")).toMatch(/0600/);
    expect(problems.join(" ")).not.toContain(T(1));
    expect((await fs.stat(f)).mode & 0o777).toBe(0o600); // rewritten by the rename
  });

  it("reseedBackoff: 1, 2, 4 … min, at most 1 h", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 40].map((a) => reseedBackoff(a))).toEqual([60_000, 120_000, 240_000, 480_000, 960_000, 1_920_000, 3_600_000, 3_600_000, 3_600_000]);
  });
});

describe("converter · the worker while a session must be seeded", { timeout: 20_000 }, () => {
  it("stays alive, claims nothing, never spins: one sign-in, one log line, and a minute between looks", async () => {
    server = await fakeServer();
    const calls = authServer(server);
    let claims = 0;
    server.on("POST", "/api/video/convert/claim", (_req, res) => { claims++; send(res, 200, { job: null }); });
    const root = await dir();
    const now = 1_000_000;
    const session = new Session({ supabaseUrl: server.url, anonKey: "anon", now: () => now, sessionFile: path.join(root, "state", "session.json"), credentials: async () => ({ email: "c@x.test", password: PW }) });
    const api = new Api({ apiBase: server.url, supabaseUrl: server.url, anonKey: "anon", session });
    const sleeps: number[] = [];
    const logs: Array<[string, Record<string, unknown>]> = [];
    const deps: WorkerDeps = {
      api, state: new ClaimStateStore(path.join(root, "state", "claim.json")), launcher: new FakeLauncher({ probe: probeJson({ width: 640, height: 360, duration: 6 }) }),
      jobsRoot: path.join(root, "jobs"), preset: "veryfast", heartbeatMs: 60_000, pollMs: 10_000, pollMaxMs: 60_000,
      sleep: async (ms) => { sleeps.push(ms); }, log: (ev, fields = {}) => logs.push([ev, fields]), allowUrl: () => true,
    };
    await fs.mkdir(deps.jobsRoot);
    const r = await workerLoop({ ...deps, maxTurns: 30 });
    expect(r.fatal).toBeUndefined();
    expect(claims).toBe(0);
    expect(calls.password).toBe(1);                       // the clock did not move: no second network sign-in
    expect(sleeps).toHaveLength(30);
    expect(sleeps.every((ms) => ms === 60_000)).toBe(true); // never a tight loop
    expect(logs.filter(([ev]) => ev === "worker.claim_error")).toHaveLength(1);
  });

  it("a claim left on disk is KEPT (not dropped) while the session must be seeded", async () => {
    server = await fakeServer();
    authServer(server);
    const root = await dir();
    const state = new ClaimStateStore(path.join(root, "state", "claim.json"));
    await state.save({ source_id: SRC, claim_token: TOKEN, claimed_at: "2026-10-18T00:00:00Z" });
    const session = new Session({ supabaseUrl: server.url, anonKey: "anon", credentials: async () => ({ email: "c@x.test", password: PW }) });
    const api = new Api({ apiBase: server.url, supabaseUrl: server.url, anonKey: "anon", session });
    const deps = { api, state, log: () => undefined } as unknown as WorkerDeps;
    const { recoverStaleClaim } = await import("../src/worker");
    expect(await recoverStaleClaim(deps)).toBe(false);
    expect(await state.load()).not.toBeNull();
  });

  it("claimErrorDelay: waiting for a seed → between pollMs and pollMaxMs", () => {
    const d = { pollMs: 10_000, pollMaxMs: 60_000 };
    expect(claimErrorDelay(new ReseedRequired("x", 400, "captcha_failed", 3_600_000, true), 10_000, d)).toBe(60_000);
    expect(claimErrorDelay(new ReseedRequired("x", 400, "captcha_failed", 1_000, false), 10_000, d)).toBe(10_000);
  });
});
