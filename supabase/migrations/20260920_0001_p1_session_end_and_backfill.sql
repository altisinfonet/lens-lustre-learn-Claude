-- ═══════════════════════════════════════════════════════════════════════════
-- P1 · 20260920_0001 — last seen, written by the server: session end + backfill
-- Phase 2 unit 2-D1-02 (server half). Two lanes: staging and production.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- INTERFACE. docs/gates/P1-interface.md, frozen by the Auditor 2026-09-27, §2
-- and §3. This file implements those two sections and nothing else. Where the
-- interface is silent, the choice made here is written down beside the code
-- that makes it, under "WHERE THE INTERFACE IS SILENT".
--
-- WHY. Today src/hooks/core/useLastActive.ts UPDATEs public.profiles every five
-- minutes from every signed-in tab. At the Owner's production reading of
-- 2026-09-26 its two statement variants were 13,294 calls / 1,033,384 ms and
-- 4,306 calls / 233,171 ms; on staging 357 calls / 17,015 ms. profiles is
-- REPLICA IDENTITY FULL, so each of those UPDATEs is also a full old-row decode
-- for Realtime, which was 48.2 % of all production database time. The member
-- sees none of it: the value only feeds "Last seen X ago".
--
-- P1 replaces the timer with two server-side writers:
--
--   public.record_session_end(_platform text) RETURNS void           (§2)
--     Called once by the client on pagehide / visibilitychange-hidden. Writes
--     last_active_at = now() and last_platform for auth.uid() — but only if the
--     stored value is NULL or more than 60 seconds old. That condition is the
--     two-tab rule: two tabs closing together produce one row update, not two,
--     and it is resolved here, in the row lock, not by client leader election.
--     (Under READ COMMITTED the second UPDATE waits on the first's row lock and
--     then re-evaluates its WHERE against the new row, which now fails it. The
--     fixture proves this with two real concurrent sessions, not by argument.)
--
--   public.backfill_last_seen() RETURNS integer                      (§3)
--     pg_cron, every 30 minutes, job 'p1-backfill-last-seen'. A tab that dies
--     without sending the signal (crash, OS kill, lost network) still earned
--     engagement-heartbeat minutes in public.member_activity_minutes. This
--     moves last_active_at forward to the member's newest heartbeat minute
--     where that minute is more than 10 minutes newer than what is stored.
--     So a session that ends silently is at most ~30 minutes stale.
--
-- This file does NOT remove the timer. D1 does not own src/. The timer's
-- continued presence is a red CI check (scripts/db-p1-client-timer-check.mjs,
-- .github/workflows/d1-p1-client-timer.yml) until D2's cut-over removes it.
--
-- OBJECTS (reservation 2-D1-01, docs/gates/phase-2-kickoff.md):
--   new   public.record_session_end(text)
--   new   public.backfill_last_seen()
--   new   cron job 'p1-backfill-last-seen'
--   write public.profiles (last_active_at, last_platform) — through the two
--         functions only; no DDL on the table
--   read  public.member_activity_minutes — read-only, as reserved
--
--   NOT reserved, but written as a side effect — reported, not hidden:
--   public.profiles_public_data. The existing AFTER UPDATE trigger
--   sync_profiles_public_data_trg on profiles upserts one profiles_public_data
--   row per profiles UPDATE (it mirrors last_active_at, NULLed when the member's
--   privacy_settings.active_status = 'off'). That is true of the timer today;
--   these two functions write profiles far less often, so they write it far
--   less often too. Nothing here changes that trigger.
--
-- GRANTS. REVOKE ALL FROM PUBLIC, anon (and authenticated, for the backfill),
-- then GRANT to the named roles only. Nothing depends on the default-privilege
-- catalogue: on staging a new postgres-owned function in public is born with
-- EXECUTE for authenticated and service_role (measured 2026-09-26 19:05 UTC), which is
-- right for record_session_end and wrong for backfill_last_seen, so both are
-- set explicitly and both are asserted afterwards.
--   record_session_end(text)  EXECUTE: authenticated, service_role
--   backfill_last_seen()      EXECUTE: service_role
-- The pg_cron job runs as the role that scheduled it — postgres, the owner,
-- which needs no grant. The dispatch connects as postgres (PRE-006).
--
-- SEARCH PATH. Both functions are SECURITY DEFINER with SET search_path = ''
-- and every name schema-qualified (repository rule secdef-no-search-path).
--
-- SECURITY DEFINER BYPASSES RLS: THE WHERE CLAUSE IS THE CONTROL.
--   record_session_end writes exactly one row, WHERE id = auth.uid(), and takes
--   no id argument — a member cannot name another member. The fixture proves a
--   call as member A leaves member B's row byte-identical.
--   backfill_last_seen takes no argument and is not executable by anon or
--   authenticated.
--
-- WHERE THE INTERFACE IS SILENT — the choices made here:
--   1. record_session_end validates _platform BEFORE the signed-out check. A
--      bad argument is a caller bug whether or not anyone is signed in, and
--      a check that only fires for signed-in callers is one that a signed-out
--      test never sees. NULL is not 'app' or 'web' and is refused (22023).
--   2. backfill_last_seen treats a stored NULL as older than any heartbeat
--      minute, so a member with heartbeat minutes and no last_active_at gets
--      one. The interface's "more than 10 minutes newer than the stored value"
--      has no answer for NULL; this is the answer that does not leave a member
--      who has demonstrably been active showing no last-seen at all.
--   3. backfill_last_seen writes last_active_at only. It never touches
--      last_platform — the heartbeat does not record a platform, and guessing
--      one would be inventing data.
--   4. backfill_last_seen scans member_activity_minutes whole, exactly as §3
--      states it (max over all of a member's minutes). A windowed scan would be
--      cheaper and would miss a member if a cron run is skipped. The cost is
--      measured, not assumed: docs/evidence/d1/phase2/p1-0001-backfill-cost.md.
--
-- APPLYING. Through apply-migration.yml only, which sets p32.lane (R-13):
--   staging first; production only after staging is green and the Auditor has
--   recorded it. Dispatch order relative to D2: this file is applied BEFORE
--   D2's client cut-over reaches the lane, because the client's new call has
--   nothing to call until it is. A client that calls it early gets
--   PGRST202 (function not found), is best-effort, is never retried, and
--   does no harm — but it records nothing.
--
-- NOT RE-RUNNABLE. PRE-004 and PRE-005 refuse a second apply rather than
-- silently replacing a function body or double-scheduling the job.
--
-- ROLLBACK: supabase/rollback/20260920_0001_p1_session_end_and_backfill_ROLLBACK.sql
--   (R-9 guarded: staging only.)
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

DO $preconditions$
BEGIN
  -- PRE-001 · the two columns this file writes, with the types it writes.
  PERFORM 1 FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'profiles'
     AND column_name = 'last_active_at' AND data_type = 'timestamp with time zone';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P1-0001-PRE-001: public.profiles.last_active_at (timestamptz) does not exist'
      USING ERRCODE = 'raise_exception';
  END IF;
  PERFORM 1 FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'profiles'
     AND column_name = 'last_platform' AND data_type = 'text';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P1-0001-PRE-002: public.profiles.last_platform (text) does not exist'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- PRE-003 · the engagement heartbeat's table, with the two columns read.
  PERFORM 1 FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'member_activity_minutes'
     AND column_name = 'user_id' AND data_type = 'uuid';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P1-0001-PRE-003: public.member_activity_minutes.user_id (uuid) does not exist'
      USING ERRCODE = 'raise_exception';
  END IF;
  PERFORM 1 FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'member_activity_minutes'
     AND column_name = 'minute_bucket' AND data_type = 'timestamp with time zone';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P1-0001-PRE-003: public.member_activity_minutes.minute_bucket (timestamptz) does not exist'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- PRE-004 · neither function exists under any signature. A second apply is
  -- refused rather than allowed to replace a body in place.
  PERFORM 1 FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace
     AND proname IN ('record_session_end', 'backfill_last_seen');
  IF FOUND THEN
    RAISE EXCEPTION
      'P1-0001-PRE-004: public.record_session_end or public.backfill_last_seen already '
      'exists. This file is not re-runnable; roll back first'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- PRE-005 · pg_cron is installed and the job name is free.
  PERFORM 1 FROM pg_extension WHERE extname = 'pg_cron';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P1-0001-PRE-005: pg_cron is not installed; the backfill would never run'
      USING ERRCODE = 'raise_exception';
  END IF;
  PERFORM 1 FROM cron.job WHERE jobname = 'p1-backfill-last-seen';
  IF FOUND THEN
    RAISE EXCEPTION 'P1-0001-PRE-005: a cron job named p1-backfill-last-seen already exists'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- PRE-006 · the job runs as the role that schedules it, and that role calls
  -- backfill_last_seen() with no grant of its own — so it must be the owner,
  -- postgres, or a member of it. Asserted so a wrong-credential dispatch fails
  -- with this sentence instead of a cron job that fails every 30 minutes.
  IF NOT pg_has_role(current_user, 'postgres', 'MEMBER') THEN
    RAISE EXCEPTION
      'P1-0001-PRE-006: the current user (%) is not postgres and not a member of it; '
      'the cron job would run as a role that cannot execute backfill_last_seen()', current_user
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;


-- ── §2 · LAST SEEN ─────────────────────────────────────────────────────────
CREATE FUNCTION public.record_session_end(_platform text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  _user uuid;
BEGIN
  -- The argument first (see header, "WHERE THE INTERFACE IS SILENT", 1).
  IF _platform IS NULL OR _platform NOT IN ('app', 'web') THEN
    RAISE EXCEPTION 'record_session_end: _platform must be ''app'' or ''web'' (got %)',
      coalesce(quote_literal(_platform), 'NULL')
      USING ERRCODE = '22023';
  END IF;

  -- Signed out: nothing to record, and no error worth raising. The same shape
  -- as public.record_activity_minute, the heartbeat this pairs with.
  _user := auth.uid();
  IF _user IS NULL THEN
    RETURN;
  END IF;

  -- The member's own row only — there is no id argument to point elsewhere.
  -- The 60-second condition is the two-tab rule (§2): the second tab's UPDATE
  -- matches no row.
  UPDATE public.profiles
     SET last_active_at = now(),
         last_platform  = _platform
   WHERE id = _user
     AND (last_active_at IS NULL OR last_active_at < now() - interval '60 seconds');
END
$fn$;

COMMENT ON FUNCTION public.record_session_end(text) IS
  'P1 (docs/gates/P1-interface.md §2): last seen, written once when a session ends '
  '(pagehide / visibilitychange-hidden). Own row only; no-op if written in the last 60 s '
  '(two-tab rule); signed out is a no-op; _platform must be app or web (22023). '
  'Migration 20260920_0001.';

REVOKE ALL ON FUNCTION public.record_session_end(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_session_end(text) TO authenticated, service_role;


-- ── §3 · CRASH BOUND ───────────────────────────────────────────────────────
CREATE FUNCTION public.backfill_last_seen()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  _touched integer;
BEGIN
  UPDATE public.profiles AS p
     SET last_active_at = m.newest_minute
    FROM (SELECT mam.user_id, max(mam.minute_bucket) AS newest_minute
            FROM public.member_activity_minutes AS mam
           GROUP BY mam.user_id) AS m
   WHERE p.id = m.user_id
     -- More than 10 minutes newer than what is stored; a stored NULL counts as
     -- older than any minute (header, "WHERE THE INTERFACE IS SILENT", 2).
     AND (p.last_active_at IS NULL OR m.newest_minute > p.last_active_at + interval '10 minutes');
  GET DIAGNOSTICS _touched = ROW_COUNT;
  RETURN _touched;
END
$fn$;

COMMENT ON FUNCTION public.backfill_last_seen() IS
  'P1 (docs/gates/P1-interface.md §3): moves profiles.last_active_at forward to the '
  'member''s newest member_activity_minutes.minute_bucket where that is more than 10 '
  'minutes newer than the stored value. Returns rows touched. pg_cron job '
  'p1-backfill-last-seen, every 30 minutes. service_role only. Migration 20260920_0001.';

REVOKE ALL ON FUNCTION public.backfill_last_seen() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_last_seen() TO service_role;

SELECT cron.schedule(
  'p1-backfill-last-seen',
  '*/30 * * * *',
  $cron$SELECT public.backfill_last_seen();$cron$
);


DO $postconditions$
DECLARE
  f_end  oid;
  f_bf   oid;
  n      integer;
  caught text;
BEGIN
  SELECT oid INTO f_end FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace AND proname = 'record_session_end'
     AND pg_get_function_identity_arguments(oid) = '_platform text';
  SELECT oid INTO f_bf FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace AND proname = 'backfill_last_seen'
     AND pg_get_function_identity_arguments(oid) = '';
  IF f_end IS NULL OR f_bf IS NULL THEN
    RAISE EXCEPTION 'P1-0001-POST-001: one of the two functions was not created'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- POST-002 · both are SECURITY DEFINER with search_path pinned to empty.
  PERFORM 1 FROM pg_proc
   WHERE oid IN (f_end, f_bf) AND prosecdef AND proconfig = ARRAY['search_path=""'];
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 2 THEN
    RAISE EXCEPTION 'P1-0001-POST-002: % of 2 functions are SECURITY DEFINER with search_path=""', n
      USING ERRCODE = 'raise_exception';
  END IF;

  -- POST-003 · no PUBLIC entry on either (F-62: a PUBLIC entry would make every
  -- anon check below true regardless of anon's own ACL item).
  PERFORM 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) x
   WHERE p.oid IN (f_end, f_bf) AND x.grantee = 0;
  IF FOUND OR (SELECT count(*) FROM pg_proc WHERE oid IN (f_end, f_bf) AND proacl IS NULL) > 0 THEN
    RAISE EXCEPTION 'P1-0001-POST-003: PUBLIC holds EXECUTE on a P1 function (or its ACL is the built-in default)'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- POST-004 · the grant matrix, as the interface states it.
  IF has_function_privilege('anon', f_end, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', f_end, 'EXECUTE')
     OR NOT has_function_privilege('service_role', f_end, 'EXECUTE') THEN
    RAISE EXCEPTION 'P1-0001-POST-004: record_session_end must be EXECUTE for authenticated '
      'and service_role only (anon=%, authenticated=%, service_role=%)',
      has_function_privilege('anon', f_end, 'EXECUTE'),
      has_function_privilege('authenticated', f_end, 'EXECUTE'),
      has_function_privilege('service_role', f_end, 'EXECUTE')
      USING ERRCODE = 'raise_exception';
  END IF;
  IF has_function_privilege('anon', f_bf, 'EXECUTE')
     OR has_function_privilege('authenticated', f_bf, 'EXECUTE')
     OR NOT has_function_privilege('service_role', f_bf, 'EXECUTE') THEN
    RAISE EXCEPTION 'P1-0001-POST-004: backfill_last_seen must be EXECUTE for service_role only '
      '(anon=%, authenticated=%, service_role=%)',
      has_function_privilege('anon', f_bf, 'EXECUTE'),
      has_function_privilege('authenticated', f_bf, 'EXECUTE'),
      has_function_privilege('service_role', f_bf, 'EXECUTE')
      USING ERRCODE = 'raise_exception';
  END IF;

  -- POST-005 · the job exists, active, with this schedule and this command.
  PERFORM 1 FROM cron.job
   WHERE jobname = 'p1-backfill-last-seen' AND schedule = '*/30 * * * *'
     AND command = 'SELECT public.backfill_last_seen();' AND active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P1-0001-POST-005: cron job p1-backfill-last-seen is missing, inactive, or not as scheduled'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- POST-006 · the function refuses a bad platform, live. The dispatch session
  -- is signed out, so this also shows the argument is checked first.
  caught := NULL;
  BEGIN
    PERFORM public.record_session_end('desktop');
  EXCEPTION WHEN SQLSTATE '22023' THEN
    caught := '22023';
  END;
  IF caught IS DISTINCT FROM '22023' THEN
    RAISE EXCEPTION 'P1-0001-POST-006: record_session_end(''desktop'') did not raise 22023'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- POST-007 · signed out is a quiet no-op, live. auth.uid() is NULL in the
  -- dispatch session; a call that wrote anything, or raised, fails here.
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'P1-0001-POST-007: auth.uid() is not NULL in the dispatch session (%); '
      'the signed-out check cannot be exercised here', auth.uid()
      USING ERRCODE = 'raise_exception';
  END IF;
  PERFORM public.record_session_end('web');
  -- A write in this transaction would carry last_active_at = now(), the
  -- transaction timestamp, which no row written by anything else can equal.
  SELECT count(*) INTO n FROM public.profiles WHERE last_active_at = now();
  IF n <> 0 THEN
    RAISE EXCEPTION 'P1-0001-POST-007: a signed-out record_session_end(''web'') wrote % row(s)', n
      USING ERRCODE = 'raise_exception';
  END IF;
END
$postconditions$;

COMMIT;
