-- ═══════════════════════════════════════════════════════════════════════════
-- F-AUD-8 (SEC-P9-2) · 20261010_0002 — FINALIZE a rotation made by 20261010_0001.
-- D1, T1. Lanes: staging and production. RE-RUNNABLE (once per rotation).
-- ═══════════════════════════════════════════════════════════════════════════
-- RUN IT only after the rotated jobs have been seen to work (the next run of a
-- moved job answers 2xx — net._http_response / the edge function's log). This is
-- the CONTRACT step of the rotation: it deletes the way back.
--   1. Reads the OLD values from the undo copies — only those whose SHA-256 is a
--      retired hash of the LATEST rotation in 'faud8_rotation:last'.
--   2. Deletes the scheduler's run-history rows that still hold an old value
--      (runs from before P9 / P9-c copied literal credentials into
--      cron.job_run_details — F-P6-1; P6's purge removes them within 48 h anyway).
--   3. Proves no vault secret, cron command, run-history row or function body
--      holds an old value (exact match), then deletes 'faud8_undo:*'.
-- After it, the Owner revokes the old key / old secret — they are nowhere here.
-- NO ROLLBACK BY DESIGN: the deleted rows and undo copies are revoked
-- credentials; restoring them is the one thing this unit exists to prevent.
-- The rollback file refuses and says so. To change the credentials again,
-- run 20261010_0001 with new temporaries.
-- OBJECTS (reservation): vault faud8_undo:*, faud8_rotation:last;
--   cron.job_run_details rows holding a retired value.
-- PROBE: supabase/migrations/PROBE_faud8_cron_credentials.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_assert$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Set it in THIS session before running: SET p32.lane = ''staging'';',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_assert$;

SET LOCAL lock_timeout = '5s';

DO $finalize$
DECLARE
  _rec   jsonb;
  _last  jsonb;
  _hash  text[];
  _old   text[];
  _r     record;
  _bad   text := '';
  _runs  bigint;
  _n     int;
BEGIN
  -- FIN-PRE-001 · a rotation is pending.
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'faud8_undo:@record') THEN
    RAISE EXCEPTION 'F-AUD-8-0002-PRE-001: no pending rotation (faud8_undo:@record absent) — run 20261010_0001 first'
      USING ERRCODE = 'raise_exception';
  END IF;
  SELECT decrypted_secret::jsonb INTO _rec FROM vault.decrypted_secrets WHERE name = 'faud8_rotation:last';
  _last := _rec->'rotations'->0;
  _hash := ARRAY(SELECT x FROM (VALUES (_last->'cron_secret'->>'old_sha256'), (_last->'service_key'->>'old_sha256')) v(x) WHERE x IS NOT NULL);
  IF _rec IS NULL OR cardinality(_hash) = 0 THEN
    RAISE EXCEPTION 'F-AUD-8-0002-PRE-002: faud8_rotation:last names no retired value' USING ERRCODE = 'raise_exception';
  END IF;

  -- 1 · the old values, from the undo copies, by hash (every header value; Bearer stripped).
  _old := ARRAY(
    SELECT DISTINCT v FROM (
      SELECT regexp_replace(h.value, '^Bearer\s+', '') AS v
        FROM vault.decrypted_secrets u, jsonb_each_text(u.decrypted_secret::jsonb->'headers') h
       WHERE u.name LIKE 'faud8\_undo:p9\_cron\_http:%') c
     WHERE encode(sha256(convert_to(v, 'UTF8')), 'hex') = ANY (_hash));
  IF cardinality(_old) <> cardinality(_hash) THEN
    RAISE EXCEPTION 'F-AUD-8-0002-PRE-003: the undo copies do not hold every retired value of the latest rotation (% of %)',
      cardinality(_old), cardinality(_hash) USING ERRCODE = 'raise_exception';
  END IF;

  -- 2 · run history holding an old value.
  DELETE FROM cron.job_run_details d
   WHERE EXISTS (SELECT 1 FROM unnest(_old) o WHERE strpos(coalesce(d.command, ''), o) > 0
                                              OR strpos(coalesce(d.return_message, ''), o) > 0);
  GET DIAGNOSTICS _runs = ROW_COUNT;

  -- 3 · exact proof, everywhere but the undo copies.
  FOR _r IN
    SELECT 'vault secret ' || name AS what, decrypted_secret AS txt FROM vault.decrypted_secrets WHERE name NOT LIKE 'faud8\_undo:%'
    UNION ALL SELECT 'cron job ' || jobname, command FROM cron.job
    UNION ALL SELECT 'run history of job ' || jobid, command || ' ' || coalesce(return_message, '') FROM cron.job_run_details
    UNION ALL SELECT 'function ' || p.oid::regprocedure::text, p.prosrc FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  LOOP
    IF EXISTS (SELECT 1 FROM unnest(_old) o WHERE strpos(coalesce(_r.txt, ''), o) > 0) THEN
      _bad := _bad || E'\n  ' || _r.what;
    END IF;
  END LOOP;
  IF _bad <> '' THEN
    RAISE EXCEPTION 'F-AUD-8-0002-POST-001: an old value is still held — not finalized:%', _bad USING ERRCODE = 'raise_exception';
  END IF;

  SELECT count(*) INTO _n FROM vault.secrets WHERE name LIKE 'faud8\_undo:%';
  DELETE FROM vault.secrets WHERE name LIKE 'faud8\_undo:%';
  PERFORM vault.update_secret((SELECT id FROM vault.secrets WHERE name = 'faud8_rotation:last'),
                              jsonb_set(_rec, '{pending_finalize}', 'false')::text);
  RAISE NOTICE 'F-AUD-8-0002: finalized on lane %: % undo cop(y/ies) and % run-history row(s) holding a retired value deleted; no old value is held anywhere checked',
    current_setting('p32.lane'), _n, _runs;
END
$finalize$;

COMMIT;
