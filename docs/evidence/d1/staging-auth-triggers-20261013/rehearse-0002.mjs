// ═══════════════════════════════════════════════════════════════════════════
// Rehearsal of 20261013_0002 (migration, PROBE, rollback) on PostgreSQL 17 (PGlite).
// Evidence for PR #425. Touches no real database: everything runs in an
// in-memory PGlite instance that this script creates and throws away.
//
//   usage:  node docs/evidence/d1/staging-auth-triggers-20261013/rehearse-0002.mjs <dir-with-node_modules/@electric-sql/pglite>
//           (run from the repository root; PGlite is not a repo dependency —
//            install it in a scratch directory: npm i @electric-sql/pglite@0.3.16)
//   output: transcript-0002.txt in this directory is one such run.
//
// FIXTURE = Supabase's shape where it matters: auth.users is owned by a
// non-superuser "supabase_auth_admin"; the migration runs as a non-superuser
// "migrator" that holds TRIGGER on auth.users but does not own it (Supabase's
// postgres role vs supabase_auth_admin). The two trigger functions are
// production's, verbatim (fixture-production-functions.sql; md5 asserted).
// push_config starts pointing at production's send-push, as staging's did on
// 2026-10-13.
//
// LIMIT: PGlite has no supautils, so the rollback's DROP TRIGGER as the
// non-owner is shown REFUSED here; the permitted path on Supabase rests on
// supautils.drop_trigger_grants listing postgres for auth.users (catalog
// setting read on staging 2026-10-13), not on an execution.
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../../..");
const [pgliteDir] = process.argv.slice(2);
if (!pgliteDir) { console.error("usage: node rehearse-0002.mjs <dir-containing-node_modules/@electric-sql/pglite>"); process.exit(2); }
const { PGlite } = await import(pathToFileURL(join(pgliteDir, "node_modules/@electric-sql/pglite/dist/index.js")).href);

const lf = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n"); // a CRLF checkout must not change md5(prosrc)
const MIG = lf(join(repo, "supabase/migrations/20261013_0002_staging_auth_user_triggers.sql"));
const PROBE = lf(join(repo, "supabase/migrations/PROBE_20261013_0002_staging_auth_user_triggers.sql"));
const RB = lf(join(repo, "supabase/rollback/20261013_0002_staging_auth_user_triggers_ROLLBACK.sql"));
const FUNCS = lf(join(here, "fixture-production-functions.sql"));
const [HANDLE, SYNC] = FUNCS.split(/\n(?=CREATE OR REPLACE FUNCTION)/).slice(1);

const STAGING_PUSH = "https://fpszggreishhuvdpkmdr.supabase.co/functions/v1/send-push";
const PROD_PUSH = "https://jtdtehuqtinjxropkkcn.supabase.co/functions/v1/send-push";

const db = await PGlite.create();
let failures = 0;
console.log((await db.query("select version() v")).rows[0].v);

async function run(label, sql, { lane, role, expect, notice }) {
  // one "psql session" per call: lane + role set, file run, an aborted txn cleaned up
  await db.exec("RESET ROLE; RESET p32.lane;");
  if (role) await db.exec(`SET ROLE ${role};`);
  if (lane !== undefined) await db.exec(`SET p32.lane = '${lane}';`);
  const notices = [];
  let err = null;
  try {
    await db.exec(sql, { onNotice: (n) => notices.push(n.message) });
  } catch (e) {
    err = e;
    try { await db.exec("ROLLBACK"); } catch {}
  }
  await db.exec("RESET ROLE; RESET p32.lane;");
  let ok = expect === "ok" ? !err : !!err && new RegExp(expect.slice(5)).test(err.message);
  if (ok && notice) ok = notices.some((m) => new RegExp(notice).test(m));
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  console.log(`      -> ${err ? "ERROR: " + err.message.split("\n").join("\n         ") : "ok; " + (notices.filter((m) => /AUTHTRG|PROBE/.test(m)).join(" | ") || "no notice")}`);
  return err;
}
async function q(sql) { return (await db.query(sql)).rows; }
async function check(label, cond) { if (!cond) failures++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); }
const userTriggers = async () => (await q(`select count(*)::int n from pg_trigger where tgrelid='auth.users'::regclass and not tgisinternal`))[0].n;
const setPush = (url) => db.exec(url === null ? `UPDATE public.push_config SET function_url = NULL;` : `UPDATE public.push_config SET function_url = '${url}';`);

// ── fixture
await db.exec(`
  CREATE ROLE supabase_auth_admin NOLOGIN;
  CREATE ROLE migrator NOLOGIN;            -- stands in for Supabase's non-superuser postgres role
  CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb, last_sign_in_at timestamptz);
  ALTER TABLE auth.users OWNER TO supabase_auth_admin;
  CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, full_name text, avatar_url text, updated_at timestamptz DEFAULT now());
  CREATE TABLE public.user_roles (user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE, role text, UNIQUE (user_id, role));
  CREATE TABLE public.push_config (id boolean PRIMARY KEY DEFAULT true, function_url text, internal_secret text);
  INSERT INTO public.push_config (function_url, internal_secret) VALUES ('${PROD_PUSH}', 'fixture-not-a-secret');
  GRANT USAGE ON SCHEMA auth TO migrator;
  GRANT USAGE, CREATE ON SCHEMA public TO migrator;
  GRANT SELECT ON auth.users TO migrator;
  GRANT SELECT ON public.push_config TO migrator;
`);
await db.exec(HANDLE);
await db.exec(SYNC);
const md5s = Object.fromEntries((await q(`select proname, md5(prosrc) m from pg_proc where proname in ('handle_new_user','sync_oauth_on_login')`)).map((r) => [r.proname, r.m]));
// Expected hashes keyed by short names: gitleaks' generic-api-key rule reads a
// name containing "auth" followed by an operator and a hex literal as a credential.
const WANT_MD5 = { handle: "ca4a770bff3c438515f6edf9b977efbb", sync: "6c157691677358931ff05084c7fefee4" };
await check(`fixture bodies are production's (md5 ${md5s.handle_new_user} handle_new_user, md5 ${md5s.sync_oauth_on_login} sync_oauth_on_login)`,
  md5s.handle_new_user === WANT_MD5.handle && md5s.sync_oauth_on_login === WANT_MD5.sync);
// a pre-existing member (like the 50 seeded ones), and staging's existing admin
await db.exec(`INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-00000000a001','old@staging.test','{"full_name":"Old Member"}', now() - interval '1 day');`);
await db.exec(`INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-00000000ad01','admin@example.invalid','{}', now());
               INSERT INTO public.profiles (id, full_name) VALUES ('00000000-0000-0000-0000-00000000ad01','50mm Retina World');
               INSERT INTO public.user_roles VALUES ('00000000-0000-0000-0000-00000000ad01','admin');`);

console.log("\n── refusals before anything is applied");
await run("migration refuses: p32.lane unset", MIG, { expect: "fail:APPLY REFUSED" });
await run("migration refuses: p32.lane = production", MIG, { lane: "production", expect: "fail:APPLY REFUSED" });
await run("PROBE refuses: p32.lane = production", PROBE, { lane: "production", expect: "fail:PROBE REFUSED" });
await run("rollback refuses: p32.lane unset", RB, { expect: "fail:ROLLBACK REFUSED" });
await run("migration refuses: role without TRIGGER on auth.users (PRE-001)", MIG, { lane: "staging", role: "migrator", expect: "fail:PRE-001" });
await check("  …and nothing was created", (await userTriggers()) === 0);
await db.exec(`GRANT TRIGGER ON auth.users TO migrator;`);

console.log("\n── ordering guard: staging push must not point at production (PRE-005 / G6)");
const e5 = await run("migration refuses while push_config names production's send-push (PRE-005)", MIG,
  { lane: "staging", role: "migrator", expect: "fail:PRE-005 public.push_config.function_url points at host jtdtehuqtinjxropkkcn\\.supabase\\.co" });
await check("  …the message names the host only, never the path", !!e5 && !/functions\/v1|send-push/.test(e5.message));
await check("  …and nothing was created", (await userTriggers()) === 0);
await run("PROBE before apply fails G1 AND G6 (negative control)", PROBE,
  { lane: "staging", expect: "fail:G1 missing: on_auth_user_created[\\s\\S]*G1 missing: on_auth_user_login_sync[\\s\\S]*G6 public\\.push_config" });
await setPush("https://fpszggreishhuvdpkmdr.supabase.co.attacker.example/functions/v1/send-push");
await run("PRE-005 is a prefix match with the trailing slash (look-alike host refused)", MIG,
  { lane: "staging", role: "migrator", expect: "fail:PRE-005 .*host fpszggreishhuvdpkmdr\\.supabase\\.co\\.attacker\\.example" });

console.log("\n── body guard (PRE-002 / G5)");
await setPush(null);
await db.exec(`CREATE OR REPLACE FUNCTION public.sync_oauth_on_login() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$ BEGIN RETURN NEW; END $f$;`);
await run("migration refuses: sync_oauth_on_login body differs from production (PRE-002)", MIG, { lane: "staging", role: "migrator", expect: "fail:PRE-002 public.sync_oauth_on_login" });
await db.exec(SYNC);

console.log("\n── apply as a NON-OWNER holding TRIGGER (Supabase's shape), push_config NULL");
await run("migration applies (lane=staging, role=migrator, push_config NULL)", MIG, { lane: "staging", role: "migrator", expect: "ok" });
for (const r of await q(`select tgname, tgenabled, pg_get_triggerdef(oid) d from pg_trigger where tgrelid='auth.users'::regclass and not tgisinternal order by 1`))
  console.log(`      ${r.tgname} [${r.tgenabled}] ${r.d}`);
await check("existing member untouched by applying (no profile created for the pre-existing user)",
  (await q(`select count(*)::int n from public.profiles where id='00000000-0000-0000-0000-00000000a001'`))[0].n === 0);
await run("PROBE passes after apply (push_config NULL)", PROBE, { lane: "staging", expect: "ok" });
await setPush(STAGING_PUSH);
await run("PROBE passes with push_config on staging's own project", PROBE, { lane: "staging", expect: "ok" });
await run("migration re-run is a no-op (idempotent)", MIG, { lane: "staging", role: "migrator", expect: "ok", notice: "already present" });
await setPush(PROD_PUSH);
await run("PROBE fails G6 if push_config is pointed back at production after apply", PROBE, { lane: "staging", expect: "fail:G6 .*jtdtehuqtinjxropkkcn\\.supabase\\.co" });
await setPush(STAGING_PUSH);

console.log("\n── behaviour: what a sign-up and a login now do");
await db.exec(`INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-00000000b001','new@staging.test','{"name":"New Member"}', NULL);`);
const p = await q(`select full_name, avatar_url from public.profiles where id='00000000-0000-0000-0000-00000000b001'`);
const ro = await q(`select role from public.user_roles where user_id='00000000-0000-0000-0000-00000000b001'`);
await check(`sign-up creates profile (${JSON.stringify(p[0])}) and role ${JSON.stringify(ro.map((r) => r.role))}`,
  p.length === 1 && p[0].full_name === "New Member" && /^\/avatars\/fallback\/m[1-5]\.svg$/.test(p[0].avatar_url) && ro.length === 1 && ro[0].role === "user");
await db.exec(`UPDATE public.profiles SET full_name = NULL WHERE id='00000000-0000-0000-0000-00000000b001';
               UPDATE auth.users SET email = 'renamed@staging.test' WHERE id='00000000-0000-0000-0000-00000000b001';`);
await check("an UPDATE that is not a login (last_sign_in_at unchanged) changes nothing",
  (await q(`select full_name from public.profiles where id='00000000-0000-0000-0000-00000000b001'`))[0].full_name === null);
await db.exec(`UPDATE auth.users SET last_sign_in_at = now() WHERE id='00000000-0000-0000-0000-00000000b001';`);
await check("a login fills a NULL full_name from metadata",
  (await q(`select full_name from public.profiles where id='00000000-0000-0000-0000-00000000b001'`))[0].full_name === "New Member");
let loginErr = null;
try { await db.exec(`UPDATE auth.users SET last_sign_in_at = now() WHERE id='00000000-0000-0000-0000-00000000a001';`); } catch (e) { loginErr = e; }
await check(`a login by a pre-existing user with no profile row does not fail${loginErr ? " — " + loginErr.message : ""}`, !loginErr);
await db.exec(`UPDATE auth.users SET last_sign_in_at = now() WHERE id='00000000-0000-0000-0000-00000000ad01';`);
await check("an admin login leaves the brand name as it is (no-op update)",
  (await q(`select full_name from public.profiles where id='00000000-0000-0000-0000-00000000ad01'`))[0].full_name === "50mm Retina World");

console.log("\n── tamper detection");
await db.exec(`ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;`);
await run("PROBE catches a disabled trigger (G3)", PROBE, { lane: "staging", expect: "fail:G3 on_auth_user_created" });
await run("migration refuses over a disabled trigger (PRE-003)", MIG, { lane: "staging", role: "migrator", expect: "fail:PRE-003 on_auth_user_created" });
await db.exec(`ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;`);
await db.exec(`DROP TRIGGER on_auth_user_login_sync ON auth.users;
               CREATE TRIGGER on_auth_user_login_sync AFTER UPDATE OF email ON auth.users FOR EACH ROW EXECUTE FUNCTION public.sync_oauth_on_login();`);
await run("PROBE catches a changed definition (G2)", PROBE, { lane: "staging", expect: "fail:G2 on_auth_user_login_sync" });
await run("migration refuses over a changed definition (PRE-003)", MIG, { lane: "staging", role: "migrator", expect: "fail:PRE-003 on_auth_user_login_sync" });
await run("rollback refuses to drop a same-named trigger with another definition (RB-PRE-001)", RB, { lane: "staging", expect: "fail:RB-PRE-001 on_auth_user_login_sync" });
await check("  …and nothing was dropped", (await userTriggers()) === 2);
await db.exec(`DROP TRIGGER on_auth_user_login_sync ON auth.users;
               CREATE TRIGGER on_auth_user_login_sync AFTER UPDATE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.sync_oauth_on_login();`);
await db.exec(`CREATE TRIGGER zz_extra AFTER DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();`);
await run("PROBE catches an extra user trigger (G1)", PROBE, { lane: "staging", expect: "fail:G1 unexpected user trigger" });
await run("migration refuses with an extra user trigger (PRE-004)", MIG, { lane: "staging", role: "migrator", expect: "fail:PRE-004" });
await db.exec(`DROP TRIGGER zz_extra ON auth.users;`);
await db.exec(`CREATE SCHEMA evil; CREATE FUNCTION evil.handle_new_user() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$;
               DROP TRIGGER on_auth_user_created ON auth.users;
               CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION evil.handle_new_user();`);
await run("PROBE catches a same-named function in another schema (G2/G4)", PROBE, { lane: "staging", expect: "fail:G4 on_auth_user_created calls evil.handle_new_user" });
await db.exec(`DROP TRIGGER on_auth_user_created ON auth.users;
               CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
               DROP SCHEMA evil CASCADE;`);
await db.exec(`CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$ BEGIN RETURN NEW; END $f$;`);
await run("PROBE catches a changed function body (G5)", PROBE, { lane: "staging", expect: "fail:G5 public.handle_new_user" });
await db.exec(HANDLE);
await run("PROBE passes again once restored", PROBE, { lane: "staging", expect: "ok" });

console.log("\n── rollback");
await run("rollback as the NON-OWNER without supautils: DROP TRIGGER refused (Supabase needs supautils.drop_trigger_grants)", RB,
  { lane: "staging", role: "migrator", expect: "fail:must be owner" });
await check("  …and both triggers are still there (whole transaction rolled back)", (await userTriggers()) === 2);
await db.exec(`CREATE TRIGGER zz_other AFTER DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
               ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;`);
await run("rollback (owner-equivalent, as supautils permits postgres): drops a DISABLED copy of 0002's trigger too, reports the other trigger (RB-PRE-002 NOTICE)", RB,
  { lane: "staging", expect: "ok", notice: "RB-PRE-002: other user trigger on auth.users, left untouched: CREATE TRIGGER zz_other" });
const left = (await q(`select string_agg(tgname::text, ',' order by tgname) s from pg_trigger where tgrelid='auth.users'::regclass and not tgisinternal`))[0].s;
await check(`  …only the other trigger is left (${left})`, left === "zz_other");
await db.exec(`DROP TRIGGER zz_other ON auth.users;`);
await run("PROBE FAILS again after rollback", PROBE, { lane: "staging", expect: "fail:G1 missing" });
await run("rollback re-run is a no-op", RB, { lane: "staging", expect: "ok" });
await check("rows written while the triggers were on are kept (profile of the sign-up)",
  (await q(`select count(*)::int n from public.profiles where id='00000000-0000-0000-0000-00000000b001'`))[0].n === 1);
await run("migration re-applies cleanly after rollback", MIG, { lane: "staging", role: "migrator", expect: "ok" });
await run("PROBE PASSES after re-apply", PROBE, { lane: "staging", expect: "ok" });

const sha = (s) => createHash("sha256").update(s.replace(/\r\n/g, "\n")).digest("hex");
console.log(`\nfiles rehearsed (sha256 of LF text):\n  migration ${sha(MIG)}\n  probe     ${sha(PROBE)}\n  rollback  ${sha(RB)}`);
console.log(failures === 0 ? "ALL SCENARIOS AS REQUIRED" : `${failures} SCENARIO(S) NOT AS REQUIRED`);
process.exit(failures === 0 ? 0 : 1);
