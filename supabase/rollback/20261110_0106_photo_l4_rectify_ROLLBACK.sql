-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261110_0106 — drop the rectify writer's functions and tables.
-- REFUSES while any post is repointed (roll 20261110_0107 back first), so no
-- before-state is ever lost. No post and no file is touched. The `-l5` copies
-- the writer stored stay in the bucket (never named by a post after 0107's
-- rollback; delete only through the held delete path).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'ROLLBACK REFUSED — p32.lane is not asserted';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $rb$
BEGIN
  IF to_regclass('public.photo_l4_rectify_swap') IS NULL THEN
    RAISE EXCEPTION 'RX-0106-RB-PRE-001: 20261110_0106 is not applied on this lane — nothing to roll back';
  END IF;
  IF EXISTS (SELECT 1 FROM public.photo_l4_rectify_swap) THEN
    RAISE EXCEPTION 'RX-0106-RB-PRE-002: posts are repointed — run 20261110_0107_photo_l4_repoint_ROLLBACK.sql first';
  END IF;
END
$rb$;

DROP FUNCTION public.photo_l4_rectify_record(uuid, integer, text);
DROP FUNCTION public.photo_l4_rectify_target(uuid, integer);
DROP FUNCTION public.photo_l4_rectify_queue();
DROP FUNCTION public.photo_l4_rectify_source_key(text);
DROP TABLE public.photo_l4_rectify_swap;
DROP TABLE public.photo_l4_rectify;

DO $done$ BEGIN RAISE NOTICE 'RX-0106 rolled back on %', current_setting('p32.lane'); END $done$;

COMMIT;
