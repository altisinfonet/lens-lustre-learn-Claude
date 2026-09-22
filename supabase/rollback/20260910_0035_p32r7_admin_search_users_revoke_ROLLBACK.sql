-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260910_0035_p32r7_admin_search_users_revoke.sql
-- Identical stem, as required. ONE object: public.admin_search_users(search_query text, search_by text)
-- Set B — open on BOTH lanes, with DIFFERENT ACL shapes on each.
--
-- ⚠ THIS FILE EXISTS BECAUSE ITS ABSENCE IS WHY #274 WAS RE-CUT. Skill §3:
-- "Every apply file ships with its rollback file, in the same PR. No
-- exceptions."
--
-- ═════════════════════════════════════════════════════════════════════════
-- THE TWO MEASURED STARTING ACLs — QUOTED HERE BECAUSE THIS FILE'S WHOLE
-- DESIGN TURNS ON THEM BEING DIFFERENT
--
--   STAGING  fpszggreishhuvdpkmdr — measured by SELECT, 2026-09-22T06:45Z:
--     =X/postgres | postgres=X/postgres | anon=X/postgres |
--     authenticated=X/postgres | service_role=X/postgres
--     → **staging originally HELD PUBLIC.** PUBLIC EXECUTE entries = 1.
--
--   PRODUCTION jtdtehuqtinjxropkkcn — RELAYED from the work order §3 and the
--   Auditor's two-lane diff, **NOT measured by this session** (BLOCKER-B:
--   `list_projects` returns staging alone, re-verified 2026-09-22T06:45Z):
--     postgres \| anon \| authenticated \| service_role
--     → **production did NOT hold PUBLIC.**
--
-- ═════════════════════════════════════════════════════════════════════════
-- WHAT THIS ROLLBACK RESTORES, AND THE ONE THING IT WILL NEVER DO
--
--   RESTORED    : `anon` EXECUTE — the named grant the apply removed, and the
--                 only named grant it removed. `authenticated` and
--                 `service_role` were re-granted by the apply and never left.
--   NEVER ISSUED: **`GRANT EXECUTE ... TO PUBLIC`. On any lane. Ever.**
--
-- ⚠ SO THIS ROLLBACK IS NOT A PERFECT INVERSE ON STAGING, DELIBERATELY.
-- Staging's starting state included PUBLIC; this file does not put it back.
-- The alternative — a faithful inverse — would, if run against production,
-- CREATE a PUBLIC EXECUTE grant that has never existed on that lane. That is
-- the recorded **UNAPPLIED_0023 hazard**, and a rollback is exactly the
-- artefact most likely to be run in a hurry, under pressure, on the wrong
-- lane. Between "staging does not get its PUBLIC grant back" and "production
-- acquires one", the choice is not close.
--
-- ONE FILE SAFELY SERVES BOTH LANE SHAPES, and it is worth saying why rather
-- than asserting it:
--   · on PRODUCTION this restores exactly the measured starting ACL —
--     production's start had `anon` and no PUBLIC, which is what this
--     produces;
--   · on STAGING it restores the starting ACL minus PUBLIC, which is a
--     strictly SMALLER privilege set than the state it is rolling back to.
-- A rollback that under-restores is recoverable. One that over-restores is
-- an incident. No `_STAGING` / `_PRODUCTION` variant is needed, and none is
-- invented — work order §10 reserves that decision to the Auditor.
--
-- CALLER SAFETY AFTER ROLLBACK — `authenticated` is untouched throughout, so
-- the one production caller (src/components/AdminGiftCredit.tsx:59) keeps working in
-- both directions.
--
-- IDEMPOTENCE — GRANT is idempotent; re-running changes nothing.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

GRANT EXECUTE ON FUNCTION public.admin_search_users(search_query text, search_by text) TO anon;

-- Post-condition, inside the transaction: if PUBLIC ever ends up holding
-- EXECUTE after this file runs, the whole thing rolls back rather than leaving
-- the hazard in place.
DO $verify$
DECLARE pub int; an boolean; BEGIN
  SELECT count(*) INTO pub
    FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid = to_regprocedure('public.admin_search_users(search_query text, search_by text)')::oid
     AND a.grantee = 0 AND a.privilege_type = 'EXECUTE';
  IF pub > 0 THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED — PUBLIC holds EXECUTE on public.admin_search_users(search_query text, search_by text) after rollback (% entr(y/ies)). This file must never create a PUBLIC grant (UNAPPLIED_0023 hazard). Transaction aborted.', pub;
  END IF;
  SELECT has_function_privilege('anon', to_regprocedure('public.admin_search_users(search_query text, search_by text)')::oid, 'EXECUTE') INTO an;
  IF NOT an THEN
    RAISE EXCEPTION 'ROLLBACK POST-CONDITION FAILED — anon does not hold EXECUTE on public.admin_search_users(search_query text, search_by text) after the rollback that was supposed to restore it.';
  END IF;
  RAISE NOTICE 'ROLLBACK POST-CONDITION PASSED — anon restored, PUBLIC absent.';
END $verify$;

COMMIT;
