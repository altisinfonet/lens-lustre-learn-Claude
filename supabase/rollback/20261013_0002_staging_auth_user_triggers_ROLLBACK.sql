-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261013_0002 — staging: restore the two auth.users triggers production has
-- Lane: STAGING ONLY. Refuses any other lane.
--
-- Restores staging's exact pre-20261013_0002 state: no user trigger on
-- auth.users. Drops on_auth_user_login_sync and on_auth_user_created and
-- nothing else. No function, grant, policy or row is changed.
--
-- WHAT IT DOES NOT UNDO: profiles, user_roles, follows, notifications,
-- newsletter and audit rows written by sign-ups or logins while the triggers
-- were on stay where they are. They are ordinary member data by then; removing
-- them is a separate, reviewed decision, not a side effect of a rollback.
--
-- RB-PRE-001 refuses unless each trigger that is present is exactly the one
-- 20261013_0002 creates (production's definition), so this never drops a trigger
-- it did not create. Absent triggers are fine: running it twice, or before
-- 20261013_0002, is a no-op that still ends in the asserted post-state.
--
-- OWNERSHIP. DROP TRIGGER needs ownership of auth.users, which belongs to
-- supabase_auth_admin. Supabase lets postgres drop triggers there through
-- supautils.drop_trigger_grants, which on staging (measured 2026-10-13) lists
-- postgres for auth.users. If that grant is ever gone, DROP fails with
-- "must be owner of table users", the transaction rolls back, and nothing is
-- half-done.
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
  -- RB-PRE-001 · each trigger present is exactly 20261013_0002's (production's definition).
  FOR r IN
    SELECT t.tgname::text AS name, pg_get_triggerdef(t.oid) AS got_def, t.tgenabled::text AS got_enabled, w.want_def
      FROM pg_trigger t
      JOIN (VALUES
        ('on_auth_user_created',
         'CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user()'),
        ('on_auth_user_login_sync',
         'CREATE TRIGGER on_auth_user_login_sync AFTER UPDATE ON auth.users FOR EACH ROW EXECUTE FUNCTION sync_oauth_on_login()')
      ) AS w(name, want_def) ON w.name = t.tgname::text
     WHERE t.tgrelid = 'auth.users'::regclass
  LOOP
    IF r.got_def IS DISTINCT FROM r.want_def OR r.got_enabled IS DISTINCT FROM 'O' THEN
      _bad := _bad || E'\n  RB-PRE-001 ' || r.name || ' is not the trigger 20261013_0002 creates: '
                   || r.got_def || ' (enabled ' || r.got_enabled || ')';
    END IF;
  END LOOP;

  -- RB-PRE-002 · no other user trigger on auth.users (staging had none before 20261013_0002).
  FOR r IN
    SELECT pg_get_triggerdef(t.oid) AS def
      FROM pg_trigger t
     WHERE t.tgrelid = 'auth.users'::regclass
       AND NOT t.tgisinternal
       AND t.tgname::text NOT IN ('on_auth_user_created', 'on_auth_user_login_sync')
  LOOP
    _bad := _bad || E'\n  RB-PRE-002 unexpected user trigger on auth.users: ' || r.def;
  END LOOP;

  IF _bad <> '' THEN
    RAISE EXCEPTION 'AUTHTRG-0002-RB-PRE: auth.users is not in 20261013_0002''s post-state — nothing dropped:%', _bad
    USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

DROP TRIGGER IF EXISTS on_auth_user_login_sync ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

DO $postconditions$
DECLARE
  _n int;
BEGIN
  -- RB-POST-001 · staging's pre-20261013_0002 state: no user trigger on auth.users.
  SELECT count(*) INTO _n FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal;
  IF _n <> 0 THEN
    RAISE EXCEPTION 'AUTHTRG-0002-RB-POST: % user trigger(s) still on auth.users, expected 0', _n USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'AUTHTRG-0002 ROLLBACK: auth.users carries no user trigger (staging''s state before 20261013_0002)';
END
$postconditions$;

COMMIT;
