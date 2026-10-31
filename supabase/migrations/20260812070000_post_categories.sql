-- ═══════════════════════════════════════════════════════════════════════════
-- STAGE B1 — CATEGORIES ON POSTS, AND A CATEGORY-AWARE FEED
--            THE PRODUCTION-SAFE FOUNDATION. NO MANDATORY MINIMUM YET.
--
-- Scope, per the owner 2026-08-12: DATABASE AND FEED FILTERING ONLY.
-- No Create UI. No category strip. Those are Stages C and D.
--
-- NOT TOUCHED BY THIS MIGRATION:
--   • hashtags — `#word` is parsed out of posts.content at READ time by
--     RichContentRenderer; there is no table and no column. Untouched.
--   • post_tags — tagging PEOPLE in a photograph, with coordinates. Untouched.
--   • the Contributor Score functions and the Active Engagement collector.
--   • the 46-row `categories` taxonomy from Phase A (read-only here).
--
-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ WHY THIS FILE NO LONGER CONTAINS POST-CAT-002                             ║
-- ║                                                                           ║
-- ║ The first version of this migration required 1–5 categories on every      ║
-- ║ member INSERT. That made it undeployable: the composer that would send    ║
-- ║ them is Stage C, which does not exist yet, so applying it would have      ║
-- ║ refused EVERY member post on a live site — instantly, for everyone.       ║
-- ║                                                                           ║
-- ║ Owner's ruling, 2026-08-12, choosing a staged rollout over both           ║
-- ║ ship-together and permanently weakening the rule:                         ║
-- ║                                                                           ║
-- ║   B1 (this file)  → foundation, no minimum. Safe to apply today.          ║
-- ║   C              → Create/Post UI, mandatory 1–5 in the client.           ║
-- ║   B2             → activate the minimum in the database.                  ║
-- ║   D              → category strip on the Feed.                            ║
-- ║                                                                           ║
-- ║ The minimum is NOT abandoned — it is deferred, verbatim, to               ║
-- ║   20260812090000_post_categories_enforce_minimum.sql                      ║
-- ║ which is written, tested and deliberately NOT applied. B1 and B2 are      ║
-- ║ separate deploys on purpose: if Stage C's frontend deploy fails, the      ║
-- ║ database must NOT already be enforcing a rule no client can satisfy.      ║
-- ║                                                                           ║
-- ║ CONSEQUENCE, ACCEPTED KNOWINGLY: between B1 and B2, member posts can be   ║
-- ║ created with zero categories. At ~5 posts/day (148 in the 30 days to      ║
-- ║ 2026-08-12) that is roughly 35 a week. They join the 204 pre-existing     ║
-- ║ uncategorised posts and stay visible under "All" only. POST-CAT-002 is    ║
-- ║ INSERT-only, so B2 will never retroactively reject them.                  ║
-- ║                                                                           ║
-- ║ EVERYTHING ELSE IS ENFORCED FROM B1 ONWARD: the max of 5, slug validity,  ║
-- ║ the active-category check, normalisation and de-duplication, the          ║
-- ║ server-side post_kind pin, and POST-CAT-003 (a categorised post cannot be ║
-- ║ stripped back to none). Only the MINIMUM is deferred.                     ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- APPLY ORDER WITHIN B1 — three artefacts, and the order is not optional:
--   1. THIS MIGRATION.  An old frontend sends 3 named args, hits the wrapper,
--      and keeps working. Nothing breaks.
--   2. THE FRONTEND.    If it went first, `_categories` would be an unknown
--      parameter, PostgREST would answer PGRST202, and the feed would fall
--      back to chronological — losing fairness ordering with nothing on
--      screen to show it. Degraded and invisible is the worst outcome.
--   3. THE EDGE FUNCTION (publish-scheduled-posts). It reads
--      `scheduled_posts.categories`, which only exists after step 1.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. THE COLUMNS
--
-- `DEFAULT '{}'` is what leaves the existing 204 posts alone. They keep an
-- empty array, which means they match no category filter and therefore appear
-- under "All" only — exactly the owner's rule. No backfill, no classification.
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS categories text[] NOT NULL DEFAULT '{}';

-- WHY `post_kind` EXISTS AT ALL.
--
-- Three code paths create posts without a human ever choosing a category:
--   • MyPhotos.tsx      "added 3 photos to the album X."
--   • profilePostHelper "updated their profile picture."
--   • (scheduled posts DO carry categories — see §5 — so they are NOT system)
-- A blanket "every new post needs 1-5 categories" breaks all of them on day one.
-- This column is the explicit, greppable distinction. No guessing from content.
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS post_kind text NOT NULL DEFAULT 'member';

DO $$ BEGIN
  ALTER TABLE public.posts
    ADD CONSTRAINT posts_post_kind_check CHECK (post_kind IN ('member','system'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.posts.categories IS
  'Category SLUGS from public.categories. 1-5 for member posts, empty for system posts and for every post created before 2026-08-12. Empty means the post appears under "All" only.';
COMMENT ON COLUMN public.posts.post_kind IS
  'member = a person chose the categories. system = generated by the app (album upload, profile-photo change) with no human choice. SERVER-CONTROLLED: a client can never set this - see enforce_post_categories().';

-- The feed filter is `categories && ARRAY[...]`, which is a GIN overlap search.
CREATE INDEX IF NOT EXISTS idx_posts_categories ON public.posts USING GIN (categories);


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. THE UPPER BOUND, AS A REAL CONSTRAINT
--
-- `<= 5` is safe to validate immediately: every existing row has 0, and 0 <= 5.
-- So unlike the minimum, this one can be a plain CHECK that also protects
-- UPDATEs, with no NOT VALID escape hatch and nothing to validate later.
--
-- The MINIMUM cannot be a CHECK. A CHECK is re-evaluated on every UPDATE, so
-- `cardinality >= 1` would make the existing 204 uncategorised posts
-- uneditable - a member editing an old caption would get a constraint error on
-- a post they never categorised. That is why the minimum lives in the trigger
-- below, which can distinguish INSERT from UPDATE.
DO $$ BEGIN
  ALTER TABLE public.posts
    ADD CONSTRAINT posts_categories_max_5 CHECK (cardinality(categories) <= 5);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. THE ENFORCEMENT TRIGGER
--
-- ⚠ WHY `post_kind` IS FORCED SERVER-SIDE.
--
-- The two system paths run under the MEMBER'S OWN session, not service_role.
-- So if the client were allowed to send `post_kind`, any member could send
-- `post_kind: 'system'` and skip the category requirement entirely - the rule
-- would be advisory, not enforced.
--
-- A SECURITY DEFINER function runs as its owner, so `current_user` inside one
-- is the owner rather than `authenticated`. That is the difference this trigger
-- keys on: a direct client INSERT is pinned to 'member', while
-- `create_system_post()` (§4) is trusted to declare 'system'.
--
-- The same applies on UPDATE, and the reason is worth stating exactly, because
-- I first wrote it down backwards.
--
-- `enforce_post_caption_only_update` is a **DENY-LIST**, not an allow-list.
-- Read from production on 2026-08-12, it refuses an author's UPDATE only when
-- one of these changes:
--     user_id, image_url, image_urls, thumbnail_url, thumbnail_urls,
--     privacy, created_at, content_hash
-- Everything NOT on that list is permitted. So the default for any column added
-- to `posts` — including these two — is EDITABLE BY THE AUTHOR.
--
-- That cuts both ways, and both matter:
--   • `categories` being absent from the deny-list is what lets a member
--     recategorise their own post at all. Desirable, and relied on.
--   • `post_kind` being absent from it means an author COULD set
--     `post_kind='system'` on their own post and then strip its categories —
--     if the clause below did not pin it. It is the only thing standing there.
--
-- Firing order makes that safe: the deny-list trigger sorts before this one
-- (`e` < `v`), so it has already run and allowed the change by the time this
-- trigger overwrites the value.
-- ⚠ THIS TRIGGER IS DELIBERATELY **SECURITY INVOKER**, NOT DEFINER.
--
-- The first version was SECURITY DEFINER and the enforcement was bypassable.
-- Inside a SECURITY DEFINER function `current_user` is the function's OWNER,
-- not the caller — so `current_user IN ('authenticated','anon')` was always
-- false, the client check never fired, and a plain client INSERT carrying
-- `post_kind: 'system'` was accepted with zero categories. A test caught it.
--
-- `session_user` is no good either: PostgREST connects as `authenticator` and
-- then SET ROLEs, so session_user is `authenticator` for every request.
--
-- SECURITY INVOKER makes `current_user` the real calling role, which is the
-- only thing that distinguishes a member from `create_system_post()`. The
-- function needs no elevated rights: it reads `public.categories`, which anon
-- and authenticated may already SELECT.
CREATE OR REPLACE FUNCTION public.enforce_post_categories()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $fn$
DECLARE
  _bad text;
  _n   integer;
  _client boolean := current_user IN ('authenticated', 'anon');
BEGIN
  -- ── post_kind is not the client's to decide ────────────────────────────────
  IF TG_OP = 'INSERT' THEN
    IF _client THEN NEW.post_kind := 'member'; END IF;
  ELSE
    IF _client THEN NEW.post_kind := OLD.post_kind; END IF;
  END IF;

  -- ── normalise before validating, so 'Portrait' and ' portrait ' both work ──
  -- and a duplicate never counts twice toward the maximum.
  --
  -- ORDER IS PRESERVED. A plain SELECT DISTINCT returns rows in whatever order
  -- the planner likes, so ARRAY['street','night'] came back as {night,street} —
  -- silently reordering something the member chose. Today nothing depends on
  -- the order, but "the first one is the primary category" is an obvious future
  -- ask, and a stored array that quietly shuffles itself would make that
  -- impossible to build on. WITH ORDINALITY keeps the member's own order and
  -- drops later duplicates rather than earlier ones.
  NEW.categories := ARRAY(
    SELECT t.slug FROM (
      SELECT DISTINCT ON (lower(btrim(u.c)))
             lower(btrim(u.c)) AS slug, u.ord
      FROM unnest(COALESCE(NEW.categories, '{}')) WITH ORDINALITY AS u(c, ord)
      WHERE btrim(u.c) <> ''
      ORDER BY lower(btrim(u.c)), u.ord
    ) t
    ORDER BY t.ord
  );
  _n := cardinality(NEW.categories);

  -- ── every slug must exist in the taxonomy AND be active ───────────────────
  SELECT string_agg(c, ', ') INTO _bad
  FROM unnest(NEW.categories) AS c
  WHERE NOT EXISTS (
    SELECT 1 FROM public.categories cat WHERE cat.slug = c AND cat.is_active
  );
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'POST-CAT-001: unknown or inactive category slug(s): %', _bad
      USING ERRCODE = 'check_violation';
  END IF;

  -- ── the minimum, INSERT only ──────────────────────────────────────────────
  --
  -- ⚠ DELIBERATELY ABSENT IN B1. This is the ONE behavioural difference
  -- between this file and the version audited on 2026-08-12.
  --
  -- The rule it will enforce, verbatim, when B2 activates it:
  --
  --     IF NEW.post_kind = 'member' AND _n < 1 THEN
  --       RAISE EXCEPTION 'POST-CAT-002: a member post requires between 1 and
  --                        5 categories' USING ERRCODE = 'check_violation';
  --     END IF;
  --
  -- It is not deleted, it is scheduled: see
  --   supabase/migrations/20260812090000_post_categories_enforce_minimum.sql
  -- which re-creates this whole function with the block restored. B2 changes
  -- nothing else — same normaliser, same slug check, same post_kind pin, same
  -- POST-CAT-003 — so the diff between the two functions is exactly this rule
  -- and nothing may ride along with it.
  --
  -- `_n` is still computed above and is still used by POST-CAT-003 below, so
  -- there is no dead code here and no branch that only exists for B2.
  IF TG_OP = 'INSERT' THEN
    NULL;  -- B1: a member post with zero categories is accepted. B2 refuses it.
  ELSE
    -- On UPDATE the rule is narrower on purpose: a post that HAS categories may
    -- not be stripped of them, but a legacy post that never had any stays
    -- editable. Applying the minimum to every update would make the existing
    -- 204 posts (production count, 2026-08-12) impossible to edit.
    IF NEW.post_kind = 'member'
       AND cardinality(COALESCE(OLD.categories, '{}')) > 0
       AND _n < 1 THEN
      RAISE EXCEPTION 'POST-CAT-003: a categorised post cannot have all its categories removed'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

-- FIRING ORDER. Postgres fires BEFORE triggers in alphabetical order, so the
-- existing ones run first and this is last:
--   trg_detect_duplicate_post → trg_enforce_post_caption_only_update
--   → trg_moderate_post_content → trg_rate_limit_posts
--   → trg_validate_post_categories
-- Last is correct: rate limiting and moderation stay cheapest-first, and this
-- one only runs on rows that have already passed them.
DROP TRIGGER IF EXISTS trg_validate_post_categories ON public.posts;
CREATE TRIGGER trg_validate_post_categories
  BEFORE INSERT OR UPDATE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_post_categories();


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. THE ONLY WAY TO CREATE A SYSTEM POST
--
-- Used by the album auto-post and the profile-photo post. Both run under the
-- member's session, so they cannot set post_kind themselves (§3). This function
-- is SECURITY DEFINER, so inside it `current_user` is the owner and the trigger
-- accepts 'system'.
--
-- It deliberately takes NO post_kind parameter and NO categories parameter:
-- there is nothing for a caller to lie about.
CREATE OR REPLACE FUNCTION public.create_system_post(
  _content       text,
  _image_url     text DEFAULT NULL,
  _image_urls    text[] DEFAULT '{}',
  _thumbnail_urls text[] DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _id  uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'AUTH-0001: sign-in required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.posts (user_id, content, image_url, image_urls, thumbnail_urls, privacy, post_kind, categories)
  VALUES (_uid, _content, _image_url, COALESCE(_image_urls,'{}'), _thumbnail_urls, 'public', 'system', '{}')
  RETURNING id INTO _id;

  RETURN _id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.create_system_post(text, text, text[], text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_system_post(text, text, text[], text[]) TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. SCHEDULED POSTS CARRY THEIR CATEGORIES THROUGH
--
-- A scheduled post is a MEMBER post whose categories were chosen at compose
-- time. Carrying them is not an exemption, it is finishing the feature - and
-- without this column the publish job would create a member post with no
-- categories, which the trigger would now reject.
ALTER TABLE public.scheduled_posts
  ADD COLUMN IF NOT EXISTS categories text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.scheduled_posts.categories IS
  'Category slugs chosen when the post was composed. Copied onto posts.categories at publish time by the publish-scheduled-posts edge function.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. THE CATEGORY-AWARE FEED
--
-- ⚠ COMPATIBILITY. `PROJECT_MASTER_RECORD` §12.27: never add a parameter to a
-- live function that installed apps still call. Two signatures exist today:
--   get_broadcast_feed(_exclude_ids, _limit)
--   get_broadcast_feed(_exclude_ids, _limit, _newest_first)
-- Adding a DEFAULTed 4th parameter to the 3-arg one would make a 3-argument
-- call ambiguous between the two candidates. So the 4-arg version takes NO
-- default, and the existing signatures are REPLACED BY THIN WRAPPERS that call
-- it with NULL. One implementation, both old call shapes preserved exactly.
--
-- ⚠ THE FILTER GOES IN ONE PLACE ONLY - the `visible` CTE. Every tier
-- (`newest`, `unseen_ranked`, `seen_ranked`) reads from `visible`, so the
-- unseen-first / fewest-viewers-first fairness ordering is inherited unchanged.
-- Filtering anywhere else, or wrapping the result, would break reach fairness.
--
-- `_categories IS NULL` = "All" = no predicate at all, which is what keeps the
-- existing uncategorised posts visible.
CREATE OR REPLACE FUNCTION public.get_broadcast_feed(
  _exclude_ids  uuid[],
  _limit        integer,
  _newest_first integer,
  _categories   text[]
)
RETURNS TABLE(
  id uuid,
  user_id uuid,
  content text,
  image_url text,
  image_urls text[],
  privacy text,
  created_at timestamptz,
  likes_count integer,
  comments_count integer,
  shares_count integer,
  feed_tier text
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  WITH me AS (
    SELECT auth.uid() AS uid
  ),
  visible AS (
    SELECT p.id, p.user_id, p.content, p.image_url, p.image_urls, p.privacy,
           p.created_at, p.likes_count, p.comments_count, p.shares_count
    FROM public.posts p, me
    WHERE public.can_view_post(me.uid, p.user_id, p.privacy)
      AND NOT (p.id = ANY(_exclude_ids))
      -- ── THE ONLY LINE ADDED TO THE FEED LOGIC ────────────────────────────
      AND (_categories IS NULL OR p.categories && _categories)
  ),
  newest AS (
    SELECT v.*, row_number() OVER (ORDER BY v.created_at DESC, v.id) AS rn
    FROM visible v
    ORDER BY v.created_at DESC, v.id
    LIMIT GREATEST(_newest_first, 0)
  ),
  my_events AS (
    SELECT fe.post_id,
           count(*) FILTER (WHERE fe.event_type = 'view') AS views,
           count(*) FILTER (WHERE fe.event_type = 'skip') AS skips,
           max(fe.created_at)                             AS last_seen_at
    FROM public.feed_events fe, me
    WHERE fe.user_id = me.uid
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
  unseen_ranked AS (
    SELECT v.*,
           row_number() OVER (
             ORDER BY COALESCE(imp.viewers, 0) + random() * 6.0 ASC
           ) AS rn
    FROM visible v
    LEFT JOIN LATERAL (
      SELECT count(DISTINCT fe.user_id) AS viewers
      FROM public.feed_events fe
      WHERE fe.post_id = v.id
        AND fe.event_type IN ('view', 'skip')
    ) imp ON true
    WHERE NOT EXISTS (SELECT 1 FROM seen s WHERE s.post_id = v.id)
      AND NOT EXISTS (SELECT 1 FROM newest n WHERE n.id = v.id)
  ),
  seen_ranked AS (
    SELECT v.*,
           row_number() OVER (
             ORDER BY floor(extract(epoch FROM (now() - s.last_seen_at)) / 86400.0) DESC,
                      random()
           ) AS rn
    FROM visible v
    JOIN seen s ON s.post_id = v.id
    WHERE NOT EXISTS (SELECT 1 FROM newest n WHERE n.id = v.id)
  )
  SELECT x.id, x.user_id, x.content, x.image_url, x.image_urls, x.privacy,
         x.created_at, x.likes_count, x.comments_count, x.shares_count,
         x.feed_tier
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
    WHERE u.rn <= _limit
    UNION ALL
    SELECT s.id, s.user_id, s.content, s.image_url, s.image_urls, s.privacy,
           s.created_at, s.likes_count, s.comments_count, s.shares_count,
           'recycled'::text AS feed_tier, 2 AS tier_order, s.rn
    FROM seen_ranked s
    WHERE s.rn <= _limit
  ) x
  ORDER BY x.tier_order ASC, x.rn ASC
  LIMIT _limit;
$$;

-- The two legacy signatures, now thin wrappers. Byte-for-byte the same result
-- shape, so an installed Android build calling either keeps working unchanged.
CREATE OR REPLACE FUNCTION public.get_broadcast_feed(
  _exclude_ids uuid[] DEFAULT '{}',
  _limit integer DEFAULT 10,
  _newest_first integer DEFAULT 0
)
RETURNS TABLE(
  id uuid, user_id uuid, content text, image_url text, image_urls text[],
  privacy text, created_at timestamptz, likes_count integer,
  comments_count integer, shares_count integer, feed_tier text
)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = 'public'
AS $$
  SELECT * FROM public.get_broadcast_feed(_exclude_ids, _limit, _newest_first, NULL::text[]);
$$;

-- ⚠ THE DEFAULTS ON THESE TWO PARAMETERS ARE NOT OPTIONAL, AND OMITTING THEM
-- IS WHAT MADE THE FIRST APPLY ATTEMPT FAIL ON PRODUCTION (2026-08-12):
--
--     ERROR 42P13: cannot remove parameter defaults from existing function
--     HINT: Use DROP FUNCTION get_broadcast_feed(uuid[],integer) first.
--
-- `CREATE OR REPLACE FUNCTION` may ADD a default but may never REMOVE one. The
-- live 2-arg function is declared, verbatim from pg_get_function_arguments():
--     _exclude_ids uuid[] DEFAULT '{}'::uuid[], _limit integer DEFAULT 10
-- so this wrapper must repeat both exactly. The 3-arg one below already did.
--
-- DROP FUNCTION was the other way out and is REJECTED: dropping a live feed
-- function, even for the instant before it is recreated, is a window in which
-- every installed app calling it gets an error. Matching the signature costs
-- nothing and has no window at all.
--
-- Side note, and the reason this is worth reading twice: because BOTH of these
-- parameters carry defaults, and the 3-arg version defaults all three, a
-- 2-argument call is ambiguous between the two candidates. That is the
-- pre-existing defect recorded separately in the Phase B audit — it is
-- reproduced here EXACTLY as it already exists on production, deliberately not
-- fixed, because fixing it means dropping a signature and that is a different
-- change with its own blast radius.
CREATE OR REPLACE FUNCTION public.get_broadcast_feed(
  _exclude_ids uuid[] DEFAULT '{}'::uuid[],
  _limit integer DEFAULT 10
)
RETURNS TABLE(
  id uuid, user_id uuid, content text, image_url text, image_urls text[],
  privacy text, created_at timestamptz, likes_count integer,
  comments_count integer, shares_count integer, feed_tier text
)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = 'public'
AS $$
  SELECT * FROM public.get_broadcast_feed(_exclude_ids, _limit, 0, NULL::text[]);
$$;

REVOKE ALL ON FUNCTION public.get_broadcast_feed(uuid[], integer, integer, text[]) FROM public;
GRANT EXECUTE ON FUNCTION public.get_broadcast_feed(uuid[], integer, integer, text[]) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. SELF-CHECK. Every value here must read exactly as annotated.
SELECT 'posts_categories_col'   AS check, count(*)::text AS value FROM information_schema.columns
  WHERE table_schema='public' AND table_name='posts' AND column_name='categories'          -- 1
UNION ALL
SELECT 'posts_post_kind_col', count(*)::text FROM information_schema.columns
  WHERE table_schema='public' AND table_name='posts' AND column_name='post_kind'           -- 1
UNION ALL
SELECT 'gin_index', count(*)::text FROM pg_indexes
  WHERE schemaname='public' AND tablename='posts' AND indexname='idx_posts_categories'     -- 1
UNION ALL
SELECT 'scheduled_posts_categories', count(*)::text FROM information_schema.columns
  WHERE table_schema='public' AND table_name='scheduled_posts' AND column_name='categories' -- 1
UNION ALL
SELECT 'feed_fn_signatures', count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='get_broadcast_feed'                              -- 3
UNION ALL
SELECT 'EXISTING_POSTS_UNTOUCHED_all_empty', count(*)::text FROM public.posts
  WHERE cardinality(categories) <> 0                                                        -- 0
UNION ALL
SELECT 'existing_posts_total', count(*)::text FROM public.posts
UNION ALL
SELECT 'existing_posts_all_member_kind', count(*)::text FROM public.posts WHERE post_kind <> 'member' -- 0
UNION ALL
-- The B1 assertion. This is what makes the migration safe to apply today: the
-- enforcement function must NOT enforce POST-CAT-002. If a future edit puts it
-- back into this file rather than into the B2 migration, this reads 1 and the
-- person applying it sees the problem before posting breaks, not after.
--
-- ⚠ `prosrc` INCLUDES COMMENTS, and this function's body deliberately QUOTES
-- the deferred rule so the next reader knows where it went. A plain
-- `LIKE '%POST-CAT-002%'` therefore matched the explanation and reported the
-- rule as active when it was not — this check failed on its first run for
-- exactly that reason. Line comments are stripped before matching, so what is
-- measured is executable code and nothing else.
SELECT 'B1_minimum_must_be_ABSENT', count(*)::text FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='enforce_post_categories'
    AND regexp_replace(p.prosrc, '--[^\n]*', '', 'g') LIKE '%POST-CAT-002%'                  -- 0
UNION ALL
SELECT 'B1_strip_guard_must_be_PRESENT', count(*)::text FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='enforce_post_categories'
    AND regexp_replace(p.prosrc, '--[^\n]*', '', 'g') LIKE '%POST-CAT-003%';                 -- 1
