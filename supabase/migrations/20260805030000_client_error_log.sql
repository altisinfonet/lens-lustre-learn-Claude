-- ============================================================================
-- CLIENT ERROR LOG — so "people can't post" stops being an anecdote.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THIS EXISTS
--
-- Owner, 2026-08-05, after a full day of members unable to post:
--   "in entire day many of members unable to post complaining and you are just
--    escaping?? Next time happened soo how to measure??"
--   "what tracking you are follwoing, just i cant check is not the soltuion"
--
-- He is right, and this is the honest diagnosis: **nothing on this platform
-- records a client-side failure.** A failed post, a failed reply, a blank boot
-- — all of them die in the member's browser. The only signal that ever reaches
-- anyone is a member complaining hours later with no detail.
--
-- Measured while investigating (2026-08-05 ~02:30 UTC), which is what proved
-- the gap rather than the bug:
--   * last successful post 04 Aug 18:27 UTC, then ~8 hours of nothing;
--   * Postgres logs: NO row-level-security or constraint violations;
--   * edge function logs: NO 4xx/5xx in the retained window;
--   * s3-presign-upload probed live: HTTP 200, both upload URLs returned;
--   * the real PUT to storage: HTTP 200.
-- The upload path was healthy at the moment of testing. The fault is
-- INTERMITTENT — so after-the-fact poking will never catch it, and only
-- recorded rows will.
--
-- And the member-facing symptom is itself a hole: WallPosts' catch block ends
-- in `err?.message || "Unknown error"`, so "Unknown error" appears exactly when
-- the thrown value carries no message — i.e. the one case where nobody, member
-- or owner or us, learns anything at all.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- DESIGN NOTES — read before changing this
--
-- * INSERT ONLY THROUGH THE FUNCTION. The table has RLS on and no INSERT policy
--   at all, so a member cannot write arbitrary rows; `log_client_error` is
--   SECURITY DEFINER and is the single door.
-- * NO MEMBER CAN READ IT. There is no SELECT policy either. Reading is via
--   `get_client_error_stats_admin()`, which checks `has_role(auth.uid(),
--   'admin')`. Error text can contain fragments of other people's data.
-- * RATE LIMITED, because an error logger that fires inside a retry loop is a
--   write amplifier — the exact shape of a self-inflicted outage. 20 rows per
--   member per hour; 200 per hour in total for logged-out callers.
-- * ANON CAN CALL IT. A blank page at boot often happens before sign-in, and
--   that is precisely the case the owner has been reporting since 2026-07-28.
-- * BOUNDED TEXT. `left(...)` on every string so one runaway stack trace cannot
--   bloat the table.
-- * 30-DAY RETENTION. This is diagnostic exhaust, not a record worth keeping.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.client_errors (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- NULL for a logged-out caller (a blank page before sign-in). Deliberately no
  -- FK: losing the log because an account was removed would be the wrong trade.
  user_id     uuid,
  kind        text NOT NULL,
  message     text NOT NULL,
  detail      jsonb,
  platform    text,   -- 'app' | 'web'
  app_build   text,   -- window.__APP_BUILD, so a bad release is visible as one
  url         text
);

COMMENT ON TABLE public.client_errors IS
  'Client-side failures (post_create, reply, upload, blank_page). Written only by log_client_error(); read only by get_client_error_stats_admin(). 30-day retention.';

-- The three questions this table has to answer fast: how many in the last hour,
-- of what kind, and on which build.
CREATE INDEX IF NOT EXISTS idx_client_errors_created  ON public.client_errors (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_errors_kind     ON public.client_errors (kind, created_at DESC);
-- Supports the per-member rate-limit probe below.
CREATE INDEX IF NOT EXISTS idx_client_errors_user_recent ON public.client_errors (user_id, created_at DESC);

ALTER TABLE public.client_errors ENABLE ROW LEVEL SECURITY;
-- No policies, on purpose. Nothing reaches this table except through the
-- SECURITY DEFINER functions below.

REVOKE ALL ON TABLE public.client_errors FROM PUBLIC, anon, authenticated;


-- ── The one door in ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_client_error(
  _kind      text,
  _message   text,
  _detail    jsonb DEFAULT NULL,
  _platform  text  DEFAULT NULL,
  _app_build text  DEFAULT NULL,
  _url       text  DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _uid    uuid := auth.uid();
  _recent integer;
BEGIN
  -- An unknown kind is dropped rather than stored. A free-text kind column
  -- becomes ungroupable within a week, and grouping is the entire point.
  IF _kind NOT IN ('post_create', 'reply', 'upload', 'blank_page') THEN
    RETURN;
  END IF;

  IF _message IS NULL OR btrim(_message) = '' THEN
    RETURN;
  END IF;

  -- Rate limit. Deliberately BEFORE the insert and deliberately silent: a
  -- logger that raises inside a failure path turns one broken thing into two.
  IF _uid IS NOT NULL THEN
    SELECT count(*) INTO _recent
      FROM public.client_errors
     WHERE user_id = _uid
       AND created_at > now() - interval '1 hour';
    IF _recent >= 20 THEN RETURN; END IF;
  ELSE
    SELECT count(*) INTO _recent
      FROM public.client_errors
     WHERE user_id IS NULL
       AND created_at > now() - interval '1 hour';
    IF _recent >= 200 THEN RETURN; END IF;
  END IF;

  INSERT INTO public.client_errors (user_id, kind, message, detail, platform, app_build, url)
  VALUES (
    _uid,
    _kind,
    left(_message, 500),
    _detail,
    left(_platform, 16),
    left(_app_build, 32),
    left(_url, 300)
  );
EXCEPTION WHEN OTHERS THEN
  -- Reporting a failure must never itself become a failure the member sees.
  RETURN;
END;
$fn$;

COMMENT ON FUNCTION public.log_client_error(text, text, jsonb, text, text, text) IS
  'Records one client-side failure. Rate-limited (20/member/hour, 200/hour anon), silent on every error path, callable by anon so a blank page before sign-in is still captured.';

GRANT EXECUTE ON FUNCTION public.log_client_error(text, text, jsonb, text, text, text) TO anon, authenticated;


-- ── The one door out ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_client_error_stats_admin(_hours integer DEFAULT 24)
RETURNS TABLE (
  hour_bucket timestamptz,
  kind        text,
  platform    text,
  app_build   text,
  occurrences bigint,
  members     bigint,
  sample      text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  RETURN QUERY
  SELECT
    date_trunc('hour', e.created_at)          AS hour_bucket,
    e.kind,
    e.platform,
    e.app_build,
    count(*)                                  AS occurrences,
    count(DISTINCT e.user_id)                 AS members,
    -- One real example per group, so the owner sees the actual sentence rather
    -- than a number he still has to come and ask us about.
    (array_agg(e.message ORDER BY e.created_at DESC))[1] AS sample
  FROM public.client_errors e
  WHERE e.created_at > now() - make_interval(hours => GREATEST(1, LEAST(_hours, 720)))
  GROUP BY 1, 2, 3, 4
  ORDER BY 1 DESC, 5 DESC;
END;
$fn$;

COMMENT ON FUNCTION public.get_client_error_stats_admin(integer) IS
  'Admin-only. Client failures per hour, grouped by kind/platform/app_build, with one real message per group.';

REVOKE ALL ON FUNCTION public.get_client_error_stats_admin(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_client_error_stats_admin(integer) TO authenticated;


-- ── Retention ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.prune_client_errors(_days integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _deleted integer;
BEGIN
  -- Hard floor, same principle as prune_old_notifications: no caller may turn
  -- retention into "delete yesterday's evidence".
  DELETE FROM public.client_errors
   WHERE created_at < now() - make_interval(days => GREATEST(7, _days));
  GET DIAGNOSTICS _deleted = ROW_COUNT;
  RETURN _deleted;
END;
$fn$;

REVOKE ALL ON FUNCTION public.prune_client_errors(integer) FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule('prune-client-errors')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-client-errors');

SELECT cron.schedule(
  'prune-client-errors',
  '25 3 * * *',
  $cron$SELECT public.prune_client_errors(30);$cron$
);
