// @vitest-environment node
/**
 * The converter's session: password sign-in from the 0600 file, refreshed
 * before it expires (rotation), a refused refresh falls back to the password,
 * a 401 from the API forgets the access token. The password never appears in
 * an error.
 */
import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { readCredentialsFile, Session } from "../src/auth";
import { Api } from "../src/api";
import { fakeServer, send, tempDir, type FakeServer } from "./helpers";

// A fake password (low-entropy on purpose: the repo's secret scan must not mistake a fixture for a secret).
const PW = "aaaa-bbbb-aaaa";
let server: FakeServer | null = null;
afterEach(async () => { await server?.close(); server = null; });

describe("converter · Supabase session", () => {
  it("signs in once, reuses the token, refreshes (rotating) when it is about to expire", async () => {
    server = await fakeServer();
    const seen: Array<{ body: unknown; apikey: unknown }> = [];
    let n = 0;
    server.on("POST", "/auth/v1/token", (req, res) => {
      seen.push({ body: req.json, apikey: req.headers.apikey });
      n++;
      send(res, 200, { access_token: `a${n}`, refresh_token: `r${n}`, expires_in: 3600 });
    });
    let now = 1_000_000;
    const s = new Session({ supabaseUrl: server.url, anonKey: "anon", credentials: async () => ({ email: "c@x.test", password: PW }), now: () => now });
    expect(await s.token()).toBe("a1");
    expect(await s.token()).toBe("a1");
    now += 3600_000 - 200_000; // < 5 min left
    expect(await s.token()).toBe("a2");
    expect(seen.map((x) => x.body)).toEqual([{ email: "c@x.test", password: PW }, { refresh_token: "r1" }]);
    expect(seen.every((x) => x.apikey === "anon")).toBe(true);
    expect(server.requests.length).toBe(2);
  });

  it("a refused refresh (revoked / reused) → signs in with the password again", async () => {
    server = await fakeServer();
    let n = 0;
    server.on("POST", "/auth/v1/token", (req, res) => {
      n++;
      if ((req.json as { refresh_token?: string }).refresh_token) { send(res, 400, { error_code: "refresh_token_already_used", msg: "Invalid Refresh Token" }); return; }
      send(res, 200, { access_token: `a${n}`, refresh_token: `r${n}`, expires_in: 60 });
    });
    const refused: Array<[number, string]> = [];
    const s = new Session({
      supabaseUrl: server.url, anonKey: "anon", credentials: async () => ({ email: "c@x.test", password: PW }),
      onRefreshRefused: (status, message) => refused.push([status, message]),
    });
    expect(await s.token()).toBe("a1");
    expect(await s.token()).toBe("a3"); // 60 s left < margin: refresh refused (n=2), password (n=3)
    // told BEFORE the password sign-in (possible reuse detection — review of #420), with Supabase's code
    expect(refused).toEqual([[400, "sign-in (refresh_token) refused: HTTP 400 refresh_token_already_used"]]);
  });

  it("re-review N6g: a refresh answered 429 / 408 / 5xx is transient — thrown, the refresh token kept, NOT reported as refused (no theft alarm)", async () => {
    for (const status of [429, 408, 503]) {
      server = await fakeServer();
      let n = 0;
      let refreshAnswer = status;
      const bodies: unknown[] = [];
      server.on("POST", "/auth/v1/token", (req, res) => {
        n++;
        bodies.push(req.json);
        if ((req.json as { refresh_token?: string }).refresh_token && refreshAnswer !== 200) { send(res, refreshAnswer, { error_code: "over_request_rate_limit", msg: "slow down" }); return; }
        send(res, 200, { access_token: `a${n}`, refresh_token: `r${n}`, expires_in: 60 });
      });
      const refused: number[] = [];
      const s = new Session({
        supabaseUrl: server.url, anonKey: "anon", credentials: async () => ({ email: "c@x.test", password: PW }),
        onRefreshRefused: (st) => refused.push(st),
      });
      expect(await s.token()).toBe("a1");
      await expect(s.token()).rejects.toThrow(new RegExp(`HTTP ${status}`)); // 60 s left < margin → refresh → transient
      expect(refused).toEqual([]);                                          // not "refused": no theft alarm
      expect(bodies.filter((b) => (b as { password?: string }).password)).toHaveLength(1); // no password sign-in instead
      refreshAnswer = 200;
      expect(await s.token()).toBe("a3");                                   // later: the SAME refresh token works
      expect(bodies[2]).toEqual({ refresh_token: "r1" });
      await server.close(); server = null;
    }
  });

  it("a refused password sign-in throws without the password in the message", async () => {
    server = await fakeServer();
    server.on("POST", "/auth/v1/token", (_req, res) => send(res, 400, { error_code: "invalid_credentials", msg: `Invalid login credentials ${PW}` }));
    const s = new Session({ supabaseUrl: server.url, anonKey: "anon", credentials: async () => ({ email: "c@x.test", password: PW }) });
    const e = (await s.token().then(() => null, (x: unknown) => x)) as Error;
    expect(e.message).toMatch(/HTTP 400 invalid_credentials/);
    expect(e.message).not.toContain(PW);
  });

  it("a 401 from the API: the access token is forgotten and the call made once more", async () => {
    server = await fakeServer();
    let n = 0;
    server.on("POST", "/auth/v1/token", (_req, res) => { n++; send(res, 200, { access_token: `a${n}`, refresh_token: `r${n}`, expires_in: 3600 }); });
    let calls = 0;
    server.on("POST", "/api/video/convert/claim", (req, res) => {
      calls++;
      if (req.headers.authorization === "Bearer a1") { send(res, 401, { error: "VID-AUTH-001" }); return; }
      send(res, 200, { job: null });
    });
    const session = new Session({ supabaseUrl: server.url, anonKey: "anon", credentials: async () => ({ email: "c@x.test", password: PW }) });
    const api = new Api({ apiBase: server.url, supabaseUrl: server.url, anonKey: "anon", session });
    expect(await api.claim()).toBeNull();
    expect(calls).toBe(2);
  });

  it("redirects are refused on the Pages and Supabase calls (review of #420): the JWT never follows a Location", async () => {
    server = await fakeServer();
    let followed = 0;
    server.on("POST", "/auth/v1/token", (_req, res) => send(res, 200, { access_token: "a1", refresh_token: "r1", expires_in: 3600 }));
    server.on("POST", "/api/video/convert/claim", (_req, res) => { res.writeHead(307, { location: `${server!.url}/elsewhere` }); res.end(); });
    server.on("POST", "/elsewhere", (_req, res) => { followed++; send(res, 200, { job: null }); });
    const session = new Session({ supabaseUrl: server.url, anonKey: "anon", credentials: async () => ({ email: "c@x.test", password: PW }) });
    const api = new Api({ apiBase: server.url, supabaseUrl: server.url, anonKey: "anon", session });
    await expect(api.claim()).rejects.toMatchObject({ status: 0, code: "NETWORK" });
    expect(followed).toBe(0);
    // and the sign-in itself
    server.on("POST", "/auth/v1/token", (_req, res) => { res.writeHead(302, { location: `${server!.url}/elsewhere` }); res.end(); });
    const fresh = new Session({ supabaseUrl: server.url, anonKey: "anon", credentials: async () => ({ email: "c@x.test", password: PW }) });
    await expect(fresh.token()).rejects.toThrow();
    expect(followed).toBe(0);
  });

  it("a claim whose source_id or claim_token is not a lowercase uuid is refused before any path is built (review of #420, L2)", async () => {
    server = await fakeServer();
    server.on("POST", "/auth/v1/token", (_req, res) => send(res, 200, { access_token: "a1", refresh_token: "r1", expires_in: 3600 }));
    const job = { owner_id: "11111111-1111-4111-8111-111111111111", purpose: "post", source_bytes: 4, source_etag: "e", lease_until: new Date().toISOString(), attempt: 1 };
    let answer: Record<string, unknown> = {};
    server.on("POST", "/api/video/convert/claim", (_req, res) => send(res, 200, answer));
    const session = new Session({ supabaseUrl: server.url, anonKey: "anon", credentials: async () => ({ email: "c@x.test", password: PW }) });
    const api = new Api({ apiBase: server.url, supabaseUrl: server.url, anonKey: "anon", session });
    const source = { url: "https://x.r2.cloudflarestorage.com/b/k", headers: {}, bytes: 4, expires_in: 60 };
    for (const [source_id, claim_token] of [
      ["../../etc", "66666666-6666-4666-8666-666666666666"],
      ["55555555-5555-4555-8555-555555555555", "x/../y"],
      ["55555555-5555-4555-8555-55555555555A", "66666666-6666-4666-8666-666666666666"], // upper case
    ]) {
      answer = { job: { ...job, source_id, claim_token }, source };
      await expect(api.claim()).rejects.toMatchObject({ code: "VID-CONV-BAD" });
    }
    answer = { job: { ...job, source_id: "55555555-5555-4555-8555-555555555555", claim_token: "66666666-6666-4666-8666-666666666666" }, source };
    expect(await api.claim()).not.toBeNull();
  });
});

describe("converter · the credentials file", () => {
  it("needs {email, password}; never echoes the content when it is not JSON", async () => {
    const d = await tempDir();
    try {
      const f = path.join(d, "credentials.json");
      await fs.writeFile(f, JSON.stringify({ email: "c@x.test", password: PW }), { mode: 0o600 });
      expect(await readCredentialsFile(f)).toEqual({ email: "c@x.test", password: PW });
      await fs.writeFile(f, `${PW} not json`, { mode: 0o600 });
      const e = (await readCredentialsFile(f).then(() => null, (x: unknown) => x)) as Error;
      expect(e.message).not.toContain(PW);
      await fs.writeFile(f, JSON.stringify({ email: "c@x.test" }), { mode: 0o600 });
      await expect(readCredentialsFile(f)).rejects.toThrow(/email.*password/);
    } finally {
      await fs.rm(d, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")("refuses a file other users can read (must be 0600)", async () => {
    const d = await tempDir();
    try {
      const f = path.join(d, "credentials.json");
      await fs.writeFile(f, JSON.stringify({ email: "c@x.test", password: PW }));
      await fs.chmod(f, 0o644);
      await expect(readCredentialsFile(f)).rejects.toThrow(/0600/);
    } finally {
      await fs.rm(d, { recursive: true, force: true });
    }
  });
});
