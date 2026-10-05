-- ═══════════════════════════════════════════════════════════════════════════
-- UB-0003 · 20261005_0002 — purge the user-block notice ledger after 24 h
-- Carries UB0002-3 (SEC, LOW). Lanes: staging and production.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT IS THERE TODAY: 20261003_0002 (SEC-UB-1) keeps one row per blocking pair
-- in public.user_block_notices — the time the admin was last told — and lets a
-- new notice through only when that time is 24 h old or more. Nothing ever
-- deletes a row, so the ledger grows by one row per distinct pair, forever.
--
-- WHY DELETING IS SAFE — the claim in notify_admin_user_blocked() is
--   INSERT … ON CONFLICT (blocker_id, blocked_id) DO UPDATE … WHERE
--     n.notified_at <= EXCLUDED.notified_at - interval '24 hours'
-- so a row whose notified_at is 24 h old or more already allows the next notice.
-- Deleting it changes nothing: the next block of that pair INSERTs instead of
-- UPDATEs, and notifies exactly as it would have. A row YOUNGER than 24 h is
-- the cap itself, and the purge refuses to touch it: _keep below 24 h raises.
-- (Proved both ways in docs/evidence/d1/UB-0003/.)
--
-- WHAT THIS FILE DOES
--   1. public.purge_user_block_notices(_keep interval = 24 h, _batch int = 5000,
--      _max_batches int = 200) → rows deleted. Bounded batches (ctid sub-select,
--      LIMIT _batch), at most _batch × _max_batches per call; the next call
--      continues. Refuses _keep < 24 h. SECURITY DEFINER, search_path '',
--      revoked from the API roles (no API role can read the ledger anyway).
--   2. cron job 'purge-user-block-notices', hourly at minute 23 (not shared with
--      P6's minute 17), command "SELECT public.purge_user_block_notices();".
--   3. Runs the first purge now, so the ledger is within 24 h at commit.
-- NO INDEX: after the first purge the ledger holds only pairs notified in the
-- last 24 h; an hourly sequential pass over that is the cheaper choice (P28).
--
-- OBJECTS (reservation): new public.purge_user_block_notices(interval,int,int);
-- cron job 'purge-user-block-notices'. Rows deleted: ledger rows ≥ 24 h old
-- (notice timestamps that no longer gate anything — no member content).
-- NOT RE-RUNNABLE: PRE-002 refuses once the function exists.
-- ROLLBACK: supabase/rollback/20261005_0002_ub0003_notice_purge_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_ub0003_notice_purge.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_assert$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Set it in THIS session before running: SET p32.lane = ''staging'';',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_assert$;

SET LOCAL lock_timeout = '5s';

DO $preconditions$
BEGIN
  -- PRE-001 · the ledger of 20261003_0002, and the cap that makes a ≥ 24 h row inert.
  IF to_regclass('public.user_block_notices') IS NULL OR to_regnamespace('cron') IS NULL THEN
    RAISE EXCEPTION 'UB0003-PRE-001: public.user_block_notices or pg_cron is missing (20261003_0002 not applied?)'
      USING ERRCODE = 'raise_exception';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.notify_admin_user_blocked()'))
     NOT LIKE '%notified_at <= EXCLUDED.notified_at - interval ''24 hours''%' THEN
    RAISE EXCEPTION 'UB0003-PRE-001: notify_admin_user_blocked() no longer carries the 24 h claim this purge relies on — read first'
      USING ERRCODE = 'raise_exception';
  END IF;
  -- PRE-002 · not applied already.
  IF to_regprocedure('public.purge_user_block_notices(interval,integer,integer)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-user-block-notices') THEN
    RAISE EXCEPTION 'UB0003-PRE-002: the purge function or job already exists — 20261005_0002 is applied'
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

CREATE FUNCTION public.purge_user_block_notices(_keep interval DEFAULT interval '24 hours',
                                                _batch integer DEFAULT 5000,
                                                _max_batches integer DEFAULT 200)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  _cut   timestamptz;
  _n     bigint;
  _total bigint := 0;
  _i     int := 0;
BEGIN
  -- A row younger than 24 h IS the cap (SEC-UB-1); it is never purged.
  IF _keep IS NULL OR _keep < interval '24 hours' THEN
    RAISE EXCEPTION 'purge_user_block_notices: _keep % is below 24 hours — that would re-open the notice cap', _keep
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _batch IS NULL OR _batch < 1 OR _max_batches IS NULL OR _max_batches < 1 THEN
    RAISE EXCEPTION 'purge_user_block_notices: _batch and _max_batches must be positive' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  _cut := now() - _keep;
  LOOP
    DELETE FROM public.user_block_notices
     WHERE ctid IN (SELECT ctid FROM public.user_block_notices WHERE notified_at < _cut LIMIT _batch);
    GET DIAGNOSTICS _n = ROW_COUNT;
    _total := _total + _n;
    _i := _i + 1;
    EXIT WHEN _n < _batch OR _i >= _max_batches;
  END LOOP;
  RETURN _total;
END;
$fn$;
REVOKE ALL ON FUNCTION public.purge_user_block_notices(interval, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_user_block_notices(interval, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.purge_user_block_notices(interval, integer, integer) FROM authenticated;

SELECT cron.schedule('purge-user-block-notices', '23 * * * *', $cmd$SELECT public.purge_user_block_notices();$cmd$);

DO $first_purge$
DECLARE _n bigint;
BEGIN
  _n := public.purge_user_block_notices();
  RAISE NOTICE 'UB0003: first purge removed % ledger row(s) at least 24 h old', _n;
END
$first_purge$;

DO $postconditions$
BEGIN
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'purge-user-block-notices' AND schedule = '23 * * * *'
        AND command = 'SELECT public.purge_user_block_notices();') <> 1 THEN
    RAISE EXCEPTION 'UB0003-POST-001: the hourly purge job is not in place' USING ERRCODE = 'raise_exception';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_block_notices WHERE notified_at < now() - interval '24 hours') THEN
    RAISE EXCEPTION 'UB0003-POST-002: ledger rows older than 24 h remain after the first purge' USING ERRCODE = 'raise_exception';
  END IF;
  IF has_function_privilege('anon', 'public.purge_user_block_notices(interval,integer,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.purge_user_block_notices(interval,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'UB0003-POST-003: an API role can execute the purge' USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'UB0003: user_block_notices purged hourly at 24 h; % row(s) remain (all within the cap window)',
    (SELECT count(*) FROM public.user_block_notices);
END
$postconditions$;

COMMIT;
