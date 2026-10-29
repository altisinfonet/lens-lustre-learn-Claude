-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · S8 F-AUD-8 — credentials in places the rotation (20261010_0001/0002)
-- does NOT scan. READ ONLY, ends in ROLLBACK. Prints COUNTS only — never a
-- value, a name of a secret, or a fragment (the Actions log is public).
--
-- 0001/0002 and PROBE_faud8_cron_credentials scan Vault, cron.job,
-- cron.job_run_details and pg_proc.prosrc. A credential that also lives in one
-- of the places below would survive the rotation and keep the old key working
-- (or break silently once the old key is revoked):
--   L1 · pg_trigger.tgargs — Dashboard "Database Webhooks" store their HTTP
--        headers there (e.g. Authorization: Bearer <service key>).
--   L2 · pg_db_role_setting — ALTER DATABASE/ROLE … SET app.settings.* = '<key>'.
--   L3 · net.http_request_queue — pg_net requests queued with such headers.
-- A hit is any of: a JWT-shaped token (eyJ….….…), an sb_secret_ key, or an
-- Authorization / apikey / x-cron-secret header with a value.
-- Verdict: PASS when every count is 0 (the rotation's scan is complete for this
-- lane today); otherwise FAIL naming only the LOCATION and the COUNT.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;

DO $p$
DECLARE
  rx  constant text := '(eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|sb_secret_[A-Za-z0-9_-]{8,}|(authorization|apikey|x-cron-secret)["'']?\s*[:=,]\s*["'']?[A-Za-z0-9_.-]{8,})';
  l1  int := 0; l2 int := 0; l3 int := 0; hooks int := 0;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;

  -- L1 · trigger arguments (bytea, NUL-separated)
  SELECT count(*) FILTER (WHERE replace(encode(t.tgargs, 'escape'), '\000', ' ') ~* rx),
         count(*) FILTER (WHERE p.proname = 'http_request' OR replace(encode(t.tgargs, 'escape'), '\000', ' ') ~* 'https?://')
    INTO l1, hooks
    FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE NOT t.tgisinternal AND t.tgnargs > 0;

  -- L2 · database / role settings
  SELECT count(*) INTO l2
    FROM pg_db_role_setting s, unnest(s.setconfig) c
   WHERE c ~* rx;

  -- L3 · pg_net queue (only if pg_net is installed)
  IF to_regclass('net.http_request_queue') IS NOT NULL THEN
    EXECUTE format('SELECT count(*) FROM net.http_request_queue q WHERE q.headers::text ~* %L', rx) INTO l3;
  END IF;

  IF l1 + l2 + l3 > 0 THEN
    RAISE EXCEPTION 'PROBE FAIL S8 F-AUD-8 unscanned locations (lane %): trigger args % (of % webhook-like triggers), db/role settings %, pg_net queue % — the rotation would leave these copies behind',
      current_setting('p32.lane'), l1, hooks, l2, l3;
  END IF;
  RAISE NOTICE 'PROBE PASS S8 F-AUD-8 unscanned locations (lane %): trigger args 0 (of % webhook-like triggers), db/role settings 0, pg_net queue 0',
    current_setting('p32.lane'), hooks;
END
$p$;

ROLLBACK;
