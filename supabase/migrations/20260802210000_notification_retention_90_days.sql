-- ============================================================================
-- NOTIFICATION RETENTION: 90 DAYS, READ ONLY.               (Stage 8b, 2026-08-02)
--
-- Owner's decision, asked and answered 2026-08-02: prune at **90 days**, and
-- **keep unread ones regardless of age**.
--
-- WHY
--   The table only grows. 994 rows today at roughly 60 a day, and 207 of them
--   are already older than 90 days. Nothing had ever removed one — until an
--   hour ago there was not even a DELETE policy (migration 20260802190000).
--
-- WHAT THIS DELETES, exactly
--   A row that is BOTH read AND older than the window. Measured before writing:
--
--     would delete (read, > 90 days)      140
--     kept because still unread            67
--     total                               994
--
--   **Unread is never touched, however old.** A notification a member has not
--   seen is not history, it is a message still waiting for them. That is the
--   owner's instruction and it is also the only safe default: age is not
--   consent.
--
-- WHAT IT WILL NEVER DELETE
--   Anything unread. Anything inside the window. Anything in another table.
--   The function names one table and one condition, and takes no argument that
--   can widen either beyond the window.
--
-- BOUNDED ON PURPOSE
--   Each run removes at most `_max_rows` (default 5000) oldest-first, so this
--   can never take a long lock on a table members are reading. At 60 new rows
--   a day a single daily run will never come close; the cap exists for the day
--   somebody backfills something.
--
-- SCHEDULE
--   pg_cron, 03:20 UTC daily — off-peak for an India-centred membership. The
--   job is created only if pg_cron is present, and re-running this migration
--   replaces the schedule rather than stacking a second copy.
--
-- ROLLBACK
--   SELECT cron.unschedule('prune-old-notifications');
--   DROP FUNCTION public.prune_old_notifications(int, int);
--   Deleted rows do not come back. That is what deletion is.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.prune_old_notifications(
  _days     int DEFAULT 90,
  _max_rows int DEFAULT 5000
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _deleted int;
  -- Floor of 30 days: no caller, now or later, can turn this into "delete
  -- everything from last week" by passing a small number.
  _window int := greatest(coalesce(_days, 90), 30);
  _cap    int := greatest(least(coalesce(_max_rows, 5000), 50000), 1);
BEGIN
  WITH doomed AS (
    SELECT id
      FROM public.user_notifications
     WHERE is_read = true
       AND created_at < now() - make_interval(days => _window)
     ORDER BY created_at
     LIMIT _cap
  )
  DELETE FROM public.user_notifications n
   USING doomed d
   WHERE n.id = d.id;

  GET DIAGNOSTICS _deleted = ROW_COUNT;

  -- Findable afterwards. A prune that leaves no trace is indistinguishable
  -- from data going missing.
  RAISE LOG 'prune_old_notifications: deleted % read notifications older than % days', _deleted, _window;
  RETURN _deleted;
END;
$fn$;

COMMENT ON FUNCTION public.prune_old_notifications(int, int) IS
  'Deletes READ notifications older than _days (minimum 30, default 90), oldest first, at most _max_rows per run. Never touches an unread notification at any age. Owner decision 2026-08-02.';

-- Members and anonymous callers have no business running this.
REVOKE ALL ON FUNCTION public.prune_old_notifications(int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prune_old_notifications(int, int) FROM anon, authenticated;

-- Daily, off-peak. Idempotent: unschedule-then-schedule, so re-running this
-- file cannot leave two jobs deleting in parallel.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('prune-old-notifications')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-old-notifications');
    PERFORM cron.schedule(
      'prune-old-notifications',
      '20 3 * * *',
      $job$ SELECT public.prune_old_notifications(90, 5000); $job$
    );
  END IF;
END
$do$;
