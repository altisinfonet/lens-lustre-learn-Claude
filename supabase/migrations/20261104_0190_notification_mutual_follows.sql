-- ═══════════════════════════════════════════════════════════════════════════
-- 20261104_0190 · NOTIFICATION CENTRE N7 — "also follows N people you know".
--
-- For each new follower shown on /notifications (centre rows, behind
-- notif_centre_ui, OFF on live): how many of the accounts the signed-in member
-- follows that new follower also follows. One call for the whole page.
--
-- SECURITY INVOKER: it runs with the caller's own rights, under the existing
-- RLS on public.follows ("Anyone can view follows"), so it can reveal nothing a
-- member could not already read. At most 50 actors per call. Read-only.
--
-- Rollback: supabase/rollback/20261104_0190_notification_mutual_follows_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261104_0190_notification_mutual_follows.sql
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane reads %. Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  IF to_regclass('public.follows') IS NULL THEN
    RAISE EXCEPTION 'NC-0190-PRE-001: public.follows missing';
  END IF;
  IF to_regprocedure('public.notif_mutual_follow_counts(uuid[])') IS NOT NULL THEN
    RAISE EXCEPTION 'NC-0190-PRE-002: already applied — roll back first';
  END IF;
END
$pre$;

CREATE FUNCTION public.notif_mutual_follow_counts(_actors uuid[])
RETURNS TABLE (actor_id uuid, mutual integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $fn$
  SELECT a.actor, count(theirs.following_id)::integer
    FROM (SELECT DISTINCT u FROM unnest((coalesce(_actors, '{}'::uuid[]))[1:50]) AS u) AS a(actor)   -- a repeated id must not double the count
    LEFT JOIN public.follows theirs
      ON theirs.follower_id = a.actor
     AND EXISTS (SELECT 1 FROM public.follows mine
                  WHERE mine.follower_id = auth.uid() AND mine.following_id = theirs.following_id)
   WHERE auth.uid() IS NOT NULL
   GROUP BY a.actor;
$fn$;

REVOKE ALL ON FUNCTION public.notif_mutual_follow_counts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notif_mutual_follow_counts(uuid[]) TO authenticated;

COMMIT;
