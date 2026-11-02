// @vitest-environment node
/**
 * The worker's sign-in (s3-media-backfill.yml, photo-retire.yml).
 * Production Auth has CAPTCHA on the password grant: measured 2026-11-02 21:10Z,
 * a password sign-in there answers 400 error_code "captcha_failed" (run
 * 41519876024), staging answers normally. The live converter gets its session
 * server-side (admin generate_link + /verify, neither CAPTCHA-gated); the worker
 * now does the same on that answer — and NEVER signs other sessions out, so the
 * live video converter (same account) stays signed in.
 */
import { describe, expect, it } from "vitest";
import { workerSession } from "../../../../tools/media-derivatives/worker-session.mjs";

const REF = "jtdtehuqtinjxropkkcn";
const SB = `https://${REF}.supabase.co`;
const UID = "33333333-3333-4333-8333-333333333333";
const EMAIL = "worker@example.test";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const SERVICE = `eyJhbGciOiJIUzI1NiJ9.${b64({ role: "service_role", ref: REF })}.sig`;
const ACCESS = `eyJhbGciOiJIUzI1NiJ9.${b64({ sub: UID, role: "authenticated" })}.sig`;

function fake(opts: { password?: "ok" | "captcha" | "invalid"; users?: Array<{ id: string; email: string }>; verifyUser?: string; keys?: unknown } = {}) {
  const calls: string[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    const m = init?.method ?? "GET";
    calls.push(`${m} ${u.replace(SB, "SB").replace("https://api.supabase.com", "API")}`);
    const j = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s });
    if (u === `${SB}/auth/v1/token?grant_type=password`) {
      if (opts.password === "ok") return j(200, { access_token: ACCESS, user: { id: UID } });
      if (opts.password === "invalid") return j(400, { error_code: "invalid_credentials", msg: "Invalid login credentials" });
      return j(400, { error_code: "captcha_failed", msg: "captcha protection: request disallowed (no captcha_token found)" });
    }
    if (u === `https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`) {
      return j(200, opts.keys ?? [{ name: "anon", api_key: "eyJanon" }, { name: "service_role", api_key: SERVICE }]);
    }
    if (u.startsWith(`${SB}/auth/v1/admin/users?`)) return j(200, { users: opts.users ?? [{ id: UID, email: EMAIL }] });
    if (u === `${SB}/auth/v1/admin/generate_link`) return j(200, { id: UID, email: EMAIL, hashed_token: "a".repeat(56), verification_type: "magiclink" });
    if (u === `${SB}/auth/v1/verify`) return j(200, { access_token: ACCESS, refresh_token: "r".repeat(12), user: { id: opts.verifyUser ?? UID } });
    return j(404, {});
  }) as unknown as typeof fetch;
  return { calls, f };
}
const base = { supabaseUrl: SB, anonKey: "anon", email: EMAIL, password: "pw", accessToken: "sbp_x" };

describe("worker sign-in", () => {
  it("staging: the password grant works → its token, no management call, no admin call", async () => {
    const s = fake({ password: "ok" });
    const r = await workerSession({ ...base, fetch: s.f });
    expect(r).toEqual({ token: ACCESS, via: "password" });
    expect(s.calls).toEqual(["POST SB/auth/v1/token?grant_type=password"]);
  });

  it("production CAPTCHA: a server-side session for the SAME account, and nobody is signed out", async () => {
    const s = fake();
    const r = await workerSession({ ...base, fetch: s.f });
    expect(r).toEqual({ token: ACCESS, via: "server-side session (password sign-in is CAPTCHA-protected on this lane)" });
    expect(s.calls).toEqual([
      "POST SB/auth/v1/token?grant_type=password",
      `GET API/v1/projects/${REF}/api-keys?reveal=true`,
      `GET SB/auth/v1/admin/users?filter=${encodeURIComponent(EMAIL)}&per_page=50`,
      "POST SB/auth/v1/admin/generate_link",
      "POST SB/auth/v1/verify",
    ]);
    expect(s.calls.some((c) => c.includes("logout"))).toBe(false);
  });

  it("any other refusal stops with Supabase's reason word only", async () => {
    await expect(workerSession({ ...base, fetch: fake({ password: "invalid" }).f })).rejects.toThrow(/^sign-in answered 400, reason 'invalid_credentials'/);
  });

  it("refuses: no access token for the fallback, an account that is not exactly one user, a session for someone else, a key of another project", async () => {
    await expect(workerSession({ ...base, accessToken: "", fetch: fake().f })).rejects.toThrow(/SUPABASE_ACCESS_TOKEN/);
    await expect(workerSession({ ...base, fetch: fake({ users: [] }).f })).rejects.toThrow(/exactly one account/);
    await expect(workerSession({ ...base, fetch: fake({ verifyUser: "44444444-4444-4444-8444-444444444444" }).f })).rejects.toThrow(/another user/);
    const other = `eyJhbGciOiJIUzI1NiJ9.${b64({ role: "service_role", ref: "fpszggreishhuvdpkmdr" })}.sig`;
    await expect(workerSession({ ...base, fetch: fake({ keys: [{ name: "service_role", api_key: other }] }).f })).rejects.toThrow(/service key/);
  });
});
