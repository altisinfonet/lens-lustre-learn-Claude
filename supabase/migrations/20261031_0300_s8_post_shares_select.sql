-- ═══════════════════════════════════════════════════════════════════════════
-- SEC-P3E-1 (LOW) · 20261031_0300 — post_shares SELECT scoped to the post's
-- visibility, like post_reactions. Lanes: staging and production.
-- S8 carry of PR #391 (20261010_0003, never merged), re-numbered into the S8
-- range; SQL unchanged except PRE-003 (the policy's function must be callable).
-- ═══════════════════════════════════════════════════════════════════════════
-- TODAY (staging read 2026-10-10 08:1x UTC; SEC read production 06:14 UTC):
--   "Authenticated users can view shares" FOR SELECT TO authenticated USING (true)
--   — every member can read (sharer, post_id, created_at) of every share,
--   including shares of Friends-only and private posts they cannot see, and on
--   a lane that publishes post_shares, receive them over realtime (realtime
--   applies this same SELECT policy). Post content was never exposed.
-- AFTER: one permissive SELECT policy, TO authenticated:
--     user_id = (select auth.uid())                      -- your own shares
--     OR EXISTS (posts p WHERE p.id = post_id AND
--                can_view_post((select auth.uid()), p.user_id, p.privacy))
--   The second arm is post_reactions' own expression ("Users can view
--   reactions on visible posts"). The first arm is added on purpose: unsharing
--   is DELETE … WHERE post_id AND user_id, and PostgreSQL applies SELECT
--   policies to the rows a DELETE's WHERE reads — without it a member could not
--   take down their share of a post that later became private. It shows a
--   member nothing but their own rows.
-- UNCHANGED: INSERT / DELETE / restrictive policies, grants, the count trigger
--   and the recount job (both SECURITY DEFINER), the publication. Client reads
--   (ShareSummaryTooltip, PostDetail count, wall, unshare) only ever ask about
--   posts the viewer can see or their own rows — same answers.
-- RULES: one permissive SELECT per table (no 385th), auth.uid() wrapped.
-- OBJECTS (reservation): policies on public.post_shares (SELECT only).
-- NOT RE-RUNNABLE: PRE-002 requires the old policy.
-- ROLLBACK: supabase/rollback/20261031_0300_s8_post_shares_select_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261031_0300_s8_post_shares_select.sql
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
  -- PRE-001 · what the new policy calls.
  IF to_regclass('public.post_shares') IS NULL OR to_regclass('public.posts') IS NULL
     OR to_regprocedure('public.can_view_post(uuid,uuid,text)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.posts'::regclass AND attname = 'privacy' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'SEC-P3E-1-PRE-001: post_shares, posts.privacy or can_view_post(uuid,uuid,text) is missing' USING ERRCODE = 'raise_exception';
  END IF;
  -- PRE-002 · exactly today's state: one permissive SELECT, the USING (true) one.
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'post_shares'
         AND cmd IN ('SELECT', 'ALL') AND permissive = 'PERMISSIVE') <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'post_shares'
                     AND policyname = 'Authenticated users can view shares' AND cmd = 'SELECT'
                     AND permissive = 'PERMISSIVE' AND roles = '{authenticated}' AND qual = 'true') THEN
    RAISE EXCEPTION 'SEC-P3E-1-PRE-002: post_shares SELECT is not the expected single USING (true) policy — drift, refusing'
      USING ERRCODE = 'raise_exception';
  END IF;
  -- PRE-003 · a policy runs as the caller: authenticated must be able to call
  -- can_view_post, or every post_shares read would error.
  IF NOT has_function_privilege('authenticated', 'public.can_view_post(uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SEC-P3E-1-PRE-003: authenticated cannot execute can_view_post(uuid,uuid,text)' USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

DROP POLICY "Authenticated users can view shares" ON public.post_shares;
CREATE POLICY "Users can view shares on visible posts" ON public.post_shares
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (SELECT 1 FROM public.posts p
                WHERE p.id = post_shares.post_id
                  AND public.can_view_post((SELECT auth.uid()), p.user_id, p.privacy))
  );

DO $postconditions$
DECLARE _q text;
BEGIN
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'post_shares'
         AND cmd IN ('SELECT', 'ALL') AND permissive = 'PERMISSIVE') <> 1 THEN
    RAISE EXCEPTION 'SEC-P3E-1-POST-001: post_shares must have exactly one permissive SELECT policy' USING ERRCODE = 'raise_exception';
  END IF;
  SELECT qual INTO _q FROM pg_policies WHERE schemaname = 'public' AND tablename = 'post_shares'
     AND policyname = 'Users can view shares on visible posts';
  -- every auth.uid() wrapped as (SELECT auth.uid()): the two counts must match.
  IF _q IS NULL OR _q = 'true' OR _q !~ 'can_view_post'
     OR (length(_q) - length(replace(_q, 'auth.uid()', ''))) / 10
        <> (length(_q) - length(replace(_q, 'SELECT auth.uid()', ''))) / 17 THEN
    RAISE EXCEPTION 'SEC-P3E-1-POST-002: the new SELECT policy is not the scoped expression' USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'SEC-P3E-1 (20261031_0300): post_shares SELECT = own shares OR shares of posts the viewer can see (one permissive policy)';
END
$postconditions$;

COMMIT;
