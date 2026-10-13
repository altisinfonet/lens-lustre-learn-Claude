// ═══════════════════════════════════════════════════════════════════════════
// Stage L2 · 20261013_0005 — behaviour proof on PGlite (Postgres 17, in memory).
//
// Two fixtures, each built from PRODUCTION's own feed functions
// (fixture-production-feed-functions.sql, verbatim, md5-checked — staging's
// bodies are md5-equal) and production's feed_events table (columns, CHECK, FK,
// 8 indexes, 3 triggers, RLS):
//   S · staging-shaped    — 10,914 posts (8,726 public / 1,080 friends / 1,108
//                            private), 50 authors, 2026-07-27 → 2026-10-11
//                            (staging, read 2026-10-13), and staging's LOOSER
//                            privileges as read on 2026-10-13 before 20261013_0001
//                            (feed_candidates / feed_rank_score executable by
//                            PUBLIC, anon, authenticated; feed_events fully
//                            granted to anon and authenticated) — the lane state
//                            that differs most from production;
//   P · production-shaped — 300 posts, 80 members, one prolific official account
//                            (production held 252 posts in the 2026-08 evidence;
//                            not re-measured — no production access by rule),
//                            production's privileges exactly.
// Both fixtures end with a burst: one author's 4 newest posts in a row.
// Optional `--scale`: 100,000 posts, 2,000 members, 1,000,000 feed_events.
//
// For each fixture: BEFORE (production's functions) → fail-first observations,
// the PROBE failing on today's state, and latency; APPLY the migration (lane
// guard checked) → PROBE → behaviour → cross-member → exactly-once; latency
// AFTER; ROLLBACK → PROBE must refuse → re-apply → PROBE passes.
// Only platform pieces are stubbed (auth.uid(), roles, has_role, account_is_live).
//
// Run:   node docs/evidence/d1/L2-feed-freshness/pglite-l2-feed.mjs [--scale]
//   PGLITE_MODULE=<abs path to @electric-sql/pglite/dist/index.js> when the
//   package is not resolvable from this file (CI installs it in a temp dir).
// Exit 1 on any FAIL.
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..");
const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : "@electric-sql/pglite");
const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const MIG = read(join(ROOT, "supabase/migrations/20261013_0005_l2_feed_session_seed.sql"));
const RB = read(join(ROOT, "supabase/rollback/20261013_0005_l2_feed_session_seed_ROLLBACK.sql"));
const PROBE = read(join(ROOT, "supabase/migrations/PROBE_20261013_0005_l2_feed_session_seed.sql"));
const FIX = read(join(HERE, "fixture-production-feed-functions.sql"));
const SCALE = process.argv.includes("--scale");
/** A covering index for the my_events step — MEASURED in the --scale run and NOT shipped (numbers and reason: the migration header). */
const CANDIDATE_INDEX = `CREATE INDEX idx_feed_events_user_seen ON public.feed_events (user_id, post_id) INCLUDE (event_type, created_at) WHERE event_type IN ('view', 'skip')`;

let pass = 0, fail = 0;
const ok = (c, msg, extra = "") => { console.log(`${c ? "PASS" : "FAIL"} ${msg}${extra ? "  — " + extra : ""}`); c ? pass++ : fail++; };
const note = (msg) => console.log(`     ${msg}`);
const U = (tag, n) => { const h = createHash("md5").update(`${tag}:${n}`).digest("hex"); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`; };

const PLATFORM = `
CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon, service_role;
GRANT USAGE ON SCHEMA public TO authenticated, anon, service_role;
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TABLE public.user_roles (user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE FUNCTION public.has_role(_user_id uuid, _role text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
  AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role::text = _role) $$;
CREATE FUNCTION public.account_is_live() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE TABLE public.profiles_public_data (id uuid PRIMARY KEY, full_name text, avatar_url text);
CREATE TABLE public.friendships (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), requester_id uuid NOT NULL, addressee_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, content text NOT NULL DEFAULT '', image_url text,
  privacy text NOT NULL DEFAULT 'public', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  image_urls text[] NOT NULL DEFAULT '{}', likes_count integer NOT NULL DEFAULT 0, comments_count integer NOT NULL DEFAULT 0,
  shares_count integer NOT NULL DEFAULT 0, thumbnail_urls text[], categories text[] NOT NULL DEFAULT '{}',
  is_public boolean GENERATED ALWAYS AS (privacy = 'public') STORED, rand_key double precision NOT NULL DEFAULT random(),
  viewer_count integer NOT NULL DEFAULT 0, viewer_bucket_stable integer NOT NULL DEFAULT 0);
CREATE INDEX idx_posts_created_at_desc ON public.posts USING btree (created_at DESC);
CREATE INDEX idx_posts_is_public_created ON public.posts USING btree (created_at DESC) WHERE is_public;
CREATE INDEX idx_posts_privacy_created_at ON public.posts USING btree (privacy, created_at DESC);
CREATE INDEX idx_posts_rand_public ON public.posts USING btree (rand_key) WHERE is_public;
CREATE INDEX idx_posts_user_id ON public.posts USING btree (user_id);
CREATE INDEX idx_posts_user_id_created_at ON public.posts USING btree (user_id, created_at DESC);
CREATE INDEX idx_posts_categories ON public.posts USING gin (categories);
-- production's feed_events, exactly (columns, CHECK, FK, indexes, RLS; triggers after the functions load)
CREATE TABLE public.feed_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(), user_id uuid NOT NULL, post_id uuid NOT NULL, author_id uuid NOT NULL,
  event_type text NOT NULL, dwell_ms integer DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feed_events_pkey PRIMARY KEY (id),
  CONSTRAINT feed_events_event_type_check CHECK ((event_type = ANY (ARRAY['view'::text, 'like'::text, 'skip'::text, 'comment'::text, 'share'::text, 'click'::text]))),
  CONSTRAINT feed_events_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE);
CREATE INDEX idx_feed_events_author ON public.feed_events USING btree (author_id);
CREATE INDEX idx_feed_events_created ON public.feed_events USING btree (created_at);
CREATE INDEX idx_feed_events_post ON public.feed_events USING btree (post_id);
CREATE INDEX idx_feed_events_post_id ON public.feed_events USING btree (post_id);
CREATE INDEX idx_feed_events_user_author ON public.feed_events USING btree (user_id, author_id);
CREATE INDEX idx_feed_events_user_created ON public.feed_events USING btree (user_id, created_at DESC);
CREATE INDEX idx_feed_events_user_post ON public.feed_events USING btree (user_id, post_id);
ALTER TABLE public.feed_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read all feed events" ON public.feed_events FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'));
CREATE POLICY "Deleted accounts cannot delete" ON public.feed_events AS RESTRICTIVE FOR DELETE TO authenticated USING ((SELECT public.account_is_live()));
CREATE POLICY "Deleted accounts cannot insert" ON public.feed_events AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.account_is_live()));
CREATE POLICY "Deleted accounts cannot update" ON public.feed_events AS RESTRICTIVE FOR UPDATE TO authenticated USING ((SELECT public.account_is_live()));
CREATE POLICY "Users insert own feed events" ON public.feed_events FOR INSERT TO authenticated WITH CHECK (((SELECT auth.uid()) = user_id));
CREATE POLICY "Users read own feed events" ON public.feed_events FOR SELECT TO authenticated USING (((SELECT auth.uid()) = user_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feed_events TO anon, authenticated;
GRANT SELECT ON public.posts, public.profiles_public_data, public.friendships TO anon, authenticated;
`;
const TRIGGERS_AND_ACLS = `
CREATE TRIGGER trg_feed_events_viewer_count AFTER INSERT ON public.feed_events FOR EACH ROW EXECUTE FUNCTION tg_feed_events_viewer_count();
CREATE TRIGGER trg_rate_limit_feed_events BEFORE INSERT ON public.feed_events FOR EACH ROW EXECUTE FUNCTION rate_limit_feed_events();
CREATE TRIGGER trg_validate_feed_event_author BEFORE INSERT ON public.feed_events FOR EACH ROW EXECUTE FUNCTION validate_feed_event_author();
REVOKE ALL ON FUNCTION public.feed_rank_score(uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.feed_rank_score(uuid, integer, text) TO service_role;
REVOKE ALL ON FUNCTION public.feed_candidates(text, text[], integer, integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.feed_candidates(text, text[], integer, integer, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.get_broadcast_feed(uuid[], integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_broadcast_feed(uuid[], integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_broadcast_feed(uuid[], integer, integer, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_broadcast_feed(uuid[], integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_broadcast_feed(uuid[], integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_broadcast_feed(uuid[], integer, integer, text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_post_view_counts(uuid[]) TO anon, authenticated, service_role;
`;

/** Build one fixture. shape: { tag, posts, members, privacy:{public,friends,private}, start, end, prolificShare } */
async function build(shape) {
  const db = new PGlite();
  await db.exec(PLATFORM);
  await db.exec(FIX);
  await db.exec(TRIGGERS_AND_ACLS);
  // Staging as read on 2026-10-13 before 20261013_0001 aligned it: looser than production.
  if (shape.looseAcl) await db.exec(`
    GRANT EXECUTE ON FUNCTION public.feed_rank_score(uuid, integer, text) TO PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.feed_candidates(text, text[], integer, integer, integer, integer) TO PUBLIC, anon, authenticated;
    GRANT ALL ON public.feed_events TO anon, authenticated;`);
  const md5s = await db.query(`SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS sig, md5(p.prosrc) AS m
                                 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                                  AND p.proname IN ('feed_rank_score','feed_candidates','get_broadcast_feed','get_post_view_counts','rate_limit_feed_events','tg_feed_events_viewer_count','validate_feed_event_author')`);
  const want = [...FIX.matchAll(/^--\s+([0-9a-f]{32})\s+(\S+\(.*?\))\s+acl/gm)].map((m) => [m[2], m[1]]);
  const got = new Map(md5s.rows.map((r) => [r.sig, r.m]));
  ok(want.length === 9 && want.every(([s, m]) => got.get(s) === m), `${shape.tag} · fixture = production's 9 feed function bodies (md5)`, `${want.filter(([s, m]) => got.get(s) === m).length}/9`);

  // members: authors 0..A-1; viewer V (no posts); the prolific account is author 0
  const A = shape.members;
  await db.query(`INSERT INTO public.profiles_public_data (id, full_name)
                  SELECT ('${U(shape.tag, "member")}'::uuid::text)::uuid, 'viewer'
                  UNION ALL SELECT md5('${shape.tag}:author:' || g)::uuid, 'author ' || g FROM generate_series(0, ${A - 1}) g`);
  const N = shape.posts;
  const span = `(timestamptz '${shape.end}' - timestamptz '${shape.start}')`;
  // posts: deterministic ids/rand_key; author = prolific account for prolificShare of posts, else round-robin
  await db.exec(`
    INSERT INTO public.posts (id, user_id, content, privacy, created_at, rand_key)
    SELECT md5('${shape.tag}:post:' || g)::uuid,
           CASE WHEN (hashtextextended('${shape.tag}:a:' || g, 0) & 1023) < ${Math.round(shape.prolificShare * 1024)}
                THEN md5('${shape.tag}:author:0')::uuid
                ELSE md5('${shape.tag}:author:' || (g % ${A}))::uuid END,
           'post ' || g,
           CASE WHEN g % ${N} < ${shape.privacy.public} THEN 'public'
                WHEN g % ${N} < ${shape.privacy.public + shape.privacy.friends} THEN 'friends' ELSE 'private' END,
           timestamptz '${shape.start}' + ${span} * ((hashtextextended('${shape.tag}:t:' || g, 0) & 2147483647)::float8 / 2147483647.0),
           (hashtextextended('${shape.tag}:r:' || g, 0) & 2147483647)::float8 / 2147483647.0
    FROM generate_series(1, ${N}) g;
    -- the burst: author 1 publishes the 4 newest posts in a row (public)
    INSERT INTO public.posts (id, user_id, content, privacy, created_at, rand_key)
    SELECT md5('${shape.tag}:burst:' || g)::uuid, md5('${shape.tag}:author:1')::uuid, 'burst ' || g, 'public',
           timestamptz '${shape.end}' + make_interval(mins => g), 0.5
    FROM generate_series(1, 4) g;
    ANALYZE;`);
  const counts = (await db.query(`SELECT count(*)::int n, count(*) FILTER (WHERE is_public)::int pub, count(DISTINCT user_id)::int authors FROM public.posts`)).rows[0];
  note(`${shape.tag} · ${counts.n} posts (${counts.pub} public), ${counts.authors} authors, viewer has no posts`);
  return { db, V: U(shape.tag, "member"), tag: shape.tag, burst: [1, 2, 3, 4].map((g) => md5uuid(`${shape.tag}:burst:${g}`)), author1: md5uuid(`${shape.tag}:author:1`) };
}
function md5uuid(s) { const h = createHash("md5").update(s).digest("hex"); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`; }

async function as(db, uid, sql, params = []) {
  await db.exec(`SET ROLE ${uid === null ? "anon" : "authenticated"}; SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false);`);
  try { return { rows: (await db.query(sql, params)).rows }; }
  catch (e) { return { error: e.message }; }
  finally { await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);"); }
}
const feed4 = (db, uid, ex, nf) => as(db, uid, `SELECT id, user_id, feed_tier FROM public.get_broadcast_feed($1::uuid[], 10, $2, NULL::text[])`, [ex, nf]);
const feed5 = (db, uid, ex, nf, seed) => as(db, uid, `SELECT id, user_id, feed_tier FROM public.get_broadcast_feed($1::uuid[], 10, $2, NULL::text[], $3)`, [ex, nf, seed]);
const ids = (r) => (r.rows ?? []).map((x) => x.id);
const maxRun = (rows) => { let best = 0, run = 0, last = null; for (const r of rows) { run = r.user_id === last ? run + 1 : 1; last = r.user_id; best = Math.max(best, run); } return best; };
/** Pages the way the client does: page 0 with newest_first 3, later pages 0, exclude = everything delivered, in order. */
async function session(db, uid, seed, pages = 5) {
  const out = []; let ex = [];
  for (let p = 0; p < pages; p++) {
    const r = seed === undefined ? await feed4(db, uid, ex, p === 0 ? 3 : 0) : await feed5(db, uid, ex, p === 0 ? 3 : 0, seed);
    if (r.error) return { error: r.error };
    out.push(r.rows); ex = [...ex, ...ids(r)];
  }
  return { pages: out, all: out.flat() };
}
async function view(db, uid, postIds) {
  // through RLS as the member, the way the client writes (triggers fire)
  const vals = postIds.map((p, i) => `('${uid}', '${p}', '${uid}', 'view', 1200)`).join(",");
  return as(db, uid, `INSERT INTO public.feed_events (user_id, post_id, author_id, event_type, dwell_ms) VALUES ${vals}`);
}
async function time(db, uid, sql, params, n = 15) {
  await as(db, uid, sql, params); // warm
  const t = [];
  for (let i = 0; i < n; i++) { const s = performance.now(); const r = await as(db, uid, sql, params); t.push(performance.now() - s); if (r.error) return { error: r.error }; }
  t.sort((a, b) => a - b);
  return { median: t[Math.floor(n / 2)], min: t[0], max: t[n - 1] };
}
const fmt = (t) => t.error ? `ERROR ${t.error}` : `median ${t.median.toFixed(1)} ms (min ${t.min.toFixed(1)}, max ${t.max.toFixed(1)})`;

async function latency(f, label) {
  const ex20 = [...Array(20)].map((_, i) => md5uuid(`${f.tag}:post:${i + 1}`));
  const p1 = await time(f.db, f.V, `SELECT * FROM public.get_broadcast_feed('{}'::uuid[], 10, 3, NULL::text[])`, []);
  const p3 = await time(f.db, f.V, `SELECT * FROM public.get_broadcast_feed($1::uuid[], 10, 0, NULL::text[])`, [ex20]);
  note(`${f.tag} · latency ${label} · 4-arg page 1: ${fmt(p1)}; page 3 (20 excluded): ${fmt(p3)}`);
  const has5 = (await f.db.query(`SELECT to_regprocedure('public.get_broadcast_feed(uuid[], integer, integer, text[], text)') IS NOT NULL AS x`)).rows[0].x;
  if (has5) {
    const s1 = await time(f.db, f.V, `SELECT * FROM public.get_broadcast_feed('{}'::uuid[], 10, 3, NULL::text[], 'seed-latency')`, []);
    note(`${f.tag} · latency ${label} · 5-arg page 1 (session seed): ${fmt(s1)}`);
  }
}

async function runFixture(shape) {
  console.log(`\n══ fixture ${shape.tag} ══`);
  const f = await build(shape);
  const { db, V } = f;

  // ── BEFORE: production's functions. Fail-first observations of F-REV4-8 causes 2 and 3.
  const b1 = await session(db, V, undefined, 1), b2 = await session(db, V, undefined, 1);
  ok(JSON.stringify(ids({ rows: b1.pages[0] })) === JSON.stringify(ids({ rows: b2.pages[0] })),
     `${f.tag} · BEFORE (fail-first, cause 2): two refreshes in the same hour return the IDENTICAL first screen`);
  const newest3 = (await db.query(`SELECT id FROM public.posts WHERE is_public ORDER BY created_at DESC, id LIMIT 3`)).rows.map((r) => r.id);
  await view(db, V, newest3);
  const b3 = await session(db, V, undefined, 1);
  ok(JSON.stringify(ids({ rows: b3.pages[0] }).slice(0, 3)) === JSON.stringify(newest3),
     `${f.tag} · BEFORE (fail-first, cause 3 / R-LIVE-5): the 3 newest stay pinned on top AFTER the member viewed them`);
  ok(maxRun(b1.pages[0]) >= 3, `${f.tag} · BEFORE (fail-first, variety): one author holds 3+ places in a row on the first screen`, `max run ${maxRun(b1.pages[0])}`);
  await db.exec(`DELETE FROM public.feed_events; UPDATE public.posts SET viewer_count = 0;`);
  await latency(f, "BEFORE");

  // ── the PROBE on TODAY's state (production's functions, nothing applied):
  //    refused without a lane, and with one it FAILS — it could not pass before the apply.
  let pe = null; try { await db.exec(PROBE); } catch (x) { pe = x.message; await db.exec("ROLLBACK").catch(() => {}); }
  ok(!!pe && pe.includes("PROBE REFUSED"), `${f.tag} · PROBE is lane-guarded: p32.lane unset → refused`);
  await db.exec(`SET p32.lane = '${shape.lane}'`); pe = null; try { await db.exec(PROBE); } catch (x) { pe = x.message; await db.exec("ROLLBACK").catch(() => {}); }
  ok(!!pe && pe.includes("PROBE FAIL 20261013_0005 G1"), `${f.tag} · BEFORE (fail-first): the PROBE FAILS on today's functions`, (pe ?? "").split("\n")[0].slice(0, 120));
  await db.exec(`RESET p32.lane`);

  // ── APPLY. Lane guard first.
  const oid4 = (await db.query(`SELECT to_regprocedure('public.get_broadcast_feed(uuid[], integer, integer, text[])')::oid::int AS o`)).rows[0].o;
  let e = null; try { await db.exec(MIG); } catch (x) { e = x.message; await db.exec("ROLLBACK").catch(() => {}); }
  ok(!!e && e.includes("APPLY REFUSED"), `${f.tag} · lane guard: p32.lane unset → refused`);
  await db.exec(`SET p32.lane = 'development'`); e = null; try { await db.exec(MIG); } catch (x) { e = x.message; await db.exec("ROLLBACK").catch(() => {}); }
  ok(!!e && e.includes("APPLY REFUSED"), `${f.tag} · lane guard: p32.lane = 'development' → refused`);
  await db.exec(`SET p32.lane = '${shape.lane}'`); e = null; try { await db.exec(MIG); } catch (x) { e = x.message; await db.exec("ROLLBACK").catch(() => {}); }
  ok(!e, `${f.tag} · 20261013_0005 applies with p32.lane = '${shape.lane}' (PRE + POST pass)`, e ?? "");
  if (e) return f;
  e = null; try { await db.exec(PROBE); } catch (x) { e = x.message; await db.exec("ROLLBACK").catch(() => {}); }
  ok(!e, `${f.tag} · PROBE passes after apply`, e ?? "");
  e = null; try { await db.exec(MIG); } catch (x) { e = x.message; await db.exec("ROLLBACK").catch(() => {}); }
  ok(!!e && e.includes("L2-0005-PRE-002"), `${f.tag} · re-run refused (PRE-002)`);

  // ── grants and identity
  const oid4b = (await db.query(`SELECT to_regprocedure('public.get_broadcast_feed(uuid[], integer, integer, text[])')::oid::int AS o`)).rows[0].o;
  ok(oid4 === oid4b, `${f.tag} · the 4-argument overload keeps its OID (installed apps' PostgREST cache unaffected)`);
  const acl = (await db.query(`SELECT pg_get_function_identity_arguments(oid) a, proacl::text acl FROM pg_proc WHERE proname = 'get_broadcast_feed' ORDER BY pronargs`)).rows;
  ok(acl.length === 4 && acl.every((r) => r.acl === "{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}"),
     `${f.tag} · EXECUTE on all 4 overloads = {postgres, authenticated, service_role} exactly (= production)`, acl.map((r) => r.acl).join(" | "));
  const anon5 = await feed5(db, null, [], 3, "x");
  ok(!!anon5.error && /permission denied/.test(anon5.error), `${f.tag} · anon cannot execute the 5-argument overload`);
  const anon4 = await feed4(db, null, [], 3);
  ok(!!anon4.error && /permission denied/.test(anon4.error), `${f.tag} · anon still cannot execute the 4-argument overload`);

  // ── the current client (4 args, no seed) keeps working
  const c1 = await session(db, V, undefined, 1);
  ok(!c1.error && c1.pages[0].length === 10, `${f.tag} · current client: 4-argument call returns 10 rows`, c1.error ?? "");
  const old2 = await as(db, V, `SELECT count(*)::int n FROM public.get_broadcast_feed('{}'::uuid[], 10)`);
  const old3 = await as(db, V, `SELECT count(*)::int n FROM public.get_broadcast_feed('{}'::uuid[], 10, 3)`);
  ok(old2.rows?.[0]?.n === 10 && old3.rows?.[0]?.n === 10, `${f.tag} · installed-app overloads (2-arg, 3-arg) still return 10 rows`);
  const nullSeed = await session(db, V, null, 1), blankSeed = await session(db, V, "   ", 1);
  ok(JSON.stringify(ids({ rows: nullSeed.pages[0] })) === JSON.stringify(ids({ rows: c1.pages[0] })) &&
     JSON.stringify(ids({ rows: blankSeed.pages[0] })) === JSON.stringify(ids({ rows: c1.pages[0] })),
     `${f.tag} · NULL / blank _session_seed = exactly the hourly behaviour of the 4-argument call`);

  // ── session seed: different per refresh, stable within a session, no duplicates across pages
  const s1 = await session(db, V, "11111111-aaaa-4aaa-8aaa-111111111111", 5);
  const s1b = await session(db, V, "11111111-aaaa-4aaa-8aaa-111111111111", 5);
  const s2 = await session(db, V, "22222222-bbbb-4bbb-8bbb-222222222222", 5);
  ok(JSON.stringify(ids({ rows: s1.all })) === JSON.stringify(ids({ rows: s1b.all })), `${f.tag} · same session seed → the same 5 pages (stable pagination)`);
  const p1a = ids({ rows: s1.pages[0] }), p1b = ids({ rows: s2.pages[0] });
  const overlap = p1a.filter((x) => p1b.includes(x)).length;
  ok(JSON.stringify(p1a) !== JSON.stringify(p1b) && overlap <= 5, `${f.tag} · a new refresh (new seed) → a different first screen`, `${overlap}/10 shared (the shared ones are the unseen newest)`);
  const all1 = ids({ rows: s1.all });
  ok(new Set(all1).size === all1.length && all1.length === 50, `${f.tag} · one session, 5 pages → ${all1.length} posts, no duplicates`);
  ok(s1.pages.every((p) => maxRun(p) <= 2) && maxRun(s1.all) <= 2, `${f.tag} · variety: no author more than 2 in a row, within and ACROSS pages`, `max run ${maxRun(s1.all)}`);

  // ── newest until seen (R-LIVE-5)
  const top = s1.pages[0].filter((r) => r.feed_tier === "newest").map((r) => r.id);
  const newest3b = (await db.query(`SELECT id FROM public.posts WHERE is_public ORDER BY created_at DESC, id LIMIT 3`)).rows.map((r) => r.id);
  ok(top.length === 3 && top.every((x) => newest3b.includes(x)), `${f.tag} · unseen newest 3 lead page 1 (tier 'newest')`);
  const burstPos = s1.pages[0].map((r) => r.id).map((x, i) => (f.burst.includes(x) ? i : -1)).filter((i) => i >= 0);
  ok(burstPos[0] === 0 && burstPos[1] === 1 && (burstPos[2] ?? 99) >= 3, `${f.tag} · burst author's newest posts: places 1–2, the 3rd waits (variety)`, `positions ${burstPos.join(",")}`);
  const w = await view(db, V, p1a);
  ok(!w.error, `${f.tag} · the member's view events insert through RLS + the 3 production triggers`, w.error ?? "");
  const s3 = await session(db, V, "33333333-cccc-4ccc-8ccc-333333333333", 1);
  const afterIds = ids({ rows: s3.pages[0] });
  ok(afterIds.filter((x) => p1a.includes(x)).length === 0, `${f.tag} · after views exist, the next refresh shows NONE of the viewed posts on its first screen`);
  ok(!s3.pages[0].some((r) => r.feed_tier === "newest" && p1a.includes(r.id)), `${f.tag} · viewed newest posts are no longer pinned (R-LIVE-5)`);
  const hourAfter = await session(db, V, undefined, 1);
  ok(ids({ rows: hourAfter.pages[0] }).filter((x) => p1a.includes(x)).length === 0, `${f.tag} · even the current client (hourly seed) gets a different first screen once views exist`);

  // ── clamps and odd input
  const big = await as(db, V, `SELECT count(*)::int n FROM public.get_broadcast_feed('{}'::uuid[], 1000, 3, NULL::text[], 'x')`);
  const nul = await as(db, V, `SELECT count(*)::int n FROM public.get_broadcast_feed('{}'::uuid[], NULL, 3, NULL::text[], 'x')`);
  ok(big.rows?.[0]?.n === 50 && nul.rows?.[0]?.n === 10, `${f.tag} · _limit clamped: 1000 → 50, NULL → 10`, `${big.rows?.[0]?.n} / ${nul.rows?.[0]?.n}`);
  const long = await feed5(db, V, [], 3, "x".repeat(10000));
  const nullEx = await as(db, V, `SELECT count(*)::int n FROM public.get_broadcast_feed(NULL, 10, 3, NULL::text[], 'x')`);
  ok(!long.error && long.rows.length === 10 && nullEx.rows?.[0]?.n === 10, `${f.tag} · 10,000-char seed and NULL _exclude_ids are handled`);

  // ── CROSS-MEMBER. SECURITY DEFINER bypasses RLS: the WHERE clauses are the only control.
  //    W is a second member: accepted friend of author 2, a PENDING request from author 3.
  const W = U(f.tag, "member2");
  const a2 = md5uuid(`${f.tag}:author:2`), a3 = md5uuid(`${f.tag}:author:3`);
  const F_OK = md5uuid(`${f.tag}:xm:friends-ok`), PRIV = md5uuid(`${f.tag}:xm:private`), F_NO = md5uuid(`${f.tag}:xm:friends-no`);
  await db.exec(`
    INSERT INTO public.profiles_public_data (id, full_name) VALUES ('${W}', 'member 2');
    INSERT INTO public.friendships (requester_id, addressee_id, status) VALUES ('${W}', '${a2}', 'accepted'), ('${a3}', '${W}', 'pending');
    INSERT INTO public.posts (id, user_id, content, privacy, created_at, rand_key) VALUES
      ('${F_OK}', '${a2}', 'friends-only, by an accepted friend', 'friends', timestamptz '${shape.end}' + interval '10 minutes', 0.5),
      ('${PRIV}', '${a3}', 'private',                             'private', timestamptz '${shape.end}' + interval '11 minutes', 0.5),
      ('${F_NO}', '${a3}', 'friends-only, friendship pending',    'friends', timestamptz '${shape.end}' + interval '12 minutes', 0.5);`);
  const xw = await session(db, W, "xm-w", 5), xv = await session(db, V, "xm-v", 5);
  const wIds = ids({ rows: xw.all }), vIds = ids({ rows: xv.all });
  ok(xw.pages[0].some((r) => r.id === F_OK && r.feed_tier === "newest"), `${f.tag} · cross-member: an accepted friend's friends-only post reaches the friend (newest, pinned)`);
  ok(!wIds.includes(PRIV) && !wIds.includes(F_NO), `${f.tag} · cross-member: another member's PRIVATE post and a pending-friend's friends-only post never reach them — though both are newer than everything`);
  ok(!vIds.includes(F_OK) && !vIds.includes(PRIV) && !vIds.includes(F_NO), `${f.tag} · cross-member: a member with no friendship gets none of the three`);
  // 500 rows each (10 pages × the 50-row clamp): every delivered row is one the caller may read.
  const deep = async (uid, seed) => { const got = []; for (let p = 0; p < 10; p++) { const r = await as(db, uid, `SELECT id FROM public.get_broadcast_feed($1::uuid[], 50, $2, NULL::text[], $3)`, [got, p === 0 ? 3 : 0, seed]); if (r.error) return { error: r.error }; got.push(...ids(r)); } return { got }; };
  const dw = await deep(W, "xm-deep-w"), dv = await deep(V, "xm-deep-v");
  const forbidden = async (uid, got, friend) => (await db.query(
    `SELECT count(*)::int n FROM public.posts WHERE id = ANY($1::uuid[]) AND NOT (is_public OR user_id = $2 OR (privacy = 'friends' AND user_id = $3))`, [got, uid, friend])).rows[0].n;
  ok(!dw.error && !dv.error && dw.got.length === new Set(dw.got).size && (await forbidden(W, dw.got, a2)) === 0 && (await forbidden(V, dv.got, V)) === 0,
     `${f.tag} · cross-member: ${dw.got?.length ?? 0} + ${dv.got?.length ?? 0} delivered rows, every one public, the caller's own, or an accepted friend's friends-only post`, dw.error ?? dv.error ?? "");
  // one member's "seen" never reaches another member's page, and RLS keeps the events private
  const vBefore = await session(db, V, "xm-stable", 2);
  const wv = await view(db, W, ids({ rows: vBefore.pages[0] }));
  const vAfter = await session(db, V, "xm-stable", 2);
  ok(!wv.error && JSON.stringify(ids({ rows: vBefore.all })) === JSON.stringify(ids({ rows: vAfter.all })), `${f.tag} · cross-member: another member's views do not change this member's pages`, wv.error ?? "");
  const peek = await as(db, V, `SELECT count(*)::int n FROM public.feed_events WHERE user_id = '${W}'`);
  const forge = await as(db, V, `INSERT INTO public.feed_events (user_id, post_id, author_id, event_type) VALUES ('${W}', '${F_OK}', '${a2}', 'view')`);
  ok(peek.rows?.[0]?.n === 0 && !!forge.error && /row-level security/.test(forge.error), `${f.tag} · cross-member: a member cannot read another member's events, nor record one in their name (RLS)`, forge.error ?? "no error");
  // _exclude_ids: an id of a post the caller cannot read must not move anything (no "who wrote post P" oracle)
  const o1 = await feed5(db, V, [], 0, "xm-oracle");
  const topAuthor = o1.rows[0].user_id;
  const PX = md5uuid(`${f.tag}:xm:private-of-top-author`);
  await db.exec(`INSERT INTO public.posts (id, user_id, content, privacy, created_at, rand_key) VALUES ('${PX}', '${topAuthor}', 'private, by the author of the top-ranked post', 'private', timestamptz '${shape.start}', 0.5)`);
  const o2 = await feed5(db, V, [PX, PX], 0, "xm-oracle");
  ok(JSON.stringify(ids(o1)) === JSON.stringify(ids(o2)), `${f.tag} · cross-member: an id the caller cannot see in _exclude_ids changes nothing (the page order cannot confirm who wrote it)`);
  const pub2 = (await db.query(`SELECT id FROM public.posts WHERE user_id = $1 AND is_public AND NOT (id = ANY($2::uuid[])) ORDER BY created_at LIMIT 2`, [topAuthor, ids(o1)])).rows.map((r) => r.id);
  const o3 = await feed5(db, V, pub2, 0, "xm-oracle");
  ok(pub2.length === 2 && !o3.error && o3.rows[0].user_id !== topAuthor, `${f.tag} · …while two VISIBLE posts by that author as the tail still make their next post wait (the rule across pages)`);

  // ── the OFF-2 contract line this PR adds: feed_events is 'natural' on (id)
  const EID = md5uuid(`${f.tag}:xm:event`);
  const once = `INSERT INTO public.feed_events (id, user_id, post_id, author_id, event_type, dwell_ms) VALUES ('${EID}', $1, '${p1b[0]}', $1, 'view', 1000) ON CONFLICT (id) DO NOTHING`;
  const e1 = await as(db, V, once, [V]), e2 = await as(db, V, once, [V]), eW = await as(db, W, once, [W]);
  const eRow = (await db.query(`SELECT user_id FROM public.feed_events WHERE id = '${EID}'`)).rows;
  const pk = (await db.query(`SELECT count(*)::int n FROM pg_index i WHERE i.indrelid = 'public.feed_events'::regclass AND i.indisunique AND i.indisvalid AND i.indpred IS NULL AND i.indexprs IS NULL
                                AND (SELECT array_agg(a.attname::text) FROM unnest(i.indkey) k(attnum) JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum) = ARRAY['id']`)).rows[0].n;
  ok(!e1.error && !e2.error && !eW.error && eRow.length === 1 && eRow[0].user_id === V && pk === 1,
     `${f.tag} · exactly once: one event id sent three times through RLS + triggers (twice by its member, once replayed by another) is ONE row, still its member's (ON CONFLICT (id) DO NOTHING on feed_events_pkey)`, e1.error ?? e2.error ?? eW.error ?? "");
  // today's table, NOT changed by this unit — recorded because the client must know it
  const selfLike = await as(db, f.author1, `INSERT INTO public.feed_events (user_id, post_id, author_id, event_type) VALUES ('${f.author1}', '${f.burst[0]}', '${f.author1}', 'like')`);
  ok(!!selfLike.error && /feed_events_event_type_check/.test(selfLike.error), `${f.tag} · today's table (unchanged here): a like on the member's OWN post is refused — validate_feed_event_author renames it 'self_like', which the table's CHECK does not allow; one such row fails its whole batch, so the client never records own-post actions (PR B)`, (selfLike.error ?? "no error").slice(0, 90));
  await db.exec(`DELETE FROM public.posts WHERE id IN ('${F_OK}', '${PRIV}', '${F_NO}', '${PX}'); DELETE FROM public.friendships; DELETE FROM public.profiles_public_data WHERE id = '${W}';`);

  await db.exec(`DELETE FROM public.feed_events; UPDATE public.posts SET viewer_count = 0;`);
  await latency(f, "AFTER");

  // ── ROLLBACK, then the PROBE must refuse, then re-apply
  e = null; try { await db.exec(RB); } catch (x) { e = x.message; await db.exec("ROLLBACK").catch(() => {}); }
  ok(!e, `${f.tag} · rollback applies (RB-PRE + RB-POST pass)`, e ?? "");
  const rbmd5 = (await db.query(`SELECT md5(prosrc) m, to_regprocedure('public.get_broadcast_feed(uuid[], integer, integer, text[])')::oid::int o FROM pg_proc WHERE oid = to_regprocedure('public.get_broadcast_feed(uuid[], integer, integer, text[])')`)).rows[0];
  ok(rbmd5.m === "96a65d7037ecc5351da75a28f8cace73" && rbmd5.o === oid4, `${f.tag} · rollback restores production's 4-argument body (md5 96a65d70…) on the same OID`);
  e = null; try { await db.exec(PROBE); } catch (x) { e = x.message; await db.exec("ROLLBACK").catch(() => {}); }
  ok(!!e && e.includes("PROBE FAIL"), `${f.tag} · PROBE refuses the rolled-back state`, (e ?? "").split("\n")[0].slice(0, 90));
  e = null; try { await db.exec(RB); } catch (x) { e = x.message; await db.exec("ROLLBACK").catch(() => {}); }
  ok(!!e && e.includes("RB-PRE-001"), `${f.tag} · rollback twice refused (RB-PRE-001)`);
  e = null; try { await db.exec(MIG); await db.exec(PROBE); } catch (x) { e = x.message; await db.exec("ROLLBACK").catch(() => {}); }
  ok(!e, `${f.tag} · re-apply after rollback, PROBE passes again`, e ?? "");
  return f;
}

// ── A0 · why _session_seed has no DEFAULT (once, on a bare instance)
{
  console.log("\n══ A0 · the DEFAULT trap ══");
  const db = new PGlite();
  await db.exec(PLATFORM); await db.exec(FIX); await db.exec(TRIGGERS_AND_ACLS);
  await db.exec(`CREATE FUNCTION public.get_broadcast_feed(_exclude_ids uuid[], _limit integer, _newest_first integer, _categories text[], _session_seed text DEFAULT NULL)
                 RETURNS SETOF uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$`);
  let e = null;
  try { await db.query(`SELECT * FROM public.get_broadcast_feed(_exclude_ids => '{}'::uuid[], _limit => 10, _newest_first => 3, _categories => NULL::text[])`); } catch (x) { e = x.message; await db.exec("ROLLBACK").catch(() => {}); }
  ok(!!e && /not unique/.test(e), "A0 · a 5-argument overload WITH a default makes today's 4-argument call fail", e ?? "no error");
}

await runFixture({ tag: "S", lane: "staging", looseAcl: true, posts: 10914, members: 50, privacy: { public: 8726, friends: 1080, private: 1108 },
                   start: "2026-07-27 06:46:30+00", end: "2026-10-11 12:23:28+00", prolificShare: 0 });
await runFixture({ tag: "P", lane: "production", posts: 300, members: 80, privacy: { public: 276, friends: 15, private: 9 },
                   start: "2026-04-01 00:00:00+00", end: "2026-10-12 00:00:00+00", prolificShare: 0.3 });

if (SCALE) {
  console.log("\n══ scale · 100,000 posts, 2,000 members, 1,000,000 feed_events ══");
  const f = await build({ tag: "X", posts: 100000, members: 2000, privacy: { public: 92000, friends: 5000, private: 3000 },
                          start: "2025-10-01 00:00:00+00", end: "2026-10-12 00:00:00+00", prolificShare: 0.02 });
  const { db } = f;
  const heavy = md5uuid("X:author:7"), light = md5uuid("X:author:8");
  const t0 = performance.now();
  await db.exec(`ALTER TABLE public.feed_events DISABLE TRIGGER USER;
    -- heavy member: 50,000 view events over 90 days on 40,000 distinct posts; light member: 2,000; everyone else: the rest
    INSERT INTO public.feed_events (user_id, post_id, author_id, event_type, dwell_ms, created_at)
    SELECT '${heavy}', md5('X:post:' || (1 + (g % 40000)))::uuid, '${heavy}', 'view', 1500, now() - make_interval(secs => g * 155)
    FROM generate_series(1, 50000) g;
    INSERT INTO public.feed_events (user_id, post_id, author_id, event_type, dwell_ms, created_at)
    SELECT '${light}', md5('X:post:' || (1 + (g % 2000)))::uuid, '${light}', 'view', 1500, now() - make_interval(secs => g * 3800)
    FROM generate_series(1, 2000) g;
    INSERT INTO public.feed_events (user_id, post_id, author_id, event_type, dwell_ms, created_at)
    SELECT md5('X:author:' || (g % 2000))::uuid, md5('X:post:' || (1 + (g % 100000)))::uuid, md5('X:author:0')::uuid,
           CASE WHEN g % 10 = 0 THEN 'like' ELSE 'view' END, 1500, now() - make_interval(secs => g * 7)
    FROM generate_series(1, 948000) g;
    ALTER TABLE public.feed_events ENABLE TRIGGER USER;`);
  await db.exec('VACUUM ANALYZE public.feed_events');
  note(`loaded 1,000,000 events in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  const myEvents = (uid) => `EXPLAIN (ANALYZE, BUFFERS) SELECT fe.post_id, count(*) FILTER (WHERE fe.event_type = 'view') AS views,
      count(*) FILTER (WHERE fe.event_type = 'skip') AS skips, max(fe.created_at) AS last_seen_at
      FROM public.feed_events fe WHERE fe.user_id = '${uid}' AND fe.event_type IN ('view', 'skip') GROUP BY fe.post_id`;
  const plan = async (sql) => (await db.query(sql)).rows.map((r) => r["QUERY PLAN"]);
  // One cold run says little in a WASM Postgres (two single runs of this file disagreed
  // on the direction): 9 warm runs, the median execution time, the last run's buffers.
  const planN = async (sql, n = 9) => {
    let last = []; const ms = [];
    for (let i = 0; i < n; i++) { last = await plan(sql); ms.push(parseFloat(/Execution Time: ([\d.]+) ms/.exec(last.join("\n"))[1])); }
    ms.sort((x, y) => x - y);
    return `${last.find((l) => /Scan/.test(l))?.trim().split("  (")[0]} · ${last.find((l) => /Buffers/.test(l))?.trim()} · execution median ${ms[n >> 1].toFixed(1)} ms (min ${ms[0].toFixed(1)}, max ${ms[n - 1].toFixed(1)}; ${n} warm runs)`;
  };
  // What one more index costs every "seen" write: 5,000 rows in one statement,
  // triggers off (index upkeep only), rolled back.
  const insertCost = async (n = 5) => {
    const ms = [];
    for (let i = 0; i < n; i++) {
      await db.exec("BEGIN; ALTER TABLE public.feed_events DISABLE TRIGGER USER;");
      const s = performance.now();
      await db.exec(`INSERT INTO public.feed_events (user_id, post_id, author_id, event_type, dwell_ms)
        SELECT md5('X:author:' || (g % 2000))::uuid, md5('X:post:' || (1 + (g % 100000)))::uuid, md5('X:author:0')::uuid, 'view', 1000 FROM generate_series(1, 5000) g`);
      ms.push(performance.now() - s);
      await db.exec("ROLLBACK");
    }
    ms.sort((x, y) => x - y);
    return `median ${ms[n >> 1].toFixed(0)} ms per 5,000 rows (min ${ms[0].toFixed(0)}, max ${ms[n - 1].toFixed(0)}; ${n} runs)`;
  };
  const rpc4 = `SELECT * FROM public.get_broadcast_feed('{}'::uuid[], 10, 3, NULL::text[])`;
  const rpc5 = `SELECT * FROM public.get_broadcast_feed('{}'::uuid[], 10, 3, NULL::text[], 'scale')`;

  // Each state: the my_events step, then the whole RPC, on a freshly vacuumed
  // table; the insert measurement comes LAST in its state (its rolled-back rows
  // are dead tuples) and the table is vacuumed again before the next state.

  // 1 · today's function (production's 4-argument body), today's 8 indexes
  const rpcOldHeavy = await time(db, heavy, rpc4, [], 15), rpcOldLight = await time(db, light, rpc4, [], 15);

  // 2 · the migration's function on today's 8 indexes — exactly what 20261013_0005
  //     ships (it creates no index; the DROP is a guard that does nothing)
  await db.exec(`SET p32.lane = 'staging'`); await db.exec(MIG);
  await db.exec("DROP INDEX IF EXISTS public.idx_feed_events_user_seen"); await db.exec("VACUUM ANALYZE public.feed_events");
  const noIdx = { heavy: await planN(myEvents(heavy)), light: await planN(myEvents(light)) };
  const rpcNewHeavy = await time(db, heavy, rpc5, [], 15), rpcNewLight = await time(db, light, rpc5, [], 15);
  noIdx.ins = await insertCost();
  const sizes8 = (await db.query(`SELECT pg_size_pretty(pg_relation_size('public.feed_events')) AS heap, pg_size_pretty(pg_indexes_size('public.feed_events')) AS idx`)).rows[0];

  // 3 · the same function plus the CANDIDATE covering index, which the migration does NOT create
  await db.exec(CANDIDATE_INDEX); await db.exec("VACUUM ANALYZE public.feed_events");
  const withIdx = { heavy: await planN(myEvents(heavy)), light: await planN(myEvents(light)) };
  const rpcIdxHeavy = await time(db, heavy, rpc5, [], 15), rpcIdxLight = await time(db, light, rpc5, [], 15);
  withIdx.ins = await insertCost();
  const sizes = (await db.query(`SELECT pg_size_pretty(pg_relation_size('public.feed_events')) AS heap, pg_size_pretty(pg_indexes_size('public.feed_events')) AS idx,
                                        pg_size_pretty(pg_relation_size('public.idx_feed_events_user_seen')) AS cand`)).rows[0];

  note(`my_events · heavy member (50,000 events) · today's 8 indexes : ${noIdx.heavy}`);
  note(`my_events · heavy member (50,000 events) · + candidate index : ${withIdx.heavy}`);
  note(`my_events · light member (2,000 events)  · today's 8 indexes : ${noIdx.light}`);
  note(`my_events · light member (2,000 events)  · + candidate index : ${withIdx.light}`);
  note(`RPC page 1 · heavy member · today's 4-arg ${fmt(rpcOldHeavy)} · new 5-arg, 8 indexes ${fmt(rpcNewHeavy)} · new 5-arg + candidate ${fmt(rpcIdxHeavy)}`);
  note(`RPC page 1 · light member · today's 4-arg ${fmt(rpcOldLight)} · new 5-arg, 8 indexes ${fmt(rpcNewLight)} · new 5-arg + candidate ${fmt(rpcIdxLight)}`);
  note(`insert upkeep · 8 indexes: ${noIdx.ins} · 9 indexes: ${withIdx.ins}`);
  note(`sizes at 1,000,000 events · heap ${sizes8.heap} · today's 8 indexes ${sizes8.idx} · with the candidate ${sizes.idx} (the candidate alone ${sizes.cand})`);
  ok(/Index Only Scan using idx_feed_events_user_seen/.test(withIdx.heavy) && /Bitmap Heap Scan|Index Scan/.test(noIdx.heavy),
     "scale · measured both ways: today's indexes serve my_events (idx_feed_events_user_post); the candidate makes it index-only — fewer buffers; the times above are why it is NOT shipped");
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
