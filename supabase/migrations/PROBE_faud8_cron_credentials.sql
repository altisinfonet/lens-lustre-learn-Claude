-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · F-AUD-8 (SEC-P9-2) · cron credential rotation (20261010_0001 + 0002)
-- READ-ONLY. Ends in ROLLBACK. Raises (and so fails the dispatch) on a hit.
-- Compares SHA-256 HASHES only; never prints a value, a hash or a command.
--
-- R1 · a finalized rotation is recorded ('faud8_rotation:last', pending_finalize
--      false); no faud8_new:* temporary and no faud8_undo:* copy is left.
-- R2 · NO retired value anywhere: every vault secret, every cron command, every
--      run-history row (command + return_message) and every function body is cut
--      into candidates — runs of [A-Za-z0-9._~+/=_-]{16,}, every '…' literal and
--      every "…" string, each also with a leading "Bearer " removed — and no
--      candidate's SHA-256 is a retired hash. (Only the record itself, which
--      holds hashes, is skipped.)
-- R3 · every live copy (p9_cron_http:*) holds the CURRENT value: x-cron-secret
--      and every Authorization / apikey header hash to the recorded current
--      hash; an sb_secret_ key is never sent as "Bearer" (refused as Invalid JWT).
-- R4 · the CURRENT values are held only in p9_cron_http:* / p9_cron_previous:* —
--      never in a cron command, run history, a function body, or another vault
--      secret (which a later rotation would leave stale).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
DO $probe$
DECLARE
  _rec     jsonb;
  _retired text[];
  _current text[];
  _hits    text := '';
  _w       text;
  _n       int;
BEGIN
  -- R1
  IF to_regclass('vault.decrypted_secrets') IS NULL OR to_regnamespace('cron') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL F-AUD-8: R1 vault or cron is missing';
  END IF;
  SELECT decrypted_secret::jsonb INTO _rec FROM vault.decrypted_secrets WHERE name = 'faud8_rotation:last';
  IF _rec IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL F-AUD-8: R1 no rotation recorded on this lane (faud8_rotation:last absent)';
  END IF;
  IF (_rec->>'pending_finalize')::boolean IS DISTINCT FROM false THEN
    _hits := _hits || E'\n  R1 the latest rotation is not finalized (run 20261010_0002)';
  END IF;
  SELECT string_agg(name, ', ' ORDER BY name) INTO _w FROM vault.secrets WHERE name LIKE 'faud8\_new:%' OR name LIKE 'faud8\_undo:%';
  IF _w IS NOT NULL THEN _hits := _hits || E'\n  R1 left behind: ' || _w; END IF;
  _retired := ARRAY(SELECT jsonb_array_elements_text(coalesce(_rec->'retired_sha256', '[]'::jsonb)));
  _current := ARRAY(SELECT x FROM (VALUES (_rec->'current'->>'cron_secret_sha256'), (_rec->'current'->>'service_key_sha256')) v(x) WHERE x IS NOT NULL);
  IF cardinality(_retired) = 0 OR cardinality(_current) = 0 THEN
    _hits := _hits || E'\n  R1 the record names no retired or no current hash';
  END IF;

  -- R2 + R4 · one scan; candidates hashed, compared with both sets.
  FOR _w, _n IN
    WITH src(kind, what, txt) AS (
      SELECT CASE WHEN name LIKE 'p9\_cron\_http:%' OR name LIKE 'p9\_cron\_previous:%' THEN 'copy' ELSE 'vault' END,
             'vault secret ' || name, decrypted_secret
        FROM vault.decrypted_secrets WHERE name <> 'faud8_rotation:last'
      UNION ALL SELECT 'text', 'cron job ' || jobname, command FROM cron.job
      UNION ALL SELECT 'text', 'run history of job ' || jobid, coalesce(command, '') || ' ' || coalesce(return_message, '') FROM cron.job_run_details
      UNION ALL SELECT 'text', 'function ' || p.oid::regprocedure::text, p.prosrc FROM pg_proc p
                  JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')),
    cand AS (
      SELECT s.kind, s.what, encode(sha256(convert_to(y.c, 'UTF8')), 'hex') AS h
        FROM src s,
        LATERAL (SELECT m[1] FROM regexp_matches(coalesce(s.txt, ''), '([A-Za-z0-9._~+/=_-]{16,})', 'g') m
                 UNION SELECT replace(m[1], '''''', '''') FROM regexp_matches(coalesce(s.txt, ''), '''((?:[^'']|'''')*)''', 'g') m
                 UNION SELECT m[1] FROM regexp_matches(coalesce(s.txt, ''), '"((?:[^"\\]|\\.)*)"', 'g') m) x(c0),
        LATERAL (SELECT x.c0 UNION SELECT regexp_replace(x.c0, '^Bearer\s+', '')) y(c))
    SELECT what, CASE WHEN h = ANY (_retired) THEN 2 ELSE 4 END
      FROM cand
     WHERE h = ANY (_retired) OR (h = ANY (_current) AND kind <> 'copy')
     GROUP BY what, h = ANY (_retired)
     ORDER BY 2, 1
  LOOP
    _hits := _hits || E'\n  R' || _n || ' ' || _w || CASE WHEN _n = 2 THEN ' holds a RETIRED value' ELSE ' holds a CURRENT value outside the managed copies' END;
  END LOOP;

  -- R3 · every live copy holds the current values.
  FOR _w IN
    SELECT s.name FROM vault.decrypted_secrets s, jsonb_each_text(s.decrypted_secret::jsonb->'headers') h
     WHERE s.name LIKE 'p9\_cron\_http:%'
       AND ((h.key = 'x-cron-secret' AND _rec->'current' ? 'cron_secret_sha256'
             AND encode(sha256(convert_to(h.value, 'UTF8')), 'hex') <> _rec->'current'->>'cron_secret_sha256')
         OR (lower(h.key) IN ('authorization', 'apikey') AND _rec->'current' ? 'service_key_sha256'
             AND encode(sha256(convert_to(regexp_replace(h.value, '^Bearer\s+', ''), 'UTF8')), 'hex') <> _rec->'current'->>'service_key_sha256')
         OR h.value ~ '^Bearer\s+sb_secret_')
     GROUP BY s.name ORDER BY s.name
  LOOP
    _hits := _hits || E'\n  R3 ' || _w || ' does not hold the current value in every credential header';
  END LOOP;

  IF _hits <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL F-AUD-8:%', _hits;
  END IF;
  RAISE NOTICE 'PROBE PASS F-AUD-8: rotation of % finalized; % live cop(y/ies) hold the current value(s) (service key form %); no retired value in % vault secret(s), % cron job(s), % run-history row(s), % function body(ies)',
    _rec->'rotations'->0->>'at',
    (SELECT count(*) FROM vault.secrets WHERE name LIKE 'p9\_cron\_http:%'),
    coalesce(_rec->'current'->>'service_key_form', 'not rotated'),
    (SELECT count(*) FROM vault.secrets), (SELECT count(*) FROM cron.job), (SELECT count(*) FROM cron.job_run_details),
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname NOT IN ('pg_catalog', 'information_schema'));
END
$probe$;
ROLLBACK;
