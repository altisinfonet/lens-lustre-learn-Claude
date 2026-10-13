// ═══════════════════════════════════════════════════════════════════════════
// Fail-first rehearsal of supabase/migrations/PROBE_staging_signup_profile_readonly.sql
// on PostgreSQL 17 (PGlite). Touches no real database: everything runs in an
// in-memory PGlite instance that this script creates and throws away.
//
//   usage:  node docs/evidence/d1/staging-signup-profile-probe-20261013/rehearse-probe.mjs <dir-with-node_modules/@electric-sql/pglite>
//           (run from the repository root; PGlite is not a repo dependency —
//            install it in a scratch directory: npm i @electric-sql/pglite@0.3.16)
//   output: transcript-probe.txt in this directory is one such run.
//
// FIXTURE = Supabase's shape where the probe depends on it:
//   * auth.users / public.profiles / public.push_config all have row security
//     ENABLED, as on Supabase. The probe runs as "migrator": not a superuser,
//     BYPASSRLS, holding SELECT on those three tables and nothing else — the
//     shape of Supabase's postgres role. "reader" holds the same SELECTs
//     without BYPASSRLS; it is there to show S0 refusing a filtered read.
//   * public.handle_new_user() is production's body, verbatim, read from
//     ../staging-auth-triggers-20261013/fixture-production-functions.sql
//     (md5 asserted). So "the trigger gives a sign-up its profile" below is
//     production's code doing it, not a stand-in.
//   * created_at is written explicitly on every fixture user, so no case
//     depends on the clock.
//
// Every probe run is wrapped by probe(): one "psql session" (role + p32.lane
// set, file run, an aborted transaction cleaned up), with a fingerprint of all
// fixture rows and of the catalog taken before and after. Everything a run
// printed is kept in `outputs` for the privacy assertions at the end.
//
// LIMIT: this proves the probe's logic on a fixture. Whether staging's real
// sign-up path produces a profiles row is exactly what the probe is for, and
// only a dispatch against staging after a real sign-up answers it.
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../../..");
const [pgliteDir] = process.argv.slice(2);
if (!pgliteDir) { console.error("usage: node rehearse-probe.mjs <dir-containing-node_modules/@electric-sql/pglite>"); process.exit(2); }
const { PGlite } = await import(pathToFileURL(join(pgliteDir, "node_modules/@electric-sql/pglite/dist/index.js")).href);

const lf = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n"); // a CRLF checkout must not change md5(prosrc)
const PROBE_PATH = "supabase/migrations/PROBE_staging_signup_profile_readonly.sql";
const PROBE = lf(join(repo, PROBE_PATH));
const HANDLE = lf(join(here, "../staging-auth-triggers-20261013/fixture-production-functions.sql"))
  .split(/\n(?=CREATE OR REPLACE FUNCTION)/)[1];

const STAGING_PUSH = "https://fpszggreishhuvdpkmdr.supabase.co/functions/v1/send-push";
const PROD_PUSH = "https://jtdtehuqtinjxropkkcn.supabase.co/functions/v1/send-push";
const PUSH_OTHER_COLUMN = "fixture-value-that-must-never-be-printed"; // push_config's second column

// Fixture people. None of these strings may ever appear in anything the probe prints.
const U = {
  old:   { id: "00000000-0000-0000-0000-00000000a001", email: "old.member@staging.test",   name: "Old Fixture Member" },
  admin: { id: "00000000-0000-0000-0000-00000000ad01", email: "admin@example.invalid",     name: "Fixture Admin" },
  b1:    { id: "00000000-0000-0000-0000-00000000b001", email: "signup.one@staging.test",   name: "Signup One" },
  b2:    { id: "00000000-0000-0000-0000-00000000b002", email: "signup.two@staging.test",   name: "Signup Two" },
  c0:    { id: "00000000-0000-0000-0000-00000000c000", email: "just.before@staging.test",  name: "Just Before" },
  c1:    { id: "00000000-0000-0000-0000-00000000c001", email: "exactly.at@staging.test",   name: "Exactly At" },
  d0:    { id: "00000000-0000-0000-0000-00000000d000", email: "no.date@staging.test",      name: "No Date" },
};

const db = await PGlite.create();
let failures = 0, passed = 0, probeRuns = 0, runsThatChangedState = 0;
const outputs = [];
console.log((await db.query("select version() v")).rows[0].v);

async function q(sql) { return (await db.query(sql)).rows; }
async function check(label, cond) { if (cond) passed++; else failures++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); return cond; }

// every fixture row, the triggers on auth.users, and the size of the catalog
async function fingerprint() {
  // (the S0 case below renames push_config for one run; follow it so that run is fingerprinted too)
  const pc = (await q(`select coalesce(to_regclass('public.push_config'), to_regclass('public.push_config_moved'))::text t`))[0].t;
  return (await q(`
    select md5(
      coalesce((select string_agg(u::text, '|' order by u.id) from auth.users u), '') || '#' ||
      coalesce((select string_agg(p::text, '|' order by p.id) from public.profiles p), '') || '#' ||
      coalesce((select string_agg(x::text, '|' order by x.user_id, x.role) from public.user_roles x), '') || '#' ||
      coalesce((select string_agg(c::text, '|') from ${pc} c), '') || '#' ||
      coalesce((select string_agg(t.tgname::text || t.tgenabled::text, ',' order by t.tgname) from pg_trigger t where t.tgrelid = 'auth.users'::regclass), '') || '#' ||
      (select count(*) from pg_class)::text || '#' || (select count(*) from pg_proc)::text || '#' ||
      (select count(*) from pg_trigger)::text || '#' || (select count(*) from pg_attribute)::text
    ) fp`))[0].fp;
}

// One psql session. expect: "ok" | "fail:<regex on the error>"; notice: regex one notice must match;
// absent: regex nothing printed may match. lane: null = p32.lane not set at all.
async function probe(label, { lane = "staging", role = "migrator", sql = PROBE, expect, notice, absent }) {
  await db.exec("RESET ROLE; RESET p32.lane;");
  const before = await fingerprint();
  if (role) await db.exec(`SET ROLE ${role};`);
  if (lane !== null) await db.exec(`SET p32.lane = '${lane}';`);
  const notices = [];
  let err = null;
  try {
    await db.exec(sql, { onNotice: (n) => notices.push(n.message) });
  } catch (e) {
    err = e;
    try { await db.exec("ROLLBACK"); } catch { /* nothing open */ }
  }
  await db.exec("RESET ROLE; RESET p32.lane;");
  const after = await fingerprint();
  probeRuns++;
  if (after !== before) runsThatChangedState++;
  const printed = [...notices, ...(err ? [err.message, err.detail ?? "", err.hint ?? ""] : [])];
  outputs.push(...printed);

  let ok = expect === "ok" ? !err : !!err && new RegExp(expect.slice(5)).test(err.message);
  if (ok && notice) ok = notices.some((m) => new RegExp(notice).test(m));
  if (ok && absent) ok = !printed.some((m) => new RegExp(absent).test(m));
  if (ok && after !== before) ok = false;
  if (ok) passed++; else failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  // PGlite adds two notices of its own (the first to_char of a session; to_regclass on a missing name). They are
  // kept in `outputs` and in the transcript, marked, so nothing the run printed is hidden.
  for (const m of notices) console.log(`      | NOTICE: ${m}${/^(S[0-4] |PROBE )/.test(m) ? "" : "   <- PGlite's own notice, not raised by the probe"}`);
  console.log(err ? `      -> ERROR: ${err.message.split("\n").join("\n         ")}` : "      -> no error");
  return { err, notices, printed };
}

const addUser = (u, createdAt) => db.exec(
  `INSERT INTO auth.users (id, email, raw_user_meta_data, created_at)
   VALUES ('${u.id}', '${u.email}', '{"full_name":"${u.name}"}', ${createdAt === null ? "NULL" : `timestamptz '${createdAt}'`});`);
const giveProfile = (u) => db.exec(`INSERT INTO public.profiles (id, full_name) VALUES ('${u.id}', '${u.name}');`);
const dropProfile = (u) => db.exec(`DELETE FROM public.profiles WHERE id = '${u.id}';`);
const dropUser = (u) => db.exec(`DELETE FROM auth.users WHERE id = '${u.id}';`);
const hasProfile = async (u) => (await q(`select count(*)::int n from public.profiles where id = '${u.id}'`))[0].n === 1;
const setPush = (url) => db.exec(`UPDATE public.push_config SET function_url = '${url}';`);
const ONLY_S3 = (text) => `fail:^PROBE FAIL staging_signup_profile:\\n  S3 ${text}$`;

// ── fixture
await db.exec(`
  CREATE ROLE supabase_auth_admin NOLOGIN;
  CREATE ROLE migrator NOLOGIN BYPASSRLS;  -- Supabase's postgres role: not a superuser, bypasses row security
  CREATE ROLE reader NOLOGIN;              -- same SELECTs, row security applies
  CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb, created_at timestamptz, last_sign_in_at timestamptz);
  ALTER TABLE auth.users OWNER TO supabase_auth_admin;
  CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, full_name text, avatar_url text, updated_at timestamptz DEFAULT now());
  CREATE TABLE public.user_roles (user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE, role text, UNIQUE (user_id, role));
  CREATE TABLE public.push_config (id boolean PRIMARY KEY DEFAULT true CHECK (id), function_url text, internal_secret text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
  INSERT INTO public.push_config (function_url, internal_secret) VALUES ('${STAGING_PUSH}', '${PUSH_OTHER_COLUMN}');
  ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.push_config ENABLE ROW LEVEL SECURITY;
  GRANT USAGE ON SCHEMA auth TO migrator, reader;
  GRANT SELECT ON auth.users TO migrator, reader;
  GRANT SELECT ON public.profiles TO migrator, reader;
  GRANT SELECT ON public.push_config TO migrator, reader;
`);
await db.exec(HANDLE);
const bodyMd5 = (await q(`select md5(prosrc) m from pg_proc where proname = 'handle_new_user'`))[0].m;
await check(`fixture handle_new_user() is production's body (md5 ${bodyMd5})`, bodyMd5 === "ca4a770bff3c438515f6edf9b977efbb");
// a member from before the trigger existed (no profiles row), and the existing admin (so no later sign-up is "first admin")
await addUser(U.old, "2026-09-12 09:00:00+00");
await addUser(U.admin, "2026-09-11 09:00:00+00");
await giveProfile(U.admin);
await db.exec(`INSERT INTO public.user_roles VALUES ('${U.admin.id}', 'admin');`);

console.log("\n── S1 · the sign-up trigger is missing (staging as it was before 20261013_0002)");
await probe("trigger missing → FAIL (S1), even with nobody signed up since the cut-off", {
  expect: "fail:^PROBE FAIL staging_signup_profile:\\n  S1 on_auth_user_created is missing from auth\\.users[^\\n]*$",
  notice: "^S1 auth\\.users: 0 non-internal trigger\\(s\\); on_auth_user_created exists = false, enabled = false" });

console.log("\n── FAIL-FIRST · the defect: someone signs up after the cut-off and gets no profiles row");
await addUser(U.b1, "2026-10-13 13:00:00+00");
await check("  fixture: with no trigger, the sign-up has no profiles row", !(await hasProfile(U.b1)));
await probe("a user created after the cut-off WITHOUT a profile, trigger still missing → FAIL (S1 and S3)", {
  expect: "fail:^PROBE FAIL staging_signup_profile:\\n  S1 on_auth_user_created is missing[^\\n]*\\n  S3 1 of 1 sign-up\\(s\\) since the cut-off have no profiles row \\(created between 2026-10-13T13:00:00Z and 2026-10-13T13:00:00Z\\)$",
  absent: "PROBE PASS|PROBE INCONCLUSIVE" });
await db.exec(`CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();`);
await probe("the same user WITHOUT a profile, trigger now in place → still FAIL, on S3 alone", {
  expect: ONLY_S3("1 of 1 sign-up\\(s\\) since the cut-off have no profiles row \\(created between 2026-10-13T13:00:00Z and 2026-10-13T13:00:00Z\\)"),
  notice: "^S3 cut-off 2026-10-13T12:05:39Z .*: n_new = 1 sign-up\\(s\\) at/after it, n_new_missing = 1 of them",
  absent: "PROBE PASS|PROBE INCONCLUSIVE" });

console.log("\n── the same user WITH a profiles row → PASS");
await giveProfile(U.b1);
await probe("the same user WITH a profile → PASS", {
  expect: "ok",
  notice: "^PROBE PASS: 1 sign-up\\(s\\) since the cut-off, each has a profiles row; newest sign-up at 2026-10-13T13:00:00Z$",
  absent: "PROBE INCONCLUSIVE" });

console.log("\n── a sign-up through the trigger (production's handle_new_user) → PASS with nothing done by hand");
await addUser(U.b2, "2026-10-13 14:30:00+00");
await check("  fixture: the trigger gave the new sign-up its profiles row", await hasProfile(U.b2));
await probe("two sign-ups since the cut-off, both with a profile → PASS, newest timestamp reported", {
  expect: "ok",
  notice: "^PROBE PASS: 2 sign-up\\(s\\) since the cut-off, each has a profiles row; newest sign-up at 2026-10-13T14:30:00Z$" });

console.log("\n── the cut-off is inclusive; earlier and undated rows are not counted");
await addUser(U.c0, "2026-10-13 12:05:38+00"); await dropProfile(U.c0);   // one second before: no profile, not counted
await addUser(U.c1, "2026-10-13 12:05:39+00");                            // exactly at the cut-off: counted
await addUser(U.d0, null); await dropProfile(U.d0);                       // no created_at: reported, not counted
const edge = await probe("a profile-less row 1 s BEFORE the cut-off and one with no created_at do not fail it; the row AT the cut-off is counted → PASS with 3", {
  expect: "ok",
  notice: "^PROBE PASS: 3 sign-up\\(s\\) since the cut-off" });
const s2s3 = edge.notices.join("\n");
await check("  S2 shows the all-time picture (7 users, 4 profiles, 3 without) and S3 the undated row (= 1)",
  /S2 auth\.users rows = 7, public\.profiles rows = 4, auth\.users rows with no profiles row = 3 /.test(s2s3) && /no created_at \(cannot be placed, not counted\) = 1$/m.test(s2s3));
await dropProfile(U.c1);
await probe("the row created exactly AT the cut-off loses its profile → FAIL (1 of 3), so 'at' is inside", {
  expect: ONLY_S3("1 of 3 sign-up\\(s\\) since the cut-off have no profiles row \\(created between 2026-10-13T12:05:39Z and 2026-10-13T12:05:39Z\\)") });
await giveProfile(U.c1);
await dropUser(U.d0);

console.log("\n── S1 · the trigger exists but is disabled");
await db.exec(`ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;`);
await probe("trigger disabled → FAIL (S1), although every sign-up so far has a profile", {
  expect: "fail:^PROBE FAIL staging_signup_profile:\\n  S1 on_auth_user_created is not enabled for ordinary sessions \\(tgenabled D\\)$",
  notice: "^S1 auth\\.users: 1 non-internal trigger\\(s\\); on_auth_user_created exists = true, enabled = false \\(tgenabled D\\)$" });
await db.exec(`ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;`);

console.log("\n── lane guard — in the state where everything else passes");
const unset = await probe("lane unset → refused", { lane: null, expect: "fail:^PROBE REFUSED staging_signup_profile — staging-only probe and p32\\.lane reads \\(unset\\)\\." });
const prod = await probe("lane production → refused", { lane: "production", expect: "fail:^PROBE REFUSED staging_signup_profile — staging-only probe and p32\\.lane reads production\\." });
await check("  …and a refused run read nothing (no S-line was printed)", unset.notices.length === 0 && prod.notices.length === 0);
await probe("lane staging → the same state passes", { expect: "ok", notice: "^PROBE PASS: 3 sign-up" });

console.log("\n── S4 · push_config");
await setPush(PROD_PUSH);
await probe("push_config naming production → FAIL (S4)", {
  expect: "fail:^PROBE FAIL staging_signup_profile:\\n  S4 push_config\\.function_url names the production project jtdtehuqtinjxropkkcn[^\\n]*\\n  S4 push_config\\.function_url is not exactly https://fpszggreishhuvdpkmdr\\.supabase\\.co/functions/v1/send-push \\(rows 1; parsed jtdtehuqtinjxropkkcn\\)$",
  notice: "^S4 public\\.push_config: 1 row\\(s\\); project ref parsed from function_url: jtdtehuqtinjxropkkcn; exactly staging's send-push = false; names the production ref = true$",
  absent: "PROBE PASS" });
await setPush("https://fpszggreishhuvdpkmdr.supabase.co.attacker.example/functions/v1/send-push");
await probe("a look-alike host that starts with staging's ref → FAIL (not exactly)", {
  expect: "fail:S4 push_config\\.function_url is not exactly .* \\(rows 1; parsed \\(no project ref; host fpszggreishhuvdpkmdr\\.supabase\\.co\\.attacker\\.example\\)\\)$" });
await setPush(STAGING_PUSH + "/");
await probe("staging's host with another path (trailing slash) → FAIL (not exactly)", {
  expect: "fail:^PROBE FAIL staging_signup_profile:\\n  S4 push_config\\.function_url is not exactly [^\\n]* \\(rows 1; parsed fpszggreishhuvdpkmdr\\)$" });
await setPush("https://user:secretpw@evil.example:8443/x");
const ui = await probe("a URL carrying user:password@ → FAIL, and only the host is printed", {
  expect: "fail:S4 push_config\\.function_url is not exactly .* \\(rows 1; parsed \\(no project ref; host evil\\.example\\)\\)$" });
await check("  …nothing that run printed carries the userinfo or an '@'", !ui.printed.some((m) => /secretpw|user:secret|@/.test(m)));
await db.exec(`DELETE FROM public.push_config;`);
await probe("push_config with no row → FAIL (nothing names staging)", {
  expect: "fail:S4 push_config\\.function_url is not exactly .* \\(rows 0; parsed nothing\\)$",
  notice: "^S4 public\\.push_config: 0 row\\(s\\); project ref parsed from function_url: \\(no row\\); exactly staging's send-push = false; names the production ref = false$" });
await db.exec(`INSERT INTO public.push_config (function_url, internal_secret) VALUES ('${STAGING_PUSH}', '${PUSH_OTHER_COLUMN}');`);
await probe("push_config back on staging's own send-push → PASS", {
  expect: "ok",
  notice: "^S4 public\\.push_config: 1 row\\(s\\); project ref parsed from function_url: fpszggreishhuvdpkmdr; exactly staging's send-push = true; names the production ref = false$" });

console.log("\n── S0 · the probe refuses to count what it cannot fully see");
await db.exec("SET ROLE reader;");
const filtered = (await q(`select count(*)::int n from auth.users`))[0].n;
await db.exec("RESET ROLE;");
const s0 = await probe("run as a role that row security applies to → FAIL (S0), before anything is counted", {
  role: "reader",
  expect: "fail:^PROBE FAIL staging_signup_profile \\(nothing was counted, nothing is concluded\\):\\n  S0 row security is active on auth\\.users [^\\n]*\\n  S0 row security is active on public\\.profiles [^\\n]*\\n  S0 row security is active on public\\.push_config [^\\n]*$" });
await check(`  …that role would have counted ${filtered} auth.users rows of 6 — a false 'no sign-up' — and the probe printed no count`, filtered === 0 && s0.notices.length === 0);
await db.exec(`ALTER TABLE public.push_config RENAME TO push_config_moved;`);
await probe("a relation the probe reads is missing → FAIL (S0)", {
  expect: "fail:^PROBE FAIL staging_signup_profile \\(nothing was counted, nothing is concluded\\):\\n  S0 public\\.push_config does not exist$" });
await db.exec(`ALTER TABLE public.push_config_moved RENAME TO push_config;`);

console.log("\n── INCONCLUSIVE · nobody has signed up since the cut-off");
await dropUser(U.b1); await dropUser(U.b2); await dropUser(U.c1);
const inc = await probe("no user after the cut-off → INCONCLUSIVE notice, no error, and no PASS line", {
  expect: "ok",
  notice: "^PROBE INCONCLUSIVE: no sign-up since the cut-off — nothing proven yet",
  absent: "PROBE PASS" });
await check("  …the S3 line reads n_new = 0 and the last line says it is NOT a pass",
  inc.notices.some((m) => /n_new = 0 sign-up\(s\) at\/after it, n_new_missing = 0 /.test(m)) && /NOT a pass/.test(inc.notices.at(-1)));

console.log("\n── privacy · what the probe printed, over every run above");
const all = outputs.join("\n");
await check(`  the runs printed something to inspect (${outputs.filter(Boolean).length} lines; S1–S4 and verdict lines present)`,
  /^S1 /m.test(all) && /^S2 /m.test(all) && /^S3 /m.test(all) && /^S4 /m.test(all) && /PROBE PASS: /.test(all) && /PROBE FAIL /.test(all));
const people = Object.values(U).flatMap((u) => [u.id, u.email, u.name]);
const leaks = (text) => people.filter((s) => text.includes(s)).length;
await check("  checker self-test: the same test does see a fixture email and a fixture id when they are there",
  leaks(`${all} ${U.b1.email} ${U.b2.id}`) === 2);
await check(`  no fixture email, user id or name appears (${people.length} strings checked)`, leaks(all) === 0);
await check("  no '@', and nothing shaped like a uuid, appears at all", !/@/.test(all) && !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(all));
await check("  push_config's other column value never appears", !all.includes(PUSH_OTHER_COLUMN));

console.log("\n── read-only · the file itself, then the transaction");
// Code = the file minus -- comments, /* */ comments and '…' literals (E'…' honours backslash escapes).
// The $probe$ body is code and stays in.
function codeOnly(sql) {
  let out = "", i = 0;
  while (i < sql.length) {
    const c = sql[i], d = sql[i + 1];
    if (c === "-" && d === "-") { while (i < sql.length && sql[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") { const e = sql.indexOf("*/", i + 2); i = e < 0 ? sql.length : e + 2; continue; }
    if (c === "'") {
      const esc = /[eE]/.test(sql[i - 1] ?? "") && !/[A-Za-z0-9_]/.test(sql[i - 2] ?? "");
      i++;
      while (i < sql.length) {
        if (esc && sql[i] === "\\") { i += 2; continue; }
        if (sql[i] === "'") { if (sql[i + 1] === "'") { i += 2; continue; } i++; break; }
        i++;
      }
      out += "''";
      continue;
    }
    out += c; i++;
  }
  return out;
}
const WRITE = /\b(insert|update|delete|truncate|merge|create|alter|drop|grant|revoke|comment|copy|execute|perform|call|lock|refresh|reindex|cluster|vacuum|analyze|import|label|set|reset|commit|savepoint|prepare|listen|notify|unlisten|discard|load|checkpoint|nextval|setval|set_config|pg_notify|pg_advisory\w*|lo_\w+|dblink\w*|pg_terminate_backend|pg_cancel_backend|pg_sleep|pg_reload_conf|http_\w+)\b/gi;
const writesIn = (sql) => [...new Set((codeOnly(sql).match(WRITE) ?? []).map((w) => w.toLowerCase()))];
const code = codeOnly(PROBE);
const MUTATED = PROBE.replace("  -- S1 ·", "  UPDATE public.push_config SET function_url = function_url;\n  -- S1 ·");

await check("  scanner self-test: write words inside a comment, a string and an E'' string are not code",
  writesIn("-- UPDATE x\n/* DROP y */ SELECT 'DELETE FROM z', E'it\\'s an INSERT', 'don''t ALTER';").length === 0);
await check(`  scanner self-test: a write planted in the probe IS seen (${writesIn(MUTATED).join(", ")})`,
  MUTATED !== PROBE && writesIn(MUTATED).join(",") === "update,set");
await check(`  the probe's comments and strings do carry such words (e.g. header: ${/\bINSERT\b/.test(PROBE) ? "INSERT" : "none"}), so stripping them is what the next line rests on`,
  /\bINSERT\b/.test(PROBE) && !/\bINSERT\b/i.test(code));
await check(`  the probe contains no write keyword outside comments/strings (found: ${writesIn(PROBE).join(", ") || "none"})`, writesIn(PROBE).length === 0);
await check("  its only statements are BEGIN READ ONLY; one DO block; ROLLBACK;",
  /^\s*BEGIN READ ONLY;\s*DO \$probe\$[\s\S]*\$probe\$;\s*ROLLBACK;\s*$/.test(code) && (code.match(/\$probe\$/g) ?? []).length === 2);
const pcCols = [...new Set([...code.matchAll(/\bpc\.(\w+|\*)/g)].map((m) => m[1]))];
const cCols = [...new Set([...code.matchAll(/\bc\.(\w+|\*)/g)].map((m) => m[1]))].sort();
await check(`  of push_config it names function_url only (pc.: ${pcCols.join(", ")}; derived c.: ${cCols.join(", ")}); internal_secret is not in the code`,
  pcCols.join(",") === "function_url" && cCols.join(",") === "function_url,host" && (code.match(/push_config/g) ?? []).length === 1
  && !/internal_secret/.test(code) && !/\b(pc|c)\s*::/.test(code) && !/select\s+\*/i.test(code));
await probe("the planted write, run as SUPERUSER inside the probe's own transaction → refused by BEGIN READ ONLY", {
  role: null, sql: MUTATED, expect: "fail:cannot execute UPDATE in a read-only transaction" });
await check(`  across all ${probeRuns} probe runs, the fixture rows and the catalog were identical before and after each run (${runsThatChangedState} changed)`,
  probeRuns >= 20 && runsThatChangedState === 0);

const sha = (s) => createHash("sha256").update(s.replace(/\r\n/g, "\n")).digest("hex");
console.log(`\nfile rehearsed (sha256 of LF text):\n  ${PROBE_PATH} ${sha(PROBE)}`);
console.log(`${passed} check(s) as required, ${failures} not as required; ${probeRuns} of them are runs of the probe file`);
console.log(failures === 0 ? "ALL SCENARIOS AS REQUIRED" : `${failures} SCENARIO(S) NOT AS REQUIRED`);
process.exit(failures === 0 ? 0 : 1);
