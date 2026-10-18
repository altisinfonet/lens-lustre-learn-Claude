// ═══════════════════════════════════════════════════════════════════════════
// S12-F1 · 20261018_0001 — behaviour proof on PGlite (in-memory Postgres; version in the output).
//
// NOT a live database. A production-shaped fixture of exactly the objects the
// migration touches or relies on, with production's own bodies (read from the
// live catalogue snapshot of 2026-10-17, _control/forensic/…/function_defs.json):
// auth.uid(), account_is_live(), are_friends(), can_view_post(); posts.privacy's
// CHECK; profiles → auth.users. LOOSE default privileges (every new table granted
// to anon and authenticated, as a lane's defaults may do) so the migration's
// REVOKE-then-GRANT is what is proved. pg_cron is stubbed (cron.job + schedule /
// unschedule) — the only platform piece not real here.
//
// Sequence: PROBE before apply must FAIL → lane guard refuses → apply → PROBE
// PASSES → re-apply refused → three loosened copies (C-34: a leaky SELECT policy,
// an anon grant, a fold that also counts resends) each make the PROBE FAIL →
// rate bound, retention, batch-survival checks → ROLLBACK → PROBE fails again →
// rollback twice refused → re-apply → PROBE passes.
//
// Run:  PGLITE_MODULE=<abs path to @electric-sql/pglite/dist/index.js> \
//       node docs/evidence/d1/S12-F1-feed-signals/pglite-s12-f1.mjs
// ═══════════════════════════════════════════════════════════════════════════
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const MIG = read("supabase/migrations/20261018_0001_s12_f1_feed_signals.sql");
const RB = read("supabase/rollback/20261018_0001_s12_f1_feed_signals_ROLLBACK.sql");
const PROBE = read("supabase/migrations/PROBE_20261018_0001_s12_f1_feed_signals.sql");

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";
const D = "00000000-0000-4000-8000-00000000000d";
const P_PUBLIC = "10000000-0000-4000-8000-000000000001";
const P_PRIVATE = "10000000-0000-4000-8000-000000000002";
const P_FRIENDS = "10000000-0000-4000-8000-000000000003";
const P_OWN_A = "10000000-0000-4000-8000-000000000004";

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
  CHECK (privacy = ANY (ARRAY['private','friends','public'])), created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view posts based on privacy" ON public.posts FOR SELECT USING (public.can_view_post((SELECT auth.uid()), user_id, privacy));
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text);
CREATE FUNCTION cron.schedule(_name text, _schedule text, _command text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (_name, _schedule, _command)
  ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(_jobid bigint) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobid = _jobid RETURNING true $$;
INSERT INTO auth.users VALUES ('${A}'), ('${B}'), ('${C}'), ('${D}');
INSERT INTO public.profiles VALUES ('${A}'), ('${B}'), ('${C}'), ('${D}');
INSERT INTO public.posts (id, user_id, privacy, created_at) VALUES
  ('${P_PUBLIC}', '${C}', 'public', now()), ('${P_PRIVATE}', '${D}', 'private', now() - interval '1 minute'),
  ('${P_FRIENDS}', '${D}', 'friends', now() - interval '2 minutes'), ('${P_OWN_A}', '${A}', 'public', now() - interval '3 days');
`;

const lines = [];
let fails = 0;
const ok = (cond, msg, detail = "") => {
  lines.push(`${cond ? "PASS" : "FAIL"} · ${msg}${detail ? `  [${String(detail).split("\n").join(" | ").slice(0, 400)}]` : ""}`);
  if (!cond) fails++;
};
const db = await PGlite.create();
const run = async (sql) => { try { await db.exec(sql); return null; } catch (e) { await db.exec("ROLLBACK").catch(() => {}); return e.message; } };
const as = async (uid, sql) => {
  await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${uid}', false);`);
  try { return await db.query(sql); } finally { await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);"); }
};

await db.exec(PLATFORM);
await db.exec(`SET p32.lane = 'staging'`);

// 1 · fail-first
let e = await run(PROBE);
ok(!!e && e.includes("G1") && e.includes("not applied"), "PROBE FAILS before the migration (G1: tables do not exist)", e);

// 2 · lane guard
await db.exec(`RESET p32.lane`);
e = await run(MIG); ok(!!e && e.includes("APPLY REFUSED"), "lane guard: p32.lane unset → refused", e);
e = await run(PROBE); ok(!!e && e.includes("PROBE REFUSED"), "PROBE lane guard: p32.lane unset → refused", e);
await db.exec(`SET p32.lane = 'staging'`);

// 3 · apply, PROBE passes
e = await run(MIG); ok(!e, "20261018_0001 applies with p32.lane = 'staging' (PRE + POST pass)", e);
e = await run(PROBE); ok(!e, "PROBE PASSES after the migration (static + cross-member + exactly-once + anon + deleted account)", e);
e = await run(MIG); ok(!!e && e.includes("PRE-001"), "re-apply refused (PRE-001)", e);

// 4 · behaviour beyond the PROBE
// 4a · one bad row does not take its batch with it: own post, private post, friends-only (not friends), unknown post
const ids = Array.from({ length: 6 }, (_, i) => `20000000-0000-4000-8000-00000000000${i}`);
await as(A, `INSERT INTO public.feed_signal_events (id, user_id, kind, post_id, subject_id, value) VALUES
  ('${ids[0]}', '${A}', 'dwell', '${P_PUBLIC}', '${A}', 2000),
  ('${ids[1]}', '${A}', 'dwell', '${P_OWN_A}', '${A}', 2000),
  ('${ids[2]}', '${A}', 'dwell', '${P_PRIVATE}', '${D}', 2000),
  ('${ids[3]}', '${A}', 'dwell', '${P_FRIENDS}', '${D}', 2000),
  ('${ids[4]}', '${A}', 'dwell', '30000000-0000-4000-8000-000000000000', '${D}', 2000),
  ('${ids[5]}', '${A}', 'watch', '${P_PUBLIC}', '${A}', 55)
  ON CONFLICT (id) DO NOTHING`);
let r = await as(A, `SELECT id FROM public.feed_signal_events ORDER BY id`);
ok(r.rows.map((x) => x.id).join(",") === [ids[0], ids[5]].join(","), "a batch keeps its good rows: own / private / friends-only (not friends) / deleted-post rows are skipped, not refused", JSON.stringify(r.rows));
// 4b · friends-only becomes visible once A and D are friends
await db.exec(`INSERT INTO public.friendships VALUES ('${A}', '${D}', 'accepted')`);
await as(A, `INSERT INTO public.feed_signal_events (id, user_id, kind, post_id, subject_id, value) VALUES ('${ids[3]}', '${A}', 'dwell', '${P_FRIENDS}', '${A}', 2000) ON CONFLICT (id) DO NOTHING`);
r = await as(A, `SELECT author_id, dwell_ms FROM public.feed_post_signals WHERE post_id = '${P_FRIENDS}'`);
ok(r.rows.length === 1 && r.rows[0].author_id === D && r.rows[0].dwell_ms === 2000, "a friend's friends-only post is recorded (can_view_post), author set server-side", JSON.stringify(r.rows));
// 4c · exactly once under repeated resends (5 more sends of the same 2 ids)
for (let i = 0; i < 5; i++) await as(A, `INSERT INTO public.feed_signal_events (id, user_id, kind, post_id, subject_id, value) VALUES ('${ids[0]}', '${A}', 'dwell', '${P_PUBLIC}', '${C}', 2000), ('${ids[5]}', '${A}', 'watch', '${P_PUBLIC}', '${C}', 55) ON CONFLICT (id) DO NOTHING`);
r = await as(A, `SELECT dwell_ms, watch_pct FROM public.feed_post_signals WHERE post_id = '${P_PUBLIC}'`);
ok(r.rows[0]?.dwell_ms === 2000 && r.rows[0]?.watch_pct === 55, "six sends of the same two signals → dwell 2000, watch 55 (counted once)", JSON.stringify(r.rows));
// 4d · aggregation across distinct signals: watch keeps the max, dwell sums
await as(A, `INSERT INTO public.feed_signal_events (id, user_id, kind, post_id, subject_id, value) VALUES
  (gen_random_uuid(), '${A}', 'watch', '${P_PUBLIC}', '${C}', 30), (gen_random_uuid(), '${A}', 'dwell', '${P_PUBLIC}', '${C}', 500)`);
r = await as(A, `SELECT dwell_ms, watch_pct FROM public.feed_post_signals WHERE post_id = '${P_PUBLIC}'`);
ok(r.rows[0]?.dwell_ms === 2500 && r.rows[0]?.watch_pct === 55, "distinct signals fold: dwell sums (2500), watch keeps its maximum (55)", JSON.stringify(r.rows));
// 4e · B (cross-member) sees none of it; B's own signal is B's only
await as(B, `INSERT INTO public.feed_signal_events (id, user_id, kind, post_id, subject_id, value) VALUES (gen_random_uuid(), '${B}', 'skip', '${P_PUBLIC}', '${C}', 0)`);
r = await as(B, `SELECT (SELECT count(*) FROM public.feed_signal_events)::int AS l, (SELECT count(*) FROM public.feed_post_signals)::int AS p, (SELECT count(*) FROM public.feed_post_signals WHERE user_id = '${A}')::int AS pa`);
ok(r.rows[0].l === 1 && r.rows[0].p === 1 && r.rows[0].pa === 0, "B reads only B's own rows (ledger 1, post 1, A's 0)", JSON.stringify(r.rows));
// 4f · the author C cannot read signals about C's post either
r = await as(C, `SELECT (SELECT count(*) FROM public.feed_post_signals)::int AS p, (SELECT count(*) FROM public.feed_signal_events)::int AS l`);
ok(r.rows[0].p === 0 && r.rows[0].l === 0, "the post's AUTHOR reads none of the viewers' signals about it", JSON.stringify(r.rows));
// 4g · rate bound: 300 per member per 10 minutes, extra rows skipped (not refused)
await db.exec(`DELETE FROM public.feed_signal_events`);
const many = Array.from({ length: 310 }, () => `(gen_random_uuid(), '${D}', 'share_click', '${P_PUBLIC}', '${C}', 0)`).join(",");
e = null; try { await as(D, `INSERT INTO public.feed_signal_events (id, user_id, kind, post_id, subject_id, value) VALUES ${many}`); } catch (x) { e = x.message; }
r = await db.query(`SELECT count(*)::int AS n FROM public.feed_signal_events WHERE user_id = '${D}'`);
ok(!e && r.rows[0].n === 300, "rate bound: 310 signals in one go → 300 recorded, 10 skipped, no error", e ?? JSON.stringify(r.rows));
r = await db.query(`SELECT share_clicks FROM public.feed_post_signals WHERE user_id = '${D}' AND post_id = '${P_PUBLIC}'`);
ok(r.rows[0]?.share_clicks === 300, "the aggregate counted exactly the 300 recorded rows", JSON.stringify(r.rows));
// 4h · a member cannot back-date a row past the retention (created_at is set by the server)
await as(A, `INSERT INTO public.feed_signal_events (id, user_id, kind, post_id, subject_id, value, created_at) VALUES ('${ids[1]}', '${A}', 'skip', '${P_PUBLIC}', '${C}', 0, now() - interval '400 days')`);
r = await db.query(`SELECT created_at > now() - interval '1 minute' AS fresh FROM public.feed_signal_events WHERE id = '${ids[1]}'`);
ok(r.rows[0]?.fresh === true, "created_at sent by the client is overwritten with now()", JSON.stringify(r.rows));
// 4i · retention
await db.exec(`UPDATE public.feed_signal_events SET created_at = now() - interval '91 days' WHERE user_id = '${D}';
  UPDATE public.feed_post_signals SET first_at = now() - interval '91 days' WHERE user_id = '${D}';
  UPDATE public.feed_author_signals SET last_visit_at = now() - interval '91 days';
  UPDATE public.feed_signal_events SET created_at = now() - interval '89 days' WHERE user_id = '${A}'`);
r = await db.query(`SELECT public.purge_feed_signals(1000) AS j`);
const j = r.rows[0].j;
r = await db.query(`SELECT count(*)::int AS n FROM public.feed_signal_events WHERE user_id = '${A}'`);
ok(j.feed_signal_events === 300 && j.feed_post_signals === 1 && j.feed_author_signals === 0 && r.rows[0].n === 1, "purge (Owner: 90 days): 91-day ledger rows and post aggregates removed; an 89-day row kept", JSON.stringify(j));
r = await db.query(`SELECT public.purge_feed_signals(1000) AS j`);
ok(r.rows[0].j.feed_signal_events === 0, "purge is idempotent (second run deletes nothing)", JSON.stringify(r.rows[0].j));
// 4j · account deletion cascades
await db.exec(`DELETE FROM auth.users WHERE id = '${A}'`);
r = await db.query(`SELECT (SELECT count(*) FROM public.feed_signal_events WHERE user_id = '${A}')::int + (SELECT count(*) FROM public.feed_post_signals WHERE user_id = '${A}')::int AS n`);
ok(r.rows[0].n === 0, "deleting the account deletes the member's signals (FK cascade)", JSON.stringify(r.rows));
await db.exec(`INSERT INTO auth.users VALUES ('${A}'); INSERT INTO public.profiles VALUES ('${A}'); INSERT INTO public.posts (id, user_id, privacy) VALUES ('${P_OWN_A}', '${A}', 'public') ON CONFLICT DO NOTHING; DELETE FROM public.feed_signal_events; DELETE FROM public.feed_post_signals; DELETE FROM public.feed_author_signals;`);

// 4k · HIDE and MUTE (Extra A, Extra D)
for (let i = 0; i < 3; i++) await as(A, `INSERT INTO public.feed_hidden_posts (user_id, post_id, reason) VALUES ('${A}', '${P_PUBLIC}', 'not_interested') ON CONFLICT (user_id, post_id) DO NOTHING`);
for (let i = 0; i < 3; i++) await as(A, `INSERT INTO public.feed_muted_authors (user_id, author_id) VALUES ('${A}', '${C}') ON CONFLICT (user_id, author_id) DO NOTHING`);
r = await db.query(`SELECT (SELECT count(*) FROM public.feed_hidden_posts)::int AS h, (SELECT count(*) FROM public.feed_muted_authors)::int AS m`);
ok(r.rows[0].h === 1 && r.rows[0].m === 1, "hide x3 and mute x3 (resends) → one row each (natural primary keys)", JSON.stringify(r.rows));
await as(A, `INSERT INTO public.feed_hidden_posts (user_id, post_id) VALUES ('${A}', '${P_OWN_A}'), ('${A}', '${P_PRIVATE}'), ('${A}', '30000000-0000-4000-8000-000000000000') ON CONFLICT (user_id, post_id) DO NOTHING`);
r = await db.query(`SELECT count(*)::int AS n FROM public.feed_hidden_posts`);
ok(r.rows[0].n === 1, "hiding an own / private / non-existent post is skipped (no FK error that would reveal the post exists)", JSON.stringify(r.rows));
r = await db.query(`EXPLAIN (COSTS OFF) SELECT p.id FROM public.posts p WHERE NOT EXISTS (SELECT 1 FROM public.feed_hidden_posts h WHERE h.user_id = '${A}' AND h.post_id = p.id) AND NOT EXISTS (SELECT 1 FROM public.feed_muted_authors m WHERE m.user_id = '${A}' AND m.author_id = p.user_id)`);
const plan = r.rows.map((x) => x["QUERY PLAN"]).join(" | ");
ok(true, "feed-RPC exclusion shape plans (PKs are the exclusion indexes; tiny fixture, so no index choice is claimed)", plan);
r = await as(A, `SELECT p.id FROM public.posts p WHERE NOT EXISTS (SELECT 1 FROM public.feed_hidden_posts h WHERE h.user_id = auth.uid() AND h.post_id = p.id) AND NOT EXISTS (SELECT 1 FROM public.feed_muted_authors m WHERE m.user_id = auth.uid() AND m.author_id = p.user_id) ORDER BY p.id`);
ok(!r.rows.some((x) => x.id === P_PUBLIC), "the exclusion shape removes A's hidden post and muted author's posts from A's list", JSON.stringify(r.rows));
r = await as(B, `SELECT (SELECT count(*) FROM public.feed_hidden_posts)::int AS h, (SELECT count(*) FROM public.feed_muted_authors)::int AS m`);
ok(r.rows[0].h === 0 && r.rows[0].m === 0, "B reads none of A's hides or mutes", JSON.stringify(r.rows));
r = await as(C, `SELECT (SELECT count(*) FROM public.feed_muted_authors)::int AS m`);
ok(r.rows[0].m === 0, "the MUTED author cannot see that they were muted", JSON.stringify(r.rows));
await as(B, `DELETE FROM public.feed_muted_authors`);
await as(B, `DELETE FROM public.feed_hidden_posts`);
r = await db.query(`SELECT (SELECT count(*) FROM public.feed_hidden_posts)::int AS h, (SELECT count(*) FROM public.feed_muted_authors)::int AS m`);
ok(r.rows[0].h === 1 && r.rows[0].m === 1, "B's bare DELETE removes none of A's hides / mutes", JSON.stringify(r.rows));
await as(A, `DELETE FROM public.feed_muted_authors WHERE author_id = '${C}'`);
await as(A, `DELETE FROM public.feed_muted_authors WHERE author_id = '${C}'`);
r = await db.query(`SELECT count(*)::int AS m FROM public.feed_muted_authors`);
ok(r.rows[0].m === 0, "unmute (sent twice) removes the mute; the repeat changes nothing", JSON.stringify(r.rows));
e = null; try { await as(A, `INSERT INTO public.feed_muted_authors (user_id, author_id) VALUES ('${A}', '${A}')`); } catch (x) { e = x.message; }
ok(!!e && e.includes("feed_muted_authors_not_self"), "muting oneself is refused by the CHECK", e);
await db.exec(`DELETE FROM public.posts WHERE id = '${P_PUBLIC}'`);
r = await db.query(`SELECT count(*)::int AS n FROM public.feed_hidden_posts`);
ok(r.rows[0].n === 0, "deleting the post removes its hides (FK cascade)", JSON.stringify(r.rows));
await db.exec(`INSERT INTO public.posts (id, user_id, privacy, created_at) VALUES ('${P_PUBLIC}', '${C}', 'public', now())`);

// 5 · C-34: loosened copies must make the PROBE fail
// B1 (review of PR #457): the BEFORE triggers WITHOUT the auth.uid() guard —
// the exact pre-fix bodies, cut from the migration itself.
const fnBlock = (name) => {
  const m = MIG.replace(/\r\n/g, "\n");
  const start = m.indexOf(`CREATE FUNCTION public.${name}()`);
  const end = m.indexOf("$fn$;", m.indexOf("AS $fn$", start)) + 5;
  if (start < 0 || end < 5) throw new Error("function block not found: " + name);
  return m.slice(start, end).replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION");
};
const unguard = (block) => {
  const g = block.replace(/  -- A row in ANOTHER member's name[\s\S]*?  IF NEW\.user_id IS DISTINCT FROM \(SELECT auth\.uid\(\)\) THEN\n    RETURN NEW;\n  END IF;\n/, "");
  if (g === block) throw new Error("guard not found");
  return g;
};
const SIG_BEFORE = fnBlock("feed_signal_events_before");
const HID_BEFORE = fnBlock("feed_hidden_posts_before");

const loosened = [
  ["B1 · feed_signal_events_before WITHOUT the auth.uid() guard (a row in B's name is judged — rate / visibility — before RLS)",
   unguard(SIG_BEFORE), SIG_BEFORE],
  ["B1 · feed_hidden_posts_before WITHOUT the auth.uid() guard (a hide in B's name of a private post is skipped, not refused)",
   unguard(HID_BEFORE), HID_BEFORE],
  ["a SELECT USING (true) policy on feed_post_signals", `CREATE POLICY leak ON public.feed_post_signals FOR SELECT TO authenticated USING (true);`, `DROP POLICY leak ON public.feed_post_signals;`],
  ["SELECT granted to anon on feed_post_signals", `GRANT SELECT ON public.feed_post_signals TO anon;`, `REVOKE SELECT ON public.feed_post_signals FROM anon;`],
  ["the fold moved to a BEFORE trigger (counts resends too)",
   `CREATE FUNCTION public.loose_fold() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $f$ BEGIN
      IF NEW.kind <> 'profile_visit' THEN
        INSERT INTO public.feed_post_signals AS s (user_id, post_id, author_id, dwell_ms) VALUES (NEW.user_id, NEW.post_id, NEW.subject_id, CASE WHEN NEW.kind='dwell' THEN NEW.value ELSE 0 END)
        ON CONFLICT (user_id, post_id) DO UPDATE SET dwell_ms = s.dwell_ms + EXCLUDED.dwell_ms;
      END IF; RETURN NEW; END $f$;
    CREATE TRIGGER zz_loose BEFORE INSERT ON public.feed_signal_events FOR EACH ROW EXECUTE FUNCTION public.loose_fold();
    ALTER TABLE public.feed_signal_events DISABLE TRIGGER feed_signal_events_fold;`,
   `DROP TRIGGER zz_loose ON public.feed_signal_events; DROP FUNCTION public.loose_fold(); ALTER TABLE public.feed_signal_events ENABLE TRIGGER feed_signal_events_fold;`],
  // The two below keep every NAME the static checks look at, so only the behaviour checks can catch them.
  ["the SAME-NAMED read policy loosened to USING (true) (only G2i can see it)",
   `DROP POLICY "Members read own post signals" ON public.feed_post_signals;
    CREATE POLICY "Members read own post signals" ON public.feed_post_signals FOR SELECT TO authenticated USING (true);`,
   `DROP POLICY "Members read own post signals" ON public.feed_post_signals;
    CREATE POLICY "Members read own post signals" ON public.feed_post_signals FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);`],
  ["the BEFORE trigger also folds (fires on a resend too; only G2c can see it)",
   `ALTER FUNCTION public.feed_signal_events_before() RENAME TO feed_signal_events_before_real;
    CREATE FUNCTION public.feed_signal_events_before() RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $f$
    DECLARE _a uuid; BEGIN
      IF NEW.kind = 'dwell' THEN
        SELECT p.user_id INTO _a FROM public.posts p WHERE p.id = NEW.post_id;
        UPDATE public.feed_post_signals SET dwell_ms = dwell_ms + NEW.value WHERE user_id = NEW.user_id AND post_id = NEW.post_id;
      END IF;
      IF NEW.kind = 'profile_visit' AND NEW.subject_id = NEW.user_id THEN RETURN NULL; END IF;
      IF NEW.kind <> 'profile_visit' THEN SELECT p.user_id INTO NEW.subject_id FROM public.posts p WHERE p.id = NEW.post_id; END IF;
      RETURN NEW; END $f$;
    REVOKE ALL ON FUNCTION public.feed_signal_events_before() FROM PUBLIC, anon, authenticated;
    DROP TRIGGER feed_signal_events_before ON public.feed_signal_events;
    CREATE TRIGGER feed_signal_events_before BEFORE INSERT ON public.feed_signal_events FOR EACH ROW EXECUTE FUNCTION public.feed_signal_events_before();`,
   `DROP TRIGGER feed_signal_events_before ON public.feed_signal_events; DROP FUNCTION public.feed_signal_events_before();
    ALTER FUNCTION public.feed_signal_events_before_real() RENAME TO feed_signal_events_before;
    CREATE TRIGGER feed_signal_events_before BEFORE INSERT ON public.feed_signal_events FOR EACH ROW EXECUTE FUNCTION public.feed_signal_events_before();`],
  ["the SAME-NAMED unmute policy loosened to USING (true) (only G2j can see it)",
   `DROP POLICY "Members unmute own mutes" ON public.feed_muted_authors;
    CREATE POLICY "Members unmute own mutes" ON public.feed_muted_authors FOR DELETE TO authenticated USING (true);`,
   `DROP POLICY "Members unmute own mutes" ON public.feed_muted_authors;
    CREATE POLICY "Members unmute own mutes" ON public.feed_muted_authors FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);`],
  ["the SAME-NAMED hidden-posts read policy loosened to USING (true) (only G2i can see it)",
   `DROP POLICY "Members read own hidden posts" ON public.feed_hidden_posts;
    CREATE POLICY "Members read own hidden posts" ON public.feed_hidden_posts FOR SELECT TO authenticated USING (true);`,
   `DROP POLICY "Members read own hidden posts" ON public.feed_hidden_posts;
    CREATE POLICY "Members read own hidden posts" ON public.feed_hidden_posts FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);`],
];
for (const [name, loosen, restore] of loosened) {
  await db.exec(loosen);
  e = await run(PROBE);
  ok(!!e && e.includes("PROBE FAIL"), `C-34 · PROBE FAILS on a loosened copy: ${name}`, e);
  await db.exec(restore);
}
e = await run(PROBE); ok(!e, "PROBE passes again once each loosening is undone", e);

// 6 · rollback
e = await run(RB); ok(!e, "ROLLBACK applies (RB-PRE + RB-POST pass)", e);
r = await db.query(`SELECT to_regclass('public.feed_signal_events') AS t, (SELECT count(*)::int FROM cron.job WHERE jobname = 'purge-feed-signals') AS j`);
ok(r.rows[0].t === null && r.rows[0].j === 0, "after ROLLBACK: tables and purge job gone", JSON.stringify(r.rows));
e = await run(PROBE); ok(!!e && e.includes("not applied"), "PROBE FAILS again after the rollback", e);
e = await run(RB); ok(!!e && e.includes("RB-PRE-001"), "ROLLBACK twice refused (RB-PRE-001)", e);
e = await run(MIG); ok(!e, "re-apply after rollback", e);
e = await run(PROBE); ok(!e, "PROBE passes after re-apply", e);

const out = [`S12-F1 PGlite proof — ${new Date().toISOString()} — PGlite (Postgres ${(await db.query("SHOW server_version")).rows[0].server_version})`, ...lines, `${fails === 0 ? "ALL PASS" : `${fails} FAIL`} (${lines.length} checks)`].join("\n");
fs.writeFileSync(path.join(here, "pglite-s12-f1-output.txt"), out + "\n");
console.log(out);
process.exit(fails ? 1 : 0);
