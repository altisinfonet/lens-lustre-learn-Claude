// ═══════════════════════════════════════════════════════════════════════════
// VID-1 · 20261013_0006 — finished converter rows are kept until posted or
// deleted; unposted converted videos are removed after 30 days.
// FAIL-FIRST behaviour harness on PGlite (Postgres, in memory), on two lane
// shapes. The SAME cases run twice per lane:
//   BEFORE  the lane as it is today (…0005, 0007's mark, 20261012_0001, 20261012_0002)
//           → every case marked [new] must be RED;
//   AFTER   the same lane + 20261013_0006 → every case must be GREEN.
// Then, on the AFTER database: the PROBE (red before / green after), seven
// PROBE mutants (each red, each undone), the rollback (exact), re-apply twice.
//
// REAL: the migration files themselves (20261005_0005, 20261012_0001,
// 20261012_0002 and 20261013_0006 whole; 20261005_0007's video_mark_uploaded),
// the rollback and the PROBE. STUBBED: only the platform — auth, pg_cron (a
// table + schedule/unschedule that behave like pg_cron 1.6: schedule() by name
// replaces), roles, feature switches, ban, the attestation check, posts.
//
// LANE SHAPES (what differs between the lanes for this unit: default
// privileges and the cron table):
//   staging     default privileges READ LIVE from staging fpszggreishhuvdpkmdr,
//               pg_default_acl, 2026-10-13 11:29Z (read-only): new public
//               functions → postgres, authenticated, service_role (PUBLIC
//               revoked for role postgres); new tables/sequences → anon,
//               authenticated, service_role ALL. Cron: the two video jobs the
//               real migrations schedule (read live the same minute; the other
//               14 staging job names were not read — the connector went down).
//   production  cron: the 18 jobs of the read-only collector dump
//               supabase-20261013-121953 (2026-10-13 06:51Z), names, schedules
//               and commands as dumped. Default privileges are NOT in that
//               dump: MODELLED as the widest this project has measured on
//               both lanes (20260910_0016's header, 2026-09-06): PUBLIC + anon
//               + authenticated + service_role EXECUTE on new functions.
//               Production has no video objects today, so the fixture first
//               applies the same video migrations it would have received.
//   production-today  the same lane WITHOUT any video migration: 20261013_0006
//               must refuse (VID-RET-PRE-001) and change nothing.
//
// RUN (from the repository root; PGlite is not a dependency of this repo):
//   npm i --prefix <any scratch dir> @electric-sql/pglite@0.5.9
//   PGLITE_MODULE=file:///<scratch dir>/node_modules/@electric-sql/pglite/dist/index.js \
//     node docs/evidence/d1/VID/converter-finished-retention/retention-harness.mjs
// Exit 0 only when BEFORE is red where it must be and AFTER is all green.
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../../..");
const read = (p) => readFileSync(resolve(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const sect = (txt, a, b) => { const i = txt.indexOf(a); const j = txt.indexOf(b, i + 1); if (i < 0 || j < 0) throw new Error("section not found: " + a.slice(0, 50)); return txt.slice(i, j); };
const sha = (t) => createHash("sha256").update(t).digest("hex").slice(0, 16);

const F = {
  m5: "supabase/migrations/20261005_0005_vid2_videos.sql",
  m7: "supabase/migrations/20261005_0007_vid2_upload_attest.sql",
  nocap: "supabase/migrations/20261012_0001_vid1_no_duration_cap.sql",
  conv: "supabase/migrations/20261012_0002_vid1_converter_sources.sql",
  ret: "supabase/migrations/20261013_0006_vid1_converter_finished_retention.sql",
  rb: "supabase/rollback/20261013_0006_vid1_converter_finished_retention_ROLLBACK.sql",
  probe: "supabase/migrations/PROBE_20261013_0006_vid1_converter_finished_retention.sql",
};
const SQL = Object.fromEntries(Object.entries(F).map(([k, p]) => [k, read(p)]));
const mark7 = sect(SQL.m7, "CREATE FUNCTION public.video_mark_uploaded", "-- ── 4. SEC-VID-4");
const hk0002 = sect(SQL.conv, "CREATE FUNCTION public.video_source_housekeeping", "-- For the health check").replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION");

const PROD_CRON = [ // collector dump supabase-20261013-121953/live/db/cron_jobs.json (2026-10-13 06:51Z)
  ["apply-scheduled-boosts", "*/5 * * * *", "SELECT public.cron_http_call('apply-scheduled-boosts');"],
  ["autoscale-ad-traffic", "0 */6 * * *", "SELECT public.cron_http_call('autoscale-ad-traffic');"],
  ["backup-reminder", "0 8 * * 1", "SELECT public.cron_http_call('backup-reminder');"],
  ["emit-birthday-notifications", "30 3 * * *", "SELECT public.emit_birthday_notifications();"],
  ["expire-gift-credits", "15 0 * * *", "SELECT public.cron_http_call('expire-gift-credits');"],
  ["judging-invariants-nightly", "0 2 * * *", "SELECT public.cron_http_call('judging-invariants-nightly');"],
  ["mark-expiring-post-drafts", "10 3 * * *", " SELECT public.mark_expiring_post_drafts(7); "],
  ["p1-backfill-last-seen", "*/30 * * * *", "SELECT public.backfill_last_seen();"],
  ["process-email-queue", "* * * * *", "SELECT public.email_queue_tick();"],
  ["process-post-jobs", "* * * * *", "SELECT public.drain_post_jobs(100, interval '20 seconds');"],
  ["prune-client-errors", "25 3 * * *", "SELECT public.prune_client_errors(30);"],
  ["prune-old-notifications", "20 3 * * *", " SELECT public.prune_old_notifications(90, 5000); "],
  ["publish-scheduled-posts", "* * * * *", "SELECT public.publish_scheduled_posts_tick();"],
  ["purge-cron-history", "17 * * * *", "CALL public.purge_cron_run_details();"],
  ["purge-user-block-notices", "23 * * * *", "SELECT public.purge_user_block_notices();"],
  ["rollup-engagement-daily", "20 0 * * *", "\n    SELECT public.rollup_engagement_daily(((now() AT TIME ZONE 'UTC')::date - 1));\n    SELECT public.rollup_engagement_daily(((now() AT TIME ZONE 'UTC')::date));\n  "],
  ["send-reengagement-emails", "0 9 * * *", "SELECT public.cron_http_call('send-reengagement-emails');"],
  ["wallet_ledger_v2_diff_hourly", "7 * * * *", " SELECT public.wallet_ledger_v2_diff_snapshot('1 hour'::interval); "],
];
const LANES = {
  staging: {
    defaults: `
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;`,
    cron: [],
  },
  production: {
    defaults: `
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;`,
    cron: PROD_CRON,
  },
};

const U = (n) => `${n.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
const ADM = U(0xad), CONV = U(0xc0);
const SHA = (c) => c.repeat(64);
const REND = { "240p": 20000000, "audio": 1000000, "other": 100000 };
const TOTAL = 21100000;

const out = [];
const say = (s = "") => { out.push(s); console.log(s); };

// ── the fixture ─────────────────────────────────────────────────────────────
async function build(lane, { video = true, retention = false } = {}) {
  const db = new PGlite();
  const x = { db, lane, seq: 0x100, keys: 0, notices: [] };
  x.su = async (sql, params = []) => (await db.query(sql, params)).rows;
  x.one = async (sql, params = []) => (await x.su(sql, params))[0];
  x.as = async (uid, sql, params = [], role = "authenticated") => {
    await db.exec(`RESET ROLE; SET ROLE ${role}; SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false);`);
    try { return { rows: (await db.query(sql, params)).rows }; }
    catch (e) { return { error: e.message }; }
    finally { await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);"); }
  };
  /** Run a whole file the way apply-migration.yml does: lane asserted in the session, then the file. */
  x.file = async (sql, asLane = lane) => {
    x.notices = [];
    await db.exec(asLane ? `SET p32.lane = '${asLane}';` : "RESET p32.lane;");
    try { await db.exec(sql, { onNotice: (n) => x.notices.push(n.message) }); return { ok: true, notices: x.notices }; }
    catch (e) { await db.exec("ROLLBACK;").catch(() => {}); return { ok: false, error: e.message }; }
  };
  await db.exec(`
CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO authenticated, anon;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, schedule text NOT NULL, command text NOT NULL, username text NOT NULL DEFAULT 'postgres',
                       active boolean NOT NULL DEFAULT true, jobname text, UNIQUE (jobname, username));
-- pg_cron 1.6: schedule(name, …) replaces the job of that name; unschedule by id or by name.
CREATE FUNCTION cron.schedule(_name text, _schedule text, _command text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (_name, _schedule, _command)
  ON CONFLICT (jobname, username) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(bigint) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobid = $1 RETURNING true $$;
CREATE FUNCTION cron.unschedule(text) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobname = $1 RETURNING true $$;
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TABLE public.user_roles (user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
-- As on both lanes: the profile goes with the auth user (account deletion is a hard delete of auth.users).
CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE);
CREATE TABLE public.banned (user_id uuid PRIMARY KEY);
CREATE FUNCTION public.is_banned(uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$ SELECT EXISTS (SELECT 1 FROM public.banned WHERE user_id = $1) $$;
CREATE TABLE public.feature_off (feature text NOT NULL, user_id uuid);
CREATE FUNCTION public.feature_allowed(_feature text, _uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$ SELECT NOT EXISTS (SELECT 1 FROM public.feature_off WHERE feature = _feature AND (user_id = _uid OR user_id IS NULL)) $$;
CREATE FUNCTION public.feature_allowed_me(text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT public.feature_allowed($1, (SELECT auth.uid())) $$;
CREATE FUNCTION public.account_is_live() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$ select exists (select 1 from auth.users u where u.id = auth.uid()) $$;
CREATE TABLE public.categories (slug text PRIMARY KEY, is_active boolean NOT NULL DEFAULT true);
INSERT INTO public.categories VALUES ('nature');
CREATE TABLE public.posts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, categories text[]);
CREATE TABLE public.ad_creatives (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.site_settings (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid);
CREATE FUNCTION public.video_attest_verify(_video_id uuid, _version_no integer, _audio_sha256 text, _issued_at bigint, _attest text)
  RETURNS void LANGUAGE plpgsql SET search_path TO '' AS $$ BEGIN IF _attest IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'VID-MU-005: bad attestation'; END IF; END $$;
INSERT INTO public.feature_off VALUES ('copyright_music_check', NULL);
INSERT INTO auth.users VALUES ('${ADM}'), ('${CONV}');
INSERT INTO public.profiles SELECT id FROM auth.users;
INSERT INTO public.user_roles VALUES ('${ADM}', 'admin');
`);
  await db.exec(LANES[lane].defaults);                    // from here on, new objects get the LANE's default privileges
  for (const [n, s, c] of LANES[lane].cron) await x.su("SELECT cron.schedule($1, $2, $3)", [n, s, c]);
  if (!video) return x;
  let r = await x.file(SQL.m5); if (!r.ok) throw new Error(`${lane}: 20261005_0005 did not apply: ${r.error}`);
  await db.exec(mark7);
  await db.exec(`REVOKE ALL ON FUNCTION public.video_mark_uploaded(uuid, integer, text, bigint, text) FROM PUBLIC, anon;
                 GRANT EXECUTE ON FUNCTION public.video_mark_uploaded(uuid, integer, text, bigint, text) TO authenticated;`); // 0007's grants
  r = await x.file(SQL.nocap); if (!r.ok) throw new Error(`${lane}: 20261012_0001 did not apply: ${r.error}`);
  r = await x.file(SQL.conv); if (!r.ok) throw new Error(`${lane}: 20261012_0002 did not apply: ${r.error}`);
  await x.su(`INSERT INTO public.video_converter_accounts (user_id, note) VALUES ('${CONV}', 'fixture converter')`);
  await x.su(`UPDATE public.site_settings SET value = '"server"' WHERE key = 'video_conversion'`);
  x.hkBefore = await x.one("SELECT md5(prosrc) m, proacl::text acl FROM pg_proc WHERE oid = 'public.video_source_housekeeping(integer)'::regprocedure");
  x.cronBefore = await x.one("SELECT count(*)::int n, md5(string_agg(jobname || '|' || schedule || '|' || command || '|' || active, E'\\n' ORDER BY jobname)) m FROM cron.job");
  if (retention) { r = await x.file(SQL.ret); if (!r.ok) throw new Error(`${lane}: 20261013_0006 did not apply: ${r.error}`); x.applyNotice = r.notices.join(" | "); }
  return x;
}

// ── helpers (each acts the way the app, the VM or cron does) ────────────────
async function member(x) { const id = U(++x.seq); await x.su("INSERT INTO auth.users VALUES ($1)", [id]); await x.su("INSERT INTO public.profiles VALUES ($1)", [id]); return id; }
const key = (x) => `aaaaaaaa-0000-4000-8000-${String(++x.keys).padStart(12, "0")}`;
/** One whole server conversion, through the real functions: begin → uploaded → claim → version → mark → done. */
async function finished(x, uid, { purpose = "post", checking = false } = {}) {
  const b = await x.as(uid, "select public.video_source_begin($1,$2,$3) r", [purpose, 100000000, key(x)]);
  const sid = b.rows?.[0]?.r?.source_id; if (!sid) throw new Error("begin: " + b.error);
  const u = await x.as(uid, "select public.video_source_uploaded($1,$2) r", [sid, "abc123etag"]); if (u.error) throw new Error("uploaded: " + u.error);
  const c = await x.as(CONV, "select public.video_source_claim() r"); const job = c.rows?.[0]?.r;
  if (job?.source_id !== sid) throw new Error("claim: " + (c.error ?? JSON.stringify(job)));
  const v = await x.as(CONV, "select public.video_converter_begin_version($1,$2,$3,$4,$5,$6,$7) r", [sid, job.claim_token, SHA("a"), TOTAL, 448, true, JSON.stringify(REND)]);
  const vid = v.rows?.[0]?.r?.video_id; if (!vid) throw new Error("begin_version: " + v.error);
  if (checking) await x.su("DELETE FROM public.feature_off WHERE feature = 'copyright_music_check'");   // the music check is ON for this one
  const m = await x.as(CONV, "select public.video_mark_uploaded($1,1,$2,$3,'ok') r", [vid, SHA("b"), Math.floor(Date.now() / 1000)]);
  if (checking) await x.su("INSERT INTO public.feature_off VALUES ('copyright_music_check', NULL)");
  if (m.error) throw new Error("mark: " + m.error);
  const d = await x.as(CONV, "select public.video_source_done($1,$2) r", [sid, job.claim_token]); if (d.error) throw new Error("done: " + d.error);
  return { sid, vid, owner: uid };
}
/** Time passes: the job ended `ended` days ago, the video last changed `changed` days ago. */
async function age(x, j, ended, changed = ended) {
  await x.db.exec(`
    ALTER TABLE public.video_sources DISABLE TRIGGER tg_video_sources_touch;
    UPDATE public.video_sources SET created_at = now() - interval '${ended} days 1 hour', queued_at = now() - interval '${ended} days 1 hour',
           updated_at = now() - interval '${ended} days' WHERE id = '${j.sid}';
    ALTER TABLE public.video_sources ENABLE TRIGGER tg_video_sources_touch;` + (j.vid ? `
    ALTER TABLE public.videos DISABLE TRIGGER tg_videos_state_guard;
    UPDATE public.videos SET created_at = now() - interval '${ended} days 1 hour', updated_at = now() - interval '${changed} days',
           ready_at = CASE WHEN ready_at IS NULL THEN NULL ELSE now() - interval '${changed} days' END,
           deleted_at = CASE WHEN deleted_at IS NULL THEN NULL ELSE now() - interval '${changed} days' END WHERE id = '${j.vid}';
    ALTER TABLE public.videos ENABLE TRIGGER tg_videos_state_guard;` : ""));
}
async function post(x, j) {
  const p = (await x.one("INSERT INTO public.posts (user_id, categories) VALUES ($1, '{nature}') RETURNING id", [j.owner])).id;
  await x.su("INSERT INTO public.post_videos (post_id, video_id) VALUES ($1, $2)", [p, j.vid]);
}
async function adLink(x, j) {
  const a = (await x.one("INSERT INTO public.ad_creatives DEFAULT VALUES RETURNING id")).id;
  await x.su("INSERT INTO public.ad_videos (ad_creative_id, video_id, categories) VALUES ($1, $2, '{nature}')", [a, j.vid]);
}
const src = async (x, j) => (await x.one("SELECT status FROM public.video_sources WHERE id = $1", [j.sid]))?.status ?? "gone";
const vst = async (x, j) => (await x.one("SELECT state FROM public.videos WHERE id = $1", [j.vid]))?.state ?? "gone";
const queued = async (x, j) => (await x.su("SELECT prefix, owner_id FROM public.video_r2_purge_queue WHERE video_id = $1", [j.vid]));
const cron = async (x, sql) => { try { return { r: (await x.one(sql)).r }; } catch (e) { return { error: e.message }; } };   // cron runs as the job owner (postgres)

// ── the cases ───────────────────────────────────────────────────────────────
async function cases(x) {
  const res = [];
  const t = (id, kind, name, pass, detail = "") => res.push({ id, kind, name, pass: !!pass, detail });

  // setup — every job below is a real conversion, then time is moved
  const J = {};
  J.d3 = await finished(x, await member(x));           await age(x, J.d3, 3);            // finished, unposted, 3 days
  J.d29 = await finished(x, await member(x));          await age(x, J.d29, 29);          // finished, unposted, 29 days
  J.posted3 = await finished(x, await member(x));      await post(x, J.posted3);  await age(x, J.posted3, 3);
  J.ad3 = await finished(x, ADM, { purpose: "ad" });   await adLink(x, J.ad3);    await age(x, J.ad3, 3);
  J.del3 = await finished(x, await member(x));
  const delAns = await x.as(J.del3.owner, "select public.video_delete($1) r", [J.del3.vid]); await age(x, J.del3, 3, 0);
  J.posted1 = await finished(x, await member(x));      await post(x, J.posted1);  await age(x, J.posted1, 1);
  J.d31 = await finished(x, await member(x));          await age(x, J.d31, 31);          // finished, unposted, 31 days
  J.d31late = await finished(x, await member(x));      await age(x, J.d31late, 31, 5);   // job ended 31 days ago, video became ready 5 days ago
  J.posted31 = await finished(x, await member(x));     await post(x, J.posted31); await age(x, J.posted31, 31);
  J.del31 = await finished(x, await member(x));
  await x.as(J.del31.owner, "select public.video_delete($1) r", [J.del31.vid]); await age(x, J.del31, 31);
  J.chk31 = await finished(x, await member(x), { checking: true }); await age(x, J.chk31, 31); // still 'checking' after 31 days
  J.fresh = await finished(x, await member(x));                                           // another member, finished a moment ago
  J.gone = await finished(x, await member(x));         await age(x, J.gone, 3);          // this member's account will be deleted
  // the same member also has a device-path video (no source row) …
  const dev = await x.as(J.gone.owner, "select public.video_begin_upload('post',$1,$2,448,true,$3,$4) r", [SHA("c"), TOTAL, key(x), JSON.stringify(REND)]);
  const devVid = dev.rows?.[0]?.r?.video_id;
  // a failed and a cancelled job (ended, never finished), 3 days old
  const fm = await member(x);
  let b = await x.as(fm, "select public.video_source_begin('post',100000000,$1) r", [key(x)]); const sFail = b.rows[0].r.source_id;
  await x.as(fm, "select public.video_source_uploaded($1,'abc123etag') r", [sFail]);
  const cl = (await x.as(CONV, "select public.video_source_claim() r")).rows[0].r;
  await x.as(CONV, "select public.video_source_fail($1,$2,'no_video',null) r", [sFail, cl.claim_token]);
  b = await x.as(fm, "select public.video_source_begin('post',100000000,$1) r", [key(x)]); const sCan = b.rows[0].r.source_id;
  await x.as(fm, "select public.video_source_cancel($1) r", [sCan]);
  await age(x, { sid: sFail }, 3); await age(x, { sid: sCan }, 3);
  // … and the deleted member has one more job, queued, with no video yet
  b = await x.as(J.gone.owner, "select public.video_source_begin('post',100000000,$1) r", [key(x)]); const sQueued = b.rows[0].r.source_id;
  await x.as(J.gone.owner, "select public.video_source_uploaded($1,'abc123etag') r", [sQueued]);
  const states = {}; for (const k of Object.keys(J)) states[k] = await vst(x, J[k]);
  t("S0", "guard", "setup: 13 server conversions finished through the real functions (ready; one still checking; two deleted by their owners)",
    states.d3 === "ready" && states.chk31 === "checking" && states.del3 === "deleted" && states.del31 === "deleted" && delAns.rows?.[0]?.r === "deleted",
    JSON.stringify(states));

  // ── A · the hourly cleanup runs (cron, as the job owner) ──
  const cu = await cron(x, "SELECT public.video_source_unposted_cleanup() r");
  const ran = !cu.error;
  const q31 = await queued(x, J.d31), ev31 = await x.su("SELECT detail FROM public.video_source_events WHERE source_id = $1 AND event = 'abandoned'", [J.d31.sid]);
  const left31 = await x.one("SELECT (SELECT count(*) FROM public.video_versions WHERE video_id = $1)::int ver, (SELECT count(*) FROM public.video_music_checks WHERE video_id = $1)::int chk", [J.d31.vid]);
  t("C1", "new", "unposted for 31 days → removed: video, versions, checks and source row gone; files queued as video/<owner>/<video>/; audit says why",
    ran && cu.r?.removed === 2 && (await vst(x, J.d31)) === "gone" && (await src(x, J.d31)) === "gone" && left31.ver === 0 && left31.chk === 0
      && q31.length === 1 && q31[0].prefix === `video/${J.d31.owner}/${J.d31.vid}/` && q31[0].owner_id === J.d31.owner
      && ev31.length === 1 && ev31[0].detail.startsWith("not posted in 30 days"),
    ran ? `returned ${JSON.stringify(cu.r)}; queue ${JSON.stringify(q31.map((r) => r.prefix))}; audit ${JSON.stringify(ev31.map((r) => r.detail.slice(0, 21)))}`
        : `cleanup: ${cu.error}; video ${await vst(x, J.d31)}, source ${await src(x, J.d31)}, queued ${q31.length}`);
  const qChk = await queued(x, J.chk31);
  t("C2", "new", "the same for a video still 'checking' after 31 days (its music check never ended)",
    ran && (await vst(x, J.chk31)) === "gone" && (await src(x, J.chk31)) === "gone" && qChk.length === 1,
    `video ${await vst(x, J.chk31)}, source ${await src(x, J.chk31)}, queued ${qChk.length}`);
  t("C3", "new", "the cleanup leaves a POSTED video alone, however old (31 days)",
    ran && (await vst(x, J.posted31)) === "ready" && (await queued(x, J.posted31)).length === 0
      && (await x.one("SELECT count(*)::int n FROM public.post_videos WHERE video_id = $1", [J.posted31.vid])).n === 1,
    ran ? `video ${await vst(x, J.posted31)}, link kept, nothing queued` : `cleanup: ${cu.error}`);
  t("C4", "new", "the cleanup leaves a DELETED video to video_housekeeping (nothing queued twice)",
    ran && (await vst(x, J.del31)) === "deleted" && (await queued(x, J.del31)).length === 0,
    ran ? `video ${await vst(x, J.del31)}, queued ${(await queued(x, J.del31)).length}` : `cleanup: ${cu.error}`);
  const bad1 = await cron(x, "SELECT public.video_source_unposted_cleanup(interval '29 days') r");
  const bad2 = await cron(x, "SELECT public.video_source_unposted_cleanup(interval '30 days', 0) r");
  t("C5", "new", "the cleanup refuses less than 30 days, and a batch below 1",
    /below the 30 days the Owner set/.test(bad1.error ?? "") && /_batch must be between 1 and 1000/.test(bad2.error ?? ""),
    `${(bad1.error ?? "accepted").slice(0, 70)} · ${(bad2.error ?? "accepted").slice(0, 70)}`);

  // ── B · the 5-minute housekeeping runs ──
  const hk = await cron(x, "SELECT public.video_source_housekeeping() r");
  const own3 = await x.as(J.d3.owner, "select status, video_id from public.video_sources where id = $1", [J.d3.sid]);
  t("C6", "new", "finished 3 days ago, not posted → the row SURVIVES today's 2-day expiry; its owner still reads status + video_id",
    (await src(x, J.d3)) === "done" && (await vst(x, J.d3)) === "ready" && own3.rows?.[0]?.status === "done" && own3.rows?.[0]?.video_id === J.d3.vid,
    `source ${await src(x, J.d3)}, video ${await vst(x, J.d3)}, owner reads ${own3.rows?.length ?? own3.error} row(s)`);
  t("C7", "new", "finished 29 days ago, not posted → still kept, video still ready, nothing queued",
    (await src(x, J.d29)) === "done" && (await vst(x, J.d29)) === "ready" && (await queued(x, J.d29)).length === 0,
    `source ${await src(x, J.d29)}, video ${await vst(x, J.d29)}`);
  t("C8", "new", "job ended 31 days ago but the video became ready 5 days ago → kept (30 days run from the later time)",
    ran && (await src(x, J.d31late)) === "done" && (await vst(x, J.d31late)) === "ready" && (await queued(x, J.d31late)).length === 0,
    `source ${await src(x, J.d31late)}, video ${await vst(x, J.d31late)}${ran ? "" : " (and no cleanup to judge it)"}`);
  t("G0", "guard", "another member's fresh finished video is untouched by whatever ran (cleanup, housekeeping)",
    (await src(x, J.fresh)) === "done" && (await vst(x, J.fresh)) === "ready" && (await queued(x, J.fresh)).length === 0,
    `source ${await src(x, J.fresh)}, video ${await vst(x, J.fresh)}`);
  t("G1", "guard", "POSTED (post_videos) and ended 3 days ago → the row is released and purged; the video and its post stay; nothing queued",
    (await src(x, J.posted3)) === "gone" && (await vst(x, J.posted3)) === "ready" && (await queued(x, J.posted3)).length === 0
      && (await x.one("SELECT count(*)::int n FROM public.post_videos WHERE video_id = $1", [J.posted3.vid])).n === 1,
    `source ${await src(x, J.posted3)}, video ${await vst(x, J.posted3)}, queued ${(await queued(x, J.posted3)).length}`);
  t("G2", "guard", "linked to an AD (ad_videos) and ended 3 days ago → released and purged; the ad keeps its video",
    (await src(x, J.ad3)) === "gone" && (await vst(x, J.ad3)) === "ready" && (await queued(x, J.ad3)).length === 0
      && (await x.one("SELECT count(*)::int n FROM public.ad_videos WHERE video_id = $1", [J.ad3.vid])).n === 1,
    `source ${await src(x, J.ad3)}, video ${await vst(x, J.ad3)}`);
  t("G3", "guard", "DELETED by its owner (video_delete) and ended 3 days ago → the row is released and purged; the video waits its own 30 days",
    (await src(x, J.del3)) === "gone" && (await vst(x, J.del3)) === "deleted" && (await queued(x, J.del3)).length === 0,
    `source ${await src(x, J.del3)}, video ${await vst(x, J.del3)}`);
  t("G4", "guard", "posted, but ended only 1 day ago → the row stays (the 2-day rule is unchanged)",
    (await src(x, J.posted1)) === "done", `source ${await src(x, J.posted1)}`);
  t("G5", "guard", "posted 31 days ago → released and purged by housekeeping; the video is not touched",
    (await src(x, J.posted31)) === "gone" && (await vst(x, J.posted31)) === "ready", `source ${await src(x, J.posted31)}, video ${await vst(x, J.posted31)}`);
  t("G6", "guard", "a FAILED and a CANCELLED job, 3 days old → purged as before (they made no video)",
    (await src(x, { sid: sFail })) === "gone" && (await src(x, { sid: sCan })) === "gone", `failed ${await src(x, { sid: sFail })}, cancelled ${await src(x, { sid: sCan })}; housekeeping ${JSON.stringify(hk.r ?? hk.error)}`);

  // ── C · the hourly video_housekeeping (20261005_0005, untouched) ──
  await cron(x, "SELECT public.video_housekeeping() r");
  const qd = await queued(x, J.del31);
  t("G7", "guard", "the video deleted 31 days ago is purged by video_housekeeping; its files are queued exactly once",
    (await vst(x, J.del31)) === "gone" && (await src(x, J.del31)) === "gone" && qd.length === 1, `video ${await vst(x, J.del31)}, queued ${qd.length}`);

  // ── D · an account is deleted (auth.users → profiles → videos / video_sources, by cascade) ──
  const qBefore = (await x.one("SELECT count(*)::int n FROM public.video_r2_purge_queue")).n;
  await x.su("DELETE FROM auth.users WHERE id = $1", [J.gone.owner]);
  const qGone = await queued(x, J.gone), qAfter = (await x.one("SELECT count(*)::int n FROM public.video_r2_purge_queue")).n;
  const leftRows = await x.one("SELECT (SELECT count(*) FROM public.video_sources WHERE owner_id = $1)::int s, (SELECT count(*) FROM public.videos WHERE owner_id = $1)::int v", [J.gone.owner]);
  t("C10", "new", "DELETED ACCOUNT: its source rows and videos cascade away, and the converted video's files are queued (once; nothing else is)",
    leftRows.s === 0 && leftRows.v === 0 && qGone.length === 1 && qGone[0].prefix === `video/${J.gone.owner}/${J.gone.vid}/` && qAfter - qBefore === 1,
    `rows left ${leftRows.s} source / ${leftRows.v} video; queued for the converted video ${qGone.length}; queue grew by ${qAfter - qBefore}`);
  const qDev = devVid ? (await x.su("SELECT 1 FROM public.video_r2_purge_queue WHERE video_id = $1", [devVid])).length : -1;
  res.push({ id: "I1", kind: "info", name: `the same account's DEVICE-path video (no source row) is queued ${qDev} time(s) — outside this unit (20261005_0005's account path), stated in the migration header`, pass: true, detail: "" });

  // ── E · who can see and stop what ──
  const stranger = J.d29.owner, mine = J.fresh;
  const sees = await x.as(stranger, "select status from public.video_sources where id = $1", [mine.sid]);
  const ownerSees = await x.as(mine.owner, "select status, video_id from public.video_sources where id = $1", [mine.sid]);
  const canc = await x.as(stranger, "select public.video_source_cancel($1) r", [mine.sid]);
  const del = await x.as(stranger, "select public.video_delete($1) r", [mine.vid]);
  const tok = await x.as(mine.owner, "select claim_token from public.video_sources where id = $1", [mine.sid]);
  const anon = await x.as(null, "select status from public.video_sources", [], "anon");
  const ownCancel = await x.as(mine.owner, "select public.video_source_cancel($1) r", [mine.sid]);
  t("G8", "guard", "CROSS-MEMBER: a stranger reads nothing of a kept row, cannot cancel it (VID-SRC-004) or delete its video (VID-DEL-001); anon reads nothing; the owner reads it, never the claim token; the owner's cancel of a finished job answers 'done' and changes nothing",
    sees.rows?.length === 0 && ownerSees.rows?.[0]?.status === "done" && ownerSees.rows?.[0]?.video_id === mine.vid
      && /VID-SRC-004/.test(canc.error ?? "") && /VID-DEL-001/.test(del.error ?? "") && /permission denied/.test(tok.error ?? "")
      && /permission denied/.test(anon.error ?? "") && ownCancel.rows?.[0]?.r === "done" && (await src(x, mine)) === "done" && (await vst(x, mine)) === "ready",
    `stranger rows ${sees.rows?.length ?? sees.error}; cancel ${(canc.error ?? "accepted").slice(0, 12)}; delete ${(del.error ?? "accepted").slice(0, 12)}; anon ${(anon.error ?? "read").slice(0, 17)}`);
  const e = [];
  for (const [role, uid] of [["authenticated", stranger], ["anon", null]]) {
    for (const sql of ["select public.video_source_unposted_cleanup()", "select public.video_source_housekeeping()",
                       "select count(*) from public.video_r2_purge_queue", "delete from public.video_sources"]) {
      const r = await x.as(uid, sql, [], role);
      e.push(/permission denied/.test(r.error ?? "") ? "denied" : (r.error ?? "ALLOWED").slice(0, 60));
    }
  }
  t("C11", "new", "no API role can run the cleanup or the housekeeping, read the purge queue, or delete a source row (authenticated and anon: permission denied ×8)",
    e.every((v) => v === "denied"), [...new Set(e)].join(" · "));
  return res;
}

function show(res, phase) {
  for (const r of res) say(`  ${r.kind === "info" ? "INFO" : r.pass ? "PASS" : "FAIL"}  ${r.id.padEnd(3)} ${r.kind === "new" ? "[new]  " : r.kind === "guard" ? "[guard]" : "       "} ${r.name}${r.detail ? `\n               → ${r.detail}` : ""}`);
  const n = res.filter((r) => r.kind === "new"), g = res.filter((r) => r.kind === "guard");
  const red = n.filter((r) => !r.pass).length, gGreen = g.filter((r) => r.pass).length;
  if (phase === "before") {
    const ok = red === n.length && gGreen === g.length;
    say(`  ── BEFORE: ${red}/${n.length} [new] cases RED (all must be), ${gGreen}/${g.length} [guard] cases green → ${ok ? "as it must be: the tests can fail" : "NOT AS EXPECTED"}`);
    return ok;
  }
  const ok = red === 0 && gGreen === g.length;
  say(`  ── AFTER: ${n.length - red}/${n.length} [new] cases GREEN, ${gGreen}/${g.length} [guard] cases green → ${ok ? "ALL GREEN" : "NOT GREEN"}`);
  return ok;
}

// ── run ─────────────────────────────────────────────────────────────────────
let good = true;
const check = (c, msg, detail = "") => { say(`  ${c ? "PASS" : "FAIL"}  ${msg}${detail ? `\n               → ${detail}` : ""}`); if (!c) good = false; };
say(`VID-1 · 20261013_0006 converter finished-row retention — PGlite harness`);
say(`engine: ${(await new PGlite().query("select version() v")).rows[0].v.split(" on ")[0]}`);
say(`files (sha256, first 16 hex, LF): migration ${sha(SQL.ret)} · rollback ${sha(SQL.rb)} · probe ${sha(SQL.probe)}`);

for (const lane of ["staging", "production"]) {
  say(`\n════════ LANE SHAPE: ${lane} ════════`);
  say(`\n── ${lane} · BEFORE 20261013_0006 (the lane as it is: …0005, 0007 mark, 20261012_0001, 20261012_0002) ──`);
  let x = await build(lane);
  good = show(await cases(x), "before") && good;
  let p = await x.file(SQL.probe);
  check(!p.ok && /PROBE FAIL VID-RET:/.test(p.error) && ["R1", "R2", "R3", "R4"].every((r) => p.error.includes(`\n  ${r} `)), "the PROBE is RED before the apply (R1, R2, R3, R4)",
    (p.error ?? "it passed").split("\n").slice(1).map((l) => l.trim().slice(0, 96)).join(" ¦ "));

  say(`\n── ${lane} · AFTER 20261013_0006 ──`);
  x = await build(lane, { retention: true });
  say(`  apply: ${x.applyNotice}`);
  good = show(await cases(x), "after") && good;
  p = await x.file(SQL.probe);
  check(p.ok, "the PROBE is GREEN after the apply", p.ok ? p.notices.join(" ").slice(0, 330) : p.error);

  say(`\n── ${lane} · cron and grants under this lane's default privileges ──`);
  const c1 = await x.su("SELECT jobname, schedule, command, active FROM cron.job WHERE jobname LIKE 'video%' ORDER BY jobname");
  const others = await x.one("SELECT count(*)::int n, md5(string_agg(jobname || '|' || schedule || '|' || command || '|' || active, E'\\n' ORDER BY jobname)) m FROM cron.job WHERE jobname <> 'video-source-unposted-cleanup'");
  check(c1.length === 3 && c1.some((j) => j.jobname === "video-source-unposted-cleanup" && j.schedule === "47 * * * *" && j.command === "SELECT public.video_source_unposted_cleanup();" && j.active)
    && others.n === x.cronBefore.n && others.m === x.cronBefore.m,
    `one new job, hourly, running only the function; the lane's other ${x.cronBefore.n} job(s) are byte-identical`, c1.map((j) => `${j.jobname} [${j.schedule}]`).join(" · "));
  check(!c1.some((j) => /net\.http|vault|Bearer|eyJ/i.test(j.command)) && !c1.some((j) => /second/i.test(j.schedule)), "no HTTP, vault read or credential in the command; never more often than once a minute");
  const acl = await x.su(`SELECT p.proname, coalesce((SELECT string_agg(CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END, ',' ORDER BY a.grantee)
       FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.privilege_type = 'EXECUTE'), '') who
     FROM pg_proc p WHERE p.proname IN ('video_source_unposted_cleanup', 'tg_video_sources_owner_gone', 'video_source_housekeeping') ORDER BY 1`);
  check(acl.length === 3 && acl.every((a) => !/PUBLIC|anon|authenticated/.test(a.who)), "EXECUTE on the three functions: never PUBLIC, anon or authenticated", acl.map((a) => `${a.proname}: ${a.who}`).join(" · "));
  const hkNow = await x.one("SELECT proacl::text acl FROM pg_proc WHERE oid = 'public.video_source_housekeeping(integer)'::regprocedure");
  check(hkNow.acl === x.hkBefore.acl, "the housekeeping function's ACL is what 20261012_0002 left (CREATE OR REPLACE kept it)", hkNow.acl);

  say(`\n── ${lane} · PROBE mutants (each must turn the PROBE red; each is undone) ──`);
  const mutants = [
    ["R1", "housekeeping put back to the 20261012_0002 body", hk0002, null],
    ["R2", "cleanup granted to authenticated", "GRANT EXECUTE ON FUNCTION public.video_source_unposted_cleanup(interval, integer) TO authenticated;", "REVOKE EXECUTE ON FUNCTION public.video_source_unposted_cleanup(interval, integer) FROM authenticated;"],
    ["R3", "the job rescheduled to every minute", "UPDATE cron.job SET schedule = '* * * * *' WHERE jobname = 'video-source-unposted-cleanup';", "UPDATE cron.job SET schedule = '47 * * * *' WHERE jobname = 'video-source-unposted-cleanup';"],
    ["R3", "a second job running the cleanup", "SELECT cron.schedule('twin', '5 * * * *', 'SELECT public.video_source_unposted_cleanup();');", "SELECT cron.unschedule('twin');"],
    ["R4", "the owner-gone trigger disabled", "ALTER TABLE public.video_sources DISABLE TRIGGER tg_video_sources_owner_gone;", "ALTER TABLE public.video_sources ENABLE TRIGGER tg_video_sources_owner_gone;"],
    ["R5", "the purge queue readable by authenticated", "GRANT SELECT ON public.video_r2_purge_queue TO authenticated;", "REVOKE SELECT ON public.video_r2_purge_queue FROM authenticated;"],
    ["R6", "an unposted finished video 32 days old (the cleanup has not run)", async () => age(x, await finished(x, await member(x)), 32), "SELECT public.video_source_unposted_cleanup();"],
  ];
  for (const [tag, what, doIt, undo] of mutants) {
    if (typeof doIt === "function") await doIt(); else await x.db.exec(doIt);
    p = await x.file(SQL.probe);
    check(!p.ok && p.error.includes(`\n  ${tag} `), `mutant: ${what} → PROBE red (${tag})`, p.ok ? "it PASSED" : p.error.split("\n").find((l) => l.startsWith(`  ${tag} `))?.trim().slice(0, 110));
    if (undo) await x.db.exec(undo); else { const r = await x.file(SQL.ret); if (!r.ok) throw new Error("re-apply after mutant: " + r.error); }
  }
  p = await x.file(SQL.probe);
  check(p.ok, "every mutant undone → the PROBE is green again", p.ok ? "" : p.error);

  say(`\n── ${lane} · lane guard, rollback (exact), re-apply twice ──`);
  let r = await x.file(SQL.ret, null);
  check(!r.ok && /APPLY REFUSED — p32.lane is not asserted/.test(r.error), "no lane asserted → the apply is refused");
  r = await x.file(SQL.rb, null);
  check(!r.ok && /APPLY REFUSED/.test(r.error), "no lane asserted → the rollback is refused");
  r = await x.file(SQL.rb);
  const after = await x.one(`SELECT (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.video_source_housekeeping(integer)'::regprocedure) m,
      (SELECT proacl::text FROM pg_proc WHERE oid = 'public.video_source_housekeeping(integer)'::regprocedure) acl,
      to_regprocedure('public.video_source_unposted_cleanup(interval,integer)') IS NULL AND to_regprocedure('public.tg_video_sources_owner_gone()') IS NULL gone,
      (SELECT count(*)::int FROM pg_trigger WHERE tgrelid = 'public.video_sources'::regclass AND tgname = 'tg_video_sources_owner_gone') trg,
      (SELECT count(*)::int FROM cron.job) jobs,
      (SELECT md5(string_agg(jobname || '|' || schedule || '|' || command || '|' || active, E'\\n' ORDER BY jobname)) FROM cron.job) cm`);
  check(r.ok && after.m === x.hkBefore.m && after.acl === x.hkBefore.acl && after.gone && after.trg === 0 && after.jobs === x.cronBefore.n && after.cm === x.cronBefore.m,
    "rollback: housekeeping body md5 and ACL equal the pre-0006 ones; the cleanup, the trigger, its function and the job are gone; cron.job is byte-identical to before",
    r.ok ? `${r.notices.join(" | ").slice(0, 250)}` : r.error);
  p = await x.file(SQL.probe);
  check(!p.ok && ["R1", "R2", "R3", "R4"].every((t) => p.error.includes(`\n  ${t} `)), "after the rollback the PROBE is red again (R1–R4)");
  r = await x.file(SQL.rb);
  check(!r.ok && /VID-RET-RB-PRE-002/.test(r.error), "a second rollback is refused (VID-RET-RB-PRE-002) — it never overwrites a body that is not 0006's");
  r = await x.file(SQL.ret); const r2 = await x.file(SQL.ret);
  const twice = await x.one(`SELECT (SELECT count(*)::int FROM cron.job WHERE jobname = 'video-source-unposted-cleanup') j,
      (SELECT count(*)::int FROM pg_trigger WHERE tgrelid = 'public.video_sources'::regclass AND tgname = 'tg_video_sources_owner_gone') t, (SELECT count(*)::int FROM cron.job) n`);
  p = await x.file(SQL.probe);
  check(r.ok && r2.ok && twice.j === 1 && twice.t === 1 && twice.n === x.cronBefore.n + 1 && p.ok, "re-apply, then apply AGAIN: both succeed; still one job, one trigger; the PROBE is green (re-runnable)",
    r2.ok ? "" : r2.error);
}

say(`\n════════ LANE SHAPE: production-today (no video objects at all) ════════`);
{
  const x = await build("production", { video: false });
  const before = await x.one("SELECT count(*)::int n FROM cron.job");
  const r = await x.file(SQL.ret);
  const st = await x.one("SELECT to_regprocedure('public.video_source_unposted_cleanup(interval,integer)') IS NULL none, (SELECT count(*)::int FROM cron.job) n");
  check(!r.ok && /VID-RET-PRE-001/.test(r.error) && st.none && st.n === before.n, "20261013_0006 refuses (VID-RET-PRE-001) and changes nothing — 18 cron jobs before and after",
    (r.error ?? "it applied").slice(0, 150));
  const p = await x.file(SQL.probe);
  check(!p.ok && /PROBE FAIL VID-RET: the converter queue is not on this lane/.test(p.error), "the PROBE says so too (it does not pass on a lane without the queue)");
}

say(`\n${good ? "RESULT: OK — red before where it must be, green after, on both lane shapes" : "RESULT: NOT OK"}`);
process.exit(good ? 0 : 1);
