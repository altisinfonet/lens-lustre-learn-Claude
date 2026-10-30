-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · foundation fix unit 1 · 0200 · read the DEFINITIONS of live-only
-- database objects so they can be captured into git exactly. READ ONLY, ROLLBACK.
--
-- Objects: the ones the foundation audit (PR #622, PROBE 0901) found live but
-- created by no migration — minus judging objects (Owner: "judging — later").
--
-- Prints DEFINITIONS ONLY (function source, trigger/policy/table DDL, cron
-- schedule + command). Never row data. The repository is public, so every
-- definition is screened first: any text that looks like a credential
-- (JWT, bearer token, sk_ key, long opaque token, password literal) is NOT
-- printed — only its md5 and length, marked SECRET_SUSPECT.
-- Definitions are printed base64-encoded in 900-char chunks so the bytes in git
-- can be made identical to the bytes live (log lines lose trailing spaces).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
SET LOCAL statement_timeout = '60s';

DO $g$ BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
END $g$;

\pset pager off
\pset format unaligned
\pset tuples_only on
\pset fieldsep '|'

SELECT 'CAP0200_LANE', current_setting('p32.lane'), now(), version();

-- ── function metadata: owner, ACL, comment hash (not source) ───────────────
SELECT 'FNMETA', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
       pg_get_userbyid(p.proowner), coalesce(p.proacl::text, '<default>'),
       coalesce(md5(obj_description(p.oid, 'pg_proc')), '<none>')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = ANY (ARRAY[
   '_field_visible','_flag_review_keyword_hit','admin_list_certificates',
   'admin_search_certificate_recipients','admin_search_users_v2','app_has_role',
   'auto_follow_official','cleanup_certificate_references','competition_total_entries',
   'enforce_comment_blocklist','enqueue_post_created_job','enqueue_post_job',
   'expire_gift_credit','filter_moderated_user_ids','flag_image_comment_for_review',
   'flag_post_comment_for_review','flag_post_for_review','get_course_lessons_for_editor',
   'get_lesson_content','get_my_certificate_entries','get_profile_visible_fields',
   'guard_profile_moderation_columns','html_escape','increment_managed_page_view',
   'issue_course_completion_certificate','maintain_competition_entry_counts',
   'password_verification_hook','pj_handle_recount_engagement','pj_handle_tag_notification',
   'prevent_unfollow_official','process_post_jobs','purge_cron_run_details',
   'touch_office_staff_updated','verify_staff_id'])
 ORDER BY 2;

-- table row ESTIMATE only (a number, never data): tells whether a table is used
SELECT 'TBLEST', c.relname, c.reltuples::bigint
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relname = ANY (ARRAY[
   'auth_login_attempts','competition_entry_counts','office_staff','posts_dead_host_backup_20260812'])
 ORDER BY 2;

WITH cap(kind, key, body) AS (
  SELECT 'FN', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', pg_get_functiondef(p.oid)
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = ANY (ARRAY[
     '_field_visible','_flag_review_keyword_hit','admin_list_certificates',
     'admin_search_certificate_recipients','admin_search_users_v2','app_has_role',
     'auto_follow_official','cleanup_certificate_references','competition_total_entries',
     'enforce_comment_blocklist','enqueue_post_created_job','enqueue_post_job',
     'expire_gift_credit','filter_moderated_user_ids','flag_image_comment_for_review',
     'flag_post_comment_for_review','flag_post_for_review','get_course_lessons_for_editor',
     'get_lesson_content','get_my_certificate_entries','get_profile_visible_fields',
     'guard_profile_moderation_columns','html_escape','increment_managed_page_view',
     'issue_course_completion_certificate','maintain_competition_entry_counts',
     'password_verification_hook','pj_handle_recount_engagement','pj_handle_tag_notification',
     'prevent_unfollow_official','process_post_jobs','purge_cron_run_details',
     'touch_office_staff_updated','verify_staff_id'])
  UNION ALL
  SELECT 'TRG', c.relname || '.' || t.tgname, pg_get_triggerdef(t.oid) || ' /*tgenabled=' || t.tgenabled::text || '*/'
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE NOT t.tgisinternal AND n.nspname = 'public' AND t.tgname = ANY (ARRAY[
     'trg_cleanup_certificate_references','trg_enforce_comment_blocklist',
     'trg_competition_entry_counts','trg_prevent_unfollow_official','trg_flag_image_comment_review',
     'trg_office_staff_touch','trg_flag_post_comment_review','trg_enqueue_post_created',
     'trg_flag_post_review','trg_auto_follow_official','trg_guard_profile_moderation'])
  UNION ALL
  SELECT 'POL', tablename || '.' || policyname,
         'permissive=' || permissive || E'\ncmd=' || cmd || E'\nroles=' || array_to_string(roles, ',')
         || E'\nusing=' || coalesce(qual, '<null>') || E'\ncheck=' || coalesce(with_check, '<null>')
    FROM pg_policies
   WHERE schemaname = 'public' AND (tablename::text, policyname::text) IN (
     ('auth_login_attempts', 'auth admin manages login attempts'),
     ('certificates', 'Users can insert own competition certificates'),
     ('competition_entry_counts', 'cec_read_authenticated'),
     ('office_staff', 'admins manage office_staff'))
  UNION ALL
  SELECT 'TBL', c.relname,
         'owner=' || pg_get_userbyid(c.relowner) || E'\nrls=' || c.relrowsecurity || E'\nforce_rls=' || c.relforcerowsecurity
         || E'\nacl=' || coalesce(c.relacl::text, '<default>') || E'\n'
         || coalesce((SELECT string_agg('col ' || a.attnum || ' ' || quote_ident(a.attname) || ' ' || format_type(a.atttypid, a.atttypmod)
                               || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
                               || coalesce(' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid), '')
                               || CASE WHEN a.attidentity <> '' THEN ' IDENTITY ' || a.attidentity::text ELSE '' END
                               || CASE WHEN a.attgenerated <> '' THEN ' GENERATED ' || a.attgenerated::text ELSE '' END,
                               E'\n' ORDER BY a.attnum)
               FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
              WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped), '') || E'\n'
         || coalesce((SELECT string_agg('con ' || quote_ident(conname) || ' ' || pg_get_constraintdef(oid), E'\n' ORDER BY conname)
                        FROM pg_constraint WHERE conrelid = c.oid), '') || E'\n'
         || coalesce((SELECT string_agg('idx ' || pg_get_indexdef(indexrelid), E'\n' ORDER BY indexrelid::regclass::text)
                        FROM pg_index WHERE indrelid = c.oid), '')
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = ANY (ARRAY[
     'auth_login_attempts','competition_entry_counts','office_staff','posts_dead_host_backup_20260812'])
  UNION ALL
  SELECT 'CRON', jobname,
         'schedule=' || schedule || E'\nactive=' || active || E'\ndatabase=' || database
         || E'\nusername=' || username || E'\ncommand=' || command
    FROM cron.job
   WHERE jobname = ANY (ARRAY['apply-scheduled-boosts','expire-gift-credits',
         'autoscale-ad-traffic','backup-reminder','send-reengagement-emails','process-email-queue'])
), scr AS (
  SELECT kind, key, body, md5(body) AS h, length(body) AS len,
         (body ~ 'eyJ[A-Za-z0-9_-]{10,}'
          OR body ~* 'bearer\s+[A-Za-z0-9._~+/=-]{20,}'
          OR body ~ 'sk_(live|test)_[A-Za-z0-9]'
          OR body ~ '[A-Za-z0-9+/_=-]{48,}'
          OR body ~* 'password[''"]?\s*[:=]\s*''[^'']{4,}'''
          OR body ~ 'sb_(secret|publishable)_[A-Za-z0-9_-]'
          OR body ~ '(rk|pk)_(live|test)_|whsec_|\mre_[A-Za-z0-9]{8,}'
          OR body ~ '[0-9a-fA-F]{32,}'
          OR body ~ '\$2[aby]\$[0-9]{2}\$'
          OR body ~* '(api[_-]?key|authorization|secret|token|service[_-]?role)[''"]?\s*[,:=]>?\s*''[^'']{8,}''') AS secret_suspect,
         replace(encode(convert_to(body, 'UTF8'), 'base64'), E'\n', '') AS b64
    FROM cap
)
SELECT 'OBJ', kind, key, h, len, CASE WHEN secret_suspect THEN 'SECRET_SUSPECT' ELSE 'clean' END, NULL::int, NULL::text
  FROM scr
UNION ALL
SELECT 'B64', kind, key, NULL, NULL, NULL, i, substr(b64, (i - 1) * 900 + 1, 900)
  FROM scr, generate_series(1, ceil(length(b64) / 900.0)::int) i
 WHERE NOT secret_suspect
ORDER BY 1 DESC, 2, 3, 7;

SELECT 'CAP0200_DONE', now();
ROLLBACK;
