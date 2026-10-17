-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261013_0002 — staging: restore the two auth.users triggers production has
-- Lane: STAGING ONLY. Refuses any other lane.
--
-- Removes exactly what 20261013_0002 added: the triggers on_auth_user_login_sync
-- and on_auth_user_created on auth.users. Nothing else is dropped. No function,
-- grant, policy or row is changed. Staging had no user trigger on auth.users
-- before 20261013_0002.
--
-- WHAT IT DOES NOT UNDO: profiles, user_roles, follows, notifications,
-- newsletter and audit rows written by sign-ups or logins while the triggers
-- were on stay where they are. They are ordinary member data by then; removing
-- them is a separate, reviewed decision, not a side effect of a rollback.
--
-- RB-PRE-001 refuses unless each named trigger that is present has exactly the
-- definition 20261013_0002 creates (production's), so this never drops a
-- same-named trigger someone else defined. Its enabled state is not part of
-- that test: a disabled copy of 0002's own trigger is still 0002's and is
-- dropped. Absent triggers are fine: running it twice, or before
-- 20261013_0002, is a no-op that still ends in the asserted post-state.
-- Any OTHER user trigger on auth.users is reported (NOTICE) and left alone.
--
-- OWNERSHIP. DROP TRIGGER needs ownership of auth.users, which belongs to
-- supabase_auth_admin. Supabase lets postgres drop triggers there through
-- supautils.drop_trigger_grants, which on staging (measured 2026-10-13) lists
-- postgres for auth.users. The two DROPs below are plain top-level statements,
-- not inside a DO block, so they reach supautils' utility hook in the most
-- direct form. If that grant is ever gone, DROP fails with a must-be-owner
-- error (PostgreSQL 17.5 in the rehearsal: "must be owner of relation users"),
-- the transaction rolls back, and nothing is half-done. The PGlite rehearsal has
-- no supautils, so the permitted path is proven from the catalog setting only;
-- the refused path was exercised.
--
-- LOCK. DROP TRIGGER takes ACCESS EXCLUSIVE on auth.users and holds it from the
-- first DROP until COMMIT — expected to be milliseconds, since only the second
-- DROP and the RB-POST check run in between. Sign-ins, logins and token reads
-- that touch auth.users wait behind it. lock_timeout 5s bounds the wait; on
-- timeout nothing is dropped — re-dispatch.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') <> 'staging' THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED — this file is for STAGING only and p32.lane reads %. '
      'Dispatch apply-migration.yml with target=staging (it sets p32.lane = ''staging'').',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';
-- Same reason as in 20261013_0002: pg_get_triggerdef() output depends on the path.
SET LOCAL search_path TO public;

DO $preconditions$
DECLARE
  r    record;
  _bad text := '';
BEGIN
  -- RB-PRE-001 · each named trigger present has exactly 20261013_0002's definition.
  FOR r IN
    SELECT t.tgname::text AS name, pg_get_triggerdef(t.oid) AS got_def, w.want_def
      FROM pg_trigger t
      JOIN (VALUES
        ('on_auth_user_created',
         'CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user()'),
        ('on_auth_user_login_sync',
         'CREATE TRIGGER on_auth_user_login_sync AFTER UPDATE ON auth.users FOR EACH ROW EXECUTE FUNCTION sync_oauth_on_login()')
      ) AS w(name, want_def) ON w.name = t.tgname::text
     WHERE t.tgrelid = 'auth.users'::regclass
  LOOP
    IF r.got_def IS DISTINCT FROM r.want_def THEN
      _bad := _bad || E'\n  RB-PRE-001 ' || r.name || ' is not the trigger 20261013_0002 creates: ' || r.got_def;
    END IF;
  END LOOP;

  IF _bad <> '' THEN
    RAISE EXCEPTION 'AUTHTRG-0002-RB-PRE: refusing to drop a trigger 20261013_0002 did not create — nothing dropped:%', _bad
    USING ERRCODE = 'raise_exception';
  END IF;

  -- RB-PRE-002 · (NOTICE only) other user triggers on auth.users are not this
  -- file's to touch; they are named so a reader sees them, and left in place.
  FOR r IN
    SELECT pg_get_triggerdef(t.oid) AS def
      FROM pg_trigger t
     WHERE t.tgrelid = 'auth.users'::regclass
       AND NOT t.tgisinternal
       AND t.tgname::text NOT IN ('on_auth_user_created', 'on_auth_user_login_sync')
  LOOP
    RAISE NOTICE 'AUTHTRG-0002 ROLLBACK RB-PRE-002: other user trigger on auth.users, left untouched: %', r.def;
  END LOOP;
END
$preconditions$;

DROP TRIGGER IF EXISTS on_auth_user_login_sync ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

DO $postconditions$
DECLARE
  _left text;
BEGIN
  -- RB-POST-001 · neither trigger 20261013_0002 creates is left on auth.users.
  SELECT string_agg(tgname::text, ', ') INTO _left
    FROM pg_trigger
   WHERE tgrelid = 'auth.users'::regclass
     AND tgname::text IN ('on_auth_user_created', 'on_auth_user_login_sync');
  IF _left IS NOT NULL THEN
    RAISE EXCEPTION 'AUTHTRG-0002-RB-POST: still on auth.users: %', _left USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'AUTHTRG-0002 ROLLBACK: on_auth_user_created and on_auth_user_login_sync are gone from auth.users';
END
$postconditions$;

COMMIT;
