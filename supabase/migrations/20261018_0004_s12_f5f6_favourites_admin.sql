-- ═══════════════════════════════════════════════════════════════════════════
-- 20261018_0004 — S12-F5 + F6: Following / Favourites feeds, ★ favourites,
-- the admin mix sliders and the before/after numbers.
--   · public.feed_favourite_authors (user_id, author_id, created_at) — own rows
--     only (RLS), one permissive policy per action, at most favourites_max (50)
--     per member (BEFORE INSERT trigger), written through the OFF-2 outbox
--     (natural key, exactly once).
--   · public.get_following_feed(uuid[], integer, integer, text[], text)
--     public.get_favourites_feed(uuid[], integer, integer, text[], text)
--     SECURITY DEFINER, search_path '', EXECUTE to authenticated ONLY; viewer =
--     (SELECT auth.uid()). Same arguments and the same 17 columns as
--     get_personal_feed. Newest first, no ranking. Both are thin wrappers over
--     ONE internal function, public.feed_author_timeline(text, uuid[], integer,
--     text[]) (no API role may execute it).
--   · public.feed_mix_set(integer, integer, integer) — admin only; writes
--     mix_circle / mix_suggested / mix_fair (sum must be 10) and one audit row
--     (feature_access_audit, feature 'personal_feed', action 'mix').
--   · public.feed_mix_admin_stats(integer) — admin only; the current mix and the
--     last N days (default 7) for members WITH the personal feed vs WITHOUT.
--   · feed_score_config key 'favourites_max' (50).
--   · feature_access_audit_action_check widened by one value ('mix').
-- EXPAND step: new table, new functions, one config row, one CHECK widened.
-- get_personal_feed / get_broadcast_feed are NOT touched.
-- Lanes: staging and production (refuses any other lane).
-- D1 (Database & Runtime), 2026-10-18. Master plan v3 S12.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- GATES (verbatim):
--   F5 "'For you' / 'Following' (time order) / 'Favourites' — Each view correct
--       on web + Android shell"
--   F6 "Admin weights (… fair %, suggested %) with no release; new mix shown to
--       a small % first; measure time spent, likes per view, return rate —
--       Measured before/after"   (Owner 2026-10-18: NO video boost.)
--
-- DESIGN
--   1. VISIBILITY — exactly get_personal_feed's `vis` filter: today's feed rule
--      (public; or a friends-only post of an ACCEPTED friend) AND
--      public.can_view_post(caller, author, privacy); the caller's
--      feed_hidden_posts and feed_muted_authors excluded; signed out → no row.
--      The caller's own posts never appear (you cannot follow or favourite
--      yourself). _categories as in get_personal_feed (NULL = all).
--   2. ORDER + PAGING — created_at DESC, id DESC, at most 50 per page. Paging is
--      the same contract as get_personal_feed (_exclude_ids = every id already
--      delivered this session); in addition the page starts at the oldest
--      delivered post the caller may see (a keyset bound), so page 20 does not
--      re-read the 190 newer rows. _newest_first and _session_seed are accepted
--      and ignored (time order has nothing to pin and nothing to shuffle).
--      feed_tier = 'chronological', source = 'following' | 'favourites',
--      caught_up_after = false.
--   3. FAVOURITES — independent of following (as Instagram). Cap read from
--      feed_score_config.favourites_max under a per-member advisory lock (two
--      concurrent inserts cannot pass the cap). A re-send of an existing pair is
--      let through to ON CONFLICT DO NOTHING even at the cap.
--   4. ADMIN — has_role(auth.uid(), 'admin'), as feature_set_mode. Mix values
--      are whole numbers 0–10, sum 10 (the page is 10 slots). The rollout uses
--      the existing personal_feed switch (Off / Selected members / All members).
--   5. STATS — window = last _days (1–31). Population = members with at least
--      one feed view in the window, split by feature_allowed('personal_feed')
--      NOW (members moved between groups during the window count in their
--      current group). Feed views = feed_events 'view'; likes per view =
--      post_reactions created in the window ÷ feed views; average time on post =
--      mean feed_post_signals.dwell_ms (rows with dwell > 0, last_at in the
--      window); returning = share of the group with feed views on 2+ distinct
--      UTC days. Read-only; admin-only; not measured at 1 M members.
--
-- LOCKING. ALTER TABLE feature_access_audit (DROP/ADD CHECK: ACCESS EXCLUSIVE on
-- a small audit table); CREATE TABLE / FUNCTION / TRIGGER / POLICY on new
-- objects; one insert into feed_score_config. lock_timeout 5 s.
-- RE-RUN: refused by PRE-001 once applied. After the rollback it applies again
-- (the rollback keeps the widened audit CHECK; PRE-002 accepts either form).
-- ROLLBACK: supabase/rollback/20261018_0004_s12_f5f6_favourites_admin_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261018_0004_s12_f5f6_favourites_admin.sql
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
  -- PRE-001 · not applied already (functions by NAME in pg_proc: any overload).
  IF to_regclass('public.feed_favourite_authors') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                  AND proname IN ('get_following_feed', 'get_favourites_feed', 'feed_author_timeline',
                                  'feed_mix_set', 'feed_mix_admin_stats', 'feed_favourite_authors_before'))
     OR (to_regclass('public.feed_score_config') IS NOT NULL
         AND EXISTS (SELECT 1 FROM public.feed_score_config WHERE key = 'favourites_max')) THEN
    RAISE EXCEPTION 'S12F56-0004-PRE-001: feed_favourite_authors, a 0004 function or favourites_max already exists — 20261018_0004 is applied (or half-applied by hand)'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- PRE-002 · what this file relies on — exact signatures (to_regprocedure).
  FOR r IN SELECT unnest(ARRAY[
      'auth.uid()',
      'public.can_view_post(uuid,uuid,text)',
      'public.has_role(uuid,public.app_role)',
      'public.account_is_live()',
      'public.feature_allowed(text,uuid)',
      'public.get_personal_feed(uuid[],integer,integer,text[],text)']) AS f LOOP
    IF to_regprocedure(r.f) IS NULL THEN _bad := _bad || E'\n  function ' || r.f || ' missing'; END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('posts', 'id'), ('posts', 'user_id'), ('posts', 'content'), ('posts', 'image_url'), ('posts', 'image_urls'),
      ('posts', 'privacy'), ('posts', 'is_public'), ('posts', 'created_at'), ('posts', 'likes_count'),
      ('posts', 'comments_count'), ('posts', 'shares_count'), ('posts', 'thumbnail_urls'), ('posts', 'categories'),
      ('profiles_public_data', 'full_name'), ('profiles_public_data', 'avatar_url'),
      ('follows', 'follower_id'), ('follows', 'following_id'),
      ('friendships', 'requester_id'), ('friendships', 'addressee_id'), ('friendships', 'status'),
      ('feed_events', 'user_id'), ('feed_events', 'event_type'), ('feed_events', 'created_at'),
      ('post_reactions', 'user_id'), ('post_reactions', 'created_at'),
      ('feed_post_signals', 'dwell_ms'), ('feed_post_signals', 'last_at'),
      ('feed_hidden_posts', 'post_id'), ('feed_muted_authors', 'author_id'),
      ('feed_score_config', 'key'), ('feed_score_config', 'value'), ('feed_score_config', 'note'),
      ('feature_access_audit', 'action'), ('feature_access_audit', 'old_value'), ('feature_access_audit', 'new_value')
    ) v(t, c) LOOP
    IF to_regclass('public.' || r.t) IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = ('public.' || r.t)::regclass AND attname = r.c AND NOT attisdropped) THEN
      _bad := _bad || E'\n  public.' || r.t || '(' || r.c || ') missing';
    END IF;
  END LOOP;
  IF to_regclass('public.feed_score_config') IS NOT NULL
     AND (SELECT count(*) FROM public.feed_score_config WHERE key IN ('mix_circle', 'mix_suggested', 'mix_fair')) <> 3 THEN
    _bad := _bad || E'\n  feed_score_config lacks mix_circle / mix_suggested / mix_fair (S12-F3, 20261018_0003)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.feature_access WHERE feature = 'personal_feed') THEN
    _bad := _bad || E'\n  feature switch personal_feed missing (20261018_0003)';
  END IF;
  -- the audit CHECK is VID-7's (or already widened by an earlier 0004 + rollback)
  IF NOT EXISTS (
       SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.feature_access_audit'::regclass AND conname = 'feature_access_audit_action_check'
          AND pg_get_constraintdef(oid) IN (
                'CHECK ((action = ANY (ARRAY[''mode''::text, ''add''::text, ''remove''::text])))',
                'CHECK ((action = ANY (ARRAY[''mode''::text, ''add''::text, ''remove''::text, ''mix''::text])))')) THEN
    _bad := _bad || E'\n  feature_access_audit_action_check is not VID-7''s (mode, add, remove)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    _bad := _bad || E'\n  role anon / authenticated / service_role missing';
  END IF;
  IF _bad <> '' THEN
    RAISE EXCEPTION 'S12F56-0004-PRE-002: prerequisites missing:%', _bad USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── 1. the audit trail takes 'mix' (F6 admin weights) ───────────────────────
DO $audit_check$
BEGIN
  IF pg_get_constraintdef((SELECT oid FROM pg_constraint
                            WHERE conrelid = 'public.feature_access_audit'::regclass
                              AND conname = 'feature_access_audit_action_check'))
     NOT LIKE '%''mix''%' THEN
    ALTER TABLE public.feature_access_audit DROP CONSTRAINT feature_access_audit_action_check;
    ALTER TABLE public.feature_access_audit ADD CONSTRAINT feature_access_audit_action_check
      CHECK (action IN ('mode', 'add', 'remove', 'mix'));
  END IF;
END
$audit_check$;

INSERT INTO public.feed_score_config (key, value, note) VALUES
  ('favourites_max', 50, 'favourites: at most this many ★ favourite members per member (S12-F5)');

-- ── 2. ★ favourites ──────────────────────────────────────────────────────────
CREATE TABLE public.feed_favourite_authors (
  user_id     uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  author_id   uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, author_id),
  CONSTRAINT feed_favourite_authors_not_self CHECK (user_id <> author_id)
);
COMMENT ON TABLE public.feed_favourite_authors IS
  'S12-F5 ★ Favourites: members whose posts the viewer wants in the Favourites tab. Unique (viewer, author); exactly once via the OFF-2 outbox (natural key). At most feed_score_config.favourites_max per member. Own rows only (RLS).';
-- P28: feed_favourite_authors · ≤ 50 rows per member · the auth.users FK cascade
-- when the FAVOURITE account is deleted (P35 rule 2); the PK leads with user_id.
CREATE INDEX feed_favourite_authors_author_idx ON public.feed_favourite_authors (author_id);

CREATE FUNCTION public.feed_favourite_authors_before()
 RETURNS trigger
 LANGUAGE plpgsql
 VOLATILE
 SECURITY DEFINER
 SET search_path TO ''
AS $fn$
DECLARE
  _max integer;
BEGIN
  -- A row in ANOTHER member's name passes through untouched, so the RLS WITH
  -- CHECK refuses it uniformly (as feed_hidden_posts_before). service_role
  -- (auth.uid() NULL) is trusted and bypasses RLS: not normalised here.
  IF NEW.user_id IS DISTINCT FROM (SELECT auth.uid()) THEN
    RETURN NEW;
  END IF;
  -- A re-send of a pair that exists: ON CONFLICT DO NOTHING handles it.
  IF EXISTS (SELECT 1 FROM public.feed_favourite_authors f WHERE f.user_id = NEW.user_id AND f.author_id = NEW.author_id) THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('feed_favourite_authors:' || NEW.user_id::text, 0));
  SELECT GREATEST(coalesce((SELECT c.value FROM public.feed_score_config c WHERE c.key = 'favourites_max'), 50), 0)::integer INTO _max;
  IF (SELECT count(*) FROM public.feed_favourite_authors f WHERE f.user_id = NEW.user_id) >= _max THEN
    RAISE EXCEPTION 'FAVOURITES-001: at most % favourites', _max USING ERRCODE = 'check_violation';
  END IF;
  NEW.created_at := now();
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER feed_favourite_authors_before
  BEFORE INSERT ON public.feed_favourite_authors
  FOR EACH ROW EXECUTE FUNCTION public.feed_favourite_authors_before();

ALTER TABLE public.feed_favourite_authors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members favourite for themselves" ON public.feed_favourite_authors
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "Members read own favourites" ON public.feed_favourite_authors
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Members remove own favourites" ON public.feed_favourite_authors
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Deleted accounts cannot insert" ON public.feed_favourite_authors
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((SELECT public.account_is_live()));

REVOKE ALL ON TABLE public.feed_favourite_authors FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.feed_favourite_authors TO authenticated;
GRANT ALL ON TABLE public.feed_favourite_authors TO service_role;
REVOKE ALL ON FUNCTION public.feed_favourite_authors_before() FROM PUBLIC, anon, authenticated;

-- ── 3. the time-ordered feeds (ONE internal function, two wrappers) ─────────
CREATE FUNCTION public.feed_author_timeline(_source text, _exclude_ids uuid[], _limit integer, _categories text[])
 RETURNS TABLE(id uuid, user_id uuid, content text, image_url text, image_urls text[], privacy text,
               created_at timestamp with time zone, likes_count integer, comments_count integer,
               shares_count integer, feed_tier text, author_name text, author_avatar text,
               thumbnail_urls text[], categories text[], source text, caught_up_after boolean)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $fn$
  WITH
  me AS (SELECT (SELECT auth.uid()) AS uid),
  ex AS (SELECT coalesce(_exclude_ids, '{}'::uuid[]) AS ids),
  friends AS (
    SELECT CASE WHEN f.requester_id = m.uid THEN f.addressee_id ELSE f.requester_id END AS aid
      FROM public.friendships f, me m
     WHERE f.status = 'accepted' AND (f.requester_id = m.uid OR f.addressee_id = m.uid)
  ),
  authors AS (
    SELECT fo.following_id AS aid FROM public.follows fo, me m
     WHERE _source = 'following' AND fo.follower_id = m.uid
    UNION
    SELECT fa.author_id FROM public.feed_favourite_authors fa, me m
     WHERE _source = 'favourites' AND fa.user_id = m.uid
  ),
  muted  AS (SELECT ma.author_id FROM public.feed_muted_authors ma, me m WHERE ma.user_id = m.uid),
  hidden AS (SELECT hp.post_id   FROM public.feed_hidden_posts  hp, me m WHERE hp.user_id = m.uid),
  -- keyset bound: the oldest already-delivered post the caller may see (an id
  -- the caller may not see is ignored — nothing about it can be learned).
  cur AS (
    SELECT min(p.created_at) AS at
      FROM public.posts p, ex, me m
     WHERE p.id = ANY (ex.ids)
       AND (p.is_public OR p.user_id = m.uid
            OR (p.privacy = 'friends' AND p.user_id IN (SELECT fr.aid FROM friends fr)))
       AND public.can_view_post(m.uid, p.user_id, p.privacy)
  )
  SELECT p.id, p.user_id, p.content, p.image_url, p.image_urls, p.privacy, p.created_at,
         p.likes_count, p.comments_count, p.shares_count,
         'chronological'::text       AS feed_tier,
         ppd.full_name               AS author_name,
         ppd.avatar_url              AS author_avatar,
         p.thumbnail_urls,
         p.categories,
         _source                     AS source,
         false                       AS caught_up_after
    FROM public.posts p
    CROSS JOIN me m
    CROSS JOIN ex
    CROSS JOIN cur
    LEFT JOIN public.profiles_public_data ppd ON ppd.id = p.user_id
   WHERE m.uid IS NOT NULL
     AND _source IN ('following', 'favourites')
     AND p.user_id IN (SELECT a.aid FROM authors a)
     AND p.user_id <> m.uid
     AND (cur.at IS NULL OR p.created_at <= cur.at)
     AND NOT (p.id = ANY (ex.ids))
     AND (_categories IS NULL OR p.categories && _categories)
     -- VISIBILITY: get_personal_feed's `vis` — both must hold.
     AND (p.is_public OR p.user_id = m.uid
          OR (p.privacy = 'friends' AND p.user_id IN (SELECT fr.aid FROM friends fr)))
     AND public.can_view_post(m.uid, p.user_id, p.privacy)
     AND NOT EXISTS (SELECT 1 FROM hidden h WHERE h.post_id = p.id)
     AND NOT EXISTS (SELECT 1 FROM muted mu WHERE mu.author_id = p.user_id)
   ORDER BY p.created_at DESC, p.id DESC
   LIMIT LEAST(GREATEST(coalesce(_limit, 10), 0), 50);
$fn$;
COMMENT ON FUNCTION public.feed_author_timeline(text, uuid[], integer, text[]) IS
  'S12-F5 (20261018_0004) internal: posts of the members the caller follows (''following'') or starred (''favourites''), newest first; visibility = get_personal_feed''s; hidden/muted excluded. Viewer = auth.uid(). No API role may execute it — called by get_following_feed / get_favourites_feed.';
REVOKE ALL ON FUNCTION public.feed_author_timeline(text, uuid[], integer, text[]) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.get_following_feed(
  _exclude_ids uuid[], _limit integer, _newest_first integer, _categories text[], _session_seed text)
 RETURNS TABLE(id uuid, user_id uuid, content text, image_url text, image_urls text[], privacy text,
               created_at timestamp with time zone, likes_count integer, comments_count integer,
               shares_count integer, feed_tier text, author_name text, author_avatar text,
               thumbnail_urls text[], categories text[], source text, caught_up_after boolean)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $fn$
  SELECT * FROM public.feed_author_timeline('following', _exclude_ids, _limit, _categories);
$fn$;

CREATE FUNCTION public.get_favourites_feed(
  _exclude_ids uuid[], _limit integer, _newest_first integer, _categories text[], _session_seed text)
 RETURNS TABLE(id uuid, user_id uuid, content text, image_url text, image_urls text[], privacy text,
               created_at timestamp with time zone, likes_count integer, comments_count integer,
               shares_count integer, feed_tier text, author_name text, author_avatar text,
               thumbnail_urls text[], categories text[], source text, caught_up_after boolean)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $fn$
  SELECT * FROM public.feed_author_timeline('favourites', _exclude_ids, _limit, _categories);
$fn$;

COMMENT ON FUNCTION public.get_following_feed(uuid[], integer, integer, text[], text) IS
  'S12-F5 Following tab (20261018_0004): posts of members the caller follows, newest first, no ranking. Same arguments / columns as get_personal_feed (_newest_first, _session_seed ignored). authenticated only.';
COMMENT ON FUNCTION public.get_favourites_feed(uuid[], integer, integer, text[], text) IS
  'S12-F5 Favourites tab (20261018_0004): posts of members the caller starred (feed_favourite_authors), newest first. Same arguments / columns as get_personal_feed (_newest_first, _session_seed ignored). authenticated only.';

REVOKE ALL ON FUNCTION public.get_following_feed(uuid[], integer, integer, text[], text),
                       public.get_favourites_feed(uuid[], integer, integer, text[], text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_following_feed(uuid[], integer, integer, text[], text),
                          public.get_favourites_feed(uuid[], integer, integer, text[], text)
  TO authenticated;

-- ── 4. F6 admin: the mix (audited) and the before/after numbers ─────────────
CREATE FUNCTION public.feed_mix_set(_circle integer, _suggested integer, _fair integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE
 SECURITY DEFINER
 SET search_path TO ''
AS $fn$
DECLARE
  _uid uuid := (SELECT auth.uid());
  _oc  double precision;
  _os  double precision;
  _of  double precision;
  _old text;
  _new text;
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'FEEDMIX-001: only an admin can change the feed mix' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _circle IS NULL OR _suggested IS NULL OR _fair IS NULL
     OR _circle NOT BETWEEN 0 AND 10 OR _suggested NOT BETWEEN 0 AND 10 OR _fair NOT BETWEEN 0 AND 10
     OR _circle + _suggested + _fair <> 10 THEN
    RAISE EXCEPTION 'FEEDMIX-002: circle, suggested and fair must be whole numbers 0–10 that add up to 10'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM 1 FROM public.feed_score_config c WHERE c.key IN ('mix_circle', 'mix_suggested', 'mix_fair') FOR UPDATE;
  SELECT max(c.value) FILTER (WHERE c.key = 'mix_circle'),
         max(c.value) FILTER (WHERE c.key = 'mix_suggested'),
         max(c.value) FILTER (WHERE c.key = 'mix_fair')
    INTO _oc, _os, _of
    FROM public.feed_score_config c;
  _old := format('circle %s / suggested %s / fair %s', _oc, _os, _of);
  _new := format('circle %s / suggested %s / fair %s', _circle, _suggested, _fair);
  IF _oc IS NOT DISTINCT FROM _circle::double precision AND _os IS NOT DISTINCT FROM _suggested::double precision
     AND _of IS NOT DISTINCT FROM _fair::double precision THEN
    RETURN jsonb_build_object('circle', _circle, 'suggested', _suggested, 'fair', _fair, 'changed', false);
  END IF;
  UPDATE public.feed_score_config c
     SET value = CASE c.key WHEN 'mix_circle' THEN _circle WHEN 'mix_suggested' THEN _suggested ELSE _fair END,
         updated_at = now()
   WHERE c.key IN ('mix_circle', 'mix_suggested', 'mix_fair');
  INSERT INTO public.feature_access_audit (actor, feature, action, old_value, new_value, note)
  VALUES (_uid, 'personal_feed', 'mix', _old, _new, NULL);
  RETURN jsonb_build_object('circle', _circle, 'suggested', _suggested, 'fair', _fair, 'changed', true);
END;
$fn$;

CREATE FUNCTION public.feed_mix_admin_stats(_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $fn$
DECLARE
  _uid   uuid := (SELECT auth.uid());
  _d     integer := LEAST(GREATEST(coalesce(_days, 7), 1), 31);
  _since timestamptz;
  _out   jsonb;
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'FEEDMIX-001: only an admin can read the feed numbers' USING ERRCODE = 'insufficient_privilege';
  END IF;
  _since := now() - make_interval(days => _d);
  WITH
  ev AS (
    SELECT fe.user_id, count(*) AS views, count(DISTINCT (fe.created_at AT TIME ZONE 'UTC')::date) AS days
      FROM public.feed_events fe
     WHERE fe.event_type = 'view' AND fe.created_at >= _since AND fe.user_id IS NOT NULL
     GROUP BY fe.user_id
  ),
  pop AS (SELECT e.user_id, e.views, e.days, public.feature_allowed('personal_feed', e.user_id) AS grp FROM ev e),
  lk AS (
    SELECT pr.user_id, count(*) AS likes
      FROM public.post_reactions pr
     WHERE pr.created_at >= _since AND pr.user_id IN (SELECT p.user_id FROM pop p)
     GROUP BY pr.user_id
  ),
  dw AS (
    SELECT s.user_id, sum(s.dwell_ms) AS dwell_ms, count(*) AS posts
      FROM public.feed_post_signals s
     WHERE s.last_at >= _since AND s.dwell_ms > 0 AND s.user_id IN (SELECT p.user_id FROM pop p)
     GROUP BY s.user_id
  ),
  g AS (
    SELECT p.grp,
           count(*)                                  AS members,
           sum(p.views)                              AS views,
           coalesce(sum(l.likes), 0)                 AS likes,
           coalesce(sum(d.dwell_ms), 0)              AS dwell_ms,
           coalesce(sum(d.posts), 0)                 AS dwell_posts,
           count(*) FILTER (WHERE p.days >= 2)       AS ret
      FROM pop p
      LEFT JOIN lk l ON l.user_id = p.user_id
      LEFT JOIN dw d ON d.user_id = p.user_id
     GROUP BY p.grp
  ),
  both_groups AS (
    SELECT b.grp, coalesce(g.members, 0) AS members, coalesce(g.views, 0) AS views, coalesce(g.likes, 0) AS likes,
           coalesce(g.dwell_ms, 0) AS dwell_ms, coalesce(g.dwell_posts, 0) AS dwell_posts, coalesce(g.ret, 0) AS ret
      FROM (VALUES (true), (false)) b(grp) LEFT JOIN g ON g.grp = b.grp
  )
  SELECT jsonb_build_object(
           'days', _d,
           'since', _since,
           'mix', (SELECT jsonb_build_object(
                            'circle',    max(c.value) FILTER (WHERE c.key = 'mix_circle'),
                            'suggested', max(c.value) FILTER (WHERE c.key = 'mix_suggested'),
                            'fair',      max(c.value) FILTER (WHERE c.key = 'mix_fair'))
                     FROM public.feed_score_config c),
           'groups', (SELECT jsonb_object_agg(CASE WHEN bg.grp THEN 'with' ELSE 'without' END, jsonb_build_object(
                               'members',          bg.members,
                               'feed_views',       bg.views,
                               'likes',            bg.likes,
                               'likes_per_view',   CASE WHEN bg.views > 0 THEN round(bg.likes::numeric / bg.views, 4) END,
                               'avg_time_on_post_s', CASE WHEN bg.dwell_posts > 0 THEN round(bg.dwell_ms::numeric / bg.dwell_posts / 1000.0, 1) END,
                               'returning_share',  CASE WHEN bg.members > 0 THEN round(bg.ret::numeric / bg.members, 4) END))
                        FROM both_groups bg))
    INTO _out;
  RETURN _out;
END;
$fn$;

COMMENT ON FUNCTION public.feed_mix_set(integer, integer, integer) IS
  'S12-F6 (20261018_0004): admin only — sets mix_circle / mix_suggested / mix_fair (0–10 each, sum 10) and writes one feature_access_audit row (personal_feed, mix). Applies to the next page any member loads; no release.';
COMMENT ON FUNCTION public.feed_mix_admin_stats(integer) IS
  'S12-F6 (20261018_0004): admin only — current mix and, for the last N days (1–31), members WITH vs WITHOUT the personal feed: feed views, likes per view, average time on post (s), share returning on 2+ days.';

REVOKE ALL ON FUNCTION public.feed_mix_set(integer, integer, integer), public.feed_mix_admin_stats(integer)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.feed_mix_set(integer, integer, integer), public.feed_mix_admin_stats(integer)
  TO authenticated;

DO $postconditions$
DECLARE
  _bad text := '';
  r    record;
BEGIN
  -- POST-001 · definer, search_path '' for every new function.
  FOR r IN SELECT unnest(ARRAY[
      'public.feed_favourite_authors_before()',
      'public.feed_author_timeline(text,uuid[],integer,text[])',
      'public.get_following_feed(uuid[],integer,integer,text[],text)',
      'public.get_favourites_feed(uuid[],integer,integer,text[],text)',
      'public.feed_mix_set(integer,integer,integer)',
      'public.feed_mix_admin_stats(integer)']) AS f LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND p.prosecdef
                     AND p.proconfig = ARRAY['search_path=""']) THEN
      _bad := _bad || E'\n  ' || r.f || ': missing or not SECURITY DEFINER with search_path ''''';
    END IF;
  END LOOP;
  -- POST-002 · EXECUTE: the four API functions → authenticated only; the
  -- internal ones → no API role.
  FOR r IN SELECT unnest(ARRAY[
      'public.get_following_feed(uuid[],integer,integer,text[],text)',
      'public.get_favourites_feed(uuid[],integer,integer,text[],text)',
      'public.feed_mix_set(integer,integer,integer)',
      'public.feed_mix_admin_stats(integer)']) AS f LOOP
    IF NOT has_function_privilege('authenticated', r.f, 'EXECUTE') THEN
      _bad := _bad || E'\n  authenticated cannot execute ' || r.f;
    END IF;
    IF has_function_privilege('anon', r.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   WHERE p.oid = r.f::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      _bad := _bad || E'\n  ' || r.f || ' is executable by PUBLIC or anon';
    END IF;
  END LOOP;
  FOR r IN SELECT unnest(ARRAY['public.feed_author_timeline(text,uuid[],integer,text[])',
                               'public.feed_favourite_authors_before()']) AS f LOOP
    IF has_function_privilege('anon', r.f, 'EXECUTE') OR has_function_privilege('authenticated', r.f, 'EXECUTE') THEN
      _bad := _bad || E'\n  ' || r.f || ' is executable by an API role';
    END IF;
  END LOOP;
  -- POST-003 · RLS on, one permissive policy per action (INSERT, SELECT, DELETE), no UPDATE.
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.feed_favourite_authors'::regclass) THEN
    _bad := _bad || E'\n  feed_favourite_authors: RLS off';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'feed_favourite_authors' AND permissive = 'PERMISSIVE') <> 3
     OR (SELECT count(DISTINCT cmd) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'feed_favourite_authors' AND permissive = 'PERMISSIVE') <> 3
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'feed_favourite_authors' AND cmd IN ('UPDATE', 'ALL')) THEN
    _bad := _bad || E'\n  feed_favourite_authors: policies are not one permissive INSERT / SELECT / DELETE';
  END IF;
  IF has_table_privilege('anon', 'public.feed_favourite_authors', 'SELECT')
     OR has_table_privilege('authenticated', 'public.feed_favourite_authors', 'UPDATE') THEN
    _bad := _bad || E'\n  feed_favourite_authors: anon can read or authenticated can update';
  END IF;
  -- POST-004 · config + audit CHECK.
  IF NOT EXISTS (SELECT 1 FROM public.feed_score_config WHERE key = 'favourites_max' AND value = 50) THEN
    _bad := _bad || E'\n  favourites_max is not 50';
  END IF;
  IF pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid = 'public.feature_access_audit'::regclass
                             AND conname = 'feature_access_audit_action_check')) NOT LIKE '%''mix''%' THEN
    _bad := _bad || E'\n  feature_access_audit_action_check does not take ''mix''';
  END IF;
  IF _bad <> '' THEN
    RAISE EXCEPTION 'S12F56-0004-POST: post-state differs from the intended one:%', _bad USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'S12F56-0004: feed_favourite_authors (cap 50); get_following_feed / get_favourites_feed (authenticated only); feed_mix_set / feed_mix_admin_stats (admin only); audit takes ''mix''';
END
$postconditions$;

COMMIT;
