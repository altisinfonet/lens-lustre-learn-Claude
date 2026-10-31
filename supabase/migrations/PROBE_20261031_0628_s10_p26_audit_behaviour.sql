-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261031_0628 · S10 P26 — the live audit trigger functions, run for
-- real on this lane, write what 0626 says. ROLLBACK: nothing persists.
--
-- Why: 0626's post-check reads the catalog; it cannot show that the live
-- SECURITY DEFINER functions (with their real owner) can call
-- p26_jsonb_change, or what rows they write. This attaches the two LIVE
-- functions to two temporary tables (so no member data and no other trigger
-- is involved), writes to them, and reads back the audit rows produced inside
-- this transaction, then rolls everything back.
--   B1  INSERT → one row, full new image
--   B2  UPDATE changing one key → one row holding only that key (+ marker)
--   B3  UPDATE changing nothing → no row
--   B4  UPDATE of an id-carrying array, one element edited → only that element
--   B5  DELETE → one row, full old image
--   B6  the same five through audit_site_settings_table (key as row_id)
-- FAIL before 0626 (B2/B3/B4 store two full copies); PASS after.
-- Prints counts and PASS/FAIL only.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not staging or production';
  END IF;
END
$guard$;

CREATE TEMP TABLE p26_probe_rows (id uuid PRIMARY KEY, a text, b text, pages jsonb) ON COMMIT DROP;
CREATE TEMP TABLE p26_probe_settings (key text PRIMARY KEY, value jsonb, note text) ON COMMIT DROP;
CREATE TRIGGER p26_probe_audit AFTER INSERT OR DELETE OR UPDATE ON pg_temp.p26_probe_rows
  FOR EACH ROW EXECUTE FUNCTION public.audit_sensitive_table();
CREATE TRIGGER p26_probe_audit AFTER INSERT OR DELETE OR UPDATE ON pg_temp.p26_probe_settings
  FOR EACH ROW EXECUTE FUNCTION public.audit_site_settings_table();

DO $probe$
DECLARE
  rid constant uuid := '00000000-0000-4000-8000-000000000026'::uuid;
  t0 timestamptz := clock_timestamp();
  n int; r record; v_pages jsonb;
BEGIN
  v_pages := '[{"id":"p1","t":"A","c":"long A"},{"id":"p2","t":"B","c":"long B"},{"id":"p3","t":"C","c":"long C"}]';

  -- through audit_sensitive_table
  INSERT INTO pg_temp.p26_probe_rows VALUES (rid, 'x', 'y', v_pages);
  UPDATE pg_temp.p26_probe_rows SET a = 'x2' WHERE id = rid;
  UPDATE pg_temp.p26_probe_rows SET a = a WHERE id = rid;
  UPDATE pg_temp.p26_probe_rows SET pages = jsonb_set(pages, '{1,t}', '"B2"') WHERE id = rid;
  DELETE FROM pg_temp.p26_probe_rows WHERE id = rid;
  -- through audit_site_settings_table
  INSERT INTO pg_temp.p26_probe_settings VALUES ('p26_probe', '"device"', 'n');
  UPDATE pg_temp.p26_probe_settings SET value = '"server"' WHERE key = 'p26_probe';
  UPDATE pg_temp.p26_probe_settings SET value = value WHERE key = 'p26_probe';
  DELETE FROM pg_temp.p26_probe_settings WHERE key = 'p26_probe';

  SELECT count(*) INTO n FROM public.db_audit_logs WHERE table_name = 'p26_probe_rows' AND row_id = rid::text;
  IF n <> 4 THEN RAISE EXCEPTION 'PROBE FAIL 0628 B1-B5: % audit rows for the row table, want 4 (insert, 2 updates, delete; the no-op writes none)', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.db_audit_logs WHERE table_name = 'p26_probe_rows' AND operation = 'UPDATE'
                  AND old_data = '{"a":"x","_p26":"change"}' AND new_data = '{"a":"x2","_p26":"change"}') THEN
    RAISE EXCEPTION 'PROBE FAIL 0628 B2: the one-key update is not stored as the change';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.db_audit_logs WHERE table_name = 'p26_probe_rows' AND operation = 'UPDATE'
                  AND old_data = '{"pages":{"_by_id":{"p2":{"id":"p2","t":"B","c":"long B"}}},"_p26":"change"}'
                  AND new_data = '{"pages":{"_by_id":{"p2":{"id":"p2","t":"B2","c":"long B"}}},"_p26":"change"}') THEN
    RAISE EXCEPTION 'PROBE FAIL 0628 B4: the page edit is not stored by id';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.db_audit_logs WHERE table_name = 'p26_probe_rows' AND operation = 'INSERT' AND new_data ->> 'b' = 'y' AND new_data ? 'pages')
     OR NOT EXISTS (SELECT 1 FROM public.db_audit_logs WHERE table_name = 'p26_probe_rows' AND operation = 'DELETE' AND old_data ->> 'a' = 'x2' AND old_data ? 'pages') THEN
    RAISE EXCEPTION 'PROBE FAIL 0628 B1/B5: insert / delete rows are not full images';
  END IF;

  SELECT count(*) INTO n FROM public.db_audit_logs WHERE table_name = 'p26_probe_settings' AND row_id = 'p26_probe';
  IF n <> 3 THEN RAISE EXCEPTION 'PROBE FAIL 0628 B6: % audit rows for the settings table, want 3', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.db_audit_logs WHERE table_name = 'p26_probe_settings' AND operation = 'UPDATE'
                  AND old_data ->> 'value' = 'device' AND new_data ->> 'value' = 'server' AND NOT (new_data ? 'note')) THEN
    RAISE EXCEPTION 'PROBE FAIL 0628 B6: the settings update is not stored as the change (value device→server only)';
  END IF;

  RAISE NOTICE 'PROBE PASS 0628 — live audit functions on this lane: insert/delete full, update = the change, no-op = no row, pages by id (rolled back)';
END
$probe$;

ROLLBACK;
