-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261031_0606 — S10 X2.
-- Puts the 32 policies back to calling auth.uid() / auth.role() bare (once
-- per row). Every wrapped auth call in these 32 policies is unwrapped; where a
-- policy already had a wrapped call before 0606 it comes back bare too, which
-- is the same value (auth.* are STABLE and read only the request's JWT), so
-- WHO SEES WHAT DOES NOT CHANGE in either direction. E1 (text equivalence with
-- wrappers removed) and the policy-shape check are re-proved here.
-- Refuses unless 0606 is applied (no listed policy has a bare call).
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
SET LOCAL search_path = '';

DO $x2_rb$
DECLARE
  targets constant text[][] := ARRAY[
    ['ad_creative_comments',  'Members comment as themselves'],
    ['ad_creative_comments',  'Members edit their own ad comment'],
    ['ad_creative_comments',  'Members or admins delete an ad comment'],
    ['ad_creative_reactions', 'Members change their own ad reaction'],
    ['ad_creative_reactions', 'Members react as themselves'],
    ['ad_creative_reactions', 'Members remove their own ad reaction'],
    ['ad_creative_shares',    'Members remove their own ad share'],
    ['ad_creative_shares',    'Members share as themselves'],
    ['ad_creatives',          'ad_creatives_admin_all'],
    ['categories',            'Admins manage categories'],
    ['media_objects',         'media_objects_insert_own'],
    ['media_objects',         'media_objects_select'],
    ['ops_alarm_settings',    'admins read ops_alarm_settings'],
    ['ops_alarms',            'admins read ops_alarms'],
    ['ops_probe_requests',    'admins read ops_probe_requests'],
    ['post_drafts',           'pd_delete_own'],
    ['post_drafts',           'pd_insert_own'],
    ['post_drafts',           'pd_select_own'],
    ['post_drafts',           'pd_update_own'],
    ['post_media',            'post_media_delete_own'],
    ['post_media',            'post_media_select'],
    ['post_media',            'post_media_write_own'],
    ['post_tags',             'Members create tags as themselves'],
    ['push_config',           'service role manages push config'],
    ['push_tokens',           'delete own push tokens'],
    ['push_tokens',           'read own push tokens'],
    ['search_recents',        'Own recents delete'],
    ['search_recents',        'Own recents read'],
    ['search_recents',        'Own recents update'],
    ['search_recents',        'Own recents write'],
    ['story_views',           'Users insert own story views'],
    ['story_views',           'Users read own story views']
  ];

  wrapped_re constant text := '\(\s*SELECT\s+auth\.(uid|role|jwt|email)\(\)\s+AS\s+\w+\s*\)';
  bare_re    constant text := 'auth\.(uid|role|jwt|email)\(\)';
  i int; tbl text; pol text; rel oid;
  old_q text; old_w text; new_q text; new_w text;
  shape_before jsonb; shape_after jsonb;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'S10-X2-RB-PRE-001: running as %, not postgres', current_user;
  END IF;
  FOR i IN 1 .. array_length(targets, 1) LOOP
    tbl := targets[i][1]; pol := targets[i][2];
    rel := to_regclass(format('public.%I', tbl));
    SELECT pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)
      INTO old_q, old_w FROM pg_policy p WHERE p.polrelid = rel AND p.polname = pol;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'S10-X2-RB-PRE-002: policy "%" on public.% is missing', pol, tbl;
    END IF;
    IF regexp_replace(coalesce(old_q, '') || ' ' || coalesce(old_w, ''), wrapped_re, '', 'gi') ~* bare_re THEN
      RAISE EXCEPTION 'S10-X2-RB-PRE-003: policy "%" on public.% already has a bare auth call — 0606 is not applied', pol, tbl;
    END IF;
  END LOOP;

  SELECT jsonb_object_agg(c.relname || '|' || p.polname, jsonb_build_array(p.polcmd::text, p.polpermissive, p.polroles::text))
    INTO shape_before FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
   WHERE c.relnamespace = 'public'::regnamespace;

  FOR i IN 1 .. array_length(targets, 1) LOOP
    tbl := targets[i][1]; pol := targets[i][2];
    rel := to_regclass(format('public.%I', tbl));
    SELECT pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)
      INTO old_q, old_w FROM pg_policy p WHERE p.polrelid = rel AND p.polname = pol;
    new_q := regexp_replace(old_q, wrapped_re, 'auth.\1()', 'gi');
    new_w := regexp_replace(old_w, wrapped_re, 'auth.\1()', 'gi');
    EXECUTE format('ALTER POLICY %I ON public.%I', pol, tbl)
         || CASE WHEN new_q IS NOT NULL THEN format(' USING (%s)', new_q) ELSE '' END
         || CASE WHEN new_w IS NOT NULL THEN format(' WITH CHECK (%s)', new_w) ELSE '' END;
    SELECT pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)
      INTO new_q, new_w FROM pg_policy p WHERE p.polrelid = rel AND p.polname = pol;
    IF coalesce(new_q, '') IS DISTINCT FROM regexp_replace(coalesce(old_q, ''), wrapped_re, 'auth.\1()', 'gi')
       OR coalesce(new_w, '') IS DISTINCT FROM regexp_replace(coalesce(old_w, ''), wrapped_re, 'auth.\1()', 'gi') THEN
      RAISE EXCEPTION 'S10-X2-RB-E1: policy "%" on public.% is not the same expression after the rollback', pol, tbl;
    END IF;
  END LOOP;

  SELECT jsonb_object_agg(c.relname || '|' || p.polname, jsonb_build_array(p.polcmd::text, p.polpermissive, p.polroles::text))
    INTO shape_after FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
   WHERE c.relnamespace = 'public'::regnamespace;
  IF shape_after IS DISTINCT FROM shape_before THEN
    RAISE EXCEPTION 'S10-X2-RB-POST-001: a policy''s roles, command or kind changed, or a policy was added/removed';
  END IF;
  RAISE NOTICE 'S10 X2 rolled back (lane %): 32 policies call auth.* bare again; expressions otherwise identical', current_setting('p32.lane');
END
$x2_rb$;

COMMIT;
