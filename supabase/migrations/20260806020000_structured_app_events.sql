-- ============================================================================
-- STRUCTURED APPLICATION EVENTS — the enterprise logging standard, server side.
--
-- OWNER DIRECTIVE, 2026-08-06:
--
--   "Every log must answer: what operation, which function, which file, which
--    user, which record, what input, what condition was evaluated, expected
--    value, actual value, why this branch executed, why it failed, recommended
--    next investigation."
--   "Include the code in every log … Now when someone reports 'I'm getting
--    DB-3002' your team immediately knows which subsystem, what failed, and
--    where to start investigating."
--
-- WHAT THIS MIGRATION DOES, AND — MORE IMPORTANTLY — WHAT IT DOES NOT DO.
--
-- It EXTENDS the existing `public.client_errors` table with the structured
-- fields the standard requires, and adds ONE new writer function beside the
-- existing one.
--
-- It does NOT alter, drop or re-sign `log_client_error`. That function is live
-- in every installed Android build (1044…1053) and in every open browser tab.
-- Adding parameters to it would have created an ambiguous overload and broken
-- error reporting in every shipped build the moment this ran — the logger
-- itself becoming the outage. So the new writer gets its own name and the old
-- one keeps working, untouched, forever.
--
-- DESIGN DECISIONS, RECORDED SO THEY ARE NOT RE-LITIGATED:
--
-- * SAME TABLE, NOT A NEW ONE. One place to look when something breaks. The
--   30-day retention job (`prune_client_errors`) and the admin RLS posture
--   already exist here and now cover structured events for free.
-- * CODE FORMAT IS ENFORCED (`^[A-Z]{2,6}-[0-9]{4}$`). A free-text code column
--   becomes ungroupable within a week, and grouping is the entire point of
--   having codes. A malformed code is DROPPED rather than stored, because a
--   log that cannot be grouped is noise that hides the logs that can.
-- * SEVERITY IS ENFORCED against the six standard levels.
-- * RATE LIMITED, separately from the old kinds. A logger that fires inside a
--   retry loop is a write amplifier; that is how a logger causes the second
--   outage. 40 structured events per member per hour, 300/hour for logged-out
--   callers, counted only against structured rows so a burst of these can
--   never silence the post/upload failure reports that matter most.
-- * SILENT ON EVERY ERROR PATH. Reporting a failure must never itself become a
--   failure the member sees.
-- * TEXT IS BOUNDED on every column, so one runaway stack trace cannot bloat
--   the table.
-- * NO SECRETS, NO PERSONAL DATA. Redaction happens client-side in
--   src/lib/logger.ts before anything is sent; this function additionally
--   never accepts an email or token field by design — there is nowhere to put
--   one.
-- ============================================================================

-- ── 1. The structured columns ────────────────────────────────────────────────
-- All nullable: existing rows written by log_client_error stay valid, and the
-- old function keeps inserting without them.
ALTER TABLE public.client_errors
  ADD COLUMN IF NOT EXISTS code           text,
  ADD COLUMN IF NOT EXISTS event          text,
  ADD COLUMN IF NOT EXISTS severity       text,
  ADD COLUMN IF NOT EXISTS fn             text,
  ADD COLUMN IF NOT EXISTS src_file       text,
  ADD COLUMN IF NOT EXISTS expected       text,
  ADD COLUMN IF NOT EXISTS actual         text,
  ADD COLUMN IF NOT EXISTS reason         text,
  ADD COLUMN IF NOT EXISTS next_step      text,
  ADD COLUMN IF NOT EXISTS duration_ms    integer,
  ADD COLUMN IF NOT EXISTS correlation_id text;

COMMENT ON COLUMN public.client_errors.code IS
  'Stable catalog code, e.g. POST-2001. Format ^[A-Z]{2,6}-[0-9]{4}$, enforced by log_app_event. Source of truth: src/lib/errorCodes.ts, documented in docs/error-codes.md.';
COMMENT ON COLUMN public.client_errors.event IS
  'SCREAMING_SNAKE event name, e.g. STORY_DELETE_MATCHED_NO_ROWS.';
COMMENT ON COLUMN public.client_errors.severity IS
  'trace | debug | info | warn | error | fatal.';
COMMENT ON COLUMN public.client_errors.fn IS 'Function that emitted the log.';
COMMENT ON COLUMN public.client_errors.src_file IS 'File that emitted the log.';
COMMENT ON COLUMN public.client_errors.expected IS 'What the code expected to be true.';
COMMENT ON COLUMN public.client_errors.actual IS 'What was actually observed.';
COMMENT ON COLUMN public.client_errors.reason IS 'Why this branch executed / why it failed.';
COMMENT ON COLUMN public.client_errors.next_step IS 'Recommended next investigation.';
COMMENT ON COLUMN public.client_errors.duration_ms IS 'Measured duration of the operation, when timed.';
COMMENT ON COLUMN public.client_errors.correlation_id IS
  'Ties every log line of one user action together. Generated per action client-side; NOT a session or device identifier.';

-- The questions this table now has to answer fast: what is failing (by code),
-- how bad (by severity), and everything that happened in one user action.
CREATE INDEX IF NOT EXISTS idx_client_errors_code
  ON public.client_errors (code, created_at DESC) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_client_errors_severity
  ON public.client_errors (severity, created_at DESC) WHERE severity IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_client_errors_correlation
  ON public.client_errors (correlation_id) WHERE correlation_id IS NOT NULL;


-- ── 2. The new door in (the old one is untouched) ────────────────────────────
CREATE OR REPLACE FUNCTION public.log_app_event(
  _code           text,
  _event          text,
  _severity       text,
  _message        text,
  _fn             text    DEFAULT NULL,
  _file           text    DEFAULT NULL,
  _reason         text    DEFAULT NULL,
  _expected       text    DEFAULT NULL,
  _actual         text    DEFAULT NULL,
  _next_step      text    DEFAULT NULL,
  _duration_ms    integer DEFAULT NULL,
  _correlation_id text    DEFAULT NULL,
  _detail         jsonb   DEFAULT NULL,
  _platform       text    DEFAULT NULL,
  _app_build      text    DEFAULT NULL,
  _url            text    DEFAULT NULL
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
  -- A code that cannot be grouped is worse than no row at all.
  IF _code IS NULL OR _code !~ '^[A-Z]{2,6}-[0-9]{4}$' THEN
    RETURN;
  END IF;

  IF _severity IS NULL
     OR lower(_severity) NOT IN ('trace','debug','info','warn','error','fatal') THEN
    RETURN;
  END IF;

  IF _message IS NULL OR btrim(_message) = '' THEN
    RETURN;
  END IF;

  -- Rate limit BEFORE the insert, counted only against structured rows, and
  -- deliberately silent. See the header.
  IF _uid IS NOT NULL THEN
    SELECT count(*) INTO _recent
      FROM public.client_errors
     WHERE user_id = _uid
       AND code IS NOT NULL
       AND created_at > now() - interval '1 hour';
    IF _recent >= 40 THEN RETURN; END IF;
  ELSE
    SELECT count(*) INTO _recent
      FROM public.client_errors
     WHERE user_id IS NULL
       AND code IS NOT NULL
       AND created_at > now() - interval '1 hour';
    IF _recent >= 300 THEN RETURN; END IF;
  END IF;

  INSERT INTO public.client_errors (
    user_id, kind, message, detail, platform, app_build, url,
    code, event, severity, fn, src_file, expected, actual, reason, next_step,
    duration_ms, correlation_id
  )
  VALUES (
    _uid,
    -- `kind` stays populated so the existing hourly stats view keeps working:
    -- the subsystem prefix of the code is exactly the grouping it wants.
    lower(split_part(_code, '-', 1)),
    left(_message, 500),
    _detail,
    left(_platform, 16),
    left(_app_build, 32),
    left(_url, 300),
    left(_code, 16),
    left(_event, 80),
    lower(left(_severity, 8)),
    left(_fn, 80),
    left(_file, 120),
    left(_expected, 300),
    left(_actual, 300),
    left(_reason, 400),
    left(_next_step, 300),
    _duration_ms,
    left(_correlation_id, 40)
  );
EXCEPTION WHEN OTHERS THEN
  -- Rule: the logger never becomes the incident.
  RETURN;
END;
$fn$;

COMMENT ON FUNCTION public.log_app_event(text,text,text,text,text,text,text,text,text,text,integer,text,jsonb,text,text,text) IS
  'Records one structured application event (owner standard, 2026-08-06). Enforces the code format and severity vocabulary, rate-limited to 40/member/hour (300/hour anon) counted separately from log_client_error, silent on every error path, callable by anon so failures before sign-in are still captured.';

GRANT EXECUTE ON FUNCTION public.log_app_event(text,text,text,text,text,text,text,text,text,text,integer,text,jsonb,text,text,text) TO anon, authenticated;


-- ── 3. The door out, for the admin log viewer ────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_app_events_admin(
  _hours    integer DEFAULT 24,
  _code     text    DEFAULT NULL,
  _severity text    DEFAULT NULL,
  _limit    integer DEFAULT 200
)
RETURNS TABLE (
  id             uuid,
  created_at     timestamptz,
  code           text,
  event          text,
  severity       text,
  message        text,
  fn             text,
  src_file       text,
  reason         text,
  expected       text,
  actual         text,
  next_step      text,
  duration_ms    integer,
  correlation_id text,
  user_id        uuid,
  platform       text,
  app_build      text,
  url            text,
  detail         jsonb
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
  SELECT e.id, e.created_at, e.code, e.event, e.severity, e.message, e.fn,
         e.src_file, e.reason, e.expected, e.actual, e.next_step,
         e.duration_ms, e.correlation_id, e.user_id, e.platform, e.app_build,
         e.url, e.detail
    FROM public.client_errors e
   WHERE e.code IS NOT NULL
     AND e.created_at > now() - make_interval(hours => GREATEST(1, LEAST(_hours, 720)))
     AND (_code     IS NULL OR e.code = _code)
     AND (_severity IS NULL OR e.severity = lower(_severity))
   ORDER BY e.created_at DESC
   LIMIT GREATEST(1, LEAST(COALESCE(_limit, 200), 1000));
END;
$fn$;

COMMENT ON FUNCTION public.get_app_events_admin(integer, text, text, integer) IS
  'Admin-only. Structured application events, newest first, filterable by code and severity. Answers "I am getting DB-3002" without reproducing it.';

REVOKE ALL ON FUNCTION public.get_app_events_admin(integer, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_app_events_admin(integer, text, text, integer) TO authenticated;


-- ── 4. Counts by code, for the top of the admin screen ───────────────────────
CREATE OR REPLACE FUNCTION public.get_app_event_counts_admin(_hours integer DEFAULT 24)
RETURNS TABLE (
  code        text,
  event       text,
  severity    text,
  occurrences bigint,
  members     bigint,
  last_seen   timestamptz,
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
  SELECT e.code,
         (array_agg(e.event ORDER BY e.created_at DESC))[1]   AS event,
         (array_agg(e.severity ORDER BY e.created_at DESC))[1] AS severity,
         count(*)                                              AS occurrences,
         count(DISTINCT e.user_id)                             AS members,
         max(e.created_at)                                     AS last_seen,
         (array_agg(e.reason ORDER BY e.created_at DESC))[1]   AS sample
    FROM public.client_errors e
   WHERE e.code IS NOT NULL
     AND e.created_at > now() - make_interval(hours => GREATEST(1, LEAST(_hours, 720)))
   GROUP BY e.code
   ORDER BY occurrences DESC;
END;
$fn$;

COMMENT ON FUNCTION public.get_app_event_counts_admin(integer) IS
  'Admin-only. Structured events grouped by code with one real reason per group.';

REVOKE ALL ON FUNCTION public.get_app_event_counts_admin(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_app_event_counts_admin(integer) TO authenticated;
