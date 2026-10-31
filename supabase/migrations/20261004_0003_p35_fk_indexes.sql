-- ═══════════════════════════════════════════════════════════════════════════
-- P35 · 20261004_0003 — index the two unindexed foreign keys (EXPAND, A-4a)
-- Phase 4 unit P35 (D1, T1). Lanes: staging and production. Additive only.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- GATE (GATE_REGISTER P35): "every table has a primary key or a written reason
-- not to; the duplicate index pairs dropped; post_hashtags.author_id indexed."
--   · post_hashtags.author_id indexed — THIS FILE.
--   · the same defect on public.user_block_notices.blocked_id (20261003_0002,
--     D1's own) — THIS FILE. Staging read-only 2026-10-04 08:20 UTC: these are
--     the ONLY two foreign keys in public with no index leading on their columns.
--   · primary keys: the six public tables without one are frozen snapshots or
--     RETIRED tables, each with a written reason in PROBE_p35_keys.sql and
--     docs/evidence/d1/P35/README.md; they are dropped in A-4c, not keyed now.
--   · duplicate-pair DROPs: CONTRACT (A-4c), held by C-2. Not here.
--
-- WHY IT MATTERS AT SCALE. Both columns reference auth.users ON DELETE CASCADE.
-- Without an index, deleting one account makes Postgres scan the WHOLE child
-- table to find its rows — at 1M post_hashtags rows that is a full scan per
-- account deletion (measured in docs/evidence/d1/P35/p35-transcript.txt).
--
-- LOCKS. CREATE INDEX (not CONCURRENTLY: apply-migration runs files in one
-- transaction) takes SHARE on the table — writes wait, reads do not — for the
-- build. Staging 2026-10-04: post_hashtags 0 rows / 24 kB; user_block_notices
-- new. Production is pre-launch. lock_timeout 5 s so a queued lock aborts.
-- RE-RUNNABLE (IF NOT EXISTS). ROLLBACK: supabase/rollback/20261004_0003_p35_fk_indexes_ROLLBACK.sql
-- PROBE: supabase/migrations/PROBE_p35_keys.sql
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
  IF to_regclass('public.post_hashtags') IS NULL THEN
    RAISE EXCEPTION 'P35-0003-PRE-001: public.post_hashtags does not exist' USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- P28: post_hashtags · ~1 row per hashtag per post at launch · FK author_id → auth.users ON DELETE CASCADE; without it every account deletion scans the table
CREATE INDEX IF NOT EXISTS idx_post_hashtags_author_id ON public.post_hashtags (author_id);

DO $ubn$
BEGIN
  IF to_regclass('public.user_block_notices') IS NOT NULL THEN
    -- P28: user_block_notices · ≤ 1 row per blocking pair · FK blocked_id → auth.users ON DELETE CASCADE; without it every account deletion scans the ledger
    CREATE INDEX IF NOT EXISTS idx_user_block_notices_blocked_id ON public.user_block_notices (blocked_id);
  END IF;
END
$ubn$;

DO $postconditions$
BEGIN
  IF to_regclass('public.idx_post_hashtags_author_id') IS NULL THEN
    RAISE EXCEPTION 'P35-0003-POST-001: idx_post_hashtags_author_id missing' USING ERRCODE = 'raise_exception';
  END IF;
  IF to_regclass('public.user_block_notices') IS NOT NULL AND to_regclass('public.idx_user_block_notices_blocked_id') IS NULL THEN
    RAISE EXCEPTION 'P35-0003-POST-002: idx_user_block_notices_blocked_id missing' USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'P35-0003: post_hashtags.author_id and user_block_notices.blocked_id are indexed';
END
$postconditions$;

COMMIT;
