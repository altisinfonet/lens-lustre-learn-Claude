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
    const s = new Session({ supabaseUrl: server.url, anonKey: "anon", credentials: async () => ({ email: "c@x.test", password: PW }) });
    expect(await s.token()).toBe("a1");
    expect(await s.token()).toBe("a3"); // 60 s left < margin: refresh refused (n=2), password (n=3)
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
