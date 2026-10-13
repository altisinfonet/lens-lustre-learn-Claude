// ═══════════════════════════════════════════════════════════════════════════
// VID-1 · 20261013_0007 — converter account provisioning. FAIL-FIRST rehearsal
// on PGlite (Postgres, in memory), on a staging and a production lane shape.
//
// REAL: the migration files (20261005_0005, 20261012_0001, 20261012_0002 and
// 20261013_0007 whole; 20261005_0007's video_mark_uploaded), 0007's rollback
// and PROBE; the bodies of is_banned() and guard_profile_moderation_columns()
// and the policy texts of posts / post_comments / profiles / user_roles, as in
// UNAPPLIED_20260911101721_new_project_full_schema_bootstrap.sql.
// STUBBED: the platform — Supabase Auth (auth.users with the columns this unit
// reads; "the Owner adds the user" is an INSERT whose encrypted_password is the
// literal 'fixture-not-a-password'), the sign-up trigger (profile + 'user'
// role), roles, feature switches, the attestation check. The trigger NAME on
// profiles is the fixture's; the PROBE looks for the function, not the name.
// NOT MODELLED: every other table of the app (see README, "What this does not
// prove").
//
// RUN (from the repository root; PGlite is not a dependency of this repo):
//   PGLITE_MODULE=file:///<scratch>/node_modules/@electric-sql/pglite/dist/index.js \
//     node docs/evidence/d1/VID/converter-account/account-harness.mjs
// Exit 0 only when every line is as expected (RED where it must be red).
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../../..");
const read = (p) => readFileSync(resolve(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const sect = (txt, a, b) => { const i = txt.indexOf(a); const j = txt.indexOf(b, i + 1); if (i < 0 || j < 0) throw new Error("section not found: " + a); return txt.slice(i, j); };

const SQL = {
  m5: read("supabase/migrations/20261005_0005_vid2_videos.sql"),
  m7: read("supabase/migrations/20261005_0007_vid2_upload_attest.sql"),
  nocap: read("supabase/migrations/20261012_0001_vid1_no_duration_cap.sql"),
  conv: read("supabase/migrations/20261012_0002_vid1_converter_sources.sql"),
  acc: read("supabase/migrations/20261013_0007_vid1_converter_account.sql"),
  rb: read("supabase/rollback/20261013_0007_vid1_converter_account_ROLLBACK.sql"),
  probe: read("supabase/migrations/PROBE_20261013_0007_vid1_converter_account.sql"),
};
const mark7 = sect(SQL.m7, "CREATE FUNCTION public.video_mark_uploaded", "-- ── 4. SEC-VID-4");
const EMAIL = "video-converter@50mmretina.com";

const DEFAULTS = {
  staging: `
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;`,
  production: `
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;`,
};

const U = (n) => `${n.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
const ADM = U(0xad), MEM = U(0x1), OTHER = U(0x2), CONV = U(0xc0);
const out = [];
const say = (s = "") => { out.push(s); console.log(s); };
let bad = 0;
/** One line of the transcript: what happened, and whether that is what must happen. */
const line = (label, got, want) => { const ok = want(got); if (!ok) bad++; say(`  ${ok ? "ok  " : "WRONG"} ${label} → ${got}`); };
const short = (e) => String(e ?? "").split("\n").slice(0, 2).join(" ⏎ ").slice(0, 260);

async function build(lane) {
  const db = new PGlite();
  const x = { db };
  x.su = async (sql, p = []) => (await db.query(sql, p)).rows;
  x.as = async (uid, sql, p = [], role = "authenticated") => {
    await db.exec(`RESET ROLE; SET ROLE ${role}; SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false);`);
    try { const r = await db.query(sql, p); return { rows: r.rows, n: r.affectedRows ?? r.rows.length }; }
    catch (e) { return { error: e.message }; }
    finally { await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);"); }
  };
  x.file = async (sql, asLane = lane) => {
    const notices = [];
    await db.exec(asLane ? `SET p32.lane = '${asLane}';` : "RESET p32.lane;");
    try { await db.exec(sql, { onNotice: (n) => notices.push(n.message) }); return "OK" + (notices.length ? " · " + notices.join(" | ") : ""); }
    catch (e) { await db.exec("ROLLBACK;").catch(() => {}); return "REFUSED · " + short(e.message); }
  };
  x.probe = async () => { const r = await x.file(SQL.probe); return r.startsWith("OK") ? "GREEN · " + r.slice(5) : "RED · " + r.slice(10); };
  /** Everything 0007 may touch, as one string. */
  x.state = async () => JSON.stringify(await x.su(`SELECT
     (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id), '[]') FROM public.profiles p) profiles,
     (SELECT coalesce(jsonb_agg(jsonb_build_array(user_id, role) ORDER BY user_id, role), '[]') FROM public.user_roles) roles,
     (SELECT coalesce(jsonb_agg(jsonb_build_array(user_id, note) ORDER BY user_id), '[]') FROM public.video_converter_accounts) accounts,
     (SELECT coalesce(jsonb_agg(tgname ORDER BY tgname), '[]') FROM pg_trigger WHERE tgrelid = 'public.user_roles'::regclass AND NOT tgisinternal) triggers,
     to_regprocedure('public.tg_user_roles_no_converter()') IS NOT NULL fn`));
  await db.exec(`
CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO authenticated, anon;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, encrypted_password text, email_confirmed_at timestamptz, banned_until timestamptz, deleted_at timestamptz);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, schedule text NOT NULL, command text NOT NULL, username text NOT NULL DEFAULT 'postgres', active boolean NOT NULL DEFAULT true, jobname text, UNIQUE (jobname, username));
CREATE FUNCTION cron.schedule(_name text, _schedule text, _command text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (_name, _schedule, _command)
  ON CONFLICT (jobname, username) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(bigint) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobid = $1 RETURNING true $$;
CREATE FUNCTION cron.unschedule(text) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobname = $1 RETURNING true $$;
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user', 'registered_photographer');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, role public.app_role NOT NULL, UNIQUE (user_id, role));
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, full_name text,
  is_suspended boolean DEFAULT false NOT NULL, suspended_until timestamptz, is_banned boolean DEFAULT false NOT NULL);
-- real body (bootstrap)
CREATE FUNCTION public.is_banned(_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE((SELECT is_banned FROM public.profiles WHERE id = _user_id), false); $$;
-- real body (bootstrap)
CREATE FUNCTION public.guard_profile_moderation_columns() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.is_banned IS DISTINCT FROM OLD.is_banned OR NEW.is_suspended IS DISTINCT FROM OLD.is_suspended
     OR NEW.suspended_until IS DISTINCT FROM OLD.suspended_until THEN
    IF auth.uid() IS NULL OR has_role(auth.uid(), 'admin'::app_role) THEN RETURN NEW; END IF;
    IF NEW.is_banned IS DISTINCT FROM OLD.is_banned THEN
      RAISE EXCEPTION 'Not permitted to change ban status' USING ERRCODE = '42501';
    END IF;
    IF NEW.is_suspended IS DISTINCT FROM OLD.is_suspended OR NEW.suspended_until IS DISTINCT FROM OLD.suspended_until THEN
      IF NOT (OLD.is_suspended = true AND OLD.suspended_until IS NOT NULL AND OLD.suspended_until < now() AND NEW.is_suspended = false) THEN
        RAISE EXCEPTION 'Not permitted to change suspension status' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_guard_profile_moderation BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.guard_profile_moderation_columns();
-- the sign-up trigger (handle_new_user): a profile and the 'user' role
CREATE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN INSERT INTO public.profiles (id) VALUES (NEW.id); INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user'); RETURN NEW; END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
CREATE TABLE public.feature_off (feature text NOT NULL, user_id uuid);
CREATE FUNCTION public.feature_allowed(_feature text, _uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$ SELECT NOT EXISTS (SELECT 1 FROM public.feature_off WHERE feature = _feature AND (user_id = _uid OR user_id IS NULL)) $$;
CREATE FUNCTION public.feature_allowed_me(text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT public.feature_allowed($1, (SELECT auth.uid())) $$;
CREATE FUNCTION public.account_is_live() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$ select exists (select 1 from auth.users u where u.id = auth.uid()) $$;
CREATE TABLE public.categories (slug text PRIMARY KEY, is_active boolean NOT NULL DEFAULT true);
INSERT INTO public.categories VALUES ('nature');
CREATE TABLE public.posts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, categories text[], content text);
CREATE TABLE public.post_comments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), post_id uuid, user_id uuid, content text);
CREATE TABLE public.ad_creatives (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.site_settings (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid);
CREATE FUNCTION public.video_attest_verify(_video_id uuid, _version_no integer, _audio_sha256 text, _issued_at bigint, _attest text)
  RETURNS void LANGUAGE plpgsql SET search_path TO '' AS $$ BEGIN IF _attest IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'VID-MU-005: bad attestation'; END IF; END $$;
INSERT INTO public.feature_off VALUES ('copyright_music_check', NULL);
-- RLS as on the lanes (policy texts from the bootstrap; the permissive "own row" insert policies stand for the app's)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY; ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY; ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT TO authenticated USING ((id = (SELECT auth.uid())));
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING ((id = (SELECT auth.uid())));
CREATE POLICY "Admins can manage roles" ON public.user_roles FOR ALL TO authenticated USING (has_role((SELECT auth.uid()), 'admin'::app_role));
CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT TO authenticated USING ((user_id = (SELECT auth.uid())));
CREATE POLICY "Users can self-assign photographer role" ON public.user_roles FOR INSERT TO authenticated WITH CHECK (((user_id = (SELECT auth.uid())) AND (role::text = 'registered_photographer'::text)));
CREATE POLICY "Users can create posts" ON public.posts FOR INSERT TO authenticated WITH CHECK ((user_id = (SELECT auth.uid())));
CREATE POLICY "Banned users cannot create posts" ON public.posts AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((NOT is_banned((SELECT auth.uid()))));
CREATE POLICY "Users can comment" ON public.post_comments FOR INSERT TO authenticated WITH CHECK ((user_id = (SELECT auth.uid())));
CREATE POLICY "Banned users cannot comment on posts" ON public.post_comments AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((NOT is_banned((SELECT auth.uid()))));
GRANT ALL ON public.profiles, public.user_roles, public.posts, public.post_comments TO authenticated;
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at) VALUES
  ('${ADM}', 'admin@example.test', 'fixture-not-a-password', now()), ('${MEM}', 'member@example.test', 'fixture-not-a-password', now()),
  ('${OTHER}', 'other@example.test', 'fixture-not-a-password', now());
INSERT INTO public.user_roles (user_id, role) VALUES ('${ADM}', 'admin');
`);
  await db.exec(DEFAULTS[lane]);
  for (const [n, s] of [["20261005_0005", SQL.m5], ["mark7", null], ["20261012_0001", SQL.nocap], ["20261012_0002", SQL.conv]]) {
    if (!s) {
      await db.exec(mark7);
      await db.exec(`REVOKE ALL ON FUNCTION public.video_mark_uploaded(uuid, integer, text, bigint, text) FROM PUBLIC, anon;
                     GRANT EXECUTE ON FUNCTION public.video_mark_uploaded(uuid, integer, text, bigint, text) TO authenticated;`);
      continue;
    }
    const r = await x.file(s); if (!r.startsWith("OK")) throw new Error(`${lane}: ${n} did not apply: ${r}`);
  }
  await x.su(`UPDATE public.site_settings SET value = '"server"' WHERE key = 'video_conversion'`);
  return x;
}

const refused = (code) => (g) => g.startsWith("REFUSED") && g.includes(code);
const denied = (re) => (g) => re.test(g);
const res = (r) => r.error ? "refused: " + short(r.error) : `allowed (${r.n} row(s))`;
const KEY = (n) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** A member puts one upload in the converter's queue (the real functions). */
async function queue(x, n) {
  const b = await x.as(MEM, "select public.video_source_begin('post', 100000000, $1) r", [KEY(n)]);
  const sid = b.rows?.[0]?.r?.source_id; if (!sid) throw new Error("begin: " + b.error);
  const u = await x.as(MEM, "select public.video_source_uploaded($1, 'abc123etag') r", [sid]); if (u.error) throw new Error("uploaded: " + u.error);
  return sid;
}
const claim = async (x, uid, role) => { const r = await x.as(uid, "select public.video_source_claim() r", [], role); return r.error ? "refused: " + short(r.error) : "claimed " + (r.rows[0].r?.source_id ? "a job" : "nothing (" + JSON.stringify(r.rows[0].r) + ")"); };

for (const lane of ["staging", "production"]) {
  say(`\n════ lane shape: ${lane} ════`);
  const x = await build(lane);
  const sid = await queue(x, 1);

  say("── 1 · BEFORE 0007 (the lane as 20261012_0002 leaves it) ──");
  line("PROBE", await x.probe(), (g) => g.startsWith("RED") && g.includes("A1 converter accounts 0"));
  line("0007 with no Auth user", await x.file(SQL.acc), refused("VID-ACC-PRE-010"));
  const s0 = await x.state();

  say("── 2 · the Owner adds the Auth user (NOT SQL; fixture INSERT stands for the dashboard) ──");
  await x.su("INSERT INTO auth.users (id, email, encrypted_password) VALUES ($1, $2, 'fixture-not-a-password')", [CONV, EMAIL]);
  line("0007 while the user is unconfirmed", await x.file(SQL.acc), refused("VID-ACC-PRE-011"));
  await x.su("UPDATE auth.users SET email_confirmed_at = now() WHERE id = $1", [CONV]);
  const s1 = await x.state();
  line("[new] the account claims a job", await claim(x, CONV), denied(/^refused: VID-CONV-001/));
  line("[new] the account gives itself a role", res(await x.as(CONV, "insert into public.user_roles (user_id, role) values ($1, 'registered_photographer')", [CONV])), denied(/^allowed/));
  await x.su("DELETE FROM public.user_roles WHERE user_id = $1 AND role = 'registered_photographer'", [CONV]);
  line("[new] the account writes a post", res(await x.as(CONV, "insert into public.posts (user_id, content) values ($1, 'x')", [CONV])), denied(/^allowed/));
  await x.su("DELETE FROM public.posts");
  line("PROBE", await x.probe(), (g) => g.startsWith("RED") && g.includes("A1 converter accounts 0"));
  line("0007 without the lane asserted", await x.file(SQL.acc, null), refused("APPLY REFUSED"));
  await x.su("INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'moderator')", [CONV]);
  line("0007 when that e-mail holds a staff role", await x.file(SQL.acc), refused("VID-ACC-PRE-016"));
  await x.su("DELETE FROM public.user_roles WHERE user_id = $1 AND role = 'moderator'", [CONV]);
  line("nothing changed by the refusals", String(await x.state() === s1), (g) => g === "true");

  say("── 3 · APPLY 0007 ──");
  line("0007", await x.file(SQL.acc), (g) => g.startsWith("OK") && g.includes("provisioned"));
  line("PROBE", await x.probe(), (g) => g.startsWith("GREEN"));
  const s2 = await x.state();

  say("── 4 · AFTER: who can use the converter RPCs ──");
  line("a normal member claims", await claim(x, MEM), denied(/^refused: VID-CONV-001/));
  line("an admin claims", await claim(x, ADM), denied(/^refused: VID-CONV-001/));
  line("anon claims", await claim(x, null, "anon"), denied(/^refused: permission denied/));
  line("a normal member heartbeats / fails / finishes a job", [
    res(await x.as(MEM, "select public.video_source_heartbeat($1, gen_random_uuid())", [sid])),
    res(await x.as(MEM, "select public.video_source_fail($1, gen_random_uuid(), 'bad_source')", [sid])),
    res(await x.as(MEM, "select public.video_source_done($1, gen_random_uuid())", [sid]))].join(" · "), (g) => (g.match(/refused: VID-CONV-001/g) ?? []).length === 3);
  line("[new] the converter account claims", await claim(x, CONV), (g) => g === "claimed a job");

  say("── 5 · AFTER: what the converter account cannot do ──");
  const c = (sql, p = []) => x.as(CONV, sql, p);
  line("[new] write a post", res(await c("insert into public.posts (user_id, content) values ($1, 'x')", [CONV])), denied(/^refused: new row violates row-level security/));
  line("write a comment", res(await c("insert into public.post_comments (user_id, content) values ($1, 'x')", [CONV])), denied(/^refused: new row violates row-level security/));
  line("[new] give itself a role", res(await c("insert into public.user_roles (user_id, role) values ($1, 'registered_photographer')", [CONV])), denied(/^refused: VID-ACC-001/));
  line("an admin gives it a role", res(await x.as(ADM, "insert into public.user_roles (user_id, role) values ($1, 'moderator')", [CONV])), denied(/^refused: VID-ACC-001/));
  line("an admin moves a role row onto it", res(await x.as(ADM, "update public.user_roles set user_id = $1 where user_id = $2", [CONV, MEM])), denied(/^refused: VID-ACC-001/));
  line("lift its own ban", res(await c("update public.profiles set is_banned = false where id = $1", [CONV])), denied(/^refused: Not permitted to change ban status/));
  line("make itself visible again", res(await c("update public.profiles set is_suspended = false where id = $1", [CONV])), denied(/^refused: Not permitted to change suspension status/));
  line("upload a video of its own (member path)", res(await c("select public.video_source_begin('post', 100000000, $1)", [KEY(9)])), denied(/^refused: VID-/));
  line("read a member's conversion rows", res(await c("select id, owner_id, status from public.video_sources")), (g) => g === "allowed (0 row(s))");
  line("read another member's profile", res(await c("select * from public.profiles where id <> $1", [CONV])), (g) => g === "allowed (0 row(s))");
  line("read the converter list / the audit trail", [res(await c("select * from public.video_converter_accounts")), res(await c("select * from public.video_source_events"))].join(" · "),
    (g) => (g.match(/refused: permission denied/g) ?? []).length === 2);
  line("change a member's profile / roles", [res(await c("update public.profiles set full_name = 'x' where id = $1", [MEM])), res(await c("delete from public.user_roles where user_id = $1", [MEM]))].join(" · "),
    (g) => g === "allowed (0 row(s)) · allowed (0 row(s))");
  line("the provisioned state did not move", String((await x.state()) === s2), (g) => g === "true");
  line("PROBE", await x.probe(), (g) => g.startsWith("GREEN") && !g.includes("never"));

  say("── 6 · PROBE mutants (each must be RED; each is undone) ──");
  const mutant = async (label, mark, doSql, undoSql) => {
    await x.db.exec(doSql); line("mutant: " + label, await x.probe(), (g) => g.startsWith("RED") && g.includes(mark)); await x.db.exec(undoSql);
  };
  await mutant("profile un-banned", "A4", `UPDATE public.profiles SET is_banned = false WHERE id = '${CONV}'`, `UPDATE public.profiles SET is_banned = true WHERE id = '${CONV}'`);
  await mutant("profile visible", "A4", `UPDATE public.profiles SET is_suspended = false WHERE id = '${CONV}'`, `UPDATE public.profiles SET is_suspended = true WHERE id = '${CONV}'`);
  await mutant("a role row", "A3", `ALTER TABLE public.user_roles DISABLE TRIGGER tg_user_roles_no_converter; INSERT INTO public.user_roles (user_id, role) VALUES ('${CONV}', 'user'); ALTER TABLE public.user_roles ENABLE TRIGGER tg_user_roles_no_converter;`,
    `DELETE FROM public.user_roles WHERE user_id = '${CONV}'`);
  await mutant("role trigger disabled", "A5", "ALTER TABLE public.user_roles DISABLE TRIGGER tg_user_roles_no_converter", "ALTER TABLE public.user_roles ENABLE TRIGGER tg_user_roles_no_converter");
  await mutant("profile guard disabled", "A5", "ALTER TABLE public.profiles DISABLE TRIGGER trg_guard_profile_moderation", "ALTER TABLE public.profiles ENABLE TRIGGER trg_guard_profile_moderation");
  await mutant("role trigger function executable by authenticated", "A5", "GRANT EXECUTE ON FUNCTION public.tg_user_roles_no_converter() TO authenticated", "REVOKE EXECUTE ON FUNCTION public.tg_user_roles_no_converter() FROM authenticated");
  await mutant("a second converter account", "A1", `INSERT INTO public.video_converter_accounts (user_id, note) VALUES ('${OTHER}', 'x')`, `DELETE FROM public.video_converter_accounts WHERE user_id = '${OTHER}'`);
  await mutant("e-mail unconfirmed", "A2", `UPDATE auth.users SET email_confirmed_at = NULL WHERE id = '${CONV}'`, `UPDATE auth.users SET email_confirmed_at = now() WHERE id = '${CONV}'`);
  await mutant("ban policy on posts dropped", "A6", `DROP POLICY "Banned users cannot create posts" ON public.posts`,
    `CREATE POLICY "Banned users cannot create posts" ON public.posts AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((NOT is_banned((SELECT auth.uid()))))`);
  line("PROBE after the mutants", await x.probe(), (g) => g.startsWith("GREEN"));

  say("── 7 · idempotent, rollback exact ──");
  const s3 = await x.state();
  line("0007 again", await x.file(SQL.acc), (g) => g.startsWith("OK") && g.includes("already provisioned"));
  line("0007 a third time; state identical", (await x.file(SQL.acc)).slice(0, 2) + " · " + String((await x.state()) === s3), (g) => g === "OK · true");
  line("rollback while the converter holds a live claim", await x.file(SQL.rb), refused("VID-ACC-RB-004"));
  await x.su("UPDATE public.video_sources SET lease_until = now() - interval '1 second' WHERE status = 'converting'");
  line("rollback without the lane asserted", await x.file(SQL.rb, null), refused("APPLY REFUSED"));
  line("rollback", await x.file(SQL.rb), (g) => g.startsWith("OK"));
  line("state equals the state before 0007 (profile, roles, list, trigger, function)", String((await x.state()) === s1), (g) => g === "true");
  line("PROBE", await x.probe(), (g) => g.startsWith("RED") && g.includes("A1 converter accounts 0"));
  line("the account claims", await claim(x, CONV), denied(/^refused: VID-CONV-001/));
  line("rollback again", await x.file(SQL.rb), refused("VID-ACC-RB-002"));
  line("0007 once more", await x.file(SQL.acc), (g) => g.startsWith("OK") && g.includes("provisioned"));
  line("PROBE", await x.probe(), (g) => g.startsWith("GREEN"));
  line("with the Auth user deleted (dashboard), the lane is as before step 2", await (async () => {
    await x.su("UPDATE public.video_sources SET lease_until = now() - interval '1 second' WHERE status = 'converting'");
    await x.file(SQL.rb); await x.su("DELETE FROM auth.users WHERE id = $1", [CONV]); return String((await x.state()) === s0); })(), (g) => g === "true");
  await x.db.close();
}

say(`\n${bad === 0 ? "ALL AS EXPECTED" : bad + " LINE(S) WRONG"} — [new] lines are the behaviour 0007 adds: each is shown failing before it and passing after it.`);
writeFileSync(resolve(HERE, "transcript.txt"), out.join("\n") + "\n");
process.exit(bad === 0 ? 0 : 1);
