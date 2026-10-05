-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · P9-c (20261005_0003) — the LIVE half, and P9 across the whole lane.
-- READ-ONLY. Ends in ROLLBACK. Raises (and so fails the dispatch) on a hit.
--   C1 · each of the six jobs that exists runs "SELECT public.cron_http_call('<job>');"
--        and its target is in vault 'p9_cron_http:<job>'.
--   C2 · NO cron job on the lane — any name — has a command holding
--        net.http_*, an inline vault.decrypted_secrets read, or a quoted
--        literal of 17+ characters (P9 gate; F-P6-1). Once 0006 (e-mail) and
--        0007 (scheduled posts) are applied too, this is P9 closed on the lane.
--   C3 · no API role can execute cron_http_call.
-- Job names are printed; commands never are (they may carry secrets).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
DO $probe$
DECLARE
  j     record;
  hits  text := '';
  n     int := 0;
BEGIN
  IF to_regprocedure('public.cron_http_call(text)') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL P9-c: C1 public.cron_http_call(text) is not installed';
  END IF;
  FOR j IN SELECT jobname, command FROM cron.job
            WHERE jobname IN ('apply-scheduled-boosts', 'autoscale-ad-traffic', 'expire-gift-credits',
                              'judging-invariants-nightly', 'send-reengagement-emails', 'backup-reminder') LOOP
    n := n + 1;
    IF j.command <> format('SELECT public.cron_http_call(%L);', j.jobname) THEN
      hits := hits || E'\n  C1 ' || j.jobname || ': command is not cron_http_call(''' || j.jobname || ''')';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'p9_cron_http:' || j.jobname) THEN
      hits := hits || E'\n  C1 ' || j.jobname || ': no vault target';
    END IF;
  END LOOP;
  FOR j IN SELECT jobname, command FROM cron.job ORDER BY jobname LOOP
    IF j.command ~* '\mnet\s*\.\s*http_(post|get)\s*\(' THEN hits := hits || E'\n  C2 ' || j.jobname || ': calls net.http_* in its command'; END IF;
    IF j.command ~* 'decrypted_secrets' THEN hits := hits || E'\n  C2 ' || j.jobname || ': reads the vault inline'; END IF;
    -- literals scanned in order from the start, so a span BETWEEN two literals
    -- (e.g. ') - interval ') is never mistaken for one.
    -- The job's own name (cron_http_call('judging-invariants-nightly')) is not a credential.
    IF EXISTS (SELECT 1 FROM regexp_matches(j.command, '''((?:[^'']|'''')*)''', 'g') m
                WHERE length(m[1]) >= 17 AND m[1] <> j.jobname) THEN
      hits := hits || E'\n  C2 ' || j.jobname || ': holds a quoted literal of 17+ characters';
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.cron_http_call(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cron_http_call(text)', 'EXECUTE') THEN
    hits := hits || E'\n  C3 an API role can execute cron_http_call';
  END IF;
  IF hits <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL P9-c:%', hits;
  END IF;
  RAISE NOTICE 'PROBE PASS P9-c: % of the six jobs on this lane call cron_http_call; no cron command on the lane holds HTTP, an inline vault read or a long literal (% job(s) read)',
    n, (SELECT count(*) FROM cron.job);
END
$probe$;
ROLLBACK;
