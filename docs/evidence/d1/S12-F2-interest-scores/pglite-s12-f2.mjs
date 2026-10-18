// ═══════════════════════════════════════════════════════════════════════════
// S12-F2 · 20261018_0002 — behaviour proof on PGlite (in-memory Postgres; version in the output).
//
// NOT a live database. A production-shaped fixture of the objects the
// migration reads (columns, constraints and counter triggers as in the live
// catalogue snapshot of 2026-10-17, _control/forensic/…): posts (categories
// text[] ≤ 5, likes_count / shares_count / viewer_count), post_reactions,
// post_comments, post_shares, follows, feed_events, auth.uid(),
// account_is_live(), can_view_post(); then the REAL S12-F1 migration
// (20261018_0001) is applied, then 20261018_0002. LOOSE default privileges
// (every new table granted to anon and authenticated; functions executable by
// PUBLIC, as Postgres defaults) so the migration's REVOKEs are what is proved.
// pg_cron is stubbed with BOTH cron.schedule overloads ((text,text) and
// (text,text,text)) and both cron.unschedule overloads, so a to_regproc-style
// precheck would fail here exactly as it did on staging for F1.
//
// Sequence: PROBE before apply FAILS → lane guard refuses → apply → PROBE
// PASSES → re-apply refused → behaviour (catch-up, within minutes, settle lag,
// keyset ties, L8 flood, per-viewer cap, smoothing ranking, decay helper,
// orphan author, retention, cascades) → loosened copies each make the PROBE
// FAIL → ROLLBACK (F1 untouched) → PROBE fails again → rollback twice refused
// → rollback refused while a reader exists → re-apply → PROBE passes.
//
// Run:  PGLITE_MODULE=<abs path to @electric-sql/pglite/dist/index.js> \
//       node docs/evidence/d1/S12-F2-interest-scores/pglite-s12-f2.mjs
// ═══════════════════════════════════════════════════════════════════════════
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const F1 = read("supabase/migrations/20261018_0001_s12_f1_feed_signals.sql");
const MIG = read("supabase/migrations/20261018_0002_s12_f2_interest_scores.sql");
const RB = read("supabase/rollback/20261018_0002_s12_f2_interest_scores_ROLLBACK.sql");
const PROBE = read("supabase/migrations/PROBE_20261018_0002_s12_f2_interest_scores.sql");

const U = (n) => `00000000-0000-4000-8000-0000000000${n}`;
const [A, B, C, D, E, F, GHOST] = ["0a", "0b", "0c", "0d", "0e", "0f", "99"].map(U);
const PST = (n) => `10000000-0000-4000-8000-0000000000${n}`;
const P = PST("01");

const PLATFORM = `
CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE service_role NOLOGIN;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $function$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$function$;
CREATE OR REPLACE FUNCTION public.account_is_live() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
  select exists (select 1 from auth.users u where u.id = auth.uid());
$function$;
CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE);
CREATE TABLE public.friendships (requester_id uuid, addressee_id uuid, status text);
CREATE OR REPLACE FUNCTION public.are_friends(_user_a uuid, _user_b uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT EXISTS (SELECT 1 FROM public.friendships WHERE status = 'accepted'
    AND ((requester_id = _user_a AND addressee_id = _user_b) OR (requester_id = _user_b AND addressee_id = _user_a)));
$function$;
CREATE OR REPLACE FUNCTION public.can_view_post(_viewer_id uuid, _post_user_id uuid, _privacy text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT CASE WHEN _viewer_id = _post_user_id THEN true WHEN _privacy = 'public' THEN true
    WHEN _privacy = 'friends' AND _viewer_id IS NOT NULL THEN public.are_friends(_viewer_id, _post_user_id) ELSE false END;
$function$;
CREATE TABLE public.posts (id uuid PRIMARY KEY, user_id uuid NOT NULL, privacy text NOT NULL DEFAULT 'public'
  CHECK (privacy = ANY (ARRAY['private','friends','public'])), created_at timestamptz NOT NULL DEFAULT now(),
  categories text[] NOT NULL DEFAULT '{}'::text[] CHECK (cardinality(categories) <= 5),
  likes_count integer NOT NULL DEFAULT 0, comments_count integer NOT NULL DEFAULT 0, shares_count integer NOT NULL DEFAULT 0,
  viewer_count integer NOT NULL DEFAULT 0);
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view posts based on privacy" ON public.posts FOR SELECT USING (public.can_view_post((SELECT auth.uid()), user_id, privacy));
CREATE TABLE public.post_reactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL, reaction_type text NOT NULL DEFAULT 'like', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (post_id, user_id));
CREATE FUNCTION public.update_post_likes_count() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN IF TG_OP = 'INSERT' THEN UPDATE public.posts SET likes_count = likes_count + 1 WHERE id = NEW.post_id; RETURN NEW;
ELSE UPDATE public.posts SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = OLD.post_id; RETURN OLD; END IF; END $f$;
CREATE TRIGGER trg_update_post_likes_count AFTER INSERT OR DELETE ON public.post_reactions FOR EACH ROW EXECUTE FUNCTION public.update_post_likes_count();
CREATE TABLE public.post_comments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL, content text NOT NULL DEFAULT 'x', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.post_shares (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (post_id, user_id));
CREATE FUNCTION public.update_post_shares_count() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN IF TG_OP = 'INSERT' THEN UPDATE public.posts SET shares_count = shares_count + 1 WHERE id = NEW.post_id; RETURN NEW;
ELSE UPDATE public.posts SET shares_count = GREATEST(shares_count - 1, 0) WHERE id = OLD.post_id; RETURN OLD; END IF; END $f$;
CREATE TRIGGER trg_update_post_shares_count AFTER INSERT OR DELETE ON public.post_shares FOR EACH ROW EXECUTE FUNCTION public.update_post_shares_count();
CREATE TABLE public.follows (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), follower_id uuid NOT NULL, following_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (follower_id, following_id), CHECK (follower_id <> following_id));
CREATE TABLE public.feed_events (id uuid PRIMARY KEY, user_id uuid NOT NULL, post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  author_id uuid NOT NULL, event_type text NOT NULL CHECK (event_type = ANY (ARRAY['view','like','skip','comment','share','click'])),
  dwell_ms integer, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX idx_feed_events_created ON public.feed_events USING btree (created_at);
CREATE FUNCTION public.tg_feed_events_viewer_count() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN IF NEW.event_type NOT IN ('view','skip') THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.feed_events fe WHERE fe.post_id = NEW.post_id AND fe.user_id = NEW.user_id
             AND fe.event_type IN ('view','skip') AND fe.id <> NEW.id) THEN RETURN NEW; END IF;
  UPDATE public.posts SET viewer_count = viewer_count + 1 WHERE id = NEW.post_id; RETURN NEW; END $f$;
CREATE TRIGGER trg_feed_events_viewer_count AFTER INSERT ON public.feed_events FOR EACH ROW EXECUTE FUNCTION public.tg_feed_events_viewer_count();
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text);
CREATE FUNCTION cron.schedule(_schedule text, _command text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job (schedule, command) VALUES (_schedule, _command) RETURNING jobid $$;
CREATE FUNCTION cron.schedule(_name text, _schedule text, _command text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (_name, _schedule, _command)
  ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(_jobid bigint) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobid = _jobid RETURNING true $$;
CREATE FUNCTION cron.unschedule(_name text) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobname = _name RETURNING true $$;
INSERT INTO auth.users VALUES ('${A}'), ('${B}'), ('${C}'), ('${D}'), ('${E}'), ('${F}'), ('${U("1a")}'), ('${U("1b")}');  -- 1a, 1b: idle members (a real lane has many)
INSERT INTO public.profiles VALUES ('${A}'), ('${B}'), ('${C}'), ('${D}'), ('${E}'), ('${F}');
INSERT INTO public.posts (id, user_id, privacy, categories, created_at) VALUES
  ('${P}', '${C}', 'public', ARRAY['street','wildlife'], now()),
  ('${PST("02")}', '${D}', 'private', ARRAY['portrait'], now() - interval '1 minute'),
  ('${PST("03")}', '${C}', 'public', ARRAY['street'], now() - interval '2 minutes'),
  ('${PST("04")}', '${C}', 'public', ARRAY['street'], now() - interval '3 minutes'),
  ('${PST("05")}', '${C}', 'public', ARRAY['street'], now() - interval '4 minutes'),
  ('${PST("06")}', '${C}', 'public', ARRAY['street'], now() - interval '5 minutes'),
  ('${PST("07")}', '${C}', 'public', ARRAY['street'], now() - interval '6 minutes'),
  ('${PST("08")}', '${GHOST}', 'public', ARRAY['macro'], now() - interval '7 minutes'),
  ('${PST("09")}', '${E}', 'public', ARRAY['landscape'], now() - interval '8 minutes'),
  ('${PST("10")}', '${F}', 'public', ARRAY['landscape'], now() - interval '9 minutes');
`;

const lines = [];
let fails = 0;
const ok = (cond, msg, detail = "") => {
  lines.push(`${cond ? "PASS" : "FAIL"} · ${msg}${detail ? `  [${String(detail).split("\n").join(" | ").slice(0, 600)}]` : ""}`);
  if (!cond) fails++;
};
const db = await PGlite.create();
const run = async (sql) => { try { await db.exec(sql); return null; } catch (e) { await db.exec("ROLLBACK").catch(() => {}); return e.message; } };
const q1 = async (sql) => (await db.query(sql)).rows[0];
const as = async (uid, sql) => {
  await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${uid}', false);`);
  try { return await db.query(sql); } finally { await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);"); }
};
const refresh = async (b = null) => (await q1(`SELECT public.feed_scores_refresh(${b === null ? "NULL" : b}) AS j`)).j;
const aff = async (u, au) => (await q1(`SELECT score FROM public.feed_viewer_author_affinity WHERE user_id = '${u}' AND author_id = '${au}'`))?.score ?? null;

await db.exec(PLATFORM);
await db.exec(`SET p32.lane = 'staging'`);
let e = await run(F1); ok(!e, "prerequisite: the real S12-F1 migration (20261018_0001) applies on the fixture", e);

// 1 · fail-first
e = await run(PROBE);
ok(!!e && e.includes("G1") && e.includes("not applied"), "PROBE FAILS before the migration (G1: tables / functions do not exist)", e);

// 2 · lane guard
await db.exec(`RESET p32.lane`);
e = await run(MIG); ok(!!e && e.includes("APPLY REFUSED"), "lane guard: p32.lane unset → refused", e);
e = await run(PROBE); ok(!!e && e.includes("PROBE REFUSED"), "PROBE lane guard: p32.lane unset → refused", e);
await db.exec(`SET p32.lane = 'staging'`);

// 3 · apply, PROBE passes
e = await run(MIG); ok(!e, "20261018_0002 applies with p32.lane = 'staging' (PRE + POST pass; cron.schedule has two overloads here)", e);
let notice = "";
db.onNotice?.((n) => { if (String(n.message).includes("PROBE PASS")) notice = n.message; });
e = await run(PROBE); ok(!e, "PROBE PASSES after the migration (static, no client path, bounded, directions, exact deltas, L8, smoothing, idempotent, cross-member)", e ?? notice);
e = await run(MIG); ok(!!e && e.includes("PRE-001"), "re-apply refused (PRE-001)", e);
let r = await q1(`SELECT count(*)::int AS n FROM public.feed_viewer_author_affinity`);
ok(r.n === 0, "the PROBE left nothing behind (ROLLBACK): 0 closeness rows", JSON.stringify(r));

// 4 · behaviour beyond the PROBE
// 4a · catch-up from the 14-day backfill watermark: 6 h per run → 56 runs; then caught up
let runs = 0, j;
for (; runs < 70; runs++) {
  j = await refresh();
  const w = await q1(`SELECT bool_and(wm_at >= now() - interval '121 seconds') AS done FROM public.feed_score_watermarks`);
  if (w.done) { runs++; break; }
}
ok(runs >= 55 && runs <= 57, `catch-up: the 14-day backfill is read in ${runs} runs of ≤ 6 h each (≈ ${(runs * 3 / 60).toFixed(1)} h at the 3-minute cadence)`, JSON.stringify(j));
// 4b · settle lag, then within minutes: a like now is NOT read (120 s settle), and IS once it is older
await db.exec(`INSERT INTO public.post_reactions (post_id, user_id) VALUES ('${P}', '${A}')`);
j = await refresh();
ok(j.rows.likes === 0 && (await aff(A, C)) === null, "a like younger than settle_seconds (120 s) is not read yet (commit-order safety)", JSON.stringify(j));
// simulate time passing: shift the like 3 minutes back AND keep it ahead of the watermark (wm is now − 120 s)
await db.exec(`UPDATE public.post_reactions SET created_at = now() - interval '119 seconds' WHERE user_id = '${A}' AND post_id = '${P}';
  UPDATE public.feed_score_config SET value = 60 WHERE key = 'settle_seconds'`);
j = await refresh();
let a1 = await aff(A, C);
ok(j.rows.likes === 1 && a1 > 2.99 && a1 <= 3, "the next run (minutes later) reads it: A→C closeness = like weight 3, decayed by seconds", `${a1} ${JSON.stringify(j)}`);
r = await q1(`SELECT jsonb_object_agg(category, round(score::numeric, 3)) AS c FROM public.feed_viewer_category_interest WHERE user_id = '${A}'`);
ok(Math.abs(r.c.street - 1.5) < 0.01 && Math.abs(r.c.wildlife - 1.5) < 0.01, "category interest follows the like, split over the post's 2 categories (1.5 each, not 3 each)", JSON.stringify(r));
await db.exec(`UPDATE public.feed_score_config SET value = 0 WHERE key = 'settle_seconds'`);
// 4c · idempotent: running again reads nothing and changes nothing
const snap = async () => JSON.stringify((await db.query(`SELECT user_id, author_id, score, updated_at FROM public.feed_viewer_author_affinity ORDER BY 1, 2`)).rows)
  + JSON.stringify((await db.query(`SELECT * FROM public.feed_viewer_category_interest ORDER BY 1, 2`)).rows)
  + JSON.stringify((await db.query(`SELECT * FROM public.feed_post_quality ORDER BY 1`)).rows);
let s0 = await snap(); j = await refresh(); j = await refresh(); let s1 = await snap();
ok(s0 === s1 && Object.values(j.rows).every((n) => n === 0), "two more runs with nothing new: 0 rows read, every score row byte-identical", JSON.stringify(j));
// 4d · keyset ties: 5 likes with the SAME created_at, batch 2 → read across 3 runs, each exactly once
await db.exec(`INSERT INTO public.post_reactions (post_id, user_id, created_at)
  SELECT p, '${B}', now() FROM unnest(ARRAY['${PST("03")}','${PST("04")}','${PST("05")}','${PST("06")}','${PST("07")}']::uuid[]) p`);
const tie = [];
for (let i = 0; i < 4; i++) tie.push((await refresh(2)).rows.likes);
let b1 = await aff(B, C);
ok(tie.join(",") === "2,2,1,0", "keyset ties: 5 likes stamped identically, batch 2 → 2,2,1,0 rows per run (none lost, none twice)", tie.join(","));
ok(Math.abs(b1 - 15) < 0.01, "…and B→C closeness = 5 likes × 3 = 15 (each run's gain under the per-run cap of 12)", b1);
// 4e · L8: 400 share clicks by D on P in one go (F1 rate bound records 300) → ONE unit for D's closeness, ONE share-clicker in P's quality
await db.exec(`UPDATE public.feed_score_config SET value = 1000 WHERE key = 'viewer_events_cap'`);
await as(D, `INSERT INTO public.feed_signal_events (id, user_id, kind, post_id, subject_id, value)
  SELECT gen_random_uuid(), '${D}', 'share_click', '${P}', '${C}', 0 FROM generate_series(1, 400)`);
j = await refresh();
let d1 = await aff(D, C);
r = await q1(`SELECT share_clicks FROM public.feed_post_signals WHERE user_id = '${D}' AND post_id = '${P}'`);
let pq = await q1(`SELECT score, engagement, views FROM public.feed_post_quality WHERE post_id = '${P}'`);
ok(j.rows.signals === 300 && r.share_clicks === 300 && Math.abs(d1 - 1) < 0.001,
  "L8: 300 recorded share clicks by one member → D→C closeness +1 (one unit), not +300", `${d1} ${JSON.stringify(j)} ${JSON.stringify(r)}`);
ok(Math.abs(pq.engagement - (1 * 1 + 0.5 * 1)) < 1e-9, "L8: P's quality counts ONE share-clicker for those 300 clicks (engagement = 1 like + 0.5 share-clicker)", JSON.stringify(pq));
await db.exec(`UPDATE public.feed_score_config SET value = 300 WHERE key = 'viewer_events_cap'`);
// 4f · per-viewer cap per run: E sends 400 dwell rows across 400 posts? — one post suffices: cap counts ACTIONS read, not units
await db.exec(`UPDATE public.feed_score_config SET value = 2 WHERE key = 'viewer_events_cap'`);
await db.exec(`INSERT INTO public.post_reactions (post_id, user_id, created_at) VALUES
  ('${PST("03")}', '${E}', now()), ('${PST("04")}', '${E}', now()), ('${PST("05")}', '${E}', now())`);
j = await refresh();
let e1 = await aff(E, C);
ok(j.rows.likes === 3 && Math.abs(e1 - 6) < 0.01, "per-viewer cap (set to 2 here): 3 likes read in one run, only 2 count (E→C = 6)", `${e1} ${JSON.stringify(j)}`);
await db.exec(`UPDATE public.feed_score_config SET value = 300 WHERE key = 'viewer_events_cap'`);
// 4g · negative signals: B hides P (strong), A skips P (weak)
await as(B, `INSERT INTO public.feed_hidden_posts (user_id, post_id) VALUES ('${B}', '${P}')`);
await as(A, `INSERT INTO public.feed_signal_events (id, user_id, kind, post_id, subject_id, value) VALUES (gen_random_uuid(), '${A}', 'skip', '${P}', '${C}', 0)`);
const bBefore = await aff(B, C), aBefore = await aff(A, C);
j = await refresh();
const bAfter = await aff(B, C), aAfter = await aff(A, C);
ok(bAfter < bBefore - 14.9 && aAfter < aBefore && aAfter > aBefore - 0.6, "hide: B→C drops by 15 (strong); skip: A→C drops by 0.5 (weak)", `B ${bBefore}→${bAfter}  A ${aBefore}→${aAfter}`);
pq = await q1(`SELECT engagement FROM public.feed_post_quality WHERE post_id = '${P}'`);
ok(Math.abs(pq.engagement - 0) < 1e-9, "a hider lowers P's quality engagement (1 + 0.5 − 5 → floored at 0)", JSON.stringify(pq));
// 4h · smoothing ranks a steady post above a lucky low-view post
await db.exec(`UPDATE public.posts SET viewer_count = 1 WHERE id = '${PST("09")}'; UPDATE public.posts SET viewer_count = 1000, likes_count = 100 WHERE id = '${PST("10")}';
  INSERT INTO public.post_reactions (post_id, user_id, created_at) VALUES ('${PST("09")}', '${A}', now());
  INSERT INTO public.feed_events (id, user_id, post_id, author_id, event_type, created_at) VALUES (gen_random_uuid(), '${A}', '${PST("10")}', '${F}', 'view', now())`);
j = await refresh();
r = (await db.query(`SELECT post_id, round(score::numeric, 4) AS s, views, engagement FROM public.feed_post_quality WHERE post_id IN ('${PST("09")}', '${PST("10")}') ORDER BY post_id`)).rows;
ok(r.length === 2 && Number(r[0].s) < Number(r[1].s) && Math.abs(Number(r[0].s) - 3.5 / 51) < 1e-3,
  "Bayesian smoothing: 1 like / 1 view scores 0.0686 (not 1.0) and ranks BELOW 101 likes / 1001 views (0.0976); a feed view alone queues a recompute", JSON.stringify(r));
// 4i · decay helper
r = await q1(`SELECT public.feed_score_decayed(10, now() - interval '14 days') AS h, public.feed_score_decayed(10, now() - interval '28 days') AS q`);
ok(Math.abs(r.h - 5) < 1e-9 && Math.abs(r.q - 2.5) < 1e-9, "decay: half-life 14 days (10 → 5 after 14 d, 2.5 after 28 d)", JSON.stringify(r));
// 4j · an orphan author (post whose author has no account) does not break a run
await db.exec(`INSERT INTO public.post_reactions (post_id, user_id, created_at) VALUES ('${PST("08")}', '${A}', now())`);
e = null; try { j = await refresh(); } catch (x) { e = x.message; }
ok(!e && j.rows.likes === 1 && (await aff(A, GHOST)) === null, "a like on a post by a deleted account is read and skipped (no FK error, run completes)", e ?? JSON.stringify(j));
// 4k · retention: a row untouched for 181 days is purged by the next run
await db.exec(`UPDATE public.feed_viewer_author_affinity SET updated_at = now() - interval '181 days' WHERE user_id = '${E}'`);
j = await refresh();
ok(j.purged_affinity === 1 && (await aff(E, C)) === null, "retention: closeness not updated for 181 days is purged (bounded per run)", JSON.stringify(j));
// 4l · cascades: deleting an account removes its scores (both directions); deleting a post removes its quality
await db.exec(`DELETE FROM auth.users WHERE id = '${D}'`);
r = await q1(`SELECT (SELECT count(*) FROM public.feed_viewer_author_affinity WHERE user_id = '${D}' OR author_id = '${D}')::int
  + (SELECT count(*) FROM public.feed_viewer_category_interest WHERE user_id = '${D}')::int AS n`);
ok(r.n === 0, "account deletion removes that member's scores (FK cascade)", JSON.stringify(r));
await db.exec(`DELETE FROM public.posts WHERE id = '${PST("10")}'`);
r = await q1(`SELECT count(*)::int AS n FROM public.feed_post_quality WHERE post_id = '${PST("10")}'`);
ok(r.n === 0, "post deletion removes its quality row (FK cascade)", JSON.stringify(r));
// 4m · members and anon read nothing directly, even their OWN rows
for (const who of [A, B]) {
  e = null; try { await as(who, `SELECT * FROM public.feed_viewer_author_affinity WHERE user_id = '${who}'`); } catch (x) { e = x.message; }
  ok(!!e && /permission denied/.test(e), `member ${who.slice(-2)} cannot read even its own closeness rows directly (only the definer feed RPC will)`, e);
}
await db.exec(`UPDATE public.feed_score_config SET value = 120 WHERE key = 'settle_seconds'`);
e = await run(PROBE); ok(!e, "PROBE passes on the used fixture (real rows present)", e);

// 5 · C-34: loosened copies must make the PROBE fail
const fnBlock = (name) => {
  const m = MIG.replace(/\r\n/g, "\n");
  const start = m.indexOf(`CREATE FUNCTION public.${name}(`);
  const end = m.indexOf("$fn$;", m.indexOf("AS $fn$", start)) + 5;
  if (start < 0 || end < 5) throw new Error("function block not found: " + name);
  return m.slice(start, end).replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION");
};
const REFRESH = fnBlock("feed_scores_refresh");
const mut = (from, to) => { const x = REFRESH.split(from).join(to); if (x === REFRESH) throw new Error("mutation anchor not found: " + from); return x; };
const loosened = [
  ["a SELECT USING (true) policy + SELECT granted to authenticated on feed_viewer_author_affinity",
   `CREATE POLICY leak ON public.feed_viewer_author_affinity FOR SELECT TO authenticated USING (true); GRANT SELECT ON public.feed_viewer_author_affinity TO authenticated;`,
   `DROP POLICY leak ON public.feed_viewer_author_affinity; REVOKE SELECT ON public.feed_viewer_author_affinity FROM authenticated;`],
  ["SELECT granted to authenticated only (RLS still denies every row)",
   `GRANT SELECT ON public.feed_viewer_category_interest TO authenticated;`, `REVOKE SELECT ON public.feed_viewer_category_interest FROM authenticated;`],
  ["SELECT granted to anon on feed_post_quality", `GRANT SELECT ON public.feed_post_quality TO anon;`, `REVOKE SELECT ON public.feed_post_quality FROM anon;`],
  ["a SECURITY DEFINER function returning every closeness row, executable by authenticated (B gets A's scores)",
   `CREATE FUNCTION public.my_feed_scores() RETURNS SETOF public.feed_viewer_author_affinity LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $f$ SELECT * FROM public.feed_viewer_author_affinity $f$;
    GRANT EXECUTE ON FUNCTION public.my_feed_scores() TO authenticated;`, `DROP FUNCTION public.my_feed_scores();`],
  ["feed_scores_refresh made executable by authenticated", `GRANT EXECUTE ON FUNCTION public.feed_scores_refresh(integer) TO authenticated;`,
   `REVOKE EXECUTE ON FUNCTION public.feed_scores_refresh(integer) FROM authenticated;`],
  ["NON-IDEMPOTENT: the refresh never advances its watermarks",
   mut("SET wm_at = _end, wm_k1 = _zero, wm_k2 = _zero", "SET wm_at = wm_at, wm_k1 = wm_k1, wm_k2 = wm_k2"), REFRESH],
  ["UNBOUNDED: the refresh ignores its batch argument",
   mut("_b    := GREATEST(1, coalesce(_batch, (_c->>'batch_rows')::integer));", "_b    := GREATEST(1, (_c->>'batch_rows')::integer);"), REFRESH],
  ["L8 cap removed: every share click is a unit (50 clicks → 50 units, capped only by the per-run pair cap)",
   mut("ELSE 1 END AS f,", "ELSE count(*) END AS f,"), REFRESH],
  ["no smoothing in the function (quality = engagement ÷ views)",
   mut("(m.engagement + (_c->>'q_prior_rate')::double precision * (_c->>'q_prior_views')::double precision)\n             / GREATEST(m.views + (_c->>'q_prior_views')::double precision, 1)", "m.engagement / GREATEST(m.views, 1)"), REFRESH],
  ["no decay in the function (old contributions count fully)",
   mut("* exp(-_k * GREATEST(0::double precision, extract(epoch FROM _now - u.at)::double precision)) AS g", "AS g"), REFRESH],
  ["hide weight flipped to positive in the config", `UPDATE public.feed_score_config SET value = 15 WHERE key = 'w_hide';`, `UPDATE public.feed_score_config SET value = -15 WHERE key = 'w_hide';`],
  ["hide mapped to a positive weight inside the function (config untouched)",
   mut("WHEN 'skip' THEN 'w_skip' WHEN 'hide' THEN 'w_hide' END", "WHEN 'skip' THEN 'w_skip' WHEN 'hide' THEN 'w_like' END"), REFRESH],
  ["prior removed in the config (q_prior_views 0)", `UPDATE public.feed_score_config SET value = 0 WHERE key = 'q_prior_views';`, `UPDATE public.feed_score_config SET value = 50 WHERE key = 'q_prior_views';`],
  ["the cron job unscheduled", `SELECT cron.unschedule('refresh-feed-scores');`, `SELECT cron.schedule('refresh-feed-scores', '*/3 * * * *', 'SELECT public.feed_scores_refresh();');`],
];
for (const [name, loosen, restore] of loosened) {
  await db.exec(loosen);
  e = await run(PROBE);
  ok(!!e && e.includes("PROBE FAIL"), `C-34 · PROBE FAILS on a loosened copy: ${name}`, e);
  await db.exec(restore);
}
e = await run(PROBE); ok(!e, "PROBE passes again once each loosening is undone", e);

// 6 · rollback
await db.exec(`CREATE FUNCTION public.f3_reader() RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $f$ SELECT count(*) FROM public.feed_viewer_author_affinity $f$;`);
e = await run(RB); ok(!!e && e.includes("RB-PRE-002"), "ROLLBACK refused while another function reads the score tables (RB-PRE-002)", e);
await db.exec(`DROP FUNCTION public.f3_reader();`);
e = await run(RB); ok(!e, "ROLLBACK applies (RB-PRE + RB-POST pass)", e);
r = await q1(`SELECT to_regclass('public.feed_viewer_author_affinity') AS t, to_regclass('public.post_reactions_created_at_idx') AS i,
  (SELECT count(*)::int FROM cron.job WHERE jobname = 'refresh-feed-scores') AS j, to_regclass('public.feed_signal_events') AS f1,
  (SELECT count(*)::int FROM cron.job WHERE jobname = 'purge-feed-signals') AS f1j`);
ok(r.t === null && r.i === null && r.j === 0 && r.f1 !== null && r.f1j === 1, "after ROLLBACK: score tables, indexes and job gone; S12-F1 untouched", JSON.stringify(r));
e = await run(PROBE); ok(!!e && e.includes("not applied"), "PROBE FAILS again after the rollback", e);
e = await run(RB); ok(!!e && e.includes("RB-PRE-001"), "ROLLBACK twice refused (RB-PRE-001)", e);
e = await run(MIG); ok(!e, "re-apply after rollback", e);
e = await run(PROBE); ok(!e, "PROBE passes after re-apply", e);

const out = [`S12-F2 PGlite proof — ${new Date().toISOString()} — PGlite (Postgres ${(await db.query("SHOW server_version")).rows[0].server_version})`, ...lines, `${fails === 0 ? "ALL PASS" : `${fails} FAIL`} (${lines.length} checks)`].join("\n");
fs.writeFileSync(path.join(here, "pglite-s12-f2-output.txt"), out + "\n");
console.log(out);
process.exit(fails ? 1 : 0);
