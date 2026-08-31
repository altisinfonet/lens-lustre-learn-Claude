-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260828082136_ad_comment_ban_and_visibility_policies.sql
--
-- ⚠ READ THIS BEFORE RUNNING IT. This rollback REOPENS both gaps the migration
-- closed. It exists because every migration must have one, not because running
-- it is ever a good idea:
--
--   * a BANNED member can comment on sponsored ads again, while still being
--     shut out of every post thread
--   * the comment thread on a HIDDEN creative becomes readable again by any
--     signed-in member, straight from
--     /rest/v1/ad_creative_comments?creative_id=eq.<id>
--
-- NO DATA IS LOST EITHER WAY. Dropping a policy removes only the policy; every
-- row in public.ad_creative_comments survives untouched, and nothing here
-- alters a table, a column or a function.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- IF SOMETHING BROKE AFTER 20260828093000, DROP ONE POLICY, NOT BOTH.
--
-- The two are independent and only one of them can plausibly be the cause:
--
--   * "members cannot post a comment on an ad any more" → section 1. Check
--     first whether profiles.is_banned is set for the account complaining;
--     the policy is doing its job if it is.
--   * "an ad's thread is suddenly empty" → section 2. Check first whether the
--     creative is is_active = false; again, that is the policy working. It is
--     the likelier of the two to surprise someone, because a creative switched
--     to Hidden now hides its thread as well as itself.
--
-- Restoring the state before the migration means dropping both, and that is
-- what running this whole file does.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Let a banned member comment on advertisements again ─────────────────
DROP POLICY IF EXISTS "Banned users cannot comment on ads" ON public.ad_creative_comments;

-- ── 2. Let any signed-in member read a hidden ad's thread again ────────────
DROP POLICY IF EXISTS "Ad comments follow the ad's visibility" ON public.ad_creative_comments;

-- ── VERIFY THE ROLLBACK ────────────────────────────────────────────────────
--   select policyname, permissive, cmd
--     from pg_policies
--    where schemaname='public' and tablename='ad_creative_comments'
--    order by cmd, policyname;
--   -- expect 7 rows, exactly the set 20260811120000 left behind, and neither
--   -- of the two names above among them.
--
--   select count(*) from public.ad_creative_comments;
--   -- unchanged by both the migration and this rollback.
