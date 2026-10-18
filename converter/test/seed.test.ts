// @vitest-environment node
/**
 * converter/tools/seed-session.mjs — the Owner's one-time seed of the LIVE
 * converter session (live CAPTCHA, 2026-10-18). Mock fetch only: nothing real
 * is called. It must refuse wrong input BEFORE any network call, touch only the
 * converter account, write only {"refresh_token"} to stdout, and never print,
 * echo or forward the service-role key.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { CONVERTER_EMAIL, main, seed } from "../tools/seed-session.mjs";

const DEPLOY = path.join(__dirname, "..", "deploy");

const REF = "abcdefghijabcdefghij";
const URL_ = `https://${REF}.supabase.co`;
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
// A fake service-role JWT, assembled at run time (low-entropy: the repo's secret scan must not mistake it for a key).
const KEY = [b64({ alg: "HS256", typ: "JWT" }), b64({ role: "service_role", ref: REF, iss: "supabase" }), "c2lnbmF0dXJlLWZha2UtZmFrZQ"].join(".");
const ID = "99999999-9999-4999-8999-999999999999";
const RT = "seedtoken-aaaa-0001";
const HASH = "aaaabbbbccccddddeeeeffff0000111122223333444455556666aaaa";

interface Call { method: string; url: string; headers: Record<string, string>; body: unknown }

function mockFetch(over: Partial<Record<"users" | "link" | "verify", [number, unknown]>> = {}) {
  const calls: Call[] = [];
  const f = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ method: String(init.method ?? "GET"), url, headers: { ...(init.headers as Record<string, string>) }, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const answer = (k: "users" | "link" | "verify", def: unknown): Response => {
      const [status, body] = over[k] ?? [200, def];
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    };
    if (url.includes("/auth/v1/admin/users")) return answer("users", { users: [{ id: ID, email: CONVERTER_EMAIL }], aud: "authenticated" });
    if (url.endsWith("/auth/v1/admin/generate_link")) return answer("link", { id: ID, email: CONVERTER_EMAIL, hashed_token: HASH, verification_type: "magiclink", action_link: "https://x/verify?token=t" });
    if (url.endsWith("/auth/v1/logout?scope=others")) return new Response(null, { status: 204 });
    if (url.endsWith("/auth/v1/verify")) return answer("verify", { access_token: "access-token-aaaa-bbbb-cccc", refresh_token: RT, expires_in: 3600, user: { id: ID, email: CONVERTER_EMAIL } });
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

async function run(o: { argv?: string[]; env?: Record<string, string>; stdin?: string; tty?: boolean; fetch?: typeof fetch }) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main({
    argv: o.argv ?? ["--url", URL_], env: o.env ?? { SUPABASE_SERVICE_ROLE_KEY: KEY },
    readStdin: async () => o.stdin ?? "", stdout: (s) => out.push(s), stderr: (s) => err.push(s),
    stdoutIsTTY: o.tty ?? false, fetch: o.fetch ?? mockFetch().f,
  });
  return { code, out: out.join(""), err: err.join("") };
}

describe("converter · seed-session.mjs", () => {
  it("generate_link (magiclink) → verify (token_hash): stdout is exactly {\"refresh_token\"}; the key is never printed", async () => {
    const { f, calls } = mockFetch();
    const r = await run({ fetch: f });
    expect(r.code).toBe(0);
    expect(r.out).toBe(`${JSON.stringify({ refresh_token: RT })}\n`);
    expect(r.out + r.err).not.toContain(KEY);
    expect(r.err).not.toContain(RT);
    expect(calls.map((c) => `${c.method} ${c.url.replace(URL_, "")}`)).toEqual([
      `GET /auth/v1/admin/users?filter=${encodeURIComponent(CONVERTER_EMAIL)}&per_page=50`,
      "POST /auth/v1/admin/generate_link",
      "POST /auth/v1/verify",
    ]);
    expect(calls[1].body).toEqual({ type: "magiclink", email: CONVERTER_EMAIL });
    expect(calls[2].body).toEqual({ type: "magiclink", token_hash: HASH });
    // the key goes to this project only, and /verify gets it only as the apikey (no bearer)
    expect(calls.every((c) => c.url.startsWith(`${URL_}/auth/v1/`))).toBe(true);
    expect(calls[2].headers.authorization).toBeUndefined();
    // nothing else: no password change, no other user, no user creation
    expect(calls.some((c) => c.method === "PUT" || c.method === "DELETE" || /\/admin\/users\/|\/user$|signup/.test(c.url))).toBe(false);
  });

  it("--revoke-others (a stolen session file): signs out every OTHER session of the account with the NEW session's token", async () => {
    const { f, calls } = mockFetch();
    const r = await run({ argv: ["--url", URL_, "--revoke-others"], fetch: f });
    expect(r.code).toBe(0);
    expect(r.out).toBe(`${JSON.stringify({ refresh_token: RT })}\n`);
    expect(calls.map((c) => `${c.method} ${c.url.replace(URL_, "")}`).slice(3)).toEqual(["POST /auth/v1/logout?scope=others"]);
    expect(calls[3].headers.authorization).toBe("Bearer access-token-aaaa-bbbb-cccc");
    // without the flag: no logout at all
    const plain = mockFetch();
    await run({ fetch: plain.f });
    expect(plain.calls.some((c) => c.url.includes("/logout"))).toBe(false);
  });

  it("the key from stdin (--key-stdin) works the same", async () => {
    const r = await run({ argv: ["--url", URL_, "--key-stdin"], env: {}, stdin: `${KEY}\r\n` });
    expect(r.code).toBe(0);
    expect(r.out).toBe(`${JSON.stringify({ refresh_token: RT })}\n`);
  });

  it("refuses a key on the command line — without echoing it, before any network call", async () => {
    for (const argv of [["--url", URL_, KEY], ["--url", URL_, "--key", KEY], [`--key=${KEY}`], ["--url", URL_, ["sb", "secret", "aaaabbbbccccdddd"].join("_")]]) {
      const { f, calls } = mockFetch();
      const r = await run({ argv, fetch: f });
      expect(r.code).toBe(2);
      expect(r.out).toBe("");
      expect(r.err).toMatch(/never be on the command line/);
      expect(r.err).not.toContain(KEY);
      expect(r.err).not.toContain("aaaabbbbccccdddd");
      expect(calls).toEqual([]);
    }
  });

  it("refuses any other e-mail than the converter account, a bad URL, a missing / wrong-project / non-service key, a terminal stdout — no network call", async () => {
    const otherRef = [b64({ alg: "HS256" }), b64({ role: "service_role", ref: "zzzzzzzzzzzzzzzzzzzz" }), "c2ln"].join(".");
    const anon = [b64({ alg: "HS256" }), b64({ role: "anon", ref: REF }), "c2ln"].join(".");
    const cases: Array<[Parameters<typeof run>[0], RegExp]> = [
      [{ argv: ["--url", URL_, "--email", "owner@50mmretina.com"] }, /only the converter account/],
      [{ argv: ["--url", "https://evil.example.com"] }, /--url must be/],
      [{ argv: ["--url", `http://${REF}.supabase.co`] }, /--url must be/],
      [{ argv: ["--url", `${URL_}/auth/v1`] }, /--url must be/],
      [{ env: {} }, /no service-role key/],
      [{ env: { SUPABASE_SERVICE_ROLE_KEY: otherRef } }, /another project/],
      [{ env: { SUPABASE_SERVICE_ROLE_KEY: anon } }, /not service_role/],
      [{ env: { SUPABASE_SERVICE_ROLE_KEY: "sb_publishable_aaaabbbbccccdddd" } }, /publishable/],
      [{ tty: true }, /terminal/],
      [{ argv: ["--url", URL_, "--bogus"] }, /unknown argument/],
    ];
    for (const [o, why] of cases) {
      const { f, calls } = mockFetch();
      const r = await run({ ...o, fetch: f });
      expect(r.code, String(why)).toBe(2);
      expect(r.err).toMatch(why);
      expect(r.out).toBe("");
      expect(r.err).not.toContain(KEY);
      expect(calls).toEqual([]);
    }
  });

  it("stops when the account is missing (never signs one up), duplicated, or an answer names another user", async () => {
    const other = "88888888-8888-4888-8888-888888888888";
    const cases: Array<[Parameters<typeof mockFetch>[0], RegExp, number]> = [
      [{ users: [200, { users: [] }] }, /not on this project \(found 0\)/, 1],
      [{ users: [200, { users: [{ id: ID, email: `x${CONVERTER_EMAIL}` }] }] }, /not on this project/, 1], // the filter is a LIKE
      [{ link: [200, { id: other, email: CONVERTER_EMAIL, hashed_token: HASH, verification_type: "magiclink" }] }, /another user/, 2],
      [{ link: [200, { id: ID, email: CONVERTER_EMAIL, hashed_token: HASH, verification_type: "signup" }] }, /not a magic link/, 2],
      [{ link: [200, { id: ID, email: CONVERTER_EMAIL, verification_type: "magiclink" }] }, /without a hashed_token/, 2],
      [{ verify: [200, { refresh_token: RT, user: { id: other } }] }, /another user/, 3],
      [{ verify: [400, { error_code: "otp_expired", msg: `token ${HASH} expired` }] }, /HTTP 400 otp_expired/, 3],
      [{ users: [401, { msg: `bad key ${KEY}` }] }, /HTTP 401/, 1],
    ];
    for (const [over, why, n] of cases) {
      const { f, calls } = mockFetch(over);
      const r = await run({ fetch: f });
      expect(r.code, String(why)).toBe(2);
      expect(r.err).toMatch(why);
      expect(r.out).toBe("");
      expect(r.err).not.toContain(KEY);
      expect(r.err).not.toContain(HASH);
      expect(calls).toHaveLength(n);
    }
  });

  it("its stdout is exactly what the VM's install-session.sh accepts; anything else is refused there", async () => {
    const r = await run({});
    const check = (input: string) => spawnSync("bash", ["install-session.sh", "--validate-only"], { cwd: DEPLOY, input, encoding: "utf8" });
    expect(check(r.out).status).toBe(0);
    for (const bad of ["", "{}", `${r.out.trim()} extra`, `{"refresh_token":"short"}`, `{"refresh_token":"a b c d e f g h"}`, `{"refresh_token":"$(reboot)aaaaaaaaaaaa"}`, `{"access_token":"${RT}"}`]) {
      const c = check(bad);
      expect(c.status, bad).toBe(2);
      expect(c.stdout + c.stderr).not.toContain(RT);
    }
    // without --lane nothing is written, even with valid input (and before any root check)
    const noLane = spawnSync("bash", ["install-session.sh"], { cwd: DEPLOY, input: r.out, encoding: "utf8" });
    expect(noLane.status).toBe(2);
    expect(noLane.stderr).toMatch(/--lane staging\|live is required/);
    expect(noLane.stdout + noLane.stderr).not.toContain(RT);
  });

  it("seed() itself refuses the wrong e-mail before any call", async () => {
    const { f, calls } = mockFetch();
    await expect(seed({ supabaseUrl: URL_, serviceKey: KEY, email: "someone@else.test", fetch: f })).rejects.toThrow(/only the converter account/);
    expect(calls).toEqual([]);
  });
});
