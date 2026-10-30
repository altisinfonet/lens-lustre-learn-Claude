-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · security audit 0901 · catalog. READ ONLY, ROLLBACK. Changes nothing.
--
-- Prints SCHEMA ONLY: policy text, grants, trigger/function names, function
-- bodies (redacted), constraint/index definitions, and COUNTS. It never
-- selects a row of member data. Every printed text passes through the same
-- redaction: JWT-shaped strings, sb_secret/sb_publishable keys, long
-- base64/hex runs (>=32 chars), e-mail addresses and UUID literals are
-- replaced by <…REDACTED> tokens, so a hard-coded key, address or user id
-- inside a function or policy cannot reach this (public) log.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
SET LOCAL statement_timeout = '120s';

DO $g$ BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
END $g$;

\pset pager off
\pset format unaligned
\pset fieldsep '|'
\pset footer off

SELECT 'SEC0901_LANE', current_setting('p32.lane'), now();

-- Redaction is written inline (a READ ONLY transaction cannot create a helper).
-- R(x) := collapse whitespace, then strip JWTs, sb_ keys, long runs, e-mails, UUIDs.
\set R1 'regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace('
\set R2 ', ''\\s+'', '' '', ''g''), ''eyJ[A-Za-z0-9_-]{8,}(\\.[A-Za-z0-9_-]+)*'', ''<JWT-REDACTED>'', ''g''), ''sb_(secret|publishable)_[A-Za-z0-9_-]+'', ''<KEY-REDACTED>'', ''g''), ''[A-Za-z0-9+/=]{32,}'', ''<LONG-REDACTED>'', ''g''), ''[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}'', ''<EMAIL-REDACTED>'', ''g''), ''[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'', ''<UUID-REDACTED>'', ''g'')'

-- ── A. every policy in public / storage / realtime ──────────────────────────
SELECT 'POL', schemaname, tablename, policyname, permissive, cmd,
       array_to_string(roles, ','),
       :R1 coalesce(qual, '-') :R2,
       :R1 coalesce(with_check, '-') :R2
  FROM pg_policies
 WHERE schemaname IN ('public', 'storage', 'realtime')
 ORDER BY 2, 3, 6, 4;

-- ── B. table / view grants + RLS flags ──────────────────────────────────────
SELECT 'TBL', c.relname, c.relkind, c.relrowsecurity rls, c.relforcerowsecurity forced,
       concat_ws('', CASE WHEN has_table_privilege('anon', c.oid, 'SELECT') THEN 'S' END,
                     CASE WHEN has_table_privilege('anon', c.oid, 'INSERT') THEN 'I' END,
                     CASE WHEN has_table_privilege('anon', c.oid, 'UPDATE') THEN 'U' END,
                     CASE WHEN has_table_privilege('anon', c.oid, 'DELETE') THEN 'D' END) anon,
       concat_ws('', CASE WHEN has_table_privilege('authenticated', c.oid, 'SELECT') THEN 'S' END,
                     CASE WHEN has_table_privilege('authenticated', c.oid, 'INSERT') THEN 'I' END,
                     CASE WHEN has_table_privilege('authenticated', c.oid, 'UPDATE') THEN 'U' END,
                     CASE WHEN has_table_privilege('authenticated', c.oid, 'DELETE') THEN 'D' END) authd,
       (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) npol,
       coalesce(array_to_string(c.reloptions, ','), '-') opts
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
 ORDER BY 2;

-- column-level privileges that differ from the table-level grant (revoked
-- columns, or column-only grants)
SELECT 'COLPRIV', c.relname, a.attname,
       has_column_privilege('anon', c.oid, a.attnum, 'SELECT') anon_s,
       has_column_privilege('authenticated', c.oid, a.attnum, 'SELECT') auth_s,
       has_column_privilege('authenticated', c.oid, a.attnum, 'UPDATE') auth_u,
       has_column_privilege('authenticated', c.oid, a.attnum, 'INSERT') auth_i
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v')
   AND (has_column_privilege('anon', c.oid, a.attnum, 'SELECT') <> has_table_privilege('anon', c.oid, 'SELECT')
     OR has_column_privilege('authenticated', c.oid, a.attnum, 'SELECT') <> has_table_privilege('authenticated', c.oid, 'SELECT')
     OR has_column_privilege('authenticated', c.oid, a.attnum, 'UPDATE') <> has_table_privilege('authenticated', c.oid, 'UPDATE')
     OR has_column_privilege('authenticated', c.oid, a.attnum, 'INSERT') <> has_table_privilege('authenticated', c.oid, 'INSERT'))
 ORDER BY 2, 3;

-- privilege-shaped columns a member could UPDATE (column privilege, before RLS)
SELECT 'PRIVCOL', c.relname, a.attname, format_type(a.atttypid, a.atttypmod),
       has_column_privilege('authenticated', c.oid, a.attnum, 'UPDATE') auth_u,
       has_column_privilege('authenticated', c.oid, a.attnum, 'INSERT') auth_i
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
   AND a.attname ~* '(role|admin|verified|badge|balance|points|credit|wallet|banned|suspend|premium|coins|^xp$|level|rank|score|is_staff|is_judge|moderat|trust|tier|plan|amount|status)'
   AND (has_column_privilege('authenticated', c.oid, a.attnum, 'UPDATE')
     OR has_column_privilege('authenticated', c.oid, a.attnum, 'INSERT'))
 ORDER BY 2, 3;

-- personal-data-shaped columns: who may SELECT them (column privilege, before RLS)
SELECT 'PIICOL', c.relname, c.relkind, a.attname,
       has_column_privilege('anon', c.oid, a.attnum, 'SELECT') anon_s,
       has_column_privilege('authenticated', c.oid, a.attnum, 'SELECT') auth_s
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
   AND a.attname ~* '(email|phone|mobile|birth|dob|national|aadhaar|aadhar|pan_|passport|id_number|address|ip_addr|^ip$|user_agent|password|secret|token|bank|ifsc|upi|account_no|gst|tax)'
 ORDER BY 2, 4;

-- ── C. triggers on public tables (guards on privilege columns live here) ────
SELECT 'TRG', c.relname, t.tgname, p.proname, p.prosecdef,
       CASE WHEN t.tgtype & 2 = 2 THEN 'BEFORE' WHEN t.tgtype & 64 = 64 THEN 'INSTEAD' ELSE 'AFTER' END,
       concat_ws(',', CASE WHEN t.tgtype & 4 = 4 THEN 'INS' END, CASE WHEN t.tgtype & 16 = 16 THEN 'UPD' END,
                      CASE WHEN t.tgtype & 8 = 8 THEN 'DEL' END, CASE WHEN t.tgtype & 32 = 32 THEN 'TRUNC' END),
       t.tgenabled
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_proc p ON p.oid = t.tgfoid
 WHERE n.nspname = 'public' AND NOT t.tgisinternal
 ORDER BY 2, 3;

-- ── D. every SECURITY DEFINER function in public (all, with features) ───────
WITH f AS (
  SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) args,
         pg_get_function_result(p.oid) ret, l.lanname lang,
         has_function_privilege('anon', p.oid, 'EXECUTE') anon_x,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_x,
         coalesce(array_to_string(p.proconfig, ','), '-') cfg,
         lower(p.prosrc) src,
         p.prorettype = 'trigger'::regtype is_trg,
         md5(p.prosrc) h
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
   WHERE n.nspname = 'public' AND p.prosecdef
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
)
SELECT 'FN', proname, args, ret, lang, anon_x, auth_x, is_trg, cfg,
       src ~ '(insert\s+into|update\s+[a-z_."]+\s+set|delete\s+from)' writes,
       src ~ 'auth\.uid\(\)' uses_uid,
       src ~ '(has_role|is_admin|app_has_role|is_staff|is_moderator|is_judge|user_roles)' role_chk,
       src ~ '(auth\.role\(\)|auth\.jwt\(\)|current_setting\(.request\.jwt)' jwt_chk,
       src ~ '(auth\.users|national|kyc|wallet|transaction|message|notification|support_ticket|login_attempt|block|withdraw|payment|email|phone)' sens,
       (SELECT string_agg(DISTINCT m[1], ',') FROM regexp_matches(src, '(?:insert\s+into|update|delete\s+from)\s+(?:only\s+)?(?:public\.)?([a-z_]+)', 'g') m
         WHERE m[1] NOT IN ('set', 'of', 'on', 'cascade')) wtables,
       length(src) len, left(h, 10) h10
  FROM f WHERE anon_x OR auth_x
 ORDER BY is_trg, anon_x DESC, proname;

-- bodies (redacted, capped) of the callable non-trigger SECURITY DEFINER
-- functions most likely to be dangerous: they write or touch sensitive data
-- AND carry no auth.uid()/role check at all; plus any that take a user-id
-- parameter and write.
WITH f AS (
  SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) args, lower(p.prosrc) src, p.prosrc raw,
         has_function_privilege('anon', p.oid, 'EXECUTE') anon_x,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_x
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosecdef AND p.prorettype <> 'trigger'::regtype
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
)
SELECT 'FNBODY', proname, args, anon_x, auth_x, left(:R1 raw :R2, 3000)
  FROM f
 WHERE (anon_x OR auth_x)
   AND (
     (NOT src ~ '(auth\.uid\(\)|auth\.role\(\)|auth\.jwt\(\)|has_role|is_admin|app_has_role|is_staff|user_roles|current_setting\(.request\.jwt)'
      AND (src ~ '(insert\s+into|update\s+[a-z_."]+\s+set|delete\s+from)'
        OR src ~ '(auth\.users|national|kyc|wallet|transaction|message|notification|support_ticket|login_attempt|withdraw|payment|email|phone)'))
     OR (args ~* '(user_id|_uid|target|recipient|member|owner)[a-z_]*\s+uuid'
         AND src ~ '(insert\s+into|update\s+[a-z_."]+\s+set|delete\s+from)')
   )
 ORDER BY anon_x DESC, proname;

-- named security-relevant objects (any schema), full redacted body
SELECT 'NAMED', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid), p.prosecdef,
       has_function_privilege('anon', p.oid, 'EXECUTE'), has_function_privilege('authenticated', p.oid, 'EXECUTE'),
       coalesce(array_to_string(p.proconfig, ','), '-'), left(:R1 p.prosrc :R2, 6000)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE p.proname IN ('verify_staff_id', 'password_verification_hook', 'filter_moderated_user_ids',
                     'get_profile_visible_fields', 'trg_enforce_comment_blocklist', 'has_role',
                     'custom_access_token_hook', 'handle_new_user', 'is_admin')
    OR p.proname ILIKE '%hook%'
 ORDER BY 2, 3;

-- all non-extension function names in public (to diff against git locally)
SELECT 'FNALL', p.proname, p.prosecdef, p.prorettype = 'trigger'::regtype, left(md5(p.prosrc), 10)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
 ORDER BY 2;

-- ── E. views: security_invoker flag + definition for definer views ─────────
SELECT 'VIEW', c.relname,
       coalesce(array_to_string(c.reloptions, ',') ~ 'security_invoker=(true|on)', false) invoker,
       has_table_privilege('anon', c.oid, 'SELECT') anon_s, has_table_privilege('authenticated', c.oid, 'SELECT') auth_s,
       CASE WHEN NOT coalesce(array_to_string(c.reloptions, ',') ~ 'security_invoker=(true|on)', false)
            THEN left(:R1 pg_get_viewdef(c.oid) :R2, 2500) ELSE '-' END
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
 ORDER BY 2;

-- ── F. realtime publication + storage ───────────────────────────────────────
SELECT 'PUB', pubname, schemaname, tablename FROM pg_publication_tables ORDER BY 1, 2, 3;
SELECT 'BUCKET', id, public, file_size_limit, coalesce(array_to_string(allowed_mime_types, ','), '-')
  FROM storage.buckets ORDER BY 2;

-- ── G. integrity: unique indexes + CHECKs on engagement / money tables ─────
SELECT 'UNIQ', c.relname, i.relname, :R1 pg_get_indexdef(i.oid) :R2
  FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid JOIN pg_class c ON c.oid = x.indrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND x.indisunique AND NOT x.indisprimary
   AND c.relname ~* '(like|reaction|follow|comment|vote|payment|transaction|wallet|credit|ledger|point|order|deposit|withdraw|gift|friend|block|entr|reward|idempot|boost)'
 ORDER BY 2, 3;
SELECT 'CHECK', c.relname, k.conname, :R1 pg_get_constraintdef(k.oid) :R2
  FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND k.contype = 'c'
   AND c.relname ~* '(payment|transaction|wallet|credit|ledger|point|deposit|withdraw|gift|reward|balance|boost)'
 ORDER BY 2, 3;

-- ── H. auth posture: COUNTS ONLY ────────────────────────────────────────────
SELECT 'ROLECOUNT', role::text, count(*) FROM public.user_roles GROUP BY 2 ORDER BY 2;
SELECT 'STAFF_MFA', ur.role::text, count(DISTINCT ur.user_id) staff,
       count(DISTINCT f.user_id) FILTER (WHERE f.status = 'verified') with_verified_mfa
  FROM public.user_roles ur LEFT JOIN auth.mfa_factors f ON f.user_id = ur.user_id
 WHERE ur.role::text IN ('admin', 'content_editor', 'judge')
 GROUP BY 2 ORDER BY 2;
SELECT 'AUTHUSERS', count(*) total, count(*) FILTER (WHERE email_confirmed_at IS NULL) unconfirmed FROM auth.users;
SELECT 'SESSIONS', count(*) total, count(*) FILTER (WHERE not_after IS NOT NULL) with_not_after,
       coalesce(max(extract(day FROM now() - created_at))::int, 0) oldest_days FROM auth.sessions;
-- rolconfig KEYS only for the API roles (values could hold secrets), except db_schemas
SELECT 'ROLECFG', r.rolname,
       (SELECT string_agg(CASE WHEN s LIKE 'pgrst.db_schemas=%' THEN s ELSE split_part(s, '=', 1) END, ';')
          FROM unnest(r.rolconfig) s)
  FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated', 'authenticator', 'service_role');
-- schemas anon can USE beyond the system ones
SELECT 'SCHEMA_USAGE', nspname, has_schema_privilege('anon', oid, 'USAGE'), has_schema_privilege('authenticated', oid, 'USAGE')
  FROM pg_namespace
 WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'
 ORDER BY 2;
-- cron: COUNT of jobs whose command embeds a bearer/JWT-shaped literal (never the command)
SELECT 'CRON', count(*) jobs,
       count(*) FILTER (WHERE command ~ 'eyJ[A-Za-z0-9_-]{8,}' OR command ~* 'bearer\s+[A-Za-z0-9._-]{20,}') with_inline_token
  FROM cron.job;

SELECT 'SEC0901_DONE', now();
ROLLBACK;
