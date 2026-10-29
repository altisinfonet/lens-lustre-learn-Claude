-- ═══════════════════════════════════════════════════════════════════════════
-- 20261029_0500 — S6-a Feed paging by cursor: the client stops uploading the
-- list of every post it has already been dealt (`_exclude_ids`).
--   · NEW table    public.feed_session_delivered  (server-side delivery log)
--   · NEW function public.get_feed_page(_tab, _personal, _session_seed,
--                                       _after, _limit, _newest_first, _categories)
--     SECURITY DEFINER, search_path '', EXECUTE to authenticated ONLY; the
--     viewer is (SELECT auth.uid()), never an argument.
-- EXPAND step. Every existing signature — get_broadcast_feed (all 4
-- overloads), get_personal_feed, get_following_feed, get_favourites_feed — is
-- NOT touched: installed Android builds and the current web bundle keep
-- calling them with `_exclude_ids` exactly as today.
-- Lanes: staging and production (refuses any other lane).
-- S6 (v2 Phase 4 "Paging & realtime"), 2026-10-29.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- GATE (plan, verbatim): "`_exclude_ids` at page 100 = 0 · …"
--
-- WHY NOT A PURE (rank_score, id) KEYSET — DECISION S6-a-D1 (recorded here and
-- in the PR). The plan names "keyset cursor on (rank_score, id)". The feeds it
-- would page are not a sort by one stable key:
--   · get_broadcast_feed: tiers newest-until-seen / unseen / recycled, where a
--     post moves between tiers the moment the member views it, then a greedy
--     "max 2 in a row per author" pick over a 3 × _limit window;
--   · get_personal_feed (S12): circle / suggested / fair slot pattern, the
--     score carries freshness (now()) and the seen penalty, a greedy max-2-per-
--     author / max-3-per-category pick, and a post can sit in two source lists.
-- A `WHERE (score, id) < cursor` over that would (a) change the order and the
-- variety rules (forbidden: "Feed order and variety rules of S12 must not
-- change") and (b) lose every post the variety pick deferred past the page end
-- (a gap) or re-deal a post from its second source list (a duplicate).
-- So the cursor is the session's DELIVERY POSITION: the server keeps, per
-- (viewer, session), the ids it has dealt in delivery order, and a page is the
-- unchanged feed function evaluated with exactly the list the client used to
-- send. Same order as today by construction (PROBE G2–G4 prove it page by page
-- against the old call), and the client sends `_after` (an integer) instead of
-- page × 10 UUIDs.
--
-- CONTRACT
--   _tab          'for_you' | 'following' | 'favourites'
--   _personal     for_you only: true → get_personal_feed, false →
--                 get_broadcast_feed (session overload). Both share ONE log per
--                 session, so a page that falls back from personal to broadcast
--                 (the client does that on any personal error) never repeats a
--                 post the personal feed already dealt.
--   _session_seed the session's seed (required, 1–64 chars used): keys the log
--                 together with _tab and _categories, and is passed on to the
--                 feed function unchanged (same deal as today).
--   _after        how many rows of this session the client holds = the
--                 delivery position of its last row (0 = first page). Rows the
--                 log holds BEYOND _after are dropped first, so a retry or a
--                 React Query refetch of page N re-deals page N exactly as the
--                 old exclude-list snapshot did, and a lost response never
--                 leaves a hole.
--   _limit, _newest_first, _categories   as today.
--   returns       get_personal_feed's 17 columns (broadcast rows: source NULL,
--                 caught_up_after false) + feed_pos = the row's delivery
--                 position (the next cursor is the last row's feed_pos).
--
-- SECURITY DEFINER, judged by its WHERE clauses: the viewer is auth.uid() only;
-- signed out → no row. Every row comes from the unchanged feed function called
-- as that viewer, so visibility is exactly today's (PROBE G6: friends-only and
-- only-me posts of others never appear). The log is read and written only for
-- viewer = auth.uid(); neither anon nor authenticated can read or write the
-- table (RLS on, no policy, no grant; service_role keeps its usual access).
-- The delegates are SECURITY DEFINER and filter on auth.uid() in their own
-- WHERE clauses (PRE-002 asserts prosecdef), so running them as this
-- function's owner bypasses no RLS they relied on.
-- DRIFT GUARD: a cursor AHEAD of the log (the client holds rows the log never
-- dealt — e.g. a page served by the old call) is refused (22023); the client
-- then pages that session the old way. Calls for one session are serialised
-- by an advisory transaction lock. The seed is hashed into the key,
-- never executed.
--
-- COST: one DELETE + one INSERT of ≤ 50 rows on the caller's own primary-key
-- range per page, plus today's function. The exclusion list the server builds
-- has the same length the client used to upload (so the database work is
-- today's); what is gone is the upload and the URL/body growth.
-- RETENTION: on each session's first page (_after = 0) the caller's log rows
-- older than 1 day are deleted. Rows of members who never return stay until
-- their next visit (≤ a few hundred each) — supervisor note in the PR.
--
-- LOCKING: CREATE TABLE / CREATE FUNCTION only. lock_timeout 5 s.
-- RE-RUN: refused by PRE-001 once applied. After the rollback it applies again.
-- ROLLBACK: supabase/rollback/20261029_0500_s6a_feed_page_cursor_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261029_0500_s6a_feed_page_cursor.sql
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
  -- PRE-001 · not applied already (checked by NAME: catches any overload).
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'get_feed_page')
     OR to_regclass('public.feed_session_delivered') IS NOT NULL THEN
    RAISE EXCEPTION 'S6A-0500-PRE-001: get_feed_page or feed_session_delivered already exists — 20261029_0500 is applied (or half-applied by hand)'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- PRE-002 · the functions this file delegates to, by exact signature.
  FOR r IN SELECT unnest(ARRAY[
      'auth.uid()',
      'public.get_broadcast_feed(uuid[],integer,integer,text[],text)',
      'public.get_personal_feed(uuid[],integer,integer,text[],text)',
      'public.feed_author_timeline(text,uuid[],integer,text[])']) AS f LOOP
    IF to_regprocedure(r.f) IS NULL THEN _bad := _bad || E'\n  function ' || r.f || ' missing';
    -- the delegates must filter visibility themselves (auth.uid() in their own
    -- WHERE clauses, SECURITY DEFINER) — this function runs them as its owner.
    ELSIF r.f <> 'auth.uid()' AND NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(r.f)) THEN
      _bad := _bad || E'\n  function ' || r.f || ' is not SECURITY DEFINER';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    _bad := _bad || E'\n  role anon / authenticated / service_role missing';
  END IF;
  IF _bad <> '' THEN
    RAISE EXCEPTION 'S6A-0500-PRE-002: prerequisites missing:%', _bad USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── 1. the delivery log ──────────────────────────────────────────────────────
CREATE TABLE public.feed_session_delivered (
  viewer       uuid        NOT NULL,
  session_key  text        NOT NULL,
  pos          integer     NOT NULL CHECK (pos > 0),
  post_id      uuid        NOT NULL,
  delivered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (viewer, session_key, pos)
);
COMMENT ON TABLE public.feed_session_delivered IS
  'S6-a (20261029_0500): per viewer and feed session, the post ids get_feed_page has dealt, in delivery order (pos 1, 2, …). Replaces the client-uploaded _exclude_ids. Written and read only by get_feed_page for viewer = auth.uid(); no API role has access.';
ALTER TABLE public.feed_session_delivered ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.feed_session_delivered FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.feed_session_delivered TO service_role;

-- ── 2. the page function ─────────────────────────────────────────────────────
CREATE FUNCTION public.get_feed_page(
  _tab text, _personal boolean, _session_seed text, _after integer,
  _limit integer, _newest_first integer, _categories text[])
 RETURNS TABLE(id uuid, user_id uuid, content text, image_url text, image_urls text[], privacy text,
               created_at timestamp with time zone, likes_count integer, comments_count integer,
               shares_count integer, feed_tier text, author_name text, author_avatar text,
               thumbnail_urls text[], categories text[], source text, caught_up_after boolean,
               feed_pos integer)
 LANGUAGE plpgsql
 VOLATILE
 SECURITY DEFINER
 SET search_path TO ''
AS $fn$
#variable_conflict use_column
DECLARE
  _me   uuid    := (SELECT auth.uid());
  _seed text    := left(btrim(coalesce(_session_seed, '')), 64);
  _from integer := GREATEST(coalesce(_after, 0), 0);
  _key  text;
  _ex   uuid[];
BEGIN
  IF _me IS NULL THEN
    RETURN;
  END IF;
  IF _tab IS NULL OR _tab NOT IN ('for_you', 'following', 'favourites') THEN
    RAISE EXCEPTION 'get_feed_page: _tab must be for_you, following or favourites' USING ERRCODE = '22023';
  END IF;
  IF _seed = '' OR length(btrim(_session_seed)) > 64 THEN
    RAISE EXCEPTION 'get_feed_page: _session_seed is required (1-64 characters)' USING ERRCODE = '22023';
  END IF;
  _key := md5(_tab || '|' || coalesce(array_to_string(_categories, ',', '~'), '*') || '|' || _seed);
  -- One page of one session at a time (a refetch overlapping a load-more).
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('feed_page:' || _me::text || ':' || _key, 0));

  -- Retention: a new session drops this viewer's log rows older than a day.
  IF _from = 0 THEN
    DELETE FROM public.feed_session_delivered d
     WHERE d.viewer = _me AND d.delivered_at < now() - interval '1 day';
  END IF;
  -- A retry / refetch of a page re-deals it: forget what was dealt after _after.
  DELETE FROM public.feed_session_delivered d
   WHERE d.viewer = _me AND d.session_key = _key AND d.pos > _from;
  -- Exactly the list the client used to upload, in delivery order.
  SELECT coalesce(array_agg(d.post_id ORDER BY d.pos), '{}'::uuid[]) INTO _ex
    FROM public.feed_session_delivered d
   WHERE d.viewer = _me AND d.session_key = _key;
  -- The client holds rows this log never dealt (a page served by the old
  -- _exclude_ids call, or a log already purged): refuse rather than deal from
  -- an incomplete list — the client then pages the old way, with its full list.
  IF _from > coalesce(cardinality(_ex), 0) THEN
    RAISE EXCEPTION 'get_feed_page: cursor % is ahead of this session''s log (%)', _from, coalesce(cardinality(_ex), 0)
      USING ERRCODE = '22023';
  END IF;

  IF _tab = 'for_you' AND coalesce(_personal, false) THEN
    RETURN QUERY
    WITH pg AS MATERIALIZED (
      SELECT f.id, f.user_id, f.content, f.image_url, f.image_urls, f.privacy, f.created_at,
             f.likes_count, f.comments_count, f.shares_count, f.feed_tier, f.author_name, f.author_avatar,
             f.thumbnail_urls, f.categories, f.source, f.caught_up_after, (_from + f.o)::integer AS pos
        FROM public.get_personal_feed(_ex, _limit, _newest_first, _categories, _session_seed)
             WITH ORDINALITY AS f(id, user_id, content, image_url, image_urls, privacy, created_at, likes_count,
                                  comments_count, shares_count, feed_tier, author_name, author_avatar,
                                  thumbnail_urls, categories, source, caught_up_after, o)
    ), ins AS (
      INSERT INTO public.feed_session_delivered AS t (viewer, session_key, pos, post_id)
      SELECT _me, _key, pg.pos, pg.id FROM pg
      ON CONFLICT (viewer, session_key, pos) DO UPDATE SET post_id = EXCLUDED.post_id, delivered_at = now()
    )
    SELECT pg.id, pg.user_id, pg.content, pg.image_url, pg.image_urls, pg.privacy, pg.created_at,
           pg.likes_count, pg.comments_count, pg.shares_count, pg.feed_tier, pg.author_name, pg.author_avatar,
           pg.thumbnail_urls, pg.categories, pg.source, pg.caught_up_after, pg.pos
      FROM pg ORDER BY pg.pos;
  ELSIF _tab = 'for_you' THEN
    RETURN QUERY
    WITH pg AS MATERIALIZED (
      SELECT b.id, b.user_id, b.content, b.image_url, b.image_urls, b.privacy, b.created_at,
             b.likes_count, b.comments_count, b.shares_count, b.feed_tier, b.author_name, b.author_avatar,
             b.thumbnail_urls, b.categories, (_from + b.o)::integer AS pos
        FROM public.get_broadcast_feed(_ex, _limit, _newest_first, _categories, _session_seed)
             WITH ORDINALITY AS b(id, user_id, content, image_url, image_urls, privacy, created_at, likes_count,
                                  comments_count, shares_count, feed_tier, author_name, author_avatar,
                                  thumbnail_urls, categories, o)
    ), ins AS (
      INSERT INTO public.feed_session_delivered AS t (viewer, session_key, pos, post_id)
      SELECT _me, _key, pg.pos, pg.id FROM pg
      ON CONFLICT (viewer, session_key, pos) DO UPDATE SET post_id = EXCLUDED.post_id, delivered_at = now()
    )
    SELECT pg.id, pg.user_id, pg.content, pg.image_url, pg.image_urls, pg.privacy, pg.created_at,
           pg.likes_count, pg.comments_count, pg.shares_count, pg.feed_tier, pg.author_name, pg.author_avatar,
           pg.thumbnail_urls, pg.categories, NULL::text, false, pg.pos
      FROM pg ORDER BY pg.pos;
  ELSE
    -- Following / Favourites: exactly what get_following_feed / get_favourites_feed return.
    RETURN QUERY
    WITH pg AS MATERIALIZED (
      SELECT f.id, f.user_id, f.content, f.image_url, f.image_urls, f.privacy, f.created_at,
             f.likes_count, f.comments_count, f.shares_count, f.feed_tier, f.author_name, f.author_avatar,
             f.thumbnail_urls, f.categories, f.source, f.caught_up_after, (_from + f.o)::integer AS pos
        FROM public.feed_author_timeline(_tab, _ex, _limit, _categories)
             WITH ORDINALITY AS f(id, user_id, content, image_url, image_urls, privacy, created_at, likes_count,
                                  comments_count, shares_count, feed_tier, author_name, author_avatar,
                                  thumbnail_urls, categories, source, caught_up_after, o)
    ), ins AS (
      INSERT INTO public.feed_session_delivered AS t (viewer, session_key, pos, post_id)
      SELECT _me, _key, pg.pos, pg.id FROM pg
      ON CONFLICT (viewer, session_key, pos) DO UPDATE SET post_id = EXCLUDED.post_id, delivered_at = now()
    )
    SELECT pg.id, pg.user_id, pg.content, pg.image_url, pg.image_urls, pg.privacy, pg.created_at,
           pg.likes_count, pg.comments_count, pg.shares_count, pg.feed_tier, pg.author_name, pg.author_avatar,
           pg.thumbnail_urls, pg.categories, pg.source, pg.caught_up_after, pg.pos
      FROM pg ORDER BY pg.pos;
  END IF;
END
$fn$;

COMMENT ON FUNCTION public.get_feed_page(text, boolean, text, integer, integer, integer, text[]) IS
  'S6-a (20261029_0500): one feed page by cursor (_after = delivery position of the last row the client holds) instead of _exclude_ids. Evaluates the unchanged get_personal_feed / get_broadcast_feed (session overload) / feed_author_timeline with the session''s server-side delivery log, so the order is today''s. Viewer = auth.uid(). authenticated only.';

REVOKE ALL ON FUNCTION public.get_feed_page(text, boolean, text, integer, integer, integer, text[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_feed_page(text, boolean, text, integer, integer, integer, text[]) TO authenticated;

DO $postconditions$
DECLARE
  _bad text := '';
  _f   constant text := 'public.get_feed_page(text,boolean,text,integer,integer,integer,text[])';
BEGIN
  -- POST-001 · definer, search_path '', authenticated only.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = _f::regprocedure AND p.prosecdef
                   AND p.proconfig = ARRAY['search_path=""']) THEN
    _bad := _bad || E'\n  get_feed_page: not SECURITY DEFINER with search_path ''''';
  END IF;
  IF NOT has_function_privilege('authenticated', _f, 'EXECUTE') THEN
    _bad := _bad || E'\n  authenticated cannot execute get_feed_page';
  END IF;
  IF has_function_privilege('anon', _f, 'EXECUTE') OR has_function_privilege('service_role', _f, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 WHERE p.oid = _f::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    _bad := _bad || E'\n  get_feed_page: anon / service_role / PUBLIC can execute';
  END IF;
  -- POST-002 · the log: RLS on, no access for the API roles.
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.feed_session_delivered'::regclass) THEN
    _bad := _bad || E'\n  feed_session_delivered: RLS is off';
  END IF;
  IF has_table_privilege('anon', 'public.feed_session_delivered', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated', 'public.feed_session_delivered', 'SELECT,INSERT,UPDATE,DELETE') THEN
    _bad := _bad || E'\n  feed_session_delivered: anon / authenticated hold a privilege';
  END IF;
  -- POST-003 · the old signatures are all still there (none touched).
  IF to_regprocedure('public.get_broadcast_feed(uuid[],integer)') IS NULL
     OR to_regprocedure('public.get_broadcast_feed(uuid[],integer,integer)') IS NULL
     OR to_regprocedure('public.get_broadcast_feed(uuid[],integer,integer,text[])') IS NULL
     OR to_regprocedure('public.get_broadcast_feed(uuid[],integer,integer,text[],text)') IS NULL
     OR to_regprocedure('public.get_personal_feed(uuid[],integer,integer,text[],text)') IS NULL
     OR to_regprocedure('public.get_following_feed(uuid[],integer,integer,text[],text)') IS NULL
     OR to_regprocedure('public.get_favourites_feed(uuid[],integer,integer,text[],text)') IS NULL THEN
    _bad := _bad || E'\n  an old feed signature is missing';
  END IF;
  IF _bad <> '' THEN
    RAISE EXCEPTION 'S6A-0500-POST: post-state differs from the intended one:%', _bad USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'S6A-0500: get_feed_page created (definer, search_path '''', authenticated only); feed_session_delivered created (RLS on, no API access); old feed signatures untouched';
END
$postconditions$;

COMMIT;
