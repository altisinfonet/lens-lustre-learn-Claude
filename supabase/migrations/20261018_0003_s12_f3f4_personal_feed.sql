-- ═══════════════════════════════════════════════════════════════════════════
-- 20261018_0003 — S12-F3 + F4 Personal feed (server RPC, behind a switch).
--   · public.get_personal_feed(uuid[], integer, integer, text[], text)
--     SECURITY DEFINER, search_path '', EXECUTE to authenticated ONLY; the
--     viewer is (SELECT auth.uid()), never an argument.
--   · 14 mix / ranking keys added to public.feed_score_config (S12-F2).
--   · feature switch 'personal_feed' (VID-7 Admin → Features), default Off.
-- EXPAND step: a new function, new config rows, one new feature row and the
-- feature list's CHECK widened by one value. get_broadcast_feed (every
-- overload) is NOT touched: members whose switch is Off — and every signed-out
-- visitor — are served exactly as today.
-- Lanes: staging and production (refuses any other lane).
-- D1 (Database & Runtime), 2026-10-18. Master plan v3 S12 (Owner: the feed
-- "like Meta/Instagram"). Builds on S12-F1 (20261018_0001) + S12-F2 (_0002).
-- ═══════════════════════════════════════════════════════════════════════════
--
-- GATES (verbatim):
--   F3 "① network (friends + following) ② interest-matched suggested ③ fair
--       share for less-seen photographers — Each source present per page in the
--       configured ratio"
--   F4 "closeness + category interest + quality + freshness − seen penalty;
--       deterministic per session seed — R1–R7 (v2) still pass; fair-share ratio
--       met"   (Owner 2026-10-18: NO video boost.)
--
-- CONTRACT — the client swap is the function name only. Same five arguments as
-- get_broadcast_feed's session overload (_exclude_ids in delivery order,
-- _limit ≤ 50, _newest_first, _categories, _session_seed); the same 15 columns,
-- plus:
--   source           'circle' | 'suggested' | 'fair'
--   caught_up_after  true on exactly the row after which this session has no
--                    unseen circle post left ("You're all caught up").
--
-- DESIGN
--   1. VISIBILITY — never weaker than today. A row is returned only if it
--      passes BOTH today's feed rule (public; or the caller's own; or a
--      friends-only post of an ACCEPTED friend — the same predicate as
--      feed_candidates and get_broadcast_feed's tail) AND
--      public.can_view_post(caller, author, privacy). Private posts of others
--      never qualify. feed_hidden_posts (the caller's) and feed_muted_authors
--      (the caller's) are excluded (S12-F1). Signed out: no row (and anon has no
--      EXECUTE at all).
--   2. SOURCES (unseen posts only; "seen" = today's rule: a view, two skips, or
--      one skip within 12 h — feed_events):
--        circle     friends (accepted, either direction) + members followed, and
--                   the caller's own posts of the last 24 h. The newest
--                   _newest_first are pinned first (today's R-LIVE-5 rule: the N
--                   newest are taken, THEN seen ones dropped), the rest by score.
--        suggested  outside the circle, interest-matched: decayed category
--                   interest > 0, or a category the member chose
--                   (profiles.photography_interests — OnboardingModal already
--                   writes it on both lanes, so no second store is created), or —
--                   COLD START, fewer than cold_history_min score rows — a
--                   popular post (smoothed quality above the prior). By score.
--        fair       outside the circle, less-seen photographers first: author
--                   reach bucket floor(log2(1 + mean viewer_count of the
--                   author's candidate posts)) ascending, ties by the session
--                   jitter.
--        recycled   seen posts, by score (the score carries the seen penalty);
--                   only when every source is empty; labelled with the source it
--                   would belong to.
--   3. SCORE (F4) — all weights in feed_score_config:
--        score = w_closeness · clamp(decayed closeness / score_max, −1, 1)
--              + w_category  · clamp(Σ decayed interest in the post's
--                              categories / score_max, −1, 1)
--              + w_chosen    · [a chosen category matches]
--              + w_quality   · min(1, smoothed quality / quality_norm)
--              + w_freshness · exp(−age_h / fresh_hours)
--              − w_seen      · [seen] · exp(−hours_since_seen / seen_hours)
--              + w_jitter    · hash(post id ‖ session seed) ∈ [0, 1)
--      Deterministic per session seed (same seed + same data → same order);
--      every refresh sends a new seed → a new mix. No video term.
--   4. MIX per page (default 10): circle 6 / suggested 2 / fair 2 from
--      mix_circle / mix_suggested / mix_fair, scaled to _limit. The page is a
--      slot pattern spread evenly (each source's j-th slot at (j − ½)/quota;
--      pinned newest first) — e.g. C C C S F C C S F C. ADAPTIVE: an empty
--      circle slot takes suggested, then fair; an empty suggested slot takes
--      fair, then circle; an empty fair slot takes suggested, then circle; then
--      recycled. Never fewer rows than today while anything is left.
--   5. VARIETY: at each slot the best post that is not the 3rd in a row by one
--      author (max 2) and not the 4th in a row sharing a category (max 3) is
--      taken first; if every remaining post breaks a rule the best one is taken
--      anyway (the feed never stops early). Carried across pages from the last
--      three ids of _exclude_ids, read only if the caller may see them (an id
--      the caller may not see yields NULL — today's rule).
--   6. COST: candidates = today's feed_candidates (≤ ~1,800 ids) + ≤ 300 newest
--      circle posts + ≤ 20 own; each source list cut to 3 × _limit before the
--      ≤ 50-step pick (as today). Indexes used: idx_posts_user_id_created_at,
--      idx_follows_follower, idx_friendships_*_status, idx_feed_events_user_post,
--      the score tables' primary keys. Not measured at 1 M members.
--   7. SWITCH: 'personal_feed' in public.feature_access (Off / Selected members /
--      All members, VID-7). The client calls this function only when
--      feature_allowed_me('personal_feed') is true. The function itself is not
--      gated: it grants no privilege (it returns only rows the caller may already
--      see), so a member whose switch flips mid-session is never shown an error.
--
-- LOCKING. ALTER TABLE feature_access (3 rows: DROP/ADD CHECK, ACCESS EXCLUSIVE,
-- instant); inserts into feed_score_config / feature_access /
-- feature_access_audit; CREATE FUNCTION. lock_timeout 5 s.
-- RE-RUN: refused by PRE-001 once applied. After the rollback it applies again.
-- ROLLBACK: supabase/rollback/20261018_0003_s12_f3f4_personal_feed_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261018_0003_s12_f3f4_personal_feed.sql
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
  -- PRE-001 · not applied already. The function is checked by NAME in pg_proc
  -- (catches any overload), never with to_regproc.
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'get_personal_feed')
     OR (to_regclass('public.feed_score_config') IS NOT NULL AND EXISTS (
           SELECT 1 FROM public.feed_score_config WHERE key IN (
             'mix_circle', 'mix_suggested', 'mix_fair', 'rank_w_closeness', 'rank_w_category', 'rank_w_chosen',
             'rank_w_quality', 'rank_quality_norm', 'rank_w_freshness', 'rank_fresh_hours', 'rank_w_seen',
             'rank_seen_hours', 'rank_w_jitter', 'cold_history_min')))
     OR (to_regclass('public.feature_access') IS NOT NULL AND EXISTS (
           SELECT 1 FROM public.feature_access WHERE feature = 'personal_feed')) THEN
    RAISE EXCEPTION 'S12F34-0003-PRE-001: get_personal_feed, a mix/rank config key or the personal_feed switch already exists — 20261018_0003 is applied (or half-applied by hand)'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- PRE-002 · what this file relies on — exact signatures (to_regprocedure).
  FOR r IN SELECT unnest(ARRAY[
      'auth.uid()',
      'public.feed_candidates(text,text[],integer,integer,integer,integer)',
      'public.can_view_post(uuid,uuid,text)',
      'public.feed_score_decayed(double precision,timestamp with time zone)',
      'public.feature_allowed(text,uuid)',
      'public.feature_allowed_me(text)']) AS f LOOP
    IF to_regprocedure(r.f) IS NULL THEN _bad := _bad || E'\n  function ' || r.f || ' missing'; END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('posts', 'id'), ('posts', 'user_id'), ('posts', 'content'), ('posts', 'image_url'), ('posts', 'image_urls'),
      ('posts', 'privacy'), ('posts', 'is_public'), ('posts', 'created_at'), ('posts', 'likes_count'),
      ('posts', 'comments_count'), ('posts', 'shares_count'), ('posts', 'thumbnail_urls'), ('posts', 'categories'),
      ('posts', 'viewer_count'),
      ('profiles', 'photography_interests'), ('profiles_public_data', 'full_name'), ('profiles_public_data', 'avatar_url'),
      ('follows', 'follower_id'), ('follows', 'following_id'),
      ('friendships', 'requester_id'), ('friendships', 'addressee_id'), ('friendships', 'status'),
      ('feed_events', 'user_id'), ('feed_events', 'post_id'), ('feed_events', 'event_type'), ('feed_events', 'created_at'),
      ('feed_hidden_posts', 'post_id'), ('feed_muted_authors', 'author_id'),
      ('feed_score_config', 'key'), ('feed_score_config', 'value'), ('feed_score_config', 'note'),
      ('feed_viewer_author_affinity', 'score'), ('feed_viewer_category_interest', 'category'),
      ('feed_post_quality', 'score'),
      ('feature_access', 'feature'), ('feature_access', 'mode'),
      ('feature_access_audit', 'old_value'), ('feature_access_audit', 'new_value')
    ) v(t, c) LOOP
    IF to_regclass('public.' || r.t) IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = ('public.' || r.t)::regclass AND attname = r.c AND NOT attisdropped) THEN
      _bad := _bad || E'\n  public.' || r.t || '(' || r.c || ') missing';
    END IF;
  END LOOP;
  -- the switch list is exactly VID-7's three features (the CHECK is rebuilt below)
  IF to_regclass('public.feature_access') IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.feature_access'::regclass AND conname = 'feature_access_feature_check'
          AND pg_get_constraintdef(oid) = 'CHECK ((feature = ANY (ARRAY[''video_posts''::text, ''video_ads''::text, ''copyright_music_check''::text])))') THEN
    _bad := _bad || E'\n  feature_access_feature_check is not VID-7''s three-feature CHECK';
  END IF;
  IF to_regclass('public.feed_score_config') IS NOT NULL
     AND (SELECT count(*) FROM public.feed_score_config WHERE key IN ('score_max', 'q_prior_rate', 'half_life_days')) <> 3 THEN
    _bad := _bad || E'\n  feed_score_config lacks score_max / q_prior_rate / half_life_days (S12-F2)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    _bad := _bad || E'\n  role anon / authenticated / service_role missing';
  END IF;
  IF _bad <> '' THEN
    RAISE EXCEPTION 'S12F34-0003-PRE-002: prerequisites missing:%', _bad USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── 1. mix + ranking weights, in S12-F2's one place ─────────────────────────
INSERT INTO public.feed_score_config (key, value, note) VALUES
  ('mix_circle',        6,    'personal feed: circle (friends + following + own 24 h) slots per 10'),
  ('mix_suggested',     2,    'personal feed: interest-matched suggested slots per 10'),
  ('mix_fair',          2,    'personal feed: fair-share (less-seen photographers) slots per 10'),
  ('rank_w_closeness',  3,    'personal feed score: × decayed viewer→author closeness / score_max'),
  ('rank_w_category',   2,    'personal feed score: × decayed interest in the post''s categories / score_max'),
  ('rank_w_chosen',     1,    'personal feed score: + when a category the member chose matches'),
  ('rank_w_quality',    2,    'personal feed score: × min(1, smoothed quality / rank_quality_norm)'),
  ('rank_quality_norm', 0.25, 'personal feed score: quality at which the quality term is full'),
  ('rank_w_freshness',  2,    'personal feed score: × exp(−age hours / rank_fresh_hours)'),
  ('rank_fresh_hours',  48,   'personal feed score: freshness time constant (hours)'),
  ('rank_w_seen',       4,    'personal feed score: − × exp(−hours since seen / rank_seen_hours) for a seen post'),
  ('rank_seen_hours',   72,   'personal feed score: seen-penalty time constant (hours)'),
  ('rank_w_jitter',     1,    'personal feed score: × hash(post, session seed) — a new mix every refresh'),
  ('cold_history_min',  5,    'personal feed: fewer score rows than this = new member (popular posts join suggested)');

-- ── 2. the switch (VID-7): Off until an admin turns it on ───────────────────
ALTER TABLE public.feature_access DROP CONSTRAINT feature_access_feature_check;
ALTER TABLE public.feature_access ADD CONSTRAINT feature_access_feature_check
  CHECK (feature IN ('video_posts', 'video_ads', 'copyright_music_check', 'personal_feed'));
INSERT INTO public.feature_access (feature, mode) VALUES ('personal_feed', 'off');
INSERT INTO public.feature_access_audit (actor, feature, action, old_value, new_value, note)
VALUES (NULL, 'personal_feed', 'mode', NULL, 'off', '20261018_0003: switch created, Off');

-- ── 3. the personal feed ─────────────────────────────────────────────────────
CREATE FUNCTION public.get_personal_feed(
  _exclude_ids uuid[], _limit integer, _newest_first integer, _categories text[], _session_seed text)
 RETURNS TABLE(id uuid, user_id uuid, content text, image_url text, image_urls text[], privacy text,
               created_at timestamp with time zone, likes_count integer, comments_count integer,
               shares_count integer, feed_tier text, author_name text, author_avatar text,
               thumbnail_urls text[], categories text[], source text, caught_up_after boolean)
 LANGUAGE sql
 VOLATILE
 SECURITY DEFINER
 SET search_path TO ''
AS $fn$
  WITH RECURSIVE
  me AS (SELECT (SELECT auth.uid()) AS uid),
  ex AS (SELECT coalesce(_exclude_ids, '{}'::uuid[]) AS ids),
  cfg AS (
    SELECT coalesce(max(c.value) FILTER (WHERE c.key = 'mix_circle'), 6)           AS mix_c,
           coalesce(max(c.value) FILTER (WHERE c.key = 'mix_suggested'), 2)        AS mix_s,
           coalesce(max(c.value) FILTER (WHERE c.key = 'mix_fair'), 2)             AS mix_f,
           coalesce(max(c.value) FILTER (WHERE c.key = 'rank_w_closeness'), 3)     AS w_close,
           coalesce(max(c.value) FILTER (WHERE c.key = 'rank_w_category'), 2)      AS w_cat,
           coalesce(max(c.value) FILTER (WHERE c.key = 'rank_w_chosen'), 1)        AS w_chosen,
           coalesce(max(c.value) FILTER (WHERE c.key = 'rank_w_quality'), 2)       AS w_quality,
           GREATEST(coalesce(max(c.value) FILTER (WHERE c.key = 'rank_quality_norm'), 0.25), 0.0001) AS q_norm,
           coalesce(max(c.value) FILTER (WHERE c.key = 'rank_w_freshness'), 2)     AS w_fresh,
           GREATEST(coalesce(max(c.value) FILTER (WHERE c.key = 'rank_fresh_hours'), 48), 0.01) AS fresh_h,
           coalesce(max(c.value) FILTER (WHERE c.key = 'rank_w_seen'), 4)          AS w_seen,
           GREATEST(coalesce(max(c.value) FILTER (WHERE c.key = 'rank_seen_hours'), 72), 0.01) AS seen_h,
           coalesce(max(c.value) FILTER (WHERE c.key = 'rank_w_jitter'), 1)        AS w_jitter,
           coalesce(max(c.value) FILTER (WHERE c.key = 'cold_history_min'), 5)     AS cold_min,
           GREATEST(coalesce(max(c.value) FILTER (WHERE c.key = 'score_max'), 100), 1) AS score_max,
           coalesce(max(c.value) FILTER (WHERE c.key = 'q_prior_rate'), 0.05)      AS q_prior
      FROM public.feed_score_config c
  ),
  -- A refresh sends a new seed (kept for every page of that session); none:
  -- a per-viewer, per-hour seed (as get_broadcast_feed).
  seed AS (
    SELECT 'personal:' || coalesce(nullif(left(btrim(coalesce(_session_seed, '')), 64), ''), to_char(now(), 'YYYYMMDDHH24'))
           || ':' || coalesce(m.uid::text, 'anon') AS s
      FROM me m
  ),
  lim AS (
    SELECT q.n, q.qs, q.qf, GREATEST(q.n - q.qs - q.qf, 0) AS qc,
           LEAST(GREATEST(coalesce(_newest_first, 0), 0), q.n) AS pin
      FROM (SELECT x.n,
                   CASE WHEN c.mix_c + c.mix_s + c.mix_f > 0 THEN round(x.n * GREATEST(c.mix_s, 0) / (c.mix_c + c.mix_s + c.mix_f))::integer ELSE 0 END AS qs,
                   CASE WHEN c.mix_c + c.mix_s + c.mix_f > 0 THEN round(x.n * GREATEST(c.mix_f, 0) / (c.mix_c + c.mix_s + c.mix_f))::integer ELSE 0 END AS qf
              FROM (SELECT LEAST(GREATEST(coalesce(_limit, 10), 0), 50) AS n) x, cfg c) q
  ),
  friends AS (
    SELECT CASE WHEN f.requester_id = m.uid THEN f.addressee_id ELSE f.requester_id END AS aid
      FROM public.friendships f, me m
     WHERE f.status = 'accepted' AND (f.requester_id = m.uid OR f.addressee_id = m.uid)
  ),
  network AS (
    SELECT fr.aid FROM friends fr
    UNION
    SELECT fo.following_id FROM public.follows fo, me m WHERE fo.follower_id = m.uid
  ),
  muted  AS (SELECT ma.author_id FROM public.feed_muted_authors ma, me m WHERE ma.user_id = m.uid),
  hidden AS (SELECT hp.post_id   FROM public.feed_hidden_posts  hp, me m WHERE hp.user_id = m.uid),
  chosen AS (SELECT coalesce(pr.photography_interests, '{}'::text[]) AS cats
               FROM me m LEFT JOIN public.profiles pr ON pr.id = m.uid),
  cand AS (
    (SELECT p.id FROM public.posts p, ex
      WHERE p.user_id IN (SELECT nw.aid FROM network nw)
        AND (p.is_public OR (p.privacy = 'friends' AND p.user_id IN (SELECT fr.aid FROM friends fr)))
        AND (_categories IS NULL OR p.categories && _categories)
        AND NOT (p.id = ANY (ex.ids))
      ORDER BY p.created_at DESC LIMIT 300)
    UNION
    (SELECT p.id FROM public.posts p, me m, ex
      WHERE p.user_id = m.uid AND p.created_at > now() - interval '24 hours'
        AND (_categories IS NULL OR p.categories && _categories)
        AND NOT (p.id = ANY (ex.ids))
      ORDER BY p.created_at DESC LIMIT 20)
    UNION
    SELECT fc.id FROM seed sd, public.feed_candidates(sd.s, _categories) fc
  ),
  -- VISIBILITY: today's feed rule AND can_view_post — both must hold.
  vis AS (
    SELECT p.id, p.user_id, p.created_at, p.categories, p.viewer_count,
           (p.user_id = m.uid OR p.user_id IN (SELECT nw.aid FROM network nw)) AS in_circle
      FROM cand ca
      JOIN public.posts p ON p.id = ca.id
      CROSS JOIN me m
      CROSS JOIN ex
     WHERE m.uid IS NOT NULL
       AND NOT (p.id = ANY (ex.ids))
       AND (_categories IS NULL OR p.categories && _categories)
       AND (p.user_id <> m.uid OR p.created_at > now() - interval '24 hours')
       AND (p.is_public OR p.user_id = m.uid
            OR (p.privacy = 'friends' AND p.user_id IN (SELECT fr.aid FROM friends fr)))
       AND public.can_view_post(m.uid, p.user_id, p.privacy)
       AND NOT EXISTS (SELECT 1 FROM hidden h WHERE h.post_id = p.id)
       AND NOT EXISTS (SELECT 1 FROM muted mu WHERE mu.author_id = p.user_id)
  ),
  my_events AS (
    SELECT fe.post_id,
           count(*) FILTER (WHERE fe.event_type = 'view') AS views,
           count(*) FILTER (WHERE fe.event_type = 'skip') AS skips,
           max(fe.created_at)                             AS last_seen_at
      FROM public.feed_events fe, me m
     WHERE fe.user_id = m.uid AND fe.event_type IN ('view', 'skip')
       AND fe.post_id IN (SELECT v.id FROM vis v)
     GROUP BY fe.post_id
  ),
  seen AS (
    SELECT e.post_id, e.last_seen_at FROM my_events e
     WHERE e.views > 0 OR e.skips >= 2 OR (e.skips = 1 AND e.last_seen_at > now() - interval '12 hours')
  ),
  hist AS (
    SELECT (SELECT count(*) FROM (SELECT 1 FROM public.feed_viewer_author_affinity a, me m WHERE a.user_id = m.uid LIMIT 100) x)
         + (SELECT count(*) FROM (SELECT 1 FROM public.feed_viewer_category_interest i, me m WHERE i.user_id = m.uid LIMIT 100) y) AS n
  ),
  scored AS (
    SELECT v.id, v.user_id, v.categories, v.in_circle,
           (s.post_id IS NOT NULL) AS is_seen,
           row_number() OVER (PARTITION BY v.in_circle ORDER BY v.created_at DESC, v.id) AS newest_rn,
           floor(ln(1 + GREATEST(avg(v.viewer_count) OVER (PARTITION BY v.user_id), 0)::double precision) / ln(2)) AS reach,
           coalesce(ci.val, 0) AS cat_raw,
           (ch.cats && v.categories) AS chosen,
           coalesce(fq.score, c.q_prior) AS qual,
           j.jit,
             c.w_close   * LEAST(1, GREATEST(-1, coalesce(public.feed_score_decayed(af.score, af.updated_at), 0) / c.score_max))
           + c.w_cat     * LEAST(1, GREATEST(-1, coalesce(ci.val, 0) / c.score_max))
           + c.w_chosen  * (CASE WHEN ch.cats && v.categories THEN 1 ELSE 0 END)
           + c.w_quality * LEAST(1, GREATEST(0, coalesce(fq.score, c.q_prior)) / c.q_norm)
           + c.w_fresh   * exp(-LEAST(GREATEST(extract(epoch FROM now() - v.created_at)::double precision, 0) / 3600.0 / c.fresh_h, 50))
           - c.w_seen    * CASE WHEN s.post_id IS NULL THEN 0
                                ELSE exp(-LEAST(GREATEST(extract(epoch FROM now() - s.last_seen_at)::double precision, 0) / 3600.0 / c.seen_h, 50)) END
           + c.w_jitter  * j.jit AS score
      FROM vis v
      CROSS JOIN cfg c
      CROSS JOIN seed sd
      CROSS JOIN me m
      CROSS JOIN chosen ch
      CROSS JOIN LATERAL (SELECT (hashtextextended(v.id::text || sd.s, 0) & 2147483647)::double precision / 2147483647.0 AS jit) j
      LEFT JOIN seen s ON s.post_id = v.id
      LEFT JOIN public.feed_viewer_author_affinity af ON af.user_id = m.uid AND af.author_id = v.user_id
      LEFT JOIN public.feed_post_quality fq ON fq.post_id = v.id
      LEFT JOIN LATERAL (
        SELECT sum(public.feed_score_decayed(x.score, x.updated_at)) AS val
          FROM public.feed_viewer_category_interest x
         WHERE x.user_id = m.uid AND x.category = ANY (v.categories)
      ) ci ON true
  ),
  -- Each source's ranked list, cut to 3 × _limit (alternatives for the variety rule).
  lists AS MATERIALIZED (
    SELECT z.id, z.user_id, z.categories, z.src, z.label, z.tier, z.rk
      FROM (
        SELECT s.id, s.user_id, s.categories, 'circle'::text AS src, 'circle'::text AS label,
               CASE WHEN s.newest_rn <= l.pin THEN 'newest' ELSE 'unseen' END::text AS tier,
               row_number() OVER (ORDER BY (s.newest_rn <= l.pin) DESC,
                                           CASE WHEN s.newest_rn <= l.pin THEN s.newest_rn END ASC,
                                           s.score DESC, s.id) AS rk
          FROM scored s, lim l
         WHERE s.in_circle AND NOT s.is_seen
        UNION ALL
        SELECT s.id, s.user_id, s.categories, 'suggested', 'suggested', 'unseen',
               row_number() OVER (ORDER BY s.score DESC, s.id)
          FROM scored s, hist hh, cfg c
         WHERE NOT s.in_circle AND NOT s.is_seen
           AND (s.cat_raw > 0 OR s.chosen OR (hh.n < c.cold_min AND s.qual > c.q_prior))
        UNION ALL
        SELECT s.id, s.user_id, s.categories, 'fair', 'fair', 'unseen',
               row_number() OVER (ORDER BY s.reach ASC, s.jit ASC, s.id)
          FROM scored s
         WHERE NOT s.in_circle AND NOT s.is_seen
        UNION ALL
        SELECT s.id, s.user_id, s.categories, 'recycled',
               CASE WHEN s.in_circle THEN 'circle' WHEN s.cat_raw > 0 OR s.chosen THEN 'suggested' ELSE 'fair' END,
               'recycled', row_number() OVER (ORDER BY s.score DESC, s.id)
          FROM scored s
         WHERE s.is_seen
      ) z, lim l
     WHERE z.rk <= l.n * 3
  ),
  -- The page's slot pattern: each source's j-th slot at (j − ½)/quota, the
  -- pinned newest circle posts first.
  slots AS (
    SELECT row_number() OVER (ORDER BY z.key, z.pri) AS k, z.src
      FROM (
        SELECT 'circle'::text AS src, 0 AS pri,
               CASE WHEN g <= LEAST(l.pin, np.n) THEN g - 1000.0 ELSE (g - 0.5) / l.qc END AS key
          FROM lim l
          CROSS JOIN LATERAL generate_series(1, l.qc) g
          CROSS JOIN (SELECT count(*) AS n FROM lists li WHERE li.tier = 'newest') np
        UNION ALL
        SELECT 'suggested', 1, (g - 0.5) / l.qs FROM lim l CROSS JOIN LATERAL generate_series(1, l.qs) g
        UNION ALL
        SELECT 'fair', 2, (g - 0.5) / l.qf FROM lim l CROSS JOIN LATERAL generate_series(1, l.qf) g
      ) z
  ),
  -- The last three posts this session already delivered (delivery order), read
  -- only if the caller may see them — today's rule. Always exactly one row.
  tail AS (
    SELECT max(p.user_id::text) FILTER (WHERE t.k = 1)::uuid AS a1,
           max(p.user_id::text) FILTER (WHERE t.k = 2)::uuid AS a2,
           max(p.categories)    FILTER (WHERE t.k = 1)       AS c1,
           max(p.categories)    FILTER (WHERE t.k = 2)       AS c2,
           max(p.categories)    FILTER (WHERE t.k = 3)       AS c3
      FROM ex
      CROSS JOIN LATERAL (VALUES (1, ex.ids[array_upper(ex.ids, 1)]),
                                 (2, ex.ids[array_upper(ex.ids, 1) - 1]),
                                 (3, ex.ids[array_upper(ex.ids, 1) - 2])) AS t(k, pid)
      JOIN public.posts p
        ON p.id = t.pid
       AND (   p.is_public
            OR p.user_id = (SELECT m.uid FROM me m)
            OR (p.privacy = 'friends' AND p.user_id IN (SELECT fr.aid FROM friends fr)))
  ),
  pick AS (
    SELECT 0 AS k, ARRAY[]::uuid[] AS picked, NULL::uuid AS pid, NULL::text AS lsrc, NULL::text AS label,
           NULL::text AS tier, t.a1, t.a2, t.c1, t.c2, t.c3
      FROM tail t
    UNION ALL
    SELECT pk.k + 1, pk.picked || x.id, x.id, x.src, x.label, x.tier, x.user_id, pk.a1, x.categories, pk.c1, pk.c2
      FROM pick pk
      JOIN slots sl ON sl.k = pk.k + 1
      CROSS JOIN lim l
      CROSS JOIN LATERAL (
        SELECT li.id, li.user_id, li.categories, li.src, li.label, li.tier
          FROM lists li
         WHERE NOT (li.id = ANY (pk.picked))
         ORDER BY ( ((li.user_id = pk.a1 AND pk.a1 = pk.a2) IS TRUE)
                    OR EXISTS (SELECT 1 FROM unnest(li.categories) cc
                                WHERE cc = ANY (pk.c1) AND cc = ANY (pk.c2) AND cc = ANY (pk.c3)) ) ASC,
                  CASE WHEN li.src = sl.src THEN 0
                       WHEN li.src = 'recycled' THEN 3
                       WHEN sl.src = 'suggested' THEN CASE li.src WHEN 'fair' THEN 1 ELSE 2 END
                       ELSE CASE li.src WHEN 'suggested' THEN 1 ELSE 2 END
                  END ASC,
                  li.rk ASC, li.id
         LIMIT 1
      ) x
     WHERE pk.k < l.n
  ),
  -- "You're all caught up": this page delivers the last unseen circle post.
  caught AS (
    SELECT CASE WHEN tot.n > 0
                 AND tot.n = (SELECT count(*) FROM pick pk WHERE pk.k > 0 AND pk.lsrc = 'circle')
                THEN (SELECT max(pk.k) FROM pick pk WHERE pk.k > 0 AND pk.lsrc = 'circle') END AS mark_k
      FROM (SELECT count(*) AS n FROM scored s WHERE s.in_circle AND NOT s.is_seen) tot
  )
  SELECT p.id, p.user_id, p.content, p.image_url, p.image_urls, p.privacy, p.created_at,
         p.likes_count, p.comments_count, p.shares_count,
         pk.tier                     AS feed_tier,
         ppd.full_name               AS author_name,
         ppd.avatar_url              AS author_avatar,
         p.thumbnail_urls,
         p.categories,
         pk.label                    AS source,
         (pk.k = cu.mark_k) IS TRUE  AS caught_up_after
    FROM pick pk
    JOIN public.posts p                       ON p.id = pk.pid
    LEFT JOIN public.profiles_public_data ppd ON ppd.id = p.user_id
    LEFT JOIN caught cu                       ON true
   WHERE pk.k > 0
   ORDER BY pk.k;
$fn$;

COMMENT ON FUNCTION public.get_personal_feed(uuid[], integer, integer, text[], text) IS
  'S12-F3/F4 personal feed (20261018_0003): circle / suggested / fair per page from feed_score_config, scored closeness + category + chosen + quality + freshness − seen + session jitter; max 2 per author and 3 per category in a row; caught_up_after marks the last unseen circle post. Visibility = get_broadcast_feed''s rule AND can_view_post; hidden/muted excluded. Viewer = auth.uid(). authenticated only; the client calls it when feature personal_feed is on.';

REVOKE ALL ON FUNCTION public.get_personal_feed(uuid[], integer, integer, text[], text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_personal_feed(uuid[], integer, integer, text[], text) TO authenticated;

DO $postconditions$
DECLARE
  _bad text := '';
  _f   constant text := 'public.get_personal_feed(uuid[],integer,integer,text[],text)';
BEGIN
  -- POST-001 · definer, search_path '', authenticated only.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = _f::regprocedure AND p.prosecdef
                   AND p.proconfig = ARRAY['search_path=""']) THEN
    _bad := _bad || E'\n  get_personal_feed: not SECURITY DEFINER with search_path ''''';
  END IF;
  IF NOT has_function_privilege('authenticated', _f, 'EXECUTE') THEN
    _bad := _bad || E'\n  authenticated cannot execute get_personal_feed';
  END IF;
  IF has_function_privilege('anon', _f, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 WHERE p.oid = _f::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    _bad := _bad || E'\n  get_personal_feed is executable by PUBLIC or anon';
  END IF;
  -- POST-002 · the 14 keys, sane.
  IF (SELECT count(*) FROM public.feed_score_config WHERE key IN (
        'mix_circle', 'mix_suggested', 'mix_fair', 'rank_w_closeness', 'rank_w_category', 'rank_w_chosen',
        'rank_w_quality', 'rank_quality_norm', 'rank_w_freshness', 'rank_fresh_hours', 'rank_w_seen',
        'rank_seen_hours', 'rank_w_jitter', 'cold_history_min')) <> 14
     OR (SELECT sum(value) FROM public.feed_score_config WHERE key IN ('mix_circle', 'mix_suggested', 'mix_fair')) <> 10 THEN
    _bad := _bad || E'\n  feed_score_config mix/rank keys are not the seeded set';
  END IF;
  -- POST-003 · the switch exists and is Off; nobody on its list.
  IF NOT EXISTS (SELECT 1 FROM public.feature_access WHERE feature = 'personal_feed' AND mode = 'off')
     OR EXISTS (SELECT 1 FROM public.feature_access_members WHERE feature = 'personal_feed') THEN
    _bad := _bad || E'\n  feature personal_feed is not Off with an empty list';
  END IF;
  IF _bad <> '' THEN
    RAISE EXCEPTION 'S12F34-0003-POST: post-state differs from the intended one:%', _bad USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'S12F34-0003: get_personal_feed (circle 6 / suggested 2 / fair 2, authenticated only, definer, search_path ''''); 14 config keys; switch personal_feed Off';
END
$postconditions$;

COMMIT;
