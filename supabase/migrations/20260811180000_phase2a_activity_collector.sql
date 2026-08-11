-- Phase 2a — Active Engagement: COLLECT ONLY.
--
-- =============================================================================
-- WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT
--
-- Owner, 2026-08-11: "Phase 2a objective: prove that the collector accurately
-- measures genuine public-platform active engagement before allowing it to
-- influence the public Contributor Score."
--
-- So this records minutes and nothing else. It does NOT touch
-- contributor_points_since, get_top_contributors_v2 or get_contributor_scores.
-- No member's score changes by a single point when this runs. The 20% weighting
-- is Phase 2c and is not built here.
--
-- =============================================================================
-- WHY A MINUTE IS THE UNIT
--
-- The client cannot be trusted with a duration — a number of minutes is exactly
-- the thing a cheater would inflate. So it never sends one. It says "I am here
-- now", at most once per wall-clock minute, and the SERVER decides which minute
-- that is. The primary key does the rest: a member physically cannot occupy the
-- same minute twice, so there is nothing to inflate.
--
-- =============================================================================
-- WHAT WE STORE ABOUT A PERSON, AND WHAT WE REFUSE TO
--
-- Owner, 2026-08-11: "Record only the first path segment/category such as feed,
-- journal, profile, course; never store full URLs, IDs or slugs."
--
-- The client sends one path SEGMENT — "feed", "journal", "admin". Never
-- /profile/<uuid>, never /post/<uuid>, never /journal/<slug>. And even the
-- segment is used and discarded: it is read once to decide public vs internal
-- and is never written to a column. What survives is that a member was active in
-- a given minute, and whether that minute was public or internal. Not what they
-- were looking at.
--
-- =============================================================================
-- THE OVER-COUNTING PROBLEM, AND THE ONE COLUMN THAT MAKES IT VISIBLE
--
-- The owner's correctness check is post and comment timestamps: if somebody
-- commented at 14:32 they were unambiguously present at 14:32, so a bucket must
-- exist for that minute. That catches UNDER-counting and it is a good check.
--
-- It cannot catch OVER-counting. Content is evidence of presence; nothing is
-- evidence of absence. A tab left open cannot be disproved by any row.
--
-- Hence `had_interaction`. A minute is marked true when a real interaction
-- happened INSIDE that minute, and false when the minute only counted because
-- the 120-second idle window had not yet expired. With a 120s window each
-- interaction carries at most about two following minutes, so the ratio of
-- carried to interacted minutes is bounded near 2.0 — and a member sitting at
-- that ceiling every day is a parked tab, not a reader. Without this column the
-- two weeks of collection cannot answer the question the phase exists to ask.
--
-- It is a DIAGNOSTIC, not a scoring input: it is asserted by the client and is
-- therefore forgeable. It is never read by anything that computes a score.

-- ─────────────────────────────────────────────────────────────────────────────
-- RAW MINUTES
--
-- Pruned after 40 days (see prune_activity_minutes). The daily rollup below is
-- what survives, so lifetime engagement outlives the raw rows. That is a
-- deliberate exception to the Phase 1 "current state is the source of truth"
-- rule, taken for privacy: a permanent minute-by-minute record of when each
-- member was awake is not something to keep, and a daily total is all the score
-- ever needs.
CREATE TABLE IF NOT EXISTS public.member_activity_minutes (
  user_id        uuid        NOT NULL,
  minute_bucket  timestamptz NOT NULL,
  surface        text        NOT NULL CHECK (surface IN ('public', 'internal')),
  had_interaction boolean    NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, minute_bucket)
);

COMMENT ON TABLE public.member_activity_minutes IS
  'One row per member per UTC minute of genuine foreground activity. Written only by record_activity_minute(). surface=internal means the minute touched /admin or /judge and can never earn contributor credit. had_interaction is a diagnostic for detecting over-counting and is never used for scoring.';

-- For the 40-day prune. The primary key already serves every read.
CREATE INDEX IF NOT EXISTS idx_member_activity_minutes_bucket
  ON public.member_activity_minutes (minute_bucket);

ALTER TABLE public.member_activity_minutes ENABLE ROW LEVEL SECURITY;

-- RLS ON WITH ZERO POLICIES IS THE POINT.
--
-- Owner, 2026-08-11: "a normal member should never be able to query: User X was
-- active at 10:31, 10:32, 10:33..."
--
-- No SELECT policy, no INSERT policy, nothing. Not for members, not for admins.
-- Every read and write goes through a SECURITY DEFINER function that can decide
-- what to expose; a table policy cannot. Admin reporting arrives in Phase 2b
-- through such a function, never through this table.


-- ─────────────────────────────────────────────────────────────────────────────
-- DAILY ROLLUP
--
-- Derived from the raw minutes and rebuildable from them for as long as they
-- exist. After the 40-day prune this becomes the only record, which is why it
-- carries the uncapped `actual` figures too: the owner's Admin Users table must
-- show real usage, while scoring may only ever see the capped `credited`.
CREATE TABLE IF NOT EXISTS public.contributor_engagement_daily (
  user_id            uuid NOT NULL,
  utc_date           date NOT NULL,
  minutes_actual     integer NOT NULL DEFAULT 0,  -- every minute, any surface
  minutes_public     integer NOT NULL DEFAULT 0,  -- public surface only
  minutes_internal   integer NOT NULL DEFAULT 0,  -- /admin and /judge
  minutes_credited   integer NOT NULL DEFAULT 0,  -- LEAST(public, 30)
  minutes_interacted integer NOT NULL DEFAULT 0,  -- diagnostic
  minutes_carried    integer NOT NULL DEFAULT 0,  -- diagnostic
  computed_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, utc_date)
);

COMMENT ON TABLE public.contributor_engagement_daily IS
  'Daily rollup of member_activity_minutes. Survives the 40-day prune so lifetime engagement is not lost. minutes_actual is for admin reporting; minutes_credited (capped at 30) is the only figure scoring may ever use. Nothing reads this for scoring during Phase 2a.';

CREATE INDEX IF NOT EXISTS idx_contributor_engagement_daily_date
  ON public.contributor_engagement_daily (utc_date);

ALTER TABLE public.contributor_engagement_daily ENABLE ROW LEVEL SECURITY;
-- Same posture: no policies. Reads go through admin-gated functions.


-- ─────────────────────────────────────────────────────────────────────────────
-- BELT AND BRACES ON BOTH TABLES
--
-- RLS with no policies already denies every member. This removes the table
-- GRANTs as well, because Supabase's ALTER DEFAULT PRIVILEGES hands anon and
-- authenticated a SELECT on newly created public tables. Today that grant is
-- inert behind RLS; the day somebody adds a policy here without thinking, the
-- grant is what would turn a one-line mistake into an exposed timeline. Taking
-- it away now costs nothing — every legitimate reader below is SECURITY
-- DEFINER and runs as the owner regardless.
REVOKE ALL ON public.member_activity_minutes FROM anon, authenticated;
REVOKE ALL ON public.contributor_engagement_daily FROM anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- THE ONLY WRITE PATH
--
-- Everything a cheater would want to control is decided here, not sent:
--   user     <- auth.uid()                      not a parameter
--   minute   <- date_trunc('minute', now())     server clock, not the client's
--   surface  <- derived from the segment        claiming 'admin' only costs you
--
-- The client's entire influence is one short word, and the worst it can do with
-- it is deny itself credit.
CREATE OR REPLACE FUNCTION public.record_activity_minute(
  _segment    text,
  _interacted boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _user    uuid := auth.uid();
  _bucket  timestamptz;
  _surface text;
BEGIN
  -- Signed out: nothing to record, and no error worth raising.
  IF _user IS NULL THEN
    RETURN;
  END IF;

  _bucket := date_trunc('minute', now());

  -- Owner, 2026-08-11: "/admin/* and /judge/* must never produce
  -- contributor-credit engagement." Applied here, on the server, so it holds
  -- regardless of what any client build does.
  _surface := CASE
    WHEN lower(coalesce(_segment, '')) IN ('admin', 'judge') THEN 'internal'
    ELSE 'public'
  END;

  INSERT INTO public.member_activity_minutes (user_id, minute_bucket, surface, had_interaction)
  VALUES (_user, _bucket, _surface, coalesce(_interacted, false))
  ON CONFLICT (user_id, minute_bucket) DO UPDATE
  SET
    -- THE STRICTEST PING WINS, AND IT NEVER UNWINDS.
    -- A minute that touched /admin at any point is an internal minute, even if
    -- the member also glanced at the feed inside the same sixty seconds. Being
    -- conservative here is what makes it impossible to launder administrative
    -- time into contributor credit by tapping a public page.
    surface = CASE
      WHEN public.member_activity_minutes.surface = 'internal' THEN 'internal'
      WHEN EXCLUDED.surface = 'internal' THEN 'internal'
      ELSE 'public'
    END,
    -- If any ping in the minute carried a real interaction, the minute had one.
    had_interaction = public.member_activity_minutes.had_interaction OR EXCLUDED.had_interaction;
END;
$fn$;

COMMENT ON FUNCTION public.record_activity_minute(text, boolean) IS
  'The only way a row enters member_activity_minutes. Takes a path SEGMENT (never a full path, id or slug) and a diagnostic interaction flag. Derives the member from auth.uid() and the minute from the server clock; the client cannot name either.';

REVOKE ALL ON FUNCTION public.record_activity_minute(text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_activity_minute(text, boolean) TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLUP — idempotent, rebuildable
CREATE OR REPLACE FUNCTION public.rollup_engagement_daily(_utc_date date DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _d date := coalesce(_utc_date, ((now() AT TIME ZONE 'UTC')::date - 1));
  _n integer;
BEGIN
  DELETE FROM public.contributor_engagement_daily WHERE utc_date = _d;

  INSERT INTO public.contributor_engagement_daily (
    user_id, utc_date, minutes_actual, minutes_public, minutes_internal,
    minutes_credited, minutes_interacted, minutes_carried
  )
  SELECT
    m.user_id,
    _d,
    COUNT(*),
    COUNT(*) FILTER (WHERE m.surface = 'public'),
    COUNT(*) FILTER (WHERE m.surface = 'internal'),
    -- The 30-minute daily cap. Applied to PUBLIC minutes only, so administrative
    -- time cannot consume or contribute to a member's credit either way.
    LEAST(COUNT(*) FILTER (WHERE m.surface = 'public'), 30),
    COUNT(*) FILTER (WHERE m.surface = 'public' AND m.had_interaction),
    COUNT(*) FILTER (WHERE m.surface = 'public' AND NOT m.had_interaction)
  FROM public.member_activity_minutes m
  WHERE (m.minute_bucket AT TIME ZONE 'UTC')::date = _d
  GROUP BY m.user_id;

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$fn$;

COMMENT ON FUNCTION public.rollup_engagement_daily(date) IS
  'Rebuilds one UTC day of contributor_engagement_daily from the raw minutes. Deletes and reinserts, so running it repeatedly is safe and always agrees with the raw data.';

REVOKE ALL ON FUNCTION public.rollup_engagement_daily(date) FROM public, anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- PRUNE — with a dry run, because it is the only destructive piece here
--
-- 40-day retention will not actually fire during the two-week Phase 2a window,
-- which means the one irreversible function in this migration would otherwise
-- go untested precisely while testing it is free. The dry run exists so it can
-- be exercised by hand before it ever deletes anything.
CREATE OR REPLACE FUNCTION public.prune_activity_minutes(_dry_run boolean DEFAULT true)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _cutoff timestamptz := now() - interval '40 days';
  _n integer;
BEGIN
  IF _dry_run THEN
    SELECT COUNT(*) INTO _n
    FROM public.member_activity_minutes
    WHERE minute_bucket < _cutoff;
    RETURN _n;
  END IF;

  -- Refuse to delete a day that has not been rolled up, or lifetime engagement
  -- would be silently lost with it.
  DELETE FROM public.member_activity_minutes m
  WHERE m.minute_bucket < _cutoff
    AND EXISTS (
      SELECT 1 FROM public.contributor_engagement_daily d
      WHERE d.user_id = m.user_id
        AND d.utc_date = (m.minute_bucket AT TIME ZONE 'UTC')::date
    );

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$fn$;

COMMENT ON FUNCTION public.prune_activity_minutes(boolean) IS
  'Deletes raw minutes older than 40 days, but ONLY for days already present in contributor_engagement_daily so lifetime totals survive. Defaults to a dry run that counts without deleting.';

REVOKE ALL ON FUNCTION public.prune_activity_minutes(boolean) FROM public, anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- THE CORRECTNESS PROBE
--
-- Owner, 2026-08-11: "Build the correctness verification using known
-- post/comment timestamps as independent activity probes."
--
-- If a member posted a photograph or wrote a comment at 14:32 UTC, they were
-- unambiguously at the keyboard at 14:32. So a bucket MUST exist for that
-- member and that minute. Every content row is therefore a free, unfakeable
-- probe of the collector, produced by a system that knows nothing about it.
--
-- Coverage well below 100% means the collector is losing time. Note two honest
-- caveats when reading the number:
--   * posts published by the publish-scheduled-posts cron have no browser
--     behind them and will always look like misses;
--   * content created before the collector's first row cannot be covered, so
--     the window starts at that row.
CREATE OR REPLACE FUNCTION public.engagement_probe_report(_days integer DEFAULT 14)
RETURNS TABLE (
  probe_source text,
  probes       bigint,
  covered      bigint,
  coverage_pct numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  WITH launch AS (
    SELECT COALESCE(MIN(minute_bucket), now()) AS t0
    FROM public.member_activity_minutes
  ),
  probe AS (
    SELECT 'posts' AS src, p.user_id AS uid, date_trunc('minute', p.created_at) AS m
    FROM public.posts p, launch l
    WHERE p.created_at >= l.t0
      AND p.created_at >= now() - (_days || ' days')::interval
    UNION ALL
    SELECT 'post_comments', c.user_id, date_trunc('minute', c.created_at)
    FROM public.post_comments c, launch l
    WHERE c.created_at >= l.t0
      AND c.created_at >= now() - (_days || ' days')::interval
  )
  SELECT
    pr.src,
    COUNT(*),
    COUNT(*) FILTER (
      WHERE EXISTS (
        SELECT 1 FROM public.member_activity_minutes a
        WHERE a.user_id = pr.uid AND a.minute_bucket = pr.m
      )
    ),
    ROUND(
      100.0 * COUNT(*) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM public.member_activity_minutes a
          WHERE a.user_id = pr.uid AND a.minute_bucket = pr.m
        )
      ) / NULLIF(COUNT(*), 0)
    , 1)
  FROM probe pr
  GROUP BY pr.src;
$fn$;

COMMENT ON FUNCTION public.engagement_probe_report(integer) IS
  'Independent correctness check: every post and comment timestamp proves the member was present in that minute, so a matching activity bucket must exist. Low coverage means the collector is losing time.';

REVOKE ALL ON FUNCTION public.engagement_probe_report(integer) FROM public, anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 2A AUDIT VIEW — admin only, aggregate only
--
-- Enough to answer "is the collector behaving" without exposing any individual
-- member's minute-by-minute timeline. The per-member Admin Users reporting is
-- Phase 2b and is deliberately not built here.
CREATE OR REPLACE FUNCTION public.engagement_collector_health()
RETURNS TABLE (
  metric text,
  value  text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT 'raw_minutes', COUNT(*)::text FROM public.member_activity_minutes
  UNION ALL
  SELECT 'distinct_members', COUNT(DISTINCT user_id)::text FROM public.member_activity_minutes
  UNION ALL
  SELECT 'first_row', COALESCE(MIN(minute_bucket)::text, 'none') FROM public.member_activity_minutes
  UNION ALL
  SELECT 'last_row', COALESCE(MAX(minute_bucket)::text, 'none') FROM public.member_activity_minutes
  UNION ALL
  SELECT 'public_minutes', COUNT(*)::text FROM public.member_activity_minutes WHERE surface = 'public'
  UNION ALL
  SELECT 'internal_minutes', COUNT(*)::text FROM public.member_activity_minutes WHERE surface = 'internal'
  UNION ALL
  SELECT 'interacted_minutes', COUNT(*)::text FROM public.member_activity_minutes WHERE had_interaction
  UNION ALL
  SELECT 'carried_minutes', COUNT(*)::text FROM public.member_activity_minutes WHERE NOT had_interaction
  UNION ALL
  -- Bounded near 2.0 by the 120s window. A member pinned at the ceiling every
  -- day is a parked tab, not a reader.
  SELECT 'carried_per_interacted',
         COALESCE(ROUND(
           (COUNT(*) FILTER (WHERE NOT had_interaction))::numeric
           / NULLIF(COUNT(*) FILTER (WHERE had_interaction), 0)
         , 2)::text, 'n/a')
  FROM public.member_activity_minutes
  UNION ALL
  -- INVARIANT: nobody can be credited more than the 30-minute cap.
  SELECT 'days_breaching_30min_cap',
         COUNT(*)::text FROM public.contributor_engagement_daily WHERE minutes_credited > 30
  UNION ALL
  -- INVARIANT: the surfaces must add up to the total.
  SELECT 'days_with_surface_mismatch',
         COUNT(*)::text FROM public.contributor_engagement_daily
         WHERE minutes_public + minutes_internal <> minutes_actual
  UNION ALL
  -- INVARIANT: a member cannot have more minutes in a day than the day has had.
  SELECT 'days_exceeding_elapsed_minutes',
         COUNT(*)::text FROM public.contributor_engagement_daily
         WHERE minutes_actual > CASE
           WHEN utc_date < (now() AT TIME ZONE 'UTC')::date THEN 1440
           ELSE EXTRACT(EPOCH FROM (now() AT TIME ZONE 'UTC') - utc_date::timestamp) / 60
         END
  UNION ALL
  SELECT 'rollup_rows', COUNT(*)::text FROM public.contributor_engagement_daily;
$fn$;

COMMENT ON FUNCTION public.engagement_collector_health() IS
  'Phase 2a diagnostics: volume, surface split, the carried-to-interacted ratio that exposes over-counting, and three invariants that must all read zero. Aggregate only - no member timeline is exposed.';

REVOKE ALL ON FUNCTION public.engagement_collector_health() FROM public, anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- SCHEDULE
--
-- Nightly rollup at 00:20 UTC — clear of the 03:00-03:30 window where four
-- existing jobs already run. Rebuilds yesterday, then today, so the rollup is
-- never more than a day behind while the raw rows are still there to rebuild
-- from.
--
-- NO PRUNE JOB IS SCHEDULED. Retention is 40 days and Phase 2a runs for two
-- weeks, so it would have nothing to do; scheduling a destructive job that
-- cannot be observed working is worse than running it by hand later.
SELECT cron.unschedule('rollup-engagement-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rollup-engagement-daily');

SELECT cron.schedule(
  'rollup-engagement-daily',
  '20 0 * * *',
  $cron$
    SELECT public.rollup_engagement_daily(((now() AT TIME ZONE 'UTC')::date - 1));
    SELECT public.rollup_engagement_daily(((now() AT TIME ZONE 'UTC')::date));
  $cron$
);
