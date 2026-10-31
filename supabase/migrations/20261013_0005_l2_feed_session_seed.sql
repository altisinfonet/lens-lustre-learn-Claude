-- ═══════════════════════════════════════════════════════════════════════════
-- 20261013_0005 — Stage L2 (F-REV4-8): the feed is dealt per refresh, the
-- newest posts lead only until the member has seen them, and no author fills
-- more than two places in a row. EXPAND step: the current client keeps working.
-- Lanes: staging and production (refuses any other lane).
-- D1 (Database & Runtime), 2026-10-13. Plan REV4 §6 Stage L2; R-LIVE-5, R-LIVE-6.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHY (F-REV4-8, "refresh shows the same pictures"). Three causes, two of them here:
--   cause 2 — get_broadcast_feed seeds its order with
--             to_char(now(),'YYYYMMDDHH24') || auth.uid(): every refresh inside
--             the same clock hour gets the same order;
--   cause 3 — the client asks for the 3 newest posts on page 1 and the RPC puts
--             them on top whether or not the member has already seen them.
--   (cause 1, "seen" never recorded, is the client half — Stage L2 PR B.)
-- Owner rulings: R-LIVE-5 (13 Oct, "YES") — "newest posts first on refresh"
-- applies only until the member has seen them. R-LIVE-6 — Stage L approved.
--
-- WHAT THIS FILE DOES
--   1. NEW  public.get_broadcast_feed(_exclude_ids uuid[], _limit integer,
--           _newest_first integer, _categories text[], _session_seed text)
--      = production's 4-argument body (read 2026-10-13, md5 96a65d70…) with:
--        a. the seed: a non-blank _session_seed (max 64 chars used) replaces the
--           hour, still combined with auth.uid(), so two members who somehow
--           sent the same seed still get different orders. NULL or blank →
--           exactly today's hourly seed (the text is unchanged).
--        b. newest-until-seen: the _newest_first newest posts lead page 1 only
--           if the caller has NOT seen them (same "seen" rule as today:
--           views > 0, or skips ≥ 2, or one skip in the last 12 h). A seen one
--           drops to the recycled tier like any other seen post.
--        c. variety: no author holds more than 2 consecutive places. Greedy over
--           the ranked list (3 × _limit candidates): a post that would be the
--           third in a row from one author waits for the next place another
--           author can take; if only that author is left it is placed anyway.
--           The rule continues across pages: the authors of the last two ids in
--           _exclude_ids (the client appends in delivery order) seed it.
--           Not a shuffle — the fairness order is kept wherever the rule holds.
--        d. _limit is clamped to 0…50 (NULL → 10). Today NULL meant "no limit".
--      Everything else is today's text: the candidate pool (feed_candidates),
--      the three tiers and their order, the fairness score, the recycled order,
--      the 15 returned columns.
--   2. The 4-argument overload becomes a one-line wrapper:
--        SELECT * FROM get_broadcast_feed(_exclude_ids, _limit, _newest_first,
--                                         _categories, NULL::text)
--      CREATE OR REPLACE keeps its OID and its ACL. The 2- and 3-argument
--      overloads (installed Android 1.2.21 calls these) are not touched: they
--      already delegate to the 4-argument one, so they get (b)–(d) with the
--      hourly seed. So does the current web client.
--   Nothing else. No table, policy, trigger, table grant or index changes.
--
-- WHY _session_seed HAS NO DEFAULT (deviation from the plan's wording, same
-- intent). The plan says "optional _session_seed text DEFAULT NULL". With the
-- 4-argument overload still present, a 5-argument overload WITH a default makes
-- every 4-argument call ambiguous ("function … is not unique" in Postgres,
-- PGRST203 in PostgREST) — the current client would break on apply. Proven on
-- PGlite (docs/evidence/d1/L2-feed-freshness, test A0), and the same trap is
-- already pinned for _categories by src/__tests__/postCategoriesPhaseB.test.ts.
-- So the seed is optional the way _categories became optional in 20260812070000:
-- the shorter overload supplies NULL.
--
-- GRANTS. Production (read 2026-10-13) grants EXECUTE on all three existing
-- overloads to exactly postgres, authenticated, service_role (no PUBLIC, no
-- anon); staging is identical. The new overload gets exactly that, explicitly
-- (REVOKE FROM PUBLIC, anon; GRANT TO authenticated, service_role) — not left to
-- either lane's default privileges — and POST-003 asserts the full ACL set of
-- all four overloads by aclexplode and by has_function_privilege.
--
-- SECURITY DEFINER, judged by its WHERE clauses (unchanged in kind): the viewer
-- is auth.uid() only — no argument names a member. Visibility comes from
-- feed_candidates() (public posts, the caller's own, accepted friends' friends-
-- only posts) exactly as today. _exclude_ids can only REMOVE posts from the
-- caller's own page. Its last two ids seed the variety rule with those posts'
-- authors, read ONLY for posts the caller may see (public, own, an accepted
-- friend's friends-only post — the `tail` step). Without that predicate the
-- order of a page would confirm or deny "member X wrote post P" for a post the
-- caller cannot read; with it such an id changes nothing (PGlite: "an id the
-- caller cannot see in _exclude_ids"). Nothing from those two posts is
-- returned. _session_seed is hashed, never executed or stored. One member's
-- events never reach another member's page: my_events reads user_id =
-- auth.uid() only (PGlite: "another member's views").
--
-- EVIDENCE (Step 0, 2026-10-13; who read what, and when, is in
-- docs/evidence/d1/L2-feed-freshness/measurements.txt):
--   * production — FILES ONLY (the Owner's read-only collection of 2026-10-13;
--     this unit never connected to production): get_broadcast_feed 2/3/4-arg
--     md5(prosrc) = the three values PRE-001 pins, ACL {postgres, authenticated,
--     service_role} on each; feed_candidates and feed_rank_score md5 as pinned;
--     feed_events = 7 columns, one CHECK, one FK, 8 indexes (two identical on
--     post_id), 3 triggers, 6 policies.
--   * staging — the same five bodies (md5 equal), the same three ACLs, the same
--     feed_events indexes, triggers and policies (the staging read of
--     2026-10-13, kept as files); feed_events held 0 rows when the first
--     preparer session read it. NOT re-measured live when this file was
--     finished — the read-only connector was down: EXPLAIN of the my_events
--     step and the RPC's latency on staging are owed, before and after apply.
--   * behaviour, fail-first, grants, cross-member and rollback: PGlite, on a
--     staging-shaped and a production-shaped fixture built from production's own
--     function bodies — pglite-l2-feed.mjs / pglite-l2-feed-output.txt.
--
-- NO INDEX — MEASURED, THEN LEFT OUT. A covering index for the my_events step,
-- (user_id, post_id) INCLUDE (event_type, created_at) WHERE view/skip, was built
-- and measured at 100,000 posts / 1,000,000 events (PGlite, three runs, 9 warm
-- executions each; measurements.txt has all three):
--   the same in every run
--     member with 50,000 events   1,232 -> 418 buffers
--     member with  2,000 events     507 ->  24 buffers
--     size                        +60 MB on a 114 MB heap (indexes 201 -> 261 MB)
--   not the same twice (a shared machine)
--     execution, 50,000 events    292 -> 323 ms · 506 -> 483 ms · 747 -> 527 ms
--     execution,  2,000 events     23 ->  17 ms ·  26 ->  17 ms ·  30 ->  31 ms
--     insert upkeep, 5,000 rows   819 -> 1,033 ms (+26 %) · 1,398 -> 2,755 ms (+97 %)
-- Fewer buffers, no time reliably won, more work on every "seen" write, and a
-- ninth index on a table whose eight are already 1.8 x its heap at that volume
-- (P28's ratio) — one nobody may drop again until C-2 is reconciled. The table
-- holds 0 rows on staging today and idx_feed_events_user_post already serves
-- user_id = auth.uid(). FOLLOW-UP (its own unit, once the table has real
-- volume): re-measure on staging and decide index and retention together.
--
-- RETENTION — NOT IN THIS FILE, on purpose: a 90-day clean-up would delete
-- nothing before ~2027-01 (the table starts at 0 rows when PR B connects the
-- tracker), and purging views would LOWER the view counts members see —
-- get_post_view_counts() counts distinct viewers from feed_events. It is a
-- follow-up unit with a deadline, together with moving the visible count off
-- the raw events.
--
-- LOCKING. CREATE FUNCTION / CREATE OR REPLACE: catalog only; no table is
-- locked. lock_timeout 5 s.
-- RE-RUN: refused by PRE-002 once applied. After the rollback it applies again.
-- ROLLBACK: supabase/rollback/20261013_0005_l2_feed_session_seed_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261013_0005_l2_feed_session_seed.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $preconditions$
DECLARE
  _bad text := '';
  r    record;
BEGIN
  -- PRE-002 · not applied already (checked first, so a re-run says so plainly).
  IF to_regprocedure('public.get_broadcast_feed(uuid[], integer, integer, text[], text)') IS NOT NULL THEN
    RAISE EXCEPTION 'L2-0005-PRE-002: the 5-argument get_broadcast_feed already exists — 20261013_0005 is applied'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- PRE-001 · the functions this file replaces or calls are exactly production's
  -- 2026-10-13 bodies, owned by the role running this file, with production's ACL.
  FOR r IN
    SELECT v.sig, v.want_md5, v.want_acl, p.oid AS fn_oid, md5(p.prosrc) AS got_md5,
           p.proowner = current_user::regrole AS owned
      FROM (VALUES
        ('get_broadcast_feed(_exclude_ids uuid[], _limit integer)',
         '6ff8f8ea3d8c8cf76e9abe0bd728915e', true),
        ('get_broadcast_feed(_exclude_ids uuid[], _limit integer, _newest_first integer)',
         '59cebfbcfd89f6ad49e46399ee6fe4e2', true),
        ('get_broadcast_feed(_exclude_ids uuid[], _limit integer, _newest_first integer, _categories text[])',
         '96a65d7037ecc5351da75a28f8cace73', true),
        ('feed_candidates(_seed text, _categories text[], _recent integer, _sample integer, _own integer, _friends integer)',
         '288ea6c01b82d1c5ab7f541de3fa3f46', false),
        ('feed_rank_score(_id uuid, _bucket integer, _seed text)',
         '3ae7718671ed2245f34c01c141164d80', false)
      ) AS v(sig, want_md5, want_acl)
      LEFT JOIN pg_proc p
        ON p.pronamespace = 'public'::regnamespace
       AND p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')' = v.sig
  LOOP
    IF r.fn_oid IS NULL THEN
      _bad := _bad || E'\n  ' || r.sig || ': missing';
      CONTINUE;
    END IF;
    IF r.got_md5 IS DISTINCT FROM r.want_md5 THEN
      _bad := _bad || E'\n  ' || r.sig || ': body md5 ' || r.got_md5 || ', expected ' || r.want_md5;
    END IF;
    IF NOT r.owned THEN
      _bad := _bad || E'\n  ' || r.sig || ': not owned by ' || current_user;
    END IF;
    IF r.want_acl AND (
         has_function_privilege('public', r.fn_oid, 'EXECUTE')
      OR has_function_privilege('anon', r.fn_oid, 'EXECUTE')
      OR NOT has_function_privilege('authenticated', r.fn_oid, 'EXECUTE')
      OR NOT has_function_privilege('service_role', r.fn_oid, 'EXECUTE')) THEN
      _bad := _bad || E'\n  ' || r.sig || ': EXECUTE is not exactly authenticated + service_role (+ owner)';
    END IF;
  END LOOP;
  IF _bad <> '' THEN
    RAISE EXCEPTION 'L2-0005-PRE-001: the feed functions are not the 2026-10-13 production definitions this file was written against:%', _bad
      USING ERRCODE = 'raise_exception';
  END IF;

  -- PRE-003 · the columns the new body reads exist (feed_events for "seen";
  -- posts and friendships for the tail step's visibility predicate).
  IF (SELECT count(*) FROM pg_attribute
       WHERE attrelid = 'public.feed_events'::regclass AND NOT attisdropped
         AND attname IN ('user_id', 'post_id', 'event_type', 'created_at')) <> 4
     OR (SELECT count(*) FROM pg_attribute
          WHERE attrelid = 'public.posts'::regclass AND NOT attisdropped
            AND attname IN ('id', 'user_id', 'privacy', 'is_public', 'created_at')) <> 5
     OR (SELECT count(*) FROM pg_attribute
          WHERE attrelid = 'public.friendships'::regclass AND NOT attisdropped
            AND attname IN ('requester_id', 'addressee_id', 'status')) <> 3 THEN
    RAISE EXCEPTION 'L2-0005-PRE-003: feed_events, posts or friendships lacks a column the new get_broadcast_feed reads'
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── 1. the new overload ────────────────────────────────────────────────────
CREATE FUNCTION public.get_broadcast_feed(
  _exclude_ids  uuid[],
  _limit        integer,
  _newest_first integer,
  _categories   text[],
  _session_seed text
)
 RETURNS TABLE(id uuid, user_id uuid, content text, image_url text, image_urls text[], privacy text, created_at timestamp with time zone, likes_count integer, comments_count integer, shares_count integer, feed_tier text, author_name text, author_avatar text, thumbnail_urls text[], categories text[])
 LANGUAGE sql
 VOLATILE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH RECURSIVE seed AS (
    -- A refresh sends a new random seed and keeps it for every page of that
    -- session (stable pages, _exclude_ids keeps them duplicate-free). No seed:
    -- today's per-viewer, per-hour seed, unchanged.
    SELECT CASE
             WHEN nullif(btrim(_session_seed), '') IS NULL
               THEN to_char(now(), 'YYYYMMDDHH24') || coalesce(auth.uid()::text, 'anon')
             ELSE 'session:' || left(btrim(_session_seed), 64) || ':' || coalesce(auth.uid()::text, 'anon')
           END AS s
  ),
  lim AS (
    SELECT LEAST(GREATEST(coalesce(_limit, 10), 0), 50) AS n
  ),
  pool AS (
    SELECT c.id, c.user_id, c.created_at, c.bucket
    FROM seed, public.feed_candidates(seed.s, _categories) c
    WHERE NOT (c.id = ANY(COALESCE(_exclude_ids, '{}'::uuid[])))
  ),
  visible AS (
    SELECT pl.id, p.user_id, p.content, p.image_url, p.image_urls, p.privacy,
           p.created_at, p.likes_count, p.comments_count, p.shares_count, pl.bucket
    FROM pool pl
    JOIN public.posts p ON p.id = pl.id
  ),
  my_events AS (
    SELECT fe.post_id,
           count(*) FILTER (WHERE fe.event_type = 'view') AS views,
           count(*) FILTER (WHERE fe.event_type = 'skip') AS skips,
           max(fe.created_at)                             AS last_seen_at
    FROM public.feed_events fe
    WHERE fe.user_id = auth.uid()
      AND fe.event_type IN ('view', 'skip')
    GROUP BY fe.post_id
  ),
  seen AS (
    SELECT e.post_id, e.last_seen_at
    FROM my_events e
    WHERE e.views > 0
       OR e.skips >= 2
       OR (e.skips = 1 AND e.last_seen_at > now() - interval '12 hours')
  ),
  -- R-LIVE-5: the newest posts lead page 1 only until this member has seen them.
  -- The N newest visible posts are taken first, THEN the seen ones are dropped —
  -- so an old post never gets pinned just because it is the newest unseen one.
  newest AS (
    SELECT v.*, row_number() OVER (ORDER BY v.created_at DESC, v.id) AS rn
    FROM (
      SELECT v0.*
      FROM visible v0
      ORDER BY v0.created_at DESC, v0.id
      LIMIT LEAST(GREATEST(coalesce(_newest_first, 0), 0), (SELECT n FROM lim))
    ) v
    WHERE NOT EXISTS (SELECT 1 FROM seen s WHERE s.post_id = v.id)
  ),
  unseen_ranked AS (
    SELECT v.*,
           row_number() OVER (
             ORDER BY public.feed_rank_score(v.id, v.bucket, (SELECT s FROM seed)) ASC, v.id
           ) AS rn
    FROM visible v
    WHERE NOT EXISTS (SELECT 1 FROM seen s WHERE s.post_id = v.id)
      AND NOT EXISTS (SELECT 1 FROM newest n WHERE n.id = v.id)
  ),
  seen_ranked AS (
    SELECT v.*,
           row_number() OVER (
             ORDER BY floor(extract(epoch FROM (now() - s.last_seen_at)) / 86400.0) DESC,
                      public.feed_rank_score(v.id, v.bucket, (SELECT s FROM seed)) ASC
           ) AS rn
    FROM visible v
    JOIN seen s ON s.post_id = v.id
    WHERE NOT EXISTS (SELECT 1 FROM newest n WHERE n.id = v.id)
  ),
  -- The tiers in today's order, 3 × _limit deep so the variety rule has
  -- alternatives to choose from. `ord` is the position without the rule.
  ranked AS MATERIALIZED (
    SELECT x.id, x.user_id, x.content, x.image_url, x.image_urls, x.privacy,
           x.created_at, x.likes_count, x.comments_count, x.shares_count,
           x.feed_tier, x.tier_order, x.rn,
           row_number() OVER (ORDER BY x.tier_order ASC, x.rn ASC) AS ord
    FROM (
      SELECT n.id, n.user_id, n.content, n.image_url, n.image_urls, n.privacy,
             n.created_at, n.likes_count, n.comments_count, n.shares_count,
             'newest'::text AS feed_tier, 0 AS tier_order, n.rn
      FROM newest n
      UNION ALL
      SELECT u.id, u.user_id, u.content, u.image_url, u.image_urls, u.privacy,
             u.created_at, u.likes_count, u.comments_count, u.shares_count,
             'unseen'::text AS feed_tier, 1 AS tier_order, u.rn
      FROM unseen_ranked u
      WHERE u.rn <= (SELECT n FROM lim) * 3
      UNION ALL
      SELECT s.id, s.user_id, s.content, s.image_url, s.image_urls, s.privacy,
             s.created_at, s.likes_count, s.comments_count, s.shares_count,
             'recycled'::text AS feed_tier, 2 AS tier_order, s.rn
      FROM seen_ranked s
      WHERE s.rn <= (SELECT n FROM lim) * 3
    ) x
    ORDER BY x.tier_order ASC, x.rn ASC
    LIMIT (SELECT n FROM lim) * 3
  ),
  -- The authors of the last two posts this session already delivered (the
  -- client appends ids in delivery order), so the rule holds across pages.
  -- Only a post THIS caller may see is read (feed_candidates' three rules:
  -- public, the caller's own, an accepted friend's friends-only post). An id of
  -- any other post yields NULL, so the order of a page can never confirm who
  -- wrote a post the caller has no right to read. Always exactly one row.
  tail AS (
    SELECT max(p.user_id::text) FILTER (WHERE t.k = 1)::uuid AS a1,
           max(p.user_id::text) FILTER (WHERE t.k = 2)::uuid AS a2
    FROM (VALUES (1, _exclude_ids[array_upper(_exclude_ids, 1)]),
                 (2, _exclude_ids[array_upper(_exclude_ids, 1) - 1])) AS t(k, pid)
    JOIN public.posts p
      ON p.id = t.pid
     AND (   p.is_public
          OR p.user_id = auth.uid()
          OR (p.privacy = 'friends' AND EXISTS (
                SELECT 1 FROM public.friendships f
                 WHERE f.status = 'accepted'
                   AND (   (f.requester_id = auth.uid() AND f.addressee_id = p.user_id)
                        OR (f.addressee_id = auth.uid() AND f.requester_id = p.user_id)))))
  ),
  -- Variety: at each place take the best-ranked post that would not be the
  -- third in a row from one author; if every remaining post is by that author,
  -- take the best-ranked anyway (the feed never stops early).
  pick AS (
    SELECT 0 AS k, ARRAY[]::uuid[] AS picked, NULL::uuid AS pid, t.a1, t.a2
    FROM tail t
    UNION ALL
    SELECT pk.k + 1, pk.picked || c.id, c.id, c.user_id, pk.a1
    FROM pick pk
    CROSS JOIN LATERAL (
      SELECT r.id, r.user_id
      FROM ranked r
      WHERE NOT (r.id = ANY(pk.picked))
      ORDER BY ((r.user_id = pk.a1 AND pk.a1 = pk.a2) IS TRUE) ASC, r.ord ASC
      LIMIT 1
    ) c
    WHERE pk.k < (SELECT n FROM lim)
  )
  SELECT r.id, r.user_id, r.content, r.image_url, r.image_urls, r.privacy,
         r.created_at, r.likes_count, r.comments_count, r.shares_count,
         r.feed_tier,
         ppd.full_name  AS author_name,
         ppd.avatar_url AS author_avatar,
         p.thumbnail_urls,
         p.categories
  FROM pick pk
  JOIN ranked r                             ON r.id  = pk.pid
  LEFT JOIN public.profiles_public_data ppd ON ppd.id = r.user_id
  LEFT JOIN public.posts p                  ON p.id  = r.id
  ORDER BY pk.k ASC;
$function$;

COMMENT ON FUNCTION public.get_broadcast_feed(uuid[], integer, integer, text[], text) IS
  'Stage L2 (20261013_0005): the broadcast feed with a per-refresh session seed (NULL = hourly), newest posts first only until seen (R-LIVE-5), max 2 consecutive posts per author. The 4/3/2-argument overloads delegate here with NULL.';

-- Exactly production's EXECUTE set: owner, authenticated, service_role.
REVOKE ALL ON FUNCTION public.get_broadcast_feed(uuid[], integer, integer, text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_broadcast_feed(uuid[], integer, integer, text[], text) TO authenticated, service_role;

-- ── 2. the 4-argument overload delegates (OID and ACL kept) ────────────────
CREATE OR REPLACE FUNCTION public.get_broadcast_feed(_exclude_ids uuid[], _limit integer, _newest_first integer, _categories text[])
 RETURNS TABLE(id uuid, user_id uuid, content text, image_url text, image_urls text[], privacy text, created_at timestamp with time zone, likes_count integer, comments_count integer, shares_count integer, feed_tier text, author_name text, author_avatar text, thumbnail_urls text[], categories text[])
 LANGUAGE sql
 VOLATILE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT * FROM public.get_broadcast_feed(_exclude_ids, _limit, _newest_first, _categories, NULL::text);
$function$;

DO $postconditions$
DECLARE
  _bad text := '';
  r    record;
  _new oid := to_regprocedure('public.get_broadcast_feed(uuid[], integer, integer, text[], text)');
BEGIN
  -- POST-001 · the new overload: present, SECURITY DEFINER, VOLATILE, sql, search_path=public, owned here.
  IF _new IS NULL OR NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = _new AND p.prosecdef AND p.provolatile = 'v' AND l.lanname = 'sql'
          AND p.proconfig = ARRAY['search_path=public'] AND p.proowner = current_user::regrole) THEN
    RAISE EXCEPTION 'L2-0005-POST-001: the 5-argument get_broadcast_feed is missing or has the wrong attributes'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- POST-002 · the 2/3-argument bodies are untouched; the 4-argument one is the wrapper.
  FOR r IN
    SELECT v.sig, md5(p.prosrc) AS got, v.want
      FROM (VALUES
        ('get_broadcast_feed(_exclude_ids uuid[], _limit integer)', '6ff8f8ea3d8c8cf76e9abe0bd728915e'),
        ('get_broadcast_feed(_exclude_ids uuid[], _limit integer, _newest_first integer)', '59cebfbcfd89f6ad49e46399ee6fe4e2')
      ) AS v(sig, want)
      LEFT JOIN pg_proc p
        ON p.pronamespace = 'public'::regnamespace
       AND p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')' = v.sig
  LOOP
    IF r.got IS DISTINCT FROM r.want THEN
      _bad := _bad || E'\n  ' || r.sig || ' body changed (md5 ' || coalesce(r.got, 'missing') || ')';
    END IF;
  END LOOP;
  IF (SELECT btrim(prosrc, E' \r\n\t') FROM pg_proc
       WHERE oid = to_regprocedure('public.get_broadcast_feed(uuid[], integer, integer, text[])'))
     IS DISTINCT FROM 'SELECT * FROM public.get_broadcast_feed(_exclude_ids, _limit, _newest_first, _categories, NULL::text);' THEN
    _bad := _bad || E'\n  the 4-argument overload is not the one-line wrapper';
  END IF;

  -- POST-003 · EXECUTE on all four overloads is exactly {postgres, authenticated,
  -- service_role}, granted by postgres, not grantable — read two ways: the ACL
  -- itself, and the effective privilege (which also sees PUBLIC and membership).
  FOR r IN
    SELECT p.oid, pg_get_function_identity_arguments(p.oid) AS args,
           (SELECT string_agg(e.x, ',' ORDER BY e.x COLLATE "C")
              FROM (SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END
                           || ':' || a.privilege_type || ':' || pg_get_userbyid(a.grantor)::text || ':' || a.is_grantable::text AS x
                      FROM aclexplode(p.proacl) a) e) AS acl
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'get_broadcast_feed'
  LOOP
    IF r.acl IS DISTINCT FROM 'authenticated:EXECUTE:postgres:false,postgres:EXECUTE:postgres:false,service_role:EXECUTE:postgres:false'
       OR has_function_privilege('public', r.oid, 'EXECUTE')
       OR has_function_privilege('anon', r.oid, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', r.oid, 'EXECUTE')
       OR NOT has_function_privilege('service_role', r.oid, 'EXECUTE') THEN
      _bad := _bad || E'\n  get_broadcast_feed(' || r.args || ') ACL ' || coalesce(r.acl, 'NULL (PUBLIC by default)');
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'get_broadcast_feed') <> 4 THEN
    _bad := _bad || E'\n  expected exactly 4 get_broadcast_feed overloads';
  END IF;

  IF _bad <> '' THEN
    RAISE EXCEPTION 'L2-0005-POST: post-state differs from the intended one:%', _bad USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'L2-0005: 5-argument get_broadcast_feed created (session seed, newest-until-seen, max 2 per author); 4-argument delegates; EXECUTE = postgres + authenticated + service_role on all 4';
END
$postconditions$;

COMMIT;
