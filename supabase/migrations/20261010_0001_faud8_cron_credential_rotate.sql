-- ═══════════════════════════════════════════════════════════════════════════
-- F-AUD-8 (SEC-P9-2) · 20261010_0001 — ROTATE the cron credentials held in the
-- database. D1, T1. Lanes: staging and production. RE-RUNNABLE (one run per
-- rotation). Finalize: 20261010_0002. PROBE: PROBE_faud8_cron_credentials.sql.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT IT ROTATES (each optional; at least one):
--   cron secret  — the x-cron-secret header (Edge secret CRON_SECRET).
--   service key  — the project service key, sent as "Authorization: Bearer <key>"
--                  and/or "apikey: <key>". A legacy JWT or a new sb_secret_ key.
-- WHERE THE DATABASE HOLDS THEM (selected by NAME PREFIX, not a job list, so a
-- lane's own set is covered — staging today also has publish-scheduled-posts):
--   vault 'p9_cron_http:<job>'      the live call target (0003 / 0006 / P5-b 0007)
--   vault 'p9_cron_previous:<job>'  the pre-P9 job, kept for those rollbacks
--
-- THE OWNER'S PART (no value is ever typed into SQL, a file or a chat):
--   1. set the new value(s) where the edge functions read them (Edge secret
--      CRON_SECRET; for a new key: create it in Settings → API Keys);
--   2. Dashboard → Vault → Add secret, under these EXACT names, value only:
--        faud8_new:cron_secret     faud8_new:service_key
--   3. the Auditor dispatches THIS file on the lane. Do not revoke the old key yet.
-- THIS FILE, in one transaction (any refusal changes nothing):
--   reads the temporaries; checks them (charset, length, form, ≠ old, a JWT must
--   be role service_role of the same project as the old one); finds the ONE old
--   value of each kind in the live copies (all must agree); refuses if any other
--   vault secret, cron command or function body holds an old value (it could not
--   be rotated safely — CONTAIN-001 names it); keeps every copy it will change
--   in vault 'faud8_undo:<name>' (the way back, until 0002); rewrites the copies;
--   proves no copy holds an old value and every live copy holds the new one;
--   records only SHA-256 hashes in vault 'faud8_rotation:last'; deletes the
--   temporaries.
-- HEADER RULES (service key). Legacy JWT → the same headers, new value
--   ("Bearer " kept). sb_secret_ key → it is NOT a JWT: "Authorization: Bearer
--   sb_secret_…" is rejected by the platform as "Invalid JWT", so the key moves
--   to "apikey" and the Bearer header carrying the old key is removed. PRE-
--   CONDITION OUTSIDE THE DATABASE: every called function must then run with
--   verify_jwt = false (D2 / Owner) — this file cannot see that.
-- p9_cron_previous:* (DECIDED): they hold the old values, so they are rewritten,
--   never left stale and never deleted (deleting would make the 0003/0006/0007
--   rollbacks refuse). Same key form → the old value is replaced in the stored
--   command text (byte-identical otherwise; an inline vault read stays inline).
--   Form change (JWT ↔ sb_secret_) → the command is rebuilt from the new target:
--   "select net.http_post(url, body, params, headers, timeout)" with literals.
--   Either way the rewritten command, EVALUATED, must equal the new live target
--   exactly (PREV-001), and its schedule is kept. A later 0003/0006/0007 rollback
--   therefore restores a WORKING job with the new credentials (the pre-P9 shape),
--   no longer the byte-exact pre-P9 command.
-- NEVER IN TEXT: values travel only as PL/pgSQL variables (bind parameters) from
--   vault to vault. No NOTICE, error or record holds a value; cron.job and
--   cron.job_run_details are never written with one. Errors name a vault secret
--   or a job, never its content.
-- OBJECTS (reservation): vault secrets p9_cron_http:*, p9_cron_previous:*
--   (contents only), faud8_new:*, faud8_undo:*, faud8_rotation:last.
-- ROLLBACK (before 0002 only): supabase/rollback/20261010_0001_faud8_cron_credential_rotate_ROLLBACK.sql
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

DO $rotate$
DECLARE
  _charset  CONSTANT text := '^[A-Za-z0-9._~+/=_-]+$';
  _new_cs   text;  _old_cs  text;
  _new_key  text;  _old_key text;
  _new_form text;  _old_form text;
  _do_cs    boolean;  _do_key boolean;
  _n        int;
  _p        jsonb;  _p_old jsonb;
  _r        record;
  _t        jsonb;  _h jsonb;  _k text;  _v text;
  _cmd      text;   _cap jsonb;  _prev jsonb;
  _changed  text[] := '{}';
  _bad      text := '';
  _rec      jsonb;  _entry jsonb;  _retired jsonb;
  _hex      text;
BEGIN
  -- PRE-001 · machinery.
  IF to_regnamespace('cron') IS NULL
     OR to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL
     OR to_regprocedure('vault.create_secret(text,text,text,uuid)') IS NULL
     OR to_regprocedure('vault.update_secret(uuid,text,text,text,uuid)') IS NULL
     OR to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE EXCEPTION 'F-AUD-8-PRE-001: cron, net.http_post or vault (create_secret / update_secret / decrypted_secrets) is missing'
      USING ERRCODE = 'raise_exception';
  END IF;
  -- PRE-002 · the previous rotation is finalized (one way back at a time).
  IF EXISTS (SELECT 1 FROM vault.secrets WHERE name LIKE 'faud8\_undo:%') THEN
    RAISE EXCEPTION 'F-AUD-8-PRE-002: a rotation is not finalized (faud8_undo:* exists) — run 20261010_0002 or the rollback first'
      USING ERRCODE = 'raise_exception';
  END IF;
  -- PRE-003 · the temporaries: present, one each, and nothing else under faud8_new:.
  IF EXISTS (SELECT 1 FROM vault.secrets WHERE name LIKE 'faud8\_new:%'
              AND name NOT IN ('faud8_new:cron_secret', 'faud8_new:service_key')) THEN
    RAISE EXCEPTION 'F-AUD-8-PRE-003: an unknown faud8_new:* secret exists — only faud8_new:cron_secret and faud8_new:service_key are read'
      USING ERRCODE = 'raise_exception';
  END IF;
  SELECT decrypted_secret INTO _new_cs  FROM vault.decrypted_secrets WHERE name = 'faud8_new:cron_secret';
  SELECT decrypted_secret INTO _new_key FROM vault.decrypted_secrets WHERE name = 'faud8_new:service_key';
  _do_cs := _new_cs IS NOT NULL;  _do_key := _new_key IS NOT NULL;
  IF NOT _do_cs AND NOT _do_key THEN
    RAISE EXCEPTION 'F-AUD-8-PRE-003: neither faud8_new:cron_secret nor faud8_new:service_key is in vault — nothing to rotate'
      USING ERRCODE = 'raise_exception';
  END IF;
  -- PRE-004 · the live copies exist and parse.
  SELECT count(*) INTO _n FROM vault.secrets WHERE name LIKE 'p9\_cron\_http:%';
  IF _n = 0 THEN
    RAISE EXCEPTION 'F-AUD-8-PRE-004: no p9_cron_http:* secret on this lane — nothing holds a cron credential'
      USING ERRCODE = 'raise_exception';
  END IF;
  FOR _r IN SELECT name, decrypted_secret AS d FROM vault.decrypted_secrets
             WHERE name LIKE 'p9\_cron\_http:%' OR name LIKE 'p9\_cron\_previous:%' LOOP
    BEGIN
      _t := _r.d::jsonb;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'F-AUD-8-PRE-004: % is not JSON', _r.name USING ERRCODE = 'raise_exception';
    END;
    IF _r.name LIKE 'p9\_cron\_http:%' AND (jsonb_typeof(_t->'headers') IS DISTINCT FROM 'object' OR _t->>'url' IS NULL) THEN
      RAISE EXCEPTION 'F-AUD-8-PRE-004: % has no url or no headers object', _r.name USING ERRCODE = 'raise_exception';
    END IF;
    IF _r.name LIKE 'p9\_cron\_previous:%' AND (_t->>'schedule' IS NULL OR _t->>'command' IS NULL) THEN
      RAISE EXCEPTION 'F-AUD-8-PRE-004: % has no schedule or no command', _r.name USING ERRCODE = 'raise_exception';
    END IF;
    IF _r.name LIKE 'p9\_cron\_previous:%'
       AND NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'p9_cron_http:' || substr(_r.name, 18)) THEN
      RAISE EXCEPTION 'F-AUD-8-PRE-004: % has no live target p9_cron_http:%', _r.name, substr(_r.name, 18)
        USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;

  -- ── the cron secret ─────────────────────────────────────────────────────
  IF _do_cs THEN
    IF _new_cs !~ _charset OR length(_new_cs) NOT BETWEEN 32 AND 256 THEN
      RAISE EXCEPTION 'F-AUD-8-NEW-001: faud8_new:cron_secret must be 32–256 characters of A–Z a–z 0–9 . _ ~ + / = - (no space or line break)'
        USING ERRCODE = 'raise_exception';
    END IF;
    SELECT count(DISTINCT d::jsonb->'headers'->>'x-cron-secret'), min(d::jsonb->'headers'->>'x-cron-secret')
      INTO _n, _old_cs
      FROM (SELECT decrypted_secret AS d FROM vault.decrypted_secrets WHERE name LIKE 'p9\_cron\_http:%') s
     WHERE d::jsonb->'headers' ? 'x-cron-secret';
    IF _n <> 1 THEN
      RAISE EXCEPTION 'F-AUD-8-OLD-001: the live copies hold % distinct x-cron-secret values (must be exactly 1)', _n
        USING ERRCODE = 'raise_exception';
    END IF;
    IF _new_cs = _old_cs THEN
      RAISE EXCEPTION 'F-AUD-8-NEW-002: faud8_new:cron_secret equals the current cron secret' USING ERRCODE = 'raise_exception';
    END IF;
  END IF;

  -- ── the service key ─────────────────────────────────────────────────────
  IF _do_key THEN
    _new_form := CASE WHEN _new_key ~ '^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' THEN 'jwt'
                      WHEN _new_key ~ '^sb_secret_[A-Za-z0-9_-]{16,}$' THEN 'sb_secret' END;
    IF _new_form IS NULL OR length(_new_key) > 4096 THEN
      RAISE EXCEPTION 'F-AUD-8-NEW-001: faud8_new:service_key is neither a legacy JWT (eyJ….….…) nor an sb_secret_ key (no space or line break; not an anon or publishable key)'
        USING ERRCODE = 'raise_exception';
    END IF;
    SELECT count(DISTINCT v), min(v) INTO _n, _old_key FROM (
      SELECT regexp_replace(h.value, '^Bearer\s+', '') AS v
        FROM vault.decrypted_secrets s, jsonb_each_text(s.decrypted_secret::jsonb->'headers') h
       WHERE s.name LIKE 'p9\_cron\_http:%' AND lower(h.key) IN ('authorization', 'apikey')) k;
    IF _n <> 1 THEN
      RAISE EXCEPTION 'F-AUD-8-OLD-002: the live copies hold % distinct service-key values in Authorization / apikey (must be exactly 1)', _n
        USING ERRCODE = 'raise_exception';
    END IF;
    _old_form := CASE WHEN _old_key ~ '^eyJ' THEN 'jwt' WHEN _old_key ~ '^sb_secret_' THEN 'sb_secret' ELSE 'other' END;
    IF _new_key = _old_key THEN
      RAISE EXCEPTION 'F-AUD-8-NEW-002: faud8_new:service_key equals the current key' USING ERRCODE = 'raise_exception';
    END IF;
    IF _new_form = 'jwt' THEN
      BEGIN
        _p := convert_from(decode(rpad(translate(split_part(_new_key, '.', 2), '-_', '+/'),
                                       (length(split_part(_new_key, '.', 2)) + 3) / 4 * 4, '='), 'base64'), 'UTF8')::jsonb;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'F-AUD-8-NEW-003: faud8_new:service_key looks like a JWT but its payload does not decode'
          USING ERRCODE = 'raise_exception';
      END;
      IF _p->>'role' IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'F-AUD-8-NEW-003: faud8_new:service_key is a JWT whose role is not service_role (an anon key?)'
          USING ERRCODE = 'raise_exception';
      END IF;
      IF _old_form = 'jwt' THEN
        BEGIN
          _p_old := convert_from(decode(rpad(translate(split_part(_old_key, '.', 2), '-_', '+/'),
                                             (length(split_part(_old_key, '.', 2)) + 3) / 4 * 4, '='), 'base64'), 'UTF8')::jsonb;
        EXCEPTION WHEN others THEN _p_old := NULL;
        END;
        IF _p_old ? 'ref' AND _p->>'ref' IS DISTINCT FROM _p_old->>'ref' THEN
          RAISE EXCEPTION 'F-AUD-8-NEW-003: faud8_new:service_key belongs to another project (ref differs from the current key) — wrong lane?'
            USING ERRCODE = 'raise_exception';
        END IF;
      END IF;
    END IF;
  END IF;
  IF _do_cs AND _do_key AND _new_cs = _new_key THEN
    RAISE EXCEPTION 'F-AUD-8-NEW-002: the new cron secret equals the new service key' USING ERRCODE = 'raise_exception';
  END IF;

  -- CONTAIN-001 · an old value anywhere this file does not manage → refuse.
  FOR _r IN
    SELECT 'vault secret ' || name AS what, decrypted_secret AS txt FROM vault.decrypted_secrets
     WHERE name NOT LIKE 'p9\_cron\_http:%' AND name NOT LIKE 'p9\_cron\_previous:%' AND name NOT LIKE 'faud8\_%'
    UNION ALL SELECT 'cron job ' || jobname, command FROM cron.job
    UNION ALL SELECT 'function ' || p.oid::regprocedure::text, p.prosrc FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  LOOP
    IF (_do_cs AND strpos(_r.txt, _old_cs) > 0) OR (_do_key AND strpos(_r.txt, _old_key) > 0) THEN
      _bad := _bad || E'\n  ' || _r.what;
    END IF;
  END LOOP;
  IF _bad <> '' THEN
    RAISE EXCEPTION 'F-AUD-8-CONTAIN-001: an old value is held outside p9_cron_http/p9_cron_previous; this file cannot rotate it safely:%', _bad
      USING ERRCODE = 'raise_exception';
  END IF;

  -- ── rewrite: live targets first ─────────────────────────────────────────
  CREATE FUNCTION pg_temp.faud8_capture(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb,
                                        headers jsonb DEFAULT '{"Content-Type": "application/json"}'::jsonb,
                                        timeout_milliseconds integer DEFAULT 5000)
  RETURNS jsonb LANGUAGE sql AS
  $c$ SELECT jsonb_build_object('url', url, 'body', body, 'params', params, 'headers', headers,
                                'timeout_milliseconds', timeout_milliseconds) $c$;

  FOR _r IN SELECT id, name, decrypted_secret AS d FROM vault.decrypted_secrets
             WHERE name LIKE 'p9\_cron\_http:%' ORDER BY name LOOP
    _t := _r.d::jsonb;  _h := '{}'::jsonb;
    FOR _k, _v IN SELECT key, value FROM jsonb_each_text(_t->'headers') LOOP
      IF _do_cs AND _v = _old_cs THEN
        _h := _h || jsonb_build_object(_k, _new_cs);
      ELSIF _do_key AND _v ~ '^Bearer\s+' AND regexp_replace(_v, '^Bearer\s+', '') = _old_key THEN
        IF _new_form = 'jwt' THEN _h := _h || jsonb_build_object(_k, 'Bearer ' || _new_key);
        ELSE _h := _h || jsonb_build_object('apikey', _new_key); END IF;      -- Bearer sb_secret_ is refused by the platform
      ELSIF _do_key AND _v = _old_key THEN
        _h := _h || jsonb_build_object(CASE WHEN _new_form = 'sb_secret' THEN 'apikey' ELSE _k END, _new_key);
      ELSE
        _h := _h || jsonb_build_object(_k, _v);
      END IF;
    END LOOP;
    IF _h IS DISTINCT FROM _t->'headers' THEN
      PERFORM vault.create_secret(_r.d, 'faud8_undo:' || _r.name, 'F-AUD-8 · 20261010_0001 · the copy before the rotation (deleted by 0002)');
      PERFORM vault.update_secret(_r.id, jsonb_set(_t, '{headers}', _h)::text);
      _changed := _changed || _r.name;
    END IF;
  END LOOP;

  -- ── rewrite: previous copies (decision above), proved by evaluation ─────
  FOR _r IN SELECT id, name, decrypted_secret AS d FROM vault.decrypted_secrets
             WHERE name LIKE 'p9\_cron\_previous:%' ORDER BY name LOOP
    _prev := _r.d::jsonb;  _cmd := _prev->>'command';
    CONTINUE WHEN NOT ((_do_cs AND strpos(_cmd, _old_cs) > 0) OR (_do_key AND strpos(_cmd, _old_key) > 0));
    SELECT decrypted_secret::jsonb INTO _t FROM vault.decrypted_secrets WHERE name = 'p9_cron_http:' || substr(_r.name, 18);
    IF _do_key AND _new_form IS DISTINCT FROM _old_form THEN
      _cmd := format('select net.http_post(url := %L, body := %L::jsonb, params := %L::jsonb, headers := %L::jsonb, timeout_milliseconds := %s)',
                     _t->>'url', coalesce(_t->'body', '{}'::jsonb), coalesce(_t->'params', '{}'::jsonb), _t->'headers',
                     coalesce((_t->>'timeout_milliseconds')::int, 5000));
    ELSE
      IF _do_cs  THEN _cmd := replace(_cmd, _old_cs,  _new_cs);  END IF;
      IF _do_key THEN _cmd := replace(_cmd, _old_key, _new_key); END IF;
    END IF;
    BEGIN
      EXECUTE regexp_replace(rtrim(_cmd, E' \t\r\n;'), 'net\.http_post\s*\(', 'pg_temp.faud8_capture(', 'i') INTO _cap;
    EXCEPTION WHEN others THEN _cap := NULL;
    END;
    IF _cap IS DISTINCT FROM jsonb_build_object('url', _t->'url', 'body', coalesce(_t->'body', '{}'::jsonb),
                                                'params', coalesce(_t->'params', '{}'::jsonb), 'headers', _t->'headers',
                                                'timeout_milliseconds', coalesce((_t->>'timeout_milliseconds')::int, 5000)) THEN
      RAISE EXCEPTION 'F-AUD-8-PREV-001: % rewritten does not evaluate to its new live target — refusing', _r.name
        USING ERRCODE = 'raise_exception';
    END IF;
    PERFORM vault.create_secret(_r.d, 'faud8_undo:' || _r.name, 'F-AUD-8 · 20261010_0001 · the copy before the rotation (deleted by 0002)');
    PERFORM vault.update_secret(_r.id, jsonb_set(_prev, '{command}', to_jsonb(_cmd))::text);
    _changed := _changed || _r.name;
  END LOOP;
  DROP FUNCTION pg_temp.faud8_capture(text, jsonb, jsonb, jsonb, integer);

  -- ── POST · nothing managed holds an old value; every live copy holds the new ──
  _bad := '';
  FOR _r IN SELECT name, decrypted_secret AS d FROM vault.decrypted_secrets
             WHERE name LIKE 'p9\_cron\_http:%' OR name LIKE 'p9\_cron\_previous:%' LOOP
    IF (_do_cs AND strpos(_r.d, _old_cs) > 0) OR (_do_key AND strpos(_r.d, _old_key) > 0) THEN
      _bad := _bad || ' ' || _r.name;
    END IF;
    IF _r.name LIKE 'p9\_cron\_http:%' AND _do_key AND _new_form = 'sb_secret'
       AND EXISTS (SELECT 1 FROM jsonb_each_text(_r.d::jsonb->'headers') h WHERE h.value ~ '^Bearer\s+sb_secret_') THEN
      _bad := _bad || ' ' || _r.name || '(Bearer sb_secret_)';
    END IF;
  END LOOP;
  IF _bad <> '' THEN
    RAISE EXCEPTION 'F-AUD-8-POST-001: still holds an old value or a refused header:%', _bad USING ERRCODE = 'raise_exception';
  END IF;
  IF _do_cs AND EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name LIKE 'p9\_cron\_http:%'
                          AND decrypted_secret::jsonb->'headers' ? 'x-cron-secret'
                          AND decrypted_secret::jsonb->'headers'->>'x-cron-secret' <> _new_cs) THEN
    RAISE EXCEPTION 'F-AUD-8-POST-002: a live copy does not hold the new cron secret' USING ERRCODE = 'raise_exception';
  END IF;
  IF _do_key AND EXISTS (SELECT 1 FROM vault.decrypted_secrets s, jsonb_each_text(s.decrypted_secret::jsonb->'headers') h
                          WHERE s.name LIKE 'p9\_cron\_http:%' AND lower(h.key) IN ('authorization', 'apikey')
                            AND regexp_replace(h.value, '^Bearer\s+', '') <> _new_key) THEN
    RAISE EXCEPTION 'F-AUD-8-POST-002: a live copy does not hold the new service key in every key header' USING ERRCODE = 'raise_exception';
  END IF;

  -- ── record (hashes only) and remove the temporaries ─────────────────────
  SELECT decrypted_secret::jsonb INTO _rec FROM vault.decrypted_secrets WHERE name = 'faud8_rotation:last';
  PERFORM vault.create_secret(coalesce(_rec::text, 'null'), 'faud8_undo:@record', 'F-AUD-8 · 20261010_0001 · the record before the rotation (deleted by 0002)');
  _retired := coalesce(_rec->'retired_sha256', '[]'::jsonb);
  _entry := jsonb_build_object('at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                               'lane', current_setting('p32.lane'), 'copies_changed', cardinality(_changed));
  IF _do_cs THEN
    _hex := encode(sha256(convert_to(_old_cs, 'UTF8')), 'hex');  _retired := _retired || to_jsonb(_hex);
    _entry := _entry || jsonb_build_object('cron_secret', jsonb_build_object(
                'old_sha256', _hex, 'new_sha256', encode(sha256(convert_to(_new_cs, 'UTF8')), 'hex')));
  END IF;
  IF _do_key THEN
    _hex := encode(sha256(convert_to(_old_key, 'UTF8')), 'hex');  _retired := _retired || to_jsonb(_hex);
    _entry := _entry || jsonb_build_object('service_key', jsonb_build_object(
                'old_sha256', _hex, 'new_sha256', encode(sha256(convert_to(_new_key, 'UTF8')), 'hex'),
                'old_form', _old_form, 'new_form', _new_form));
  END IF;
  _rec := jsonb_build_object(
    'version', 1,
    'pending_finalize', true,
    'current', coalesce(_rec->'current', '{}'::jsonb)
               || CASE WHEN _do_cs  THEN jsonb_build_object('cron_secret_sha256', _entry->'cron_secret'->'new_sha256') ELSE '{}' END
               || CASE WHEN _do_key THEN jsonb_build_object('service_key_sha256', _entry->'service_key'->'new_sha256',
                                                            'service_key_form', _new_form) ELSE '{}' END,
    'retired_sha256', (SELECT jsonb_agg(DISTINCT x) FROM jsonb_array_elements(_retired) x),
    -- newest first (rotations[0] = this run; 0002 reads it), at most 10 kept.
    'rotations', (SELECT jsonb_agg(e ORDER BY ord) FROM (
                    SELECT e, row_number() OVER (ORDER BY i) AS ord
                      FROM jsonb_array_elements(jsonb_build_array(_entry) || coalesce(_rec->'rotations', '[]'::jsonb))
                           WITH ORDINALITY a(e, i)) z WHERE ord <= 10));
  IF EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'faud8_rotation:last') THEN
    PERFORM vault.update_secret((SELECT id FROM vault.secrets WHERE name = 'faud8_rotation:last'), _rec::text);
  ELSE
    PERFORM vault.create_secret(_rec::text, 'faud8_rotation:last', 'F-AUD-8 · SHA-256 hashes of rotated cron credentials (no value)');
  END IF;
  DELETE FROM vault.secrets WHERE name IN ('faud8_new:cron_secret', 'faud8_new:service_key');

  RAISE NOTICE 'F-AUD-8-0001: rotated% on lane %: % cop(y/ies) rewritten (%); old values kept only in faud8_undo:* until 20261010_0002; temporaries deleted',
    CASE WHEN _do_cs THEN ' cron secret' ELSE '' END || CASE WHEN _do_key THEN ' service key (' || _old_form || ' → ' || _new_form || ')' ELSE '' END,
    current_setting('p32.lane'), cardinality(_changed), array_to_string(_changed, ', ');
END
$rotate$;

COMMIT;
