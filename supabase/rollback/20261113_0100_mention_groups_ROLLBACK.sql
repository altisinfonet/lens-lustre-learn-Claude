-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261113_0100 @all / @followers. Removes the clock, the triggers,
-- the functions, the jobs table, the two switches (audited), the two
-- notification types, the member switches and the reserved-handle rule, and
-- puts notif_action_phrase back to the body it had before (PROBE 0090,
-- staging 2026-11-12). Mentions already in members' bells stay — they are
-- ordinary notification rows; "@all" already written in a post stays as text.
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

DO $pre$
BEGIN
  IF to_regclass('public.mention_group_jobs') IS NULL
     OR to_regprocedure('public.is_verified_member(uuid)') IS NULL THEN
    RAISE EXCEPTION 'MG-0100-RB-PRE-001: 20261113_0100 is not applied on this lane — nothing to roll back';
  END IF;
END
$pre$;

SELECT cron.unschedule('mention-groups-tick') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mention-groups-tick');

DROP TRIGGER trg_mention_groups_post ON public.posts;
DROP TRIGGER trg_mention_groups_comment ON public.post_comments;
DROP FUNCTION public.tg_mention_groups_post();
DROP FUNCTION public.tg_mention_groups_comment();
DROP FUNCTION public.mention_groups_me();
DROP FUNCTION public.mention_groups_tick(integer);
DROP FUNCTION public.mention_group_enqueue(text, uuid, uuid, uuid);
DROP FUNCTION public.mention_group_refusal(text, uuid, uuid, uuid);
DROP FUNCTION public.mention_group_daily_limit(text);
DROP FUNCTION public.mention_groups_day_start();
DROP TABLE public.mention_group_jobs;
DROP FUNCTION public.is_verified_member(uuid);

DELETE FROM public.notification_types WHERE type IN ('mention_all', 'mention_followers');

ALTER TABLE public.notification_preferences
  DROP COLUMN inapp_mentions_everyone,
  DROP COLUMN push_mentions_everyone;

ALTER TABLE public.profiles DROP CONSTRAINT profiles_custom_url_not_group_tag;

-- the switches (their member lists go with them: FK cascade is not assumed)
LOCK TABLE public.feature_access IN ACCESS EXCLUSIVE MODE;
DELETE FROM public.feature_access_members WHERE feature IN ('mention_groups', 'mention_all_blocked');
WITH del AS (
  DELETE FROM public.feature_access WHERE feature IN ('mention_groups', 'mention_all_blocked') RETURNING feature, mode
)
INSERT INTO public.feature_access_audit (actor, feature, action, old_value, new_value, note)
SELECT NULL, del.feature, 'mode', del.mode, NULL, '20261113_0100 ROLLBACK: switch removed'
  FROM del;

DO $switch$
DECLARE _def text; _keys text[];
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO _def FROM pg_constraint c
   WHERE c.conrelid = 'public.feature_access'::regclass AND c.conname = 'feature_access_feature_check';
  IF _def IS NULL OR _def !~ '^CHECK \(\(feature = ANY \(ARRAY\[''[a-z0-9_]+''::text(, ''[a-z0-9_]+''::text)*\]\)\)\)$' THEN
    RAISE EXCEPTION 'MG-0100-RB-PRE-002: feature_access_feature_check is not a plain key list (read: %)', coalesce(_def, '<none>');
  END IF;
  SELECT array_agg(t.m[1] ORDER BY t.i) INTO _keys
    FROM regexp_matches(_def, '''([a-z0-9_]+)''::text', 'g') WITH ORDINALITY AS t(m, i)
   WHERE t.m[1] NOT IN ('mention_groups', 'mention_all_blocked');
  EXECUTE format(
    'ALTER TABLE public.feature_access DROP CONSTRAINT feature_access_feature_check, '
    'ADD CONSTRAINT feature_access_feature_check CHECK (feature IN (%s))',
    (SELECT string_agg(quote_literal(k), ', ' ORDER BY i) FROM unnest(_keys) WITH ORDINALITY AS u(k, i)));
END
$switch$;

-- wording back to the body before 0100
CREATE OR REPLACE FUNCTION public.notif_action_phrase(_type text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $fn$
  SELECT CASE _type
           WHEN 'new_post_from_following' THEN 'shared a photo.'
           WHEN 'post_reaction'           THEN 'reacted to your photo.'
           WHEN 'image_reaction'          THEN 'reacted to your photo.'
           WHEN 'post_comment'            THEN 'commented on your photo.'
           WHEN 'image_comment'           THEN 'commented on your photo.'
           WHEN 'comment_reply'           THEN 'replied to your comment.'
           WHEN 'new_follower'            THEN 'started following you.'
           WHEN 'friend_request'          THEN 'sent you a friend request.'
           WHEN 'friend_accepted'         THEN 'accepted your friend request.'
           WHEN 'post_tag'                THEN 'tagged you in a photo.'
           WHEN 'tagged_post_reaction'    THEN 'reacted to a photo you are tagged in.'
           WHEN 'tagged_post_comment'     THEN 'commented on a photo you are tagged in.'
           WHEN 'ad_comment_reply'        THEN 'replied to your comment on a sponsored post.'
           WHEN 'story_comment'           THEN 'commented on your story.'
           ELSE NULL
         END;
$fn$;
GRANT EXECUTE ON FUNCTION public.notif_action_phrase(text) TO anon, authenticated, service_role;   -- wording only, as before

COMMIT;
