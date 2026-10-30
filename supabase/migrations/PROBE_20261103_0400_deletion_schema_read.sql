-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · foundation fix unit 2 · 0400 · what account deletion must cover.
-- READ ONLY, ROLLBACK. Prints SCHEMA facts and COUNTS only — never row data,
-- never a file name, never a member id.
--   DFK   every foreign key that points at auth.users or public.profiles + its ON DELETE rule
--   UCOL  every public uuid / uuid[] column whose NAME says it holds a member id,
--         whether an FK covers it, and the table's row estimate
--   FCOL  every public column whose NAME says it holds a file URL / storage key
--   BKT   storage buckets: public flag, object count, and how many objects
--         start with a uuid folder (= keyed by owner) — counts only
--   AUTRG triggers on auth.users (they fire during deletion)
--   FNDEF md5 of the two SQL helpers delete-my-account calls today
--   S3KEYS the key NAMES (not values) of site_settings.s3_storage_settings
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
SET LOCAL statement_timeout = '90s';

DO $g$ BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
END $g$;

\pset pager off
\pset format unaligned
\pset tuples_only on
\pset fieldsep '|'

SELECT 'DEL0400_LANE', current_setting('p32.lane'), now();

SELECT 'DFK', cn.nspname || '.' || c.relname,
       (SELECT string_agg(a.attname, ',' ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum = ANY (k.conkey)),
       rn.nspname || '.' || r.relname,
       CASE k.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'r' THEN 'RESTRICT' WHEN 'a' THEN 'NO ACTION' WHEN 'd' THEN 'SET DEFAULT' END
  FROM pg_constraint k
  JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace cn ON cn.oid = c.relnamespace
  JOIN pg_class r ON r.oid = k.confrelid JOIN pg_namespace rn ON rn.oid = r.relnamespace
 WHERE k.contype = 'f' AND ((rn.nspname = 'auth' AND r.relname = 'users') OR (rn.nspname = 'public' AND r.relname = 'profiles'))
 ORDER BY 2, 3;

SELECT 'UCOL', c.relname, a.attname, format_type(a.atttypid, a.atttypmod),
       CASE WHEN EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'f' AND a.attnum = ANY (k.conkey)
                          AND k.confrelid IN ('auth.users'::regclass, 'public.profiles'::regclass)) THEN 'fk' ELSE 'no_fk' END,
       c.reltuples::bigint
  FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped
   AND a.atttypid IN ('uuid'::regtype, 'uuid[]'::regtype)
   AND a.attname ~ '(^|_)(user|users|owner|author|creator|uploader|uploaded|reporter|sender|recipient|receiver|follower|following|requester|addressee|viewer|profile|member|actor|referrer|referred|blocker|blocked|judge|reviewed|created|participant|buyer|seller|winner|invited|inviter|tagged|mentioned|liker|voter|commenter|host|admin|staff|by)(_|$)'
 ORDER BY 2, 3;

SELECT 'FCOL', c.relname, a.attname, format_type(a.atttypid, a.atttypmod)
  FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped
   AND a.atttypid IN ('text'::regtype, 'text[]'::regtype, 'jsonb'::regtype, 'character varying'::regtype)
   AND a.attname ~ '(url|urls|path|paths|key|image|images|avatar|cover|photo|photos|video|file|thumbnail|thumb|poster|derivatives|media|r2|s3)'
 ORDER BY 2, 3;

SELECT 'BKT', b.id, b.public, count(o.id),
       count(o.id) FILTER (WHERE split_part(o.name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  FROM storage.buckets b LEFT JOIN storage.objects o ON o.bucket_id = b.id
 GROUP BY b.id, b.public ORDER BY 2;

SELECT 'AUTRG', t.tgname, p.proname, t.tgenabled::text,
       CASE WHEN (t.tgtype & 8) = 8 THEN 'DELETE' ELSE '' END || CASE WHEN (t.tgtype & 4) = 4 THEN ' INSERT' ELSE '' END || CASE WHEN (t.tgtype & 16) = 16 THEN ' UPDATE' ELSE '' END
  FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
 WHERE t.tgrelid = 'auth.users'::regclass AND NOT t.tgisinternal ORDER BY 2;

SELECT 'FNDEF', p.proname, md5(pg_get_functiondef(p.oid)), pg_get_userbyid(p.proowner), coalesce(p.proacl::text, '<default>')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname IN ('admin_delete_auth_user', 'admin_purge_orphan_user_data')
 ORDER BY 2;

SELECT 'S3KEYS', string_agg(k, ',' ORDER BY k)
  FROM public.site_settings s, LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(s.value) = 'object' THEN s.value ELSE '{}'::jsonb END) k
 WHERE s.key = 's3_storage_settings';

SELECT 'DEL0400_DONE', now();
ROLLBACK;
