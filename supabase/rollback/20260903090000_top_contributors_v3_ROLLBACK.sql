-- ROLLBACK — Top Contributors V3.
--
-- Reverses supabase/migrations/20260903090000_top_contributors_v3.sql
-- (OWNER-RULING-2026-09-03-02).
--
-- =============================================================================
-- ⚠ READ THIS BEFORE RUNNING IT. THE ORDER MATTERS.
--
-- This file drops get_top_contributors_v3. If the Home page is already reading
-- v3 when you run it, the card breaks — the client asks for a function that is
-- no longer there and gets a 404 from PostgREST, which renders as an empty or
-- errored card, not as a graceful fallback.
--
-- THE CORRECT ROLLBACK ORDER IS CLIENT FIRST, DATABASE SECOND:
--
--   1. Revert the Home card to get_top_contributors_v2. That is a one-line
--      frontend change and it is the whole rollback for anything a member can
--      see. v2 was never altered by the v3 migration — same signature, same
--      grants, same ranking — so the card works again the moment the revert
--      deploys, with this file never run.
--   2. Only then, and only if the function itself must go, run this file.
--
-- Step 1 alone is sufficient for every user-visible problem. Step 2 exists for
-- the case where v3 must not remain callable at all. Running step 2 without
-- step 1 turns a display question into an outage.
--
-- =============================================================================
-- WHAT THIS FILE DOES NOT DO, DELIBERATELY
--
--   * It does NOT touch get_top_contributors_v2. v2 is the rollback target and
--     the v3 migration never modified it, so there is nothing to restore.
--   * It does NOT touch contributor_points_since — neither its body nor its
--     grants. The v3 migration only read it.
--   * It does NOT touch get_contributor_scores or get_top_contributors_v1.
--   * It does NOT drop idx_post_comments_user_created. That index belongs to
--     the v2 migration and predates this unit; dropping it here would remove
--     something this unit never created, which is how a rollback quietly
--     becomes a second, unreviewed migration.
--
-- =============================================================================
-- IS IT SAFE TO RUN TWICE? Yes. IF EXISTS makes it idempotent, and the
-- signature is spelled out so it can only ever match the function this unit
-- created — not some later overload that happens to share the name.

BEGIN;

DROP FUNCTION IF EXISTS public.get_top_contributors_v3();

-- Confirm the intended end state in the same transaction that produced it:
-- v3 gone, v2 present and still granted to anon. If either is not true the
-- transaction is rolled back and the database is left exactly as it was.
DO $rollback_check$
DECLARE
  v3_present  boolean;
  v2_present  boolean;
  v2_anon     boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname = 'get_top_contributors_v3'
  ) INTO v3_present;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname = 'get_top_contributors_v2'
  ) INTO v2_present;

  IF v3_present THEN
    RAISE EXCEPTION
      'ROLLBACK FAILED: get_top_contributors_v3 still exists after the DROP. Nothing was changed.';
  END IF;

  IF NOT v2_present THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED: get_top_contributors_v2 is missing, so dropping v3 would leave the Home page with no function to fall back to. Nothing was changed. Restore v2 from 20260811160000_top_contributors_v2.sql first.';
  END IF;

  SELECT has_function_privilege('anon', p.oid, 'EXECUTE')
    INTO v2_anon
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'get_top_contributors_v2';

  IF NOT v2_anon THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED: get_top_contributors_v2 exists but anon cannot execute it, so the public Home page would still be broken. Nothing was changed.';
  END IF;

  RAISE NOTICE 'Rollback complete: get_top_contributors_v3 dropped; get_top_contributors_v2 present and anon-executable.';
END
$rollback_check$;

COMMIT;
