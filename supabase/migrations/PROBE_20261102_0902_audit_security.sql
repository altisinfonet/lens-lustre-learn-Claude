-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · foundation audit 0902 · security posture. READ ONLY, ROLLBACK.
-- Per SECURITY DEFINER function in public: can anon / authenticated EXECUTE
-- it, is search_path pinned, and does its body (inspected here, never
-- printed) write (INSERT/UPDATE/DELETE) and/or check the caller (auth.uid /
-- auth.role / has_role / is_admin / app_has_role). Tables without RLS and
-- their anon/authenticated grants. Storage buckets: public flag + object
-- COUNT and total bytes only — no file names, no member data. Changes nothing.
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
\pset fieldsep '|'

SELECT 'AUDIT0902_LANE', current_setting('p32.lane'), now();

WITH f AS (
  SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) args,
         has_function_privilege('anon', p.oid, 'EXECUTE') anon_x,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_x,
         coalesce(array_to_string(p.proconfig, ',') ~ 'search_path', false) sp_pinned,
         lower(p.prosrc) ~ '(insert\s+into|update\s+[a-z_."]+\s+set|delete\s+from)' writes,
         lower(p.prosrc) ~ '(auth\.uid\(\)|auth\.role\(\)|auth\.jwt\(\)|has_role|is_admin|app_has_role|current_user_id|is_staff)' checks,
         p.prorettype = 'trigger'::regtype is_trigger
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosecdef
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
)
SELECT 'SECDEF_SUMMARY', count(*) total,
       count(*) FILTER (WHERE anon_x) anon_exec,
       count(*) FILTER (WHERE auth_x) auth_exec,
       count(*) FILTER (WHERE anon_x AND NOT is_trigger) anon_exec_nontrigger,
       count(*) FILTER (WHERE anon_x AND writes AND NOT checks AND NOT is_trigger) anon_writes_nocheck,
       count(*) FILTER (WHERE auth_x AND writes AND NOT checks AND NOT is_trigger) auth_writes_nocheck,
       count(*) FILTER (WHERE NOT sp_pinned) no_search_path
  FROM f;

WITH f AS (
  SELECT p.proname, pg_get_function_identity_arguments(p.oid) args,
         has_function_privilege('anon', p.oid, 'EXECUTE') anon_x,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_x,
         coalesce(array_to_string(p.proconfig, ',') ~ 'search_path', false) sp,
         lower(p.prosrc) ~ '(insert\s+into|update\s+[a-z_."]+\s+set|delete\s+from)' w,
         lower(p.prosrc) ~ '(auth\.uid\(\)|auth\.role\(\)|auth\.jwt\(\)|has_role|is_admin|app_has_role|current_user_id|is_staff)' c,
         p.prorettype = 'trigger'::regtype t
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosecdef
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
)
SELECT 'SECDEF', proname, args, anon_x, auth_x, sp, w, c, t FROM f
 WHERE (anon_x OR auth_x) ORDER BY (anon_x AND w AND NOT c AND NOT t) DESC, (w AND NOT c) DESC, proname;

-- tables without RLS, with what anon/authenticated may do to them
SELECT 'NORLS', n.nspname, c.relname,
       has_table_privilege('anon', c.oid, 'SELECT') anon_sel,
       has_table_privilege('anon', c.oid, 'INSERT,UPDATE,DELETE') anon_write,
       has_table_privilege('authenticated', c.oid, 'SELECT') auth_sel,
       has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE') auth_write
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
 ORDER BY 2, 3;

-- RLS on but zero policies (deny-all; informational)
SELECT 'RLS_NOPOL', c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
   AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname)
 ORDER BY 2;

-- policies that grant to anon/public with USING (true) on write commands
SELECT 'POL_OPEN_WRITE', tablename, policyname, cmd, array_to_string(roles, ',')
  FROM pg_policies
 WHERE schemaname = 'public' AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
   AND (roles && ARRAY['anon', 'public']::name[])
   AND (coalesce(qual, 'true') = 'true' OR coalesce(with_check, 'true') = 'true')
 ORDER BY 2, 3;

-- views without security_invoker readable by anon (bypass RLS of owner)
SELECT 'VIEW_DEFINER_ANON', c.relname
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'v'
   AND NOT coalesce(array_to_string(c.reloptions, ',') ~ 'security_invoker=(true|on)', false)
   AND has_table_privilege('anon', c.oid, 'SELECT')
 ORDER BY 2;

-- storage buckets: public flag, object count, bytes (no names of objects)
SELECT 'BUCKET', b.id, b.public, count(o.id) objects,
       coalesce(sum((o.metadata->>'size')::bigint), 0) bytes,
       b.file_size_limit, array_length(b.allowed_mime_types, 1) mime_rules
  FROM storage.buckets b LEFT JOIN storage.objects o ON o.bucket_id = b.id
 GROUP BY b.id, b.public, b.file_size_limit, b.allowed_mime_types ORDER BY 2;

-- storage policies letting anon list/read objects
SELECT 'STORAGE_POL', policyname, cmd, array_to_string(roles, ',')
  FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' ORDER BY 2;

SELECT 'AUDIT0902_DONE', now();
ROLLBACK;
