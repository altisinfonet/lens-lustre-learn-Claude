-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261004_0008 — OFF-2 idempotency keys
-- Drops the two UNIQUE (owner, idempotency_key) constraints and the two
-- key-format CHECKs. After it, a repeated send can create a second comment or
-- report again (the pre-0008 behaviour).
--
-- WHAT IT DOES NOT DO — BY DESIGN (never a bare DROP of member data):
--   the idempotency_key COLUMNS are KEPT, with whatever keys members' sends
--   have written. Nothing reads them after this rollback; a re-apply of 0008
--   reuses them (ADD COLUMN IF NOT EXISTS) and its PRE-003 refuses if repeats
--   crept in meanwhile. Dropping them is a separate, later decision.
--
-- LANE GUARD. The invoking session asserts the lane; this file never sets it:
--     SET p32.lane = 'staging';   -- or 'production', then run this file
-- NOT RE-RUNNABLE: RB-PRE-001 requires the 0008 constraints.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Set it in THIS session before running: SET p32.lane = ''staging'';',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $preconditions$
BEGIN
  IF (SELECT count(*) FROM pg_constraint WHERE conname IN ('post_comments_user_idempotency_key', 'reports_reporter_idempotency_key',
                                                           'post_comments_idempotency_key_format', 'reports_idempotency_key_format')) <> 4 THEN
    RAISE EXCEPTION 'OFF2-0008-RB-PRE-001: the four 0008 constraints are not all present — nothing (or something else) to roll back'
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

ALTER TABLE public.post_comments DROP CONSTRAINT post_comments_user_idempotency_key;
ALTER TABLE public.post_comments DROP CONSTRAINT post_comments_idempotency_key_format;
ALTER TABLE public.reports DROP CONSTRAINT reports_reporter_idempotency_key;
ALTER TABLE public.reports DROP CONSTRAINT reports_idempotency_key_format;

DO $postconditions$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname IN ('post_comments_user_idempotency_key', 'reports_reporter_idempotency_key',
                                                           'post_comments_idempotency_key_format', 'reports_idempotency_key_format')) THEN
    RAISE EXCEPTION 'OFF2-0008-RB-POST-001: an 0008 constraint remains' USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'OFF2-0008-RB: constraints dropped; the idempotency_key columns are kept (no data dropped)';
END
$postconditions$;

COMMIT;
