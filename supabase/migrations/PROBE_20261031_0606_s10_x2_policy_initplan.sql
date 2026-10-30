-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261031_0606 — S10 X2 (staging and production).
-- READ ONLY, ROLLBACK. Prints counts and policy NAMES only (public log).
-- FAILS before 0606 (the 32 policies call auth.uid() / auth.role() bare, so
-- Postgres re-evaluates them per row); PASSES after.
-- Both lanes have the same 32 policies on the same 16 tables (PROBE 0605,
-- staging 41069834234 / production 41072016755), so one fixture shape
-- covers both; the probe still counts per lane.
--
--   G0 · lane asserted.
--   G1 · all 32 listed policies exist.
--   G2 · none of the 32 calls auth.uid/role/jwt/email outside a sub-SELECT.
--   G3 · lane-wide: no public policy does (X2 = 0), so nothing was missed.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;

DO $probe$
DECLARE
  targets constant text[] := ARRAY[
    'ad_creative_comments|Members comment as themselves',
    'ad_creative_comments|Members edit their own ad comment',
    'ad_creative_comments|Members or admins delete an ad comment',
    'ad_creative_reactions|Members change their own ad reaction',
    'ad_creative_reactions|Members react as themselves',
    'ad_creative_reactions|Members remove their own ad reaction',
    'ad_creative_shares|Members remove their own ad share',
    'ad_creative_shares|Members share as themselves',
    'ad_creatives|ad_creatives_admin_all',
    'categories|Admins manage categories',
    'media_objects|media_objects_insert_own',
    'media_objects|media_objects_select',
    'ops_alarm_settings|admins read ops_alarm_settings',
    'ops_alarms|admins read ops_alarms',
    'ops_probe_requests|admins read ops_probe_requests',
    'post_drafts|pd_delete_own',
    'post_drafts|pd_insert_own',
    'post_drafts|pd_select_own',
    'post_drafts|pd_update_own',
    'post_media|post_media_delete_own',
    'post_media|post_media_select',
    'post_media|post_media_write_own',
    'post_tags|Members create tags as themselves',
    'push_config|service role manages push config',
    'push_tokens|delete own push tokens',
    'push_tokens|read own push tokens',
    'search_recents|Own recents delete',
    'search_recents|Own recents read',
    'search_recents|Own recents update',
    'search_recents|Own recents write',
    'story_views|Users insert own story views',
    'story_views|Users read own story views'
  ];
  wrapped_re constant text := '\(\s*SELECT\s+auth\.(uid|role|jwt|email)\(\)\s+AS\s+\w+\s*\)';
  bare_re    constant text := 'auth\.(uid|role|jwt|email)\(\)';
  _bad text := '';
  n_found int; n_bare int; n_lane int; bare_names text;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not staging or production';
  END IF;

  WITH pol AS (
    SELECT tablename || '|' || policyname AS k,
           coalesce(qual, '') || ' ' || coalesce(with_check, '') AS t
      FROM pg_policies WHERE schemaname = 'public'
  )
  SELECT count(*) FILTER (WHERE k = ANY (targets)),
         count(*) FILTER (WHERE k = ANY (targets) AND regexp_replace(t, wrapped_re, '', 'gi') ~* bare_re),
         count(*) FILTER (WHERE regexp_replace(t, wrapped_re, '', 'gi') ~* bare_re),
         string_agg(k, ', ' ORDER BY k) FILTER (WHERE regexp_replace(t, wrapped_re, '', 'gi') ~* bare_re)
    INTO n_found, n_bare, n_lane, bare_names
    FROM pol;

  IF n_found <> 32 THEN _bad := _bad || format(' G1(%s of 32 listed policies found)', n_found); END IF;
  IF n_bare <> 0 THEN _bad := _bad || format(' G2(%s of the 32 still call auth.* per row)', n_bare); END IF;
  IF n_lane <> 0 THEN _bad := _bad || format(' G3(%s public policies call auth.* per row: %s)', n_lane, bare_names); END IF;

  IF _bad <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL 20261031_0606 (lane %):%', current_setting('p32.lane'), _bad;
  END IF;
  RAISE NOTICE 'PROBE PASS 20261031_0606 (lane %): 32/32 policies evaluate auth calls once per query; 0 public policies call them per row',
    current_setting('p32.lane');
END
$probe$;

ROLLBACK;
