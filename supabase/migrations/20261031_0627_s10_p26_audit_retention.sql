-- ═══════════════════════════════════════════════════════════════════════════
-- S10 P26 · 20261031_0627 — audit rows older than 180 days move out of the
-- live table. Owner decision 15 (2026-10-31 08:13 UTC, #553): "as proposed".
--
-- GATE (GATE_REGISTER P26, clause 3): rows older than a stated window moved
-- out of the live database. STATED WINDOW: 180 days. (0626 is clauses 1–2.)
--
-- WHAT THIS FILE DOES
--   * schema p26_archive (no USAGE for PUBLIC / anon / authenticated /
--     service_role, not an API schema) with p26_archive.db_audit_logs: the
--     same columns as public.db_audit_logs plus moved_at.
--   * PROCEDURE public.p26_move_old_audit_rows(_keep, _batch, _max_batches):
--     moves rows with created_at older than _keep (default 180 days; refuses
--     anything shorter, and anything over 10 years) in batches of _batch
--     (default 2,000) — one DELETE … RETURNING feeding one INSERT per batch,
--     so a row is either still live or archived, never both or neither — with
--     a COMMIT after each batch, at most _max_batches (default 50) per run.
--     SECURITY INVOKER, no SET clause (COMMIT inside a procedure with SET is
--     refused — same rule as P6's purge_cron_run_details), every name
--     schema-qualified, no API role can EXECUTE it.
--   * cron job 'p26-audit-retention', daily at 04:23 UTC.
--
-- MEASURED (PROBE 0625 production 41206819857): the oldest production row is
-- from 2026-07-09, so nothing moves before 2027-01-05; staging's oldest is
-- 2026-09-11. Both lanes therefore archive 0 rows today; the move is proven
-- on a fixture with backdated rows.
--
-- KNOWN LIMIT: hard-delete-competition deletes a competition's audit rows
-- from public.db_audit_logs by row_id. Rows already archived (older than
-- 180 days) stay in p26_archive until that function also lists it — an edge
-- function change that ships with the next function deploy (Owner item 7).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE cols text;
BEGIN
  IF to_regnamespace('p26_archive') IS NOT NULL THEN
    RAISE EXCEPTION 'APPLY REFUSED 0627 — schema p26_archive already exists; run the PROBE, do not re-apply';
  END IF;
  IF to_regclass('cron.job') IS NULL THEN
    RAISE EXCEPTION 'APPLY REFUSED 0627 — pg_cron is not installed on this lane';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'p26-audit-retention') THEN
    RAISE EXCEPTION 'APPLY REFUSED 0627 — cron job p26-audit-retention already exists';
  END IF;
  SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' ORDER BY a.attnum) INTO cols
    FROM pg_attribute a WHERE a.attrelid = 'public.db_audit_logs'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF cols IS DISTINCT FROM 'id uuid, table_name text, operation text, row_id text, old_data jsonb, new_data jsonb, changed_by uuid, created_at timestamp with time zone' THEN
    RAISE EXCEPTION 'APPLY REFUSED 0627 — db_audit_logs columns are not as measured (PROBE 0622): %', cols;
  END IF;
END
$pre$;

CREATE SCHEMA p26_archive;
REVOKE ALL ON SCHEMA p26_archive FROM PUBLIC;
COMMENT ON SCHEMA p26_archive IS 'S10 P26 (0627): audit rows older than 180 days, moved out of public.db_audit_logs. Not exposed to the API.';

CREATE TABLE p26_archive.db_audit_logs (
  id         uuid PRIMARY KEY,
  table_name text,
  operation  text,
  row_id     text,
  old_data   jsonb,
  new_data   jsonb,
  changed_by uuid,
  created_at timestamptz,
  moved_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON p26_archive.db_audit_logs (table_name, created_at);
REVOKE ALL ON ALL TABLES IN SCHEMA p26_archive FROM PUBLIC, anon, authenticated, service_role;

CREATE PROCEDURE public.p26_move_old_audit_rows(_keep interval DEFAULT interval '180 days',
                                                 _batch integer DEFAULT 2000,
                                                 _max_batches integer DEFAULT 50)
LANGUAGE plpgsql
-- No SET clause: COMMIT inside a procedure that carries one is refused. Every
-- name is schema-qualified; SECURITY INVOKER; no API role can EXECUTE it.
AS $proc$
DECLARE
  _n int; _batches int := 0; _total bigint := 0;
BEGIN
  IF _keep < interval '180 days' OR _keep > interval '3650 days' THEN
    RAISE EXCEPTION 'p26_move_old_audit_rows: _keep % is outside the P26 window (180 days – 10 years)', _keep;
  END IF;
  IF _batch < 1 OR _batch > 10000 OR _max_batches < 1 THEN
    RAISE EXCEPTION 'p26_move_old_audit_rows: batch % / max % out of bounds (1–10000 / ≥ 1)', _batch, _max_batches;
  END IF;
  LOOP
    WITH moved AS (
      DELETE FROM public.db_audit_logs
       WHERE id IN (SELECT id FROM public.db_audit_logs
                     WHERE created_at < pg_catalog.now() - _keep
                     ORDER BY created_at, id
                     LIMIT _batch)
      RETURNING id, table_name, operation, row_id, old_data, new_data, changed_by, created_at)
    INSERT INTO p26_archive.db_audit_logs (id, table_name, operation, row_id, old_data, new_data, changed_by, created_at)
    SELECT id, table_name, operation, row_id, old_data, new_data, changed_by, created_at FROM moved;
    GET DIAGNOSTICS _n = ROW_COUNT;
    _total := _total + _n;
    _batches := _batches + 1;
    COMMIT;
    EXIT WHEN _n < _batch OR _batches >= _max_batches;
  END LOOP;
  RAISE NOTICE 'p26_move_old_audit_rows: % row(s) in % batch(es), keep %', _total, _batches, _keep;
END;
$proc$;
REVOKE ALL ON PROCEDURE public.p26_move_old_audit_rows(interval, integer, integer) FROM PUBLIC;
REVOKE ALL ON PROCEDURE public.p26_move_old_audit_rows(interval, integer, integer) FROM anon;
REVOKE ALL ON PROCEDURE public.p26_move_old_audit_rows(interval, integer, integer) FROM authenticated;
REVOKE ALL ON PROCEDURE public.p26_move_old_audit_rows(interval, integer, integer) FROM service_role;

SELECT cron.schedule('p26-audit-retention', '23 4 * * *', $cmd$CALL public.p26_move_old_audit_rows();$cmd$);

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'p26-audit-retention' AND active AND schedule = '23 4 * * *'
                   AND command ~* 'call\s+public\.p26_move_old_audit_rows\(\)') THEN
    RAISE EXCEPTION 'APPLY FAILED 0627 — cron job p26-audit-retention is not daily calling the procedure';
  END IF;
  IF has_function_privilege('anon', 'public.p26_move_old_audit_rows(interval, integer, integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.p26_move_old_audit_rows(interval, integer, integer)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.p26_move_old_audit_rows(interval, integer, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'APPLY FAILED 0627 — an API role can run p26_move_old_audit_rows';
  END IF;
  IF has_schema_privilege('anon', 'p26_archive', 'USAGE') OR has_schema_privilege('authenticated', 'p26_archive', 'USAGE')
     OR has_schema_privilege('service_role', 'p26_archive', 'USAGE') THEN
    RAISE EXCEPTION 'APPLY FAILED 0627 — an API role can use schema p26_archive';
  END IF;
  RAISE NOTICE '0627 POST PASS — daily move of audit rows older than 180 days into private p26_archive';
END
$post$;

COMMIT;
