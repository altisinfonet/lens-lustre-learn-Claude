-- ═══════════════════════════════════════════════════════════════════════════
-- 20261003_0002 — user_blocks hardening (R-72.5)
-- Follows 20261003_0001_user_blocks.sql (main 566fe1b; applied on production by
-- apply-migration run #105, 2026-10-03 05:15:32 UTC). The block 20261003_* is
-- assigned to the user_blocks line by R-72.4. Staging first, then production.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT IT CHANGES, AND WHY (finding → change)
--
--   SEC-UB-1  Notice flood. 0001 writes one admin_notifications row per INSERT,
--             through a SECURITY DEFINER trigger, with no cap: a block/unblock/
--             block loop writes a row every time. → The trigger now notifies at
--             most ONCE PER (blocker, blocked) PAIR PER 24 HOURS. The pair's last
--             notice time lives in a new side table, public.user_block_notices,
--             written only by the trigger (no API role can read or write it).
--             The claim is one atomic statement — INSERT … ON CONFLICT DO UPDATE
--             … WHERE notified_at <= now() - 24 h — so two racing inserts of the
--             same pair cannot both notify. (They cannot race anyway: the pair is
--             user_blocks' primary key.) Mass-blocking of MANY distinct members
--             is NOT capped here: the ruling names the pair cap only.
--
--   UB-2 /    Two permissive SELECT policies for authenticated (own + admin), and
--   SEC-UB-4  has_role(...) not wrapped in a sub-select. → ONE SELECT policy:
--             blocker_id = (select auth.uid())
--             OR (select public.has_role((select auth.uid()), 'admin'::public.app_role))
--             Same rows as before for every caller; one policy, evaluated once
--             per statement instead of per row.
--
--   SEC-UB-3  No RESTRICTIVE account_is_live() guard (100 public tables carry one;
--             staging, 2026-10-04 03:33 UTC). → The same three policies, same
--             names, same expressions, read from public.admin_notifications on
--             staging 2026-10-04 05:06 UTC:
--               "Deleted accounts cannot insert" WITH CHECK ((SELECT account_is_live()))
--               "Deleted accounts cannot update" USING      ((SELECT account_is_live()))
--               "Deleted accounts cannot delete" USING      ((SELECT account_is_live()))
--             (user_blocks has no UPDATE grant; the UPDATE guard is kept so the
--             table matches the other 100 exactly.)
--
--   UB-1      0001 asserts no lane. → This file asserts p32.lane IN (staging,
--             production) first, as its own statement; its rollback does too.
--
-- UNCHANGED: the table, its primary key, CHECK, index and FKs; the INSERT and
-- DELETE policies; every grant; the trigger itself; the notice text. The client
-- (src/hooks/core/useBlockedUsers.ts on main: select/insert/delete by own
-- blocker_id, 23505 treated as success) sees no difference.
--
-- OBJECTS (reservation, block 20261003_*):
--   alter  public.user_blocks — policies only (2 dropped, 1 + 3 created)
--   alter  public.notify_admin_user_blocked() — body only (CREATE OR REPLACE)
--   new    public.user_block_notices (blocker_id, blocked_id, notified_at)
--   read   public.admin_notifications, public.profiles, public.has_role, public.account_is_live
--
-- NOT RE-RUNNABLE. PRE-002 requires exactly the four 0001 policies; a second
-- apply finds the 0002 set and refuses — a sentence, not a silent success.
--
-- PROBE:    supabase/migrations/PROBE_user_blocks_hardened.sql (supersedes
--           PROBE_user_blocks_closed.sql, whose "exactly 4 policies" check is
--           false after this file by design).
-- ROLLBACK: supabase/rollback/20261003_0002_user_blocks_hardening_ROLLBACK.sql
-- EVIDENCE: docs/evidence/d1/user-blocks/ub-0002-run-tests.sh → ub-0002-transcript.txt
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
DECLARE
  pols text;
BEGIN
  -- PRE-001 · 0001 is applied: the table, its trigger and its function exist.
  -- (to_regclass, never a ::regclass cast: on a database without the table the
  -- cast would fail before this sentence could be raised.)
  IF to_regclass('public.user_blocks') IS NULL
     OR to_regprocedure('public.notify_admin_user_blocked()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.user_blocks')
                                             AND tgname = 'user_blocks_notify_admin') THEN
    RAISE EXCEPTION 'UB-0002-PRE-001: 20261003_0001 is not applied on this database '
      '(user_blocks, its trigger or notify_admin_user_blocked() is missing)'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- PRE-002 · the policy set is exactly 0001's. Anything else means this file
  -- already ran, or someone changed the table since; re-read before anything else.
  SELECT string_agg(policyname || ':' || permissive || ':' || cmd, ',' ORDER BY policyname) INTO pols
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_blocks';
  IF pols IS DISTINCT FROM
     'user_blocks_delete_own:PERMISSIVE:DELETE,user_blocks_insert_own:PERMISSIVE:INSERT,'
     'user_blocks_select_admin:PERMISSIVE:SELECT,user_blocks_select_own:PERMISSIVE:SELECT' THEN
    RAISE EXCEPTION 'UB-0002-PRE-002: user_blocks policies are (%), not the four of 20261003_0001',
      coalesce(pols, 'none')
      USING ERRCODE = 'raise_exception';
  END IF;

  -- PRE-003 · the helpers this file's policies call exist, with these signatures.
  IF to_regprocedure('public.account_is_live()') IS NULL
     OR to_regprocedure('public.has_role(uuid, public.app_role)') IS NULL THEN
    RAISE EXCEPTION 'UB-0002-PRE-003: public.account_is_live() or public.has_role(uuid, app_role) is missing'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- PRE-004 · the columns the notice writes exist on admin_notifications.
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'admin_notifications'
         AND column_name IN ('type', 'title', 'message', 'reference_id')) <> 4 THEN
    RAISE EXCEPTION 'UB-0002-PRE-004: admin_notifications lacks one of type, title, message, reference_id'
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── SEC-UB-1 · the pair ledger. IF NOT EXISTS: the rollback keeps this table
--    (it holds no member choice, only notice times, and is never dropped
--    blind — SEC-UB-5), so a re-apply after a rollback finds it and reuses it.
CREATE TABLE IF NOT EXISTS public.user_block_notices (
  blocker_id  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notified_at timestamptz NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);
ALTER TABLE public.user_block_notices ENABLE ROW LEVEL SECURITY;
-- No policy: only the table owner (the trigger function's owner) reads or
-- writes it. Explicit revokes so a default privilege never opens it (F-62).
REVOKE ALL ON public.user_block_notices FROM PUBLIC;
REVOKE ALL ON public.user_block_notices FROM anon;
REVOKE ALL ON public.user_block_notices FROM authenticated;
GRANT ALL ON public.user_block_notices TO service_role;

CREATE OR REPLACE FUNCTION public.notify_admin_user_blocked()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  _blocker text;
  _blocked text;
  _claimed int;
BEGIN
  -- SEC-UB-1: claim this pair's notice slot. A row is written (or moved
  -- forward) only when the pair has no notice in the last 24 hours; otherwise
  -- the statement affects 0 rows and no notice is written.
  INSERT INTO public.user_block_notices AS n (blocker_id, blocked_id, notified_at)
  VALUES (NEW.blocker_id, NEW.blocked_id, now())
  ON CONFLICT (blocker_id, blocked_id) DO UPDATE
     SET notified_at = EXCLUDED.notified_at
   WHERE n.notified_at <= EXCLUDED.notified_at - interval '24 hours';
  GET DIAGNOSTICS _claimed = ROW_COUNT;
  IF _claimed = 0 THEN
    RETURN NEW;
  END IF;

  -- Unchanged from 20261003_0001 below this line.
  SELECT full_name INTO _blocker FROM public.profiles WHERE id = NEW.blocker_id;
  SELECT full_name INTO _blocked FROM public.profiles WHERE id = NEW.blocked_id;

  INSERT INTO public.admin_notifications (type, title, message, reference_id)
  VALUES (
    'user_blocked',
    'Member blocked by another member',
    COALESCE(_blocker, 'A member') || ' blocked ' || COALESCE(_blocked, 'a member')
      || ' (user ' || NEW.blocked_id::text || '). Review that member''s recent posts and comments for objectionable content.',
    NEW.blocked_id
  );
  RETURN NEW;
END;
$fn$;

-- CREATE OR REPLACE keeps the ACL, but the revokes are restated so the file
-- states the end state rather than relying on that.
REVOKE ALL ON FUNCTION public.notify_admin_user_blocked() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_admin_user_blocked() FROM anon;
REVOKE ALL ON FUNCTION public.notify_admin_user_blocked() FROM authenticated;

-- ── UB-2 / SEC-UB-4 · one SELECT policy.
DROP POLICY user_blocks_select_own   ON public.user_blocks;
DROP POLICY user_blocks_select_admin ON public.user_blocks;
CREATE POLICY user_blocks_select ON public.user_blocks
  FOR SELECT TO authenticated
  USING (
    blocker_id = (SELECT auth.uid())
    OR (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
  );

-- ── SEC-UB-3 · the restrictive live-account guard, as on the other 100 tables.
CREATE POLICY "Deleted accounts cannot insert" ON public.user_blocks
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.account_is_live()));
CREATE POLICY "Deleted accounts cannot update" ON public.user_blocks
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((SELECT public.account_is_live()));
CREATE POLICY "Deleted accounts cannot delete" ON public.user_blocks
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((SELECT public.account_is_live()));

DO $postconditions$
DECLARE
  pols text;
  sel  text;
  fn   text;
BEGIN
  -- POST-001 · the policy set is exactly 0002's.
  SELECT string_agg(policyname || ':' || permissive || ':' || cmd, ',' ORDER BY policyname) INTO pols
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_blocks';
  IF pols IS DISTINCT FROM
     'Deleted accounts cannot delete:RESTRICTIVE:DELETE,Deleted accounts cannot insert:RESTRICTIVE:INSERT,'
     'Deleted accounts cannot update:RESTRICTIVE:UPDATE,user_blocks_delete_own:PERMISSIVE:DELETE,'
     'user_blocks_insert_own:PERMISSIVE:INSERT,user_blocks_select:PERMISSIVE:SELECT' THEN
    RAISE EXCEPTION 'UB-0002-POST-001: user_blocks policies are (%), not the 0002 set', coalesce(pols, 'none')
      USING ERRCODE = 'raise_exception';
  END IF;

  -- POST-002 · the one SELECT policy reads the caller's own rows (and admins').
  SELECT qual INTO sel FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'user_blocks' AND policyname = 'user_blocks_select';
  IF sel NOT LIKE '%blocker_id = ( SELECT auth.uid()%' OR sel NOT LIKE '%has_role(( SELECT auth.uid()%' THEN
    RAISE EXCEPTION 'UB-0002-POST-002: user_blocks_select is (%), not own-or-admin', sel
      USING ERRCODE = 'raise_exception';
  END IF;

  -- POST-003 · the ledger is closed to every API role except service_role.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_block_notices'::regclass)
     OR has_table_privilege('anon', 'public.user_block_notices', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
     OR has_table_privilege('authenticated', 'public.user_block_notices', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') THEN
    RAISE EXCEPTION 'UB-0002-POST-003: public.user_block_notices is not closed (RLS off, or anon/authenticated hold a privilege)'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- POST-004 · the trigger function carries the cap and is still not callable by API roles.
  SELECT prosrc INTO fn FROM pg_proc WHERE oid = 'public.notify_admin_user_blocked()'::regprocedure;
  IF fn NOT LIKE '%user_block_notices%' OR fn NOT LIKE '%interval ''24 hours''%' THEN
    RAISE EXCEPTION 'UB-0002-POST-004: notify_admin_user_blocked() does not carry the 24 h pair cap'
      USING ERRCODE = 'raise_exception';
  END IF;
  IF has_function_privilege('anon', 'public.notify_admin_user_blocked()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.notify_admin_user_blocked()', 'EXECUTE') THEN
    RAISE EXCEPTION 'UB-0002-POST-004: notify_admin_user_blocked() is executable by an API role'
      USING ERRCODE = 'raise_exception';
  END IF;

  RAISE NOTICE 'UB-0002: one SELECT policy, three restrictive live-account guards, '
               'notices capped at one per pair per 24 h';
END
$postconditions$;

COMMIT;
