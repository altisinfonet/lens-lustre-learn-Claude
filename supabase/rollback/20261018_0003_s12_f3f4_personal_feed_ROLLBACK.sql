-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261018_0003 — S12-F3 + F4 Personal feed
-- Lanes: staging and production (refuses any other lane).
--
-- Pre-state restored:
--   * public.get_personal_feed(uuid[], integer, integer, text[], text) dropped;
--   * the 14 mix / rank keys removed from public.feed_score_config;
--   * the 'personal_feed' switch removed from public.feature_access (its member
--     list goes with it, FK cascade) and feature_access_feature_check put back
--     to VID-7's three features.
-- KEPT: feature_access_audit rows for 'personal_feed' — the audit trail is
-- append-only by design (VID-7) and is a record, never deleted blind.
--
-- CLIENT IMPACT: a bundle that knows the switch keeps working —
-- feature_allowed_me('personal_feed') answers false for an unknown feature, so
-- every member is served by get_broadcast_feed again (the client falls back on
-- any error from get_personal_feed too). Admin → Personal Feed shows no card.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $rb_pre$
BEGIN
  -- RB-PRE-001 · the migration is applied (exact signature).
  IF to_regprocedure('public.get_personal_feed(uuid[],integer,integer,text[],text)') IS NULL THEN
    RAISE EXCEPTION 'S12F34-0003-RB-PRE-001: get_personal_feed(uuid[],integer,integer,text[],text) does not exist — nothing to roll back'
      USING ERRCODE = 'raise_exception';
  END IF;
END
$rb_pre$;

DROP FUNCTION public.get_personal_feed(uuid[], integer, integer, text[], text);

DELETE FROM public.feed_score_config WHERE key IN (
  'mix_circle', 'mix_suggested', 'mix_fair', 'rank_w_closeness', 'rank_w_category', 'rank_w_chosen',
  'rank_w_quality', 'rank_quality_norm', 'rank_w_freshness', 'rank_fresh_hours', 'rank_w_seen',
  'rank_seen_hours', 'rank_w_jitter', 'cold_history_min');

DELETE FROM public.feature_access WHERE feature = 'personal_feed';
ALTER TABLE public.feature_access DROP CONSTRAINT feature_access_feature_check;
ALTER TABLE public.feature_access ADD CONSTRAINT feature_access_feature_check
  CHECK (feature IN ('video_posts', 'video_ads', 'copyright_music_check'));

DO $rb_post$
DECLARE
  _bad text := '';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'get_personal_feed') THEN
    _bad := _bad || E'\n  get_personal_feed still exists';
  END IF;
  IF EXISTS (SELECT 1 FROM public.feed_score_config WHERE key LIKE 'mix\_%' OR key LIKE 'rank\_%' OR key = 'cold_history_min') THEN
    _bad := _bad || E'\n  a mix/rank key is still in feed_score_config';
  END IF;
  IF EXISTS (SELECT 1 FROM public.feature_access WHERE feature = 'personal_feed')
     OR EXISTS (SELECT 1 FROM public.feature_access_members WHERE feature = 'personal_feed') THEN
    _bad := _bad || E'\n  the personal_feed switch is still there';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.feature_access'::regclass AND conname = 'feature_access_feature_check'
                    AND pg_get_constraintdef(oid) = 'CHECK ((feature = ANY (ARRAY[''video_posts''::text, ''video_ads''::text, ''copyright_music_check''::text])))') THEN
    _bad := _bad || E'\n  feature_access_feature_check is not VID-7''s three-feature CHECK';
  END IF;
  IF _bad <> '' THEN
    RAISE EXCEPTION 'S12F34-0003-RB-POST: rollback incomplete:%', _bad USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'S12F34-0003 ROLLBACK: get_personal_feed dropped; 14 config keys removed; personal_feed switch removed (audit rows kept); CHECK back to three features';
END
$rb_post$;

COMMIT;
