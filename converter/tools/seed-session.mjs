#!/usr/bin/env node
/**
 * 50mm Retina World · seed the converter's Supabase session (one-time, Owner's PC).
 *
 * Why: the LIVE project enforces CAPTCHA on password sign-in, and the converter
 * VM has no person to solve one. Refresh grants are never CAPTCHA-gated, so the
 * worker only needs ONE valid refresh token in its session file; from then on it
 * rotates and saves it by itself (converter/src/auth.ts).
 *
 * How (supabase/auth, master ce9a8eee, 2026-09-22 — internal/api/api.go): the
 * admin route `POST /admin/generate_link` (service role) and `POST /verify` are
 * registered WITHOUT the verifyCaptcha middleware; `/token`, `/otp`, `/magiclink`
 * … carry it. So, with the service-role key, and touching nothing else:
 *   1. GET  /auth/v1/admin/users?filter=<email>   the converter account must ALREADY exist
 *      (a magic link for an unknown e-mail would sign one up — never done here)
 *   2. POST /auth/v1/admin/generate_link {type:"magiclink", email}   → hashed_token
 *      (no e-mail is sent; no password is changed)
 *   3. POST /auth/v1/verify {type:"magiclink", token_hash}           → a NEW session for that user
 *   4. only with --revoke-others (a session file may have been stolen): POST /auth/v1/logout?scope=others
 *      with the NEW session's access token — every other session of that account ends
 *   5. stdout: {"refresh_token":"…"} — and nothing else
 *
 * Usage (the Owner's click file pipes stdout over ssh to the VM's root helper,
 * converter/deploy/install-session.sh; see converter/deploy/README.md):
 *
 *   set SUPABASE_SERVICE_ROLE_KEY=…   (or --key-stdin: the key is the first line of stdin)
 *   node seed-session.mjs --url https://<ref>.supabase.co [--email video-converter@50mmretina.com] [--key-stdin] [--revoke-others]
 *     | ssh <vm> sudo bash ~/converter-deploy/deploy/install-session.sh --lane live
 *
 * The key is NEVER taken from the command line (a key-shaped argument is refused),
 * never printed, never stored, and sent only to the given project's /auth/v1.
 * stdout must not be a terminal (the token would land on the screen).
 * No dependencies: Node 18+ (global fetch).
 */

import { pathToFileURL } from "node:url";

export const CONVERTER_EMAIL = "video-converter@50mmretina.com";
const PROJECT_URL = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/;
const REFRESH_TOKEN = /^[A-Za-z0-9_.-]{12,1024}$/;
const TOKEN_HASH = /^[A-Za-z0-9_-]{16,256}$/;

export class SeedRefused extends Error {
  constructor(message) {
    super(message);
    this.name = "SeedRefused";
  }
}

/** Anything on the command line that looks like a key or a token. */
function looksLikeSecret(arg) {
  return /eyJ[A-Za-z0-9_-]{8,}\.|sb_secret_|service_role/i.test(arg) || (/^[A-Za-z0-9._~+/=-]{40,}$/.test(arg) && !arg.startsWith("https://"));
}

function projectRef(url) {
  const m = PROJECT_URL.exec(String(url ?? "").trim().replace(/\/+$/, ""));
  if (!m) throw new SeedRefused("--url must be the project's origin, https://<20-char ref>.supabase.co");
  return { origin: `https://${m[1]}.supabase.co`, ref: m[1] };
}

/** A legacy JWT key must be THIS project's service_role key (checked before anything is sent). */
function checkKey(key, ref) {
  if (typeof key !== "string" || key.length < 20 || /\s/.test(key)) throw new SeedRefused("no service-role key (SUPABASE_SERVICE_ROLE_KEY, or --key-stdin)");
  if (key.startsWith("sb_publishable_")) throw new SeedRefused("that is the publishable key; the service-role (secret) key is needed");
  if (key.startsWith("eyJ")) {
    let payload;
    try {
      payload = JSON.parse(Buffer.from(key.split(".")[1] ?? "", "base64url").toString("utf8"));
    } catch {
      throw new SeedRefused("the key is not a readable JWT");
    }
    if (payload?.role !== "service_role") throw new SeedRefused(`the key's role is not service_role`);
    if (payload?.ref && payload.ref !== ref) throw new SeedRefused("the key belongs to another project than --url");
  } else if (!key.startsWith("sb_secret_")) {
    throw new SeedRefused("the key is neither a service_role JWT nor an sb_secret_ key");
  }
}

async function call(f, origin, key, method, path, body, { admin }) {
  const headers = { apikey: key, accept: "application/json" };
  // a legacy JWT key also goes as the bearer for the admin routes; an sb_secret_ key only as apikey
  if (admin && key.startsWith("eyJ")) headers.authorization = `Bearer ${key}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  let res;
  try {
    res = await f(`${origin}/auth/v1${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error", signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new SeedRefused(`${method} /auth/v1${path.split("?")[0]}: no answer (${e?.cause?.code ?? e?.name ?? "network"})`);
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok) {
    // only the status and Supabase's short code — never the body
    const code = String(json?.error_code ?? json?.error ?? "").replace(/[^a-z_]/gi, "").slice(0, 60);
    throw new SeedRefused(`${method} /auth/v1${path.split("?")[0]}: HTTP ${res.status}${code ? ` ${code}` : ""}`);
  }
  if (!json || typeof json !== "object") throw new SeedRefused(`${method} /auth/v1${path.split("?")[0]}: the answer is not JSON`);
  return json;
}

/**
 * The three calls. Returns the new session's refresh token and the account id.
 * Refuses (SeedRefused) before any network call when the input is wrong.
 */
export async function seed({ supabaseUrl, serviceKey, email = CONVERTER_EMAIL, revokeOthers = false, fetch: f = globalThis.fetch }) {
  const wanted = String(email ?? "").trim().toLowerCase();
  if (wanted !== CONVERTER_EMAIL) throw new SeedRefused(`only the converter account (${CONVERTER_EMAIL}) can be seeded`);
  const { origin, ref } = projectRef(supabaseUrl);
  checkKey(serviceKey, ref);

  // 1. the account must already exist — exactly one, with exactly this e-mail
  const list = await call(f, origin, serviceKey, "GET", `/admin/users?filter=${encodeURIComponent(wanted)}&per_page=50`, undefined, { admin: true });
  const users = Array.isArray(list.users) ? list.users : [];
  const matches = users.filter((u) => String(u?.email ?? "").toLowerCase() === wanted);
  if (matches.length !== 1 || typeof matches[0].id !== "string") throw new SeedRefused(`the converter account is not on this project (found ${matches.length}) — nothing was changed`);
  const id = matches[0].id;
  if (matches[0].banned_until && Date.parse(matches[0].banned_until) > Date.now()) throw new SeedRefused("the converter account is banned on this project — nothing was changed");

  // 2. a magic-link token for THAT user (no e-mail is sent)
  const link = await call(f, origin, serviceKey, "POST", "/admin/generate_link", { type: "magiclink", email: wanted }, { admin: true });
  const linkUser = link.user ?? link;
  if (linkUser?.id !== id || String(linkUser?.email ?? "").toLowerCase() !== wanted) throw new SeedRefused("generate_link answered for another user — stopped");
  if (link.verification_type !== undefined && link.verification_type !== "magiclink") throw new SeedRefused(`generate_link answered a '${String(link.verification_type).replace(/[^a-z_]/gi, "")}' link, not a magic link — stopped`);
  const tokenHash = link.hashed_token ?? link.properties?.hashed_token;
  if (typeof tokenHash !== "string" || !TOKEN_HASH.test(tokenHash)) throw new SeedRefused("generate_link answered without a hashed_token");

  // 3. exchange it for a session (POST /verify: not CAPTCHA-gated)
  const session = await call(f, origin, serviceKey, "POST", "/verify", { type: "magiclink", token_hash: tokenHash }, { admin: false });
  if (session.user?.id !== id) throw new SeedRefused("/verify answered a session for another user — stopped");
  if (typeof session.refresh_token !== "string" || !REFRESH_TOKEN.test(session.refresh_token)) throw new SeedRefused("/verify answered without a refresh token");

  // 4. (only with --revoke-others: a session file may have been stolen) sign out every OTHER session of
  //    this account, with the new session's own access token (supabase/auth logout.go, scope=others)
  if (revokeOthers) {
    if (typeof session.access_token !== "string" || session.access_token.length < 20) throw new SeedRefused("/verify answered without an access token; nothing was revoked");
    let res;
    try {
      res = await f(`${origin}/auth/v1/logout?scope=others`, {
        method: "POST", headers: { apikey: serviceKey, authorization: `Bearer ${session.access_token}`, accept: "application/json" },
        redirect: "error", signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw new SeedRefused(`POST /auth/v1/logout: no answer (${e?.cause?.code ?? e?.name ?? "network"}) — the other sessions may still be live`);
    }
    if (!res.ok) throw new SeedRefused(`POST /auth/v1/logout: HTTP ${res.status} — the other sessions may still be live`);
  }
  return { refresh_token: session.refresh_token, user_id: id };
}

function parseArgs(argv) {
  const o = { url: "", email: CONVERTER_EMAIL, keyStdin: false, revokeOthers: false };
  // every argument first, whatever its position: a key there is refused before anything else is said
  if (argv.some(looksLikeSecret)) throw new SeedRefused("a key or token must never be on the command line (it would be visible to other programs and in history) — use SUPABASE_SERVICE_ROLE_KEY or --key-stdin");
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url") o.url = argv[++i] ?? "";
    else if (a === "--email") o.email = argv[++i] ?? "";
    else if (a === "--key-stdin") o.keyStdin = true;
    else if (a === "--revoke-others") o.revokeOthers = true;
    else throw new SeedRefused(`unknown argument (${a.slice(0, 20).replace(/[^\w-]/g, "?")}); usage: --url https://<ref>.supabase.co [--email ${CONVERTER_EMAIL}] [--key-stdin] [--revoke-others]`);
  }
  return o;
}

/** The command line. Returns the exit code; writes the token to `stdout` and nothing else there. */
export async function main({
  argv = process.argv.slice(2), env = process.env,
  readStdin = async () => { let s = ""; for await (const c of process.stdin) s += c; return s; },
  stdout = (s) => process.stdout.write(s), stderr = (s) => process.stderr.write(s),
  stdoutIsTTY = Boolean(process.stdout.isTTY), fetch: f = globalThis.fetch,
} = {}) {
  let key = "";
  try {
    const o = parseArgs(argv);
    if (stdoutIsTTY) throw new SeedRefused("stdout is a terminal: pipe it to the VM's install-session.sh (the token must not land on the screen)");
    key = o.keyStdin ? String(await readStdin()).split(/\r?\n/)[0].trim() : String(env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
    const r = await seed({ supabaseUrl: o.url, serviceKey: key, email: o.email, revokeOthers: o.revokeOthers, fetch: f });
    stdout(`${JSON.stringify({ refresh_token: r.refresh_token })}\n`);
    stderr(`seed-session: a new session for the converter account ${r.user_id} — its refresh token went to stdout only${o.revokeOthers ? "; every OTHER session of that account was signed out" : ""}\n`);
    return 0;
  } catch (e) {
    let msg = e instanceof SeedRefused ? e.message : `unexpected error (${e?.name ?? "error"})`;
    if (key) msg = msg.split(key).join("[key]"); // belt and braces: no message ever carries it
    stderr(`seed-session: REFUSED — ${msg}\n`);
    return e instanceof SeedRefused ? 2 : 1;
  }
}

// Run when executed directly (not when imported by the tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; });
}
