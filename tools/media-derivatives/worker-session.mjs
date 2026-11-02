#!/usr/bin/env node
/**
 * The media worker's sign-in for s3-media-backfill.yml and photo-retire.yml.
 *
 *   1. The password grant (staging today).
 *   2. If — and only if — the lane answers `captcha_failed` (production Auth has
 *      CAPTCHA protection on password sign-in; measured 2026-11-02 21:10Z,
 *      run 41519876024), a session is made SERVER-SIDE, as the live video
 *      converter's is (_control/out/OWNER/seed-session.mjs):
 *        GET  api.supabase.com/v1/projects/<ref>/api-keys?reveal=true   (the environment's
 *             SUPABASE_ACCESS_TOKEN → this project's service key, checked to be this project's)
 *        GET  /auth/v1/admin/users?filter=<email>        exactly one account
 *        POST /auth/v1/admin/generate_link {magiclink}   → hashed_token (no e-mail is sent)
 *        POST /auth/v1/verify {magiclink, token_hash}    → a NEW session for that account
 *      Neither admin route nor /verify is CAPTCHA-gated. CAPTCHA stays on.
 *      NOBODY IS SIGNED OUT: no /logout call, so the live converter (same
 *      account) keeps its own session.
 *   Any other refusal stops with Supabase's reason word only.
 *
 * Secrets: read from the environment only (never argv). Before anything else
 * leaves this process the service key and the session token are registered
 * with `::add-mask::`; the token is written to --out (0600) and printed nowhere.
 *
 * USAGE (in a workflow step, after the lane step set SB_URL / SB_ANON):
 *   WORKER_EMAIL=… WORKER_PASSWORD=… SUPABASE_ACCESS_TOKEN=… \
 *     node tools/media-derivatives/worker-session.mjs --out "$RUNNER_TEMP/worker.jwt"
 */
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

class Refused extends Error {}
const reason = (b) => String(b?.error_code ?? b?.error ?? "unknown").replace(/[^a-z_]/gi, "");
const claims = (jwt) => { try { return JSON.parse(Buffer.from(String(jwt).split(".")[1], "base64url").toString("utf8")); } catch { return null; } };

async function json(f, url, init) {
  const res = await f(url, init);
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, ok: res.ok, body };
}

/** The session token for the worker account, and how it was obtained. */
export async function workerSession({ supabaseUrl, anonKey, email, password, accessToken, mask = () => {}, fetch: f = globalThis.fetch }) {
  const origin = String(supabaseUrl).replace(/\/+$/, "");
  const ref = (/^https:\/\/([a-z0-9]{20})\.supabase\.co$/.exec(origin) ?? [])[1];
  if (!ref) throw new Refused("SB_URL is not a Supabase project URL");
  const wanted = String(email ?? "").trim().toLowerCase();
  if (!wanted || !password) throw new Refused("the worker e-mail / password are not set");

  const pw = await json(f, `${origin}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: anonKey, "content-type": "application/json" }, body: JSON.stringify({ email: wanted, password }),
  });
  if (pw.ok && typeof pw.body?.access_token === "string") return { token: pw.body.access_token, via: "password" };
  if (reason(pw.body) !== "captcha_failed") throw new Refused(`sign-in answered ${pw.status}, reason '${reason(pw.body)}' (wrong secret, banned or unconfirmed account)`);

  // ── 2. CAPTCHA on this lane's password grant: a server-side session ──
  if (!accessToken) throw new Refused("password sign-in is CAPTCHA-protected on this lane and SUPABASE_ACCESS_TOKEN is not set on its environment");
  const keys = await json(f, `https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!keys.ok || !Array.isArray(keys.body)) throw new Refused(`the management API answered ${keys.status} for this project's keys`);
  const legacy = keys.body.find((k) => k?.name === "service_role" && typeof k.api_key === "string");
  const secret = keys.body.find((k) => k?.type === "secret" && typeof k.api_key === "string" && k.api_key.startsWith("sb_secret_"));
  const service = legacy?.api_key ?? secret?.api_key;
  if (!service) throw new Refused("no service key for this project");
  if (service.startsWith("eyJ")) {
    const c = claims(service);
    if (c?.role !== "service_role" || c?.ref !== ref) throw new Refused("the service key is not this project's — stopped");
  }
  mask(service);
  const admin = { apikey: service, "content-type": "application/json", ...(service.startsWith("eyJ") ? { authorization: `Bearer ${service}` } : {}) };

  const list = await json(f, `${origin}/auth/v1/admin/users?filter=${encodeURIComponent(wanted)}&per_page=50`, { headers: admin });
  const users = (Array.isArray(list.body?.users) ? list.body.users : []).filter((u) => String(u?.email ?? "").toLowerCase() === wanted);
  if (!list.ok || users.length !== 1) throw new Refused(`the worker e-mail is not exactly one account on this lane (${users.length})`);
  const id = users[0].id;

  const link = await json(f, `${origin}/auth/v1/admin/generate_link`, { method: "POST", headers: admin, body: JSON.stringify({ type: "magiclink", email: wanted }) });
  const linkUser = link.body?.user ?? link.body;
  if (!link.ok || linkUser?.id !== id) throw new Refused("generate_link answered for another user — stopped");
  const tokenHash = link.body?.hashed_token ?? link.body?.properties?.hashed_token;
  if (typeof tokenHash !== "string" || !/^[0-9a-f]{20,128}$/i.test(tokenHash)) throw new Refused("generate_link answered without a hashed_token");

  const session = await json(f, `${origin}/auth/v1/verify`, { method: "POST", headers: { apikey: service, "content-type": "application/json" }, body: JSON.stringify({ type: "magiclink", token_hash: tokenHash }) });
  if (!session.ok || session.body?.user?.id !== id) throw new Refused("/verify answered a session for another user — stopped");
  if (typeof session.body?.access_token !== "string" || session.body.access_token.length < 20) throw new Refused("/verify answered without an access token");
  return { token: session.body.access_token, via: "server-side session (password sign-in is CAPTCHA-protected on this lane)" };
}

async function main() {
  const i = process.argv.indexOf("--out");
  const out = i >= 0 ? process.argv[i + 1] : "";
  if (!out) { console.error("usage: --out <file>"); process.exit(2); }
  const mask = (v) => { if (v) console.log(`::add-mask::${v}`); };
  const { token, via } = await workerSession({
    supabaseUrl: process.env.SB_URL, anonKey: process.env.SB_ANON,
    email: process.env.WORKER_EMAIL, password: process.env.WORKER_PASSWORD,
    accessToken: process.env.SUPABASE_ACCESS_TOKEN, mask,
  });
  mask(token);
  writeFileSync(out, token, { mode: 0o600 });
  console.log(`Signed in as the worker account via ${via}. The token is masked and stored in a 0600 file.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => { console.error(`::error::${e instanceof Refused ? e.message : "sign-in failed (unexpected error)"}`); process.exit(1); });
}
