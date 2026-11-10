-- ═══════════════════════════════════════════════════════════════════════════
-- H1 · 20261112_0100 — the hashtag page reads the hashtag store; tags in every
-- language; at most 30 tags per post; follow a hashtag.
-- Lanes: staging and production. Owner: plan 2026-11-09 ("go", follow-hashtag
-- YES), sample screens approved 2026-11-10 ("okay on hashtag sample").
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHY (measured 2026-11-09 on origin/main):
--   * /hashtag/:tag searched captions with posts.ilike('%#tag%'), public only,
--     newest 50, no paging — #land also returned #landscape, and it is a full
--     scan of posts. The store (hashtags + post_hashtags, 20260817051750) was
--     already kept by triggers and never read by the page.
--   * Tags were [A-Za-z0-9_] only, so #পাহাড় (Bengali) or #पहाड़ (Hindi) were
--     not tags at all. The Owner wants every language.
--
-- OBJECTS
--   normalize_hashtag(text)    REPLACED: + Unicode NFC, so the same word typed on
--                              two keyboards is one tag. ASCII tags unchanged.
--   extract_hashtags(text)     REPLACED: the letter class below (the ONE rule,
--                              mirrored by src/lib/hashtags/hashtagRule.ts and
--                              compared by hashtagOneRule.test.ts); first-seen
--                              order; at most 30 distinct tags per post.
--   hashtags_tag_shape         REPLACED: same class, 1–60 characters.
--   post_hashtags.post_created_at  NEW, filled by a BEFORE INSERT trigger from the
--                              post; index (hashtag_id, post_created_at, post_id)
--                              so Recent pages by index at any size.
--   hashtag_follows            NEW: (user, hashtag); cascades from the account and
--                              from the hashtag; a member reads only their own rows;
--                              written only through the two functions below.
--   hashtag_page_info(tag)     NEW: tag, display tag, photographers (public), posts
--                              (public), is_following (caller), up to 8 related
--                              tags (co-used on the tag's newest 300 public posts).
--   hashtag_page_posts(tag, sort, cursor, limit)  NEW: the page's posts, top or
--                              recent, ≤ 60 a call. A row is returned only if
--                              can_view_post(caller, author, privacy) — the SAME
--                              rule as the posts SELECT policy (public; friends for
--                              a friend; own) — and its author is neither banned nor
--                              suspended (the rule the page used before, via
--                              filter_moderated_user_ids). Top = likes + 2×comments
--                              over the tag's newest 1000 posts (bounded work);
--                              Recent = keyset on (post_created_at, post_id).
--   follow_hashtag(tag) / unfollow_hashtag(tag)  NEW: signed-in members only.
--   BACKFILL                   every caption with a '#' is re-read with the new rule
--                              (non-Latin tags appear; >30 tags trimmed), then every
--                              count is recomputed from truth (recount_hashtags).
--
-- HASHTAG_CHAR_CLASS = A-Za-z0-9_À-ÖØ-öø-ɏͰ-ϿЀ-ӿؠ-٩ٮ-ۓە-ۿऀ-ॣ०-෿ก-๙぀-ヿ㐀-䶿一-鿿가-힯‌‍
--   Latin (with accents), Greek, Cyrillic, Arabic, every Indian script from
--   Devanagari to Sinhala, Thai, Japanese kana, Chinese, Korean; ZWNJ/ZWJ, which
--   Indian scripts need inside words. NOT included: spaces, punctuation (also the
--   danda । ॥, Arabic ، ؛ ؟ ۔), symbols, emoji — so "#street।" is the tag street.
--
-- RE-RUNNABLE: PRE-002 refuses once hashtag_page_posts exists.
-- ROLLBACK: supabase/rollback/20261112_0100_h1_hashtag_page_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261112_0100_h1_hashtag_page.sql (FAIL before, PASS after)
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_assert$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_assert$;

SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  -- PRE-001 · what this file builds on.
  IF to_regclass('public.hashtags') IS NULL OR to_regclass('public.post_hashtags') IS NULL
     OR to_regclass('public.posts') IS NULL OR to_regclass('public.profiles_public_data') IS NULL
     OR to_regprocedure('public.normalize_hashtag(text)') IS NULL
     OR to_regprocedure('public.extract_hashtags(text)') IS NULL
     OR to_regprocedure('public.recount_hashtags(uuid[])') IS NULL
     OR to_regprocedure('public.can_view_post(uuid,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'H1-0100-PRE-001: the hashtag store (20260817051750) or can_view_post is missing on this lane';
  END IF;
  -- PRE-002 · not twice.
  IF to_regprocedure('public.hashtag_page_posts(text,text,text,integer)') IS NOT NULL
     OR to_regclass('public.hashtag_follows') IS NOT NULL THEN
    RAISE EXCEPTION 'H1-0100-PRE-002: already applied';
  END IF;
END
$pre$;

-- ── 1. The one tag rule ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.normalize_hashtag(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
  select nullif(normalize(lower(regexp_replace(coalesce(raw, ''), '^#', '')), NFC), '');
$fn$;

CREATE OR REPLACE FUNCTION public.extract_hashtags(body text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
  select coalesce(array_agg(x.t order by x.first_at), '{}')
  from (
    select s.t, min(s.n) as first_at
    from (
      select public.normalize_hashtag(r.m[1]) as t, r.n
      from regexp_matches(
             coalesce(body, ''),
             '#([A-Za-z0-9_À-ÖØ-öø-ɏͰ-ϿЀ-ӿؠ-٩ٮ-ۓە-ۿऀ-ॣ०-෿ก-๙぀-ヿ㐀-䶿一-鿿가-힯‌‍]{1,60})',
             'g') with ordinality as r(m, n)
    ) s
    where s.t is not null
    group by s.t
    order by min(s.n)
    limit 30
  ) x;
$fn$;

-- Pure text functions (no table read, SECURITY INVOKER): callable by everyone, as
-- before. Stated by name so who may run them is written down (S11 M2).
GRANT EXECUTE ON FUNCTION public.normalize_hashtag(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.extract_hashtags(text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.extract_hashtags(text) IS
  'Every hashtag in a caption: canonical, de-duplicated, in first-seen order, at most 30. '
  'Letters of every language in HASHTAG_CHAR_CLASS (20261112_0100); mirrored by '
  'src/lib/hashtags/hashtagRule.ts so what renders as a link is what gets counted.';

ALTER TABLE public.hashtags DROP CONSTRAINT IF EXISTS hashtags_tag_shape;
ALTER TABLE public.hashtags ADD CONSTRAINT hashtags_tag_shape CHECK (
  char_length(tag) BETWEEN 1 AND 60
  AND tag ~ '^[A-Za-z0-9_À-ÖØ-öø-ɏͰ-ϿЀ-ӿؠ-٩ٮ-ۓە-ۿऀ-ॣ०-෿ก-๙぀-ヿ㐀-䶿一-鿿가-힯‌‍]+$'
);

-- ── 2. Post time on the junction, for paging by index ───────────────────────
ALTER TABLE public.post_hashtags ADD COLUMN post_created_at timestamptz;

UPDATE public.post_hashtags ph
   SET post_created_at = p.created_at
  FROM public.posts p
 WHERE p.id = ph.post_id;

UPDATE public.post_hashtags SET post_created_at = created_at WHERE post_created_at IS NULL;
ALTER TABLE public.post_hashtags ALTER COLUMN post_created_at SET NOT NULL;

-- Filled from the post on every insert, so the one writer (sync_post_hashtags)
-- needs no change. Runs as the inserting role (the SECURITY DEFINER trigger).
CREATE OR REPLACE FUNCTION public.post_hashtags_fill_post_time()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $fn$
BEGIN
  IF NEW.post_created_at IS NULL THEN
    SELECT p.created_at INTO NEW.post_created_at FROM public.posts p WHERE p.id = NEW.post_id;
    NEW.post_created_at := coalesce(NEW.post_created_at, now());
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.post_hashtags_fill_post_time() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_post_hashtags_fill_post_time
  BEFORE INSERT ON public.post_hashtags
  FOR EACH ROW EXECUTE FUNCTION public.post_hashtags_fill_post_time();

CREATE INDEX IF NOT EXISTS idx_post_hashtags_tag_time
  ON public.post_hashtags (hashtag_id, post_created_at DESC, post_id DESC);

-- ── 3. Re-read every caption with the new rule, then recount from truth ─────
INSERT INTO public.hashtags (tag, display_tag)
SELECT DISTINCT t.tag, t.tag
  FROM public.posts p
 CROSS JOIN LATERAL unnest(public.extract_hashtags(p.content)) AS t(tag)
 WHERE p.content LIKE '%#%'
ON CONFLICT (tag) DO NOTHING;

-- Rows the new rule no longer produces (e.g. the 31st tag of a post).
DELETE FROM public.post_hashtags ph
 USING public.posts p, public.hashtags h
 WHERE p.id = ph.post_id
   AND h.id = ph.hashtag_id
   AND NOT (h.tag = ANY (public.extract_hashtags(p.content)));

INSERT INTO public.post_hashtags (post_id, hashtag_id, author_id, post_created_at)
SELECT p.id, h.id, p.user_id, p.created_at
  FROM public.posts p
 CROSS JOIN LATERAL unnest(public.extract_hashtags(p.content)) AS t(tag)
  JOIN public.hashtags h ON h.tag = t.tag
 WHERE p.content LIKE '%#%'
ON CONFLICT (post_id, hashtag_id) DO NOTHING;

SELECT public.recount_hashtags(array(SELECT id FROM public.hashtags));

-- ── 4. Follow a hashtag ─────────────────────────────────────────────────────
CREATE TABLE public.hashtag_follows (
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  hashtag_id uuid NOT NULL REFERENCES public.hashtags(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, hashtag_id)
);
CREATE INDEX idx_hashtag_follows_hashtag ON public.hashtag_follows (hashtag_id);

COMMENT ON TABLE public.hashtag_follows IS
  'Which member follows which hashtag (Owner YES 2026-11-09). Written only by '
  'follow_hashtag / unfollow_hashtag; a member reads only their own rows.';

ALTER TABLE public.hashtag_follows ENABLE ROW LEVEL SECURITY;
CREATE POLICY hashtag_follows_read_own ON public.hashtag_follows
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
REVOKE ALL ON public.hashtag_follows FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.hashtag_follows TO authenticated;
GRANT ALL ON public.hashtag_follows TO service_role;

CREATE FUNCTION public.follow_hashtag(_tag text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  _me uuid := (SELECT auth.uid());
  _h  uuid;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'HT-0100-001: sign in to follow a hashtag' USING ERRCODE = '42501';
  END IF;
  SELECT x.id INTO _h FROM public.hashtags x WHERE x.tag = public.normalize_hashtag(_tag);
  IF _h IS NULL THEN
    RAISE EXCEPTION 'HT-0100-002: no such hashtag' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.hashtag_follows f WHERE f.user_id = _me) >= 1000 THEN
    RAISE EXCEPTION 'HT-0100-003: you already follow the most hashtags allowed (1000)' USING ERRCODE = '54000';
  END IF;
  INSERT INTO public.hashtag_follows (user_id, hashtag_id) VALUES (_me, _h)
  ON CONFLICT (user_id, hashtag_id) DO NOTHING;
  RETURN true;
END
$fn$;
REVOKE ALL ON FUNCTION public.follow_hashtag(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.follow_hashtag(text) TO authenticated, service_role;

CREATE FUNCTION public.unfollow_hashtag(_tag text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  _me uuid := (SELECT auth.uid());
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'HT-0100-001: sign in to follow a hashtag' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.hashtag_follows f
   USING public.hashtags x
   WHERE f.user_id = _me AND f.hashtag_id = x.id AND x.tag = public.normalize_hashtag(_tag);
  RETURN false;
END
$fn$;
REVOKE ALL ON FUNCTION public.unfollow_hashtag(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unfollow_hashtag(text) TO authenticated, service_role;

-- ── 5. The page: header row ─────────────────────────────────────────────────
CREATE FUNCTION public.hashtag_page_info(_tag text)
RETURNS TABLE(tag text, display_tag text, people_count integer, post_count integer,
              is_following boolean, related jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
  WITH h AS (
    SELECT x.id, x.tag, x.display_tag, x.unique_user_count, x.post_count
      FROM public.hashtags x
     WHERE x.tag = public.normalize_hashtag(_tag)
  ), recent AS (
    SELECT ph.post_id
      FROM public.post_hashtags ph
      JOIN h ON ph.hashtag_id = h.id
      JOIN public.posts p ON p.id = ph.post_id
     WHERE p.privacy = 'public'
     ORDER BY ph.post_created_at DESC, ph.post_id DESC
     LIMIT 300
  ), rel AS (
    SELECT h2.tag, h2.display_tag, h2.post_count, h2.unique_user_count AS users, count(*) AS together
      FROM recent r
      JOIN public.post_hashtags ph2 ON ph2.post_id = r.post_id
      JOIN public.hashtags h2 ON h2.id = ph2.hashtag_id
     WHERE h2.id <> (SELECT h.id FROM h) AND h2.post_count > 0
     GROUP BY h2.tag, h2.display_tag, h2.post_count, h2.unique_user_count
     ORDER BY count(*) DESC, h2.unique_user_count DESC, h2.tag
     LIMIT 8
  )
  SELECT h.tag, h.display_tag, h.unique_user_count, h.post_count,
         EXISTS (SELECT 1 FROM public.hashtag_follows f
                  WHERE f.hashtag_id = h.id AND f.user_id = (SELECT auth.uid())),
         coalesce((SELECT jsonb_agg(jsonb_build_object('tag', rel.tag, 'display_tag', rel.display_tag,
                                                       'post_count', rel.post_count)
                                    ORDER BY rel.together DESC, rel.users DESC, rel.tag)
                     FROM rel), '[]'::jsonb)
    FROM h;
$fn$;
-- PUBLIC-BY-DESIGN: hashtag_page_info — /hashtag/:tag is a public page that logged-out visitors and search engines open, so anon MUST be able to execute this or the page header is empty; it returns only aggregates that are already public (people and post counts over PUBLIC posts only, maintained by recount_hashtags), the related tags of PUBLIC posts, and is_following for the caller's own auth.uid() alone (always false for anon); no author identity and no non-public post contributes to any value.
REVOKE ALL ON FUNCTION public.hashtag_page_info(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hashtag_page_info(text) TO anon, authenticated, service_role;

-- ── 6. The page: posts ──────────────────────────────────────────────────────
CREATE FUNCTION public.hashtag_page_posts(_tag text, _sort text DEFAULT 'top',
                                          _cursor text DEFAULT NULL, _limit integer DEFAULT 30)
RETURNS TABLE(post jsonb, page_cursor text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
#variable_conflict use_column
DECLARE
  _me  uuid    := (SELECT auth.uid());
  _t   text    := public.normalize_hashtag(_tag);
  _n   integer := least(greatest(coalesce(_limit, 30), 1), 60);
  _h   uuid;
  _off integer := 0;
  _ts  timestamptz;
  _id  uuid;
BEGIN
  IF coalesce(_sort, 'top') NOT IN ('top', 'recent') THEN
    RAISE EXCEPTION 'hashtag_page_posts: _sort must be top or recent' USING ERRCODE = '22023';
  END IF;
  IF _t IS NULL THEN RETURN; END IF;
  SELECT x.id INTO _h FROM public.hashtags x WHERE x.tag = _t;
  IF _h IS NULL THEN RETURN; END IF;

  IF _sort = 'recent' THEN
    IF _cursor IS NOT NULL THEN
      BEGIN
        _ts := split_part(_cursor, '|', 1)::timestamptz;
        _id := split_part(_cursor, '|', 2)::uuid;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'hashtag_page_posts: bad cursor' USING ERRCODE = '22023';
      END;
    END IF;
    RETURN QUERY
      SELECT jsonb_build_object(
               'id', p.id, 'user_id', p.user_id, 'content', p.content, 'image_url', p.image_url,
               'image_urls', p.image_urls, 'thumbnail_urls', p.thumbnail_urls, 'privacy', p.privacy,
               'created_at', p.created_at, 'likes_count', p.likes_count, 'comments_count', p.comments_count,
               'shares_count', p.shares_count, 'categories', p.categories),
             to_char(ph.post_created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || ph.post_id::text
        FROM public.post_hashtags ph
        JOIN public.posts p ON p.id = ph.post_id
       WHERE ph.hashtag_id = _h
         AND (_ts IS NULL OR (ph.post_created_at, ph.post_id) < (_ts, _id))
         AND public.can_view_post(_me, p.user_id, p.privacy)
         AND NOT EXISTS (SELECT 1 FROM public.profiles_public_data pp
                          WHERE pp.id = p.user_id AND (pp.is_banned OR pp.is_suspended))
       ORDER BY ph.post_created_at DESC, ph.post_id DESC
       LIMIT _n;
  ELSE
    IF _cursor IS NOT NULL THEN
      IF _cursor !~ '^[0-9]{1,4}$' THEN
        RAISE EXCEPTION 'hashtag_page_posts: bad cursor' USING ERRCODE = '22023';
      END IF;
      _off := _cursor::integer;
    END IF;
    RETURN QUERY
      WITH pool AS (
        SELECT ph.post_id
          FROM public.post_hashtags ph
         WHERE ph.hashtag_id = _h
         ORDER BY ph.post_created_at DESC, ph.post_id DESC
         LIMIT 1000
      ), ranked AS (
        SELECT p.id, p.user_id, p.content, p.image_url, p.image_urls, p.thumbnail_urls, p.privacy,
               p.created_at, p.likes_count, p.comments_count, p.shares_count, p.categories,
               row_number() OVER (ORDER BY (coalesce(p.likes_count, 0) + 2 * coalesce(p.comments_count, 0)) DESC,
                                           p.created_at DESC, p.id DESC) AS rn
          FROM pool
          JOIN public.posts p ON p.id = pool.post_id
         WHERE public.can_view_post(_me, p.user_id, p.privacy)
           AND NOT EXISTS (SELECT 1 FROM public.profiles_public_data pp
                            WHERE pp.id = p.user_id AND (pp.is_banned OR pp.is_suspended))
      )
      SELECT jsonb_build_object(
               'id', r.id, 'user_id', r.user_id, 'content', r.content, 'image_url', r.image_url,
               'image_urls', r.image_urls, 'thumbnail_urls', r.thumbnail_urls, 'privacy', r.privacy,
               'created_at', r.created_at, 'likes_count', r.likes_count, 'comments_count', r.comments_count,
               'shares_count', r.shares_count, 'categories', r.categories),
             r.rn::text
        FROM ranked r
       WHERE r.rn > _off
       ORDER BY r.rn
       LIMIT _n;
  END IF;
END
$fn$;
-- PUBLIC-BY-DESIGN: hashtag_page_posts — /hashtag/:tag is a public page that logged-out visitors and search engines open, so anon MUST be able to execute this or the page lists nothing; every row passes public.can_view_post(auth.uid(), author, privacy), the very rule of the posts SELECT policy (anon therefore sees public posts only, a friend sees friends-only posts, nobody sees only-me posts of others), banned and suspended authors are left out, and the columns returned are the ones the posts table already shows that caller.
REVOKE ALL ON FUNCTION public.hashtag_page_posts(text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hashtag_page_posts(text, text, text, integer) TO anon, authenticated, service_role;

-- ── 7. POST checks ──────────────────────────────────────────────────────────
DO $post$
DECLARE
  _n bigint;
BEGIN
  -- ড় / ड़ are composition exclusions: NFC stores them as two code points, so the
  -- expected values are normalised the same way.
  IF public.extract_hashtags('#পাহাড় #Land #landscape #land। #पहाड़')
     <> ARRAY[normalize('পাহাড়', NFC), 'land', 'landscape', normalize('पहाड़', NFC)] THEN
    RAISE EXCEPTION 'H1-0100-POST-001: extract_hashtags does not read every language as intended: %',
      public.extract_hashtags('#পাহাড় #Land #landscape #land। #पहाड़');
  END IF;
  IF cardinality(public.extract_hashtags((SELECT string_agg('#t' || g, ' ') FROM generate_series(1, 40) g))) <> 30 THEN
    RAISE EXCEPTION 'H1-0100-POST-002: more than 30 tags per post are kept';
  END IF;
  SELECT count(*) INTO _n FROM public.post_hashtags WHERE post_created_at IS NULL;
  IF _n <> 0 THEN RAISE EXCEPTION 'H1-0100-POST-003: % junction rows without post time', _n; END IF;
  IF has_function_privilege('anon', 'public.follow_hashtag(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.unfollow_hashtag(text)', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.hashtag_page_info(text)', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.hashtag_page_posts(text,text,text,integer)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.follow_hashtag(text)', 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.hashtag_follows', 'INSERT')
     OR has_table_privilege('anon', 'public.hashtag_follows', 'SELECT') THEN
    RAISE EXCEPTION 'H1-0100-POST-004: grants are not as intended';
  END IF;
  RAISE NOTICE 'H1-0100 applied on %: % hashtags, % post tags',
    current_setting('p32.lane', true), (SELECT count(*) FROM public.hashtags), (SELECT count(*) FROM public.post_hashtags);
END
$post$;

COMMIT;
