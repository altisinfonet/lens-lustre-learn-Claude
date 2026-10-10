-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261010_0003 — SEC-P3E-1
-- Restores the previous post_shares SELECT policy exactly:
--   "Authenticated users can view shares" FOR SELECT TO authenticated USING (true)
-- (re-opens SEC-P3E-1; use only if a scoped read breaks a feature).
-- LANE GUARD. The invoking session asserts the lane; this file never sets it:
--     SET p32.lane = 'staging';   -- or 'production', then run this file
-- NOT RE-RUNNABLE: RB-PRE-001 requires the 0003 policy.
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

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'post_shares'
                  AND policyname = 'Users can view shares on visible posts') THEN
    RAISE EXCEPTION 'SEC-P3E-1-RB-PRE-001: 20261010_0003 is not applied — nothing to roll back' USING ERRCODE = 'raise_exception';
  END IF;
END
$pre$;

DROP POLICY "Users can view shares on visible posts" ON public.post_shares;
CREATE POLICY "Authenticated users can view shares" ON public.post_shares
  AS PERMISSIVE FOR SELECT TO authenticated USING (true);

DO $post$
BEGIN
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'post_shares'
         AND cmd IN ('SELECT', 'ALL') AND permissive = 'PERMISSIVE') <> 1 THEN
    RAISE EXCEPTION 'SEC-P3E-1-RB-POST-001: post_shares must have exactly one permissive SELECT policy' USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'SEC-P3E-1-RB: post_shares SELECT back to USING (true) for authenticated';
END
$post$;

COMMIT;
