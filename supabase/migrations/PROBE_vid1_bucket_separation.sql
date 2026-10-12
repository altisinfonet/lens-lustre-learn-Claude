-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · VID-1 bucket separation (CONVERTER-DESIGN.md v2 §7, review R4) — the
-- DATABASE half. READ-ONLY. Ends in ROLLBACK. Raises (and so fails the
-- dispatch) on a hit. Changes nothing; creates nothing; needs no migration.
--
-- The photo uploaders (s3-presign-upload, s3-upload, s3-delete, s3-signed-url)
-- take their bucket and credential from site_settings.s3_storage_settings and
-- nowhere else. The video Functions take theirs from the Pages project (binding
-- MEDIA / R2_BUCKET = the lane's video bucket). This probe proves, from the
-- live row, that the photo side is NOT configured for a video bucket.
--
-- SECRETS: it reads ONLY value->>'enabled', 'bucket_name', 'endpoint',
-- 'path_prefix' and 'public_url'. It never reads access_key_id or
-- secret_access_key, and never prints the endpoint (it carries the Cloudflare
-- account id) — only whether its shape is right.
--
--   B1 · bucket_name is a valid R2 bucket name, is NOT '50mm-staging-video',
--        and names no video bucket at all (no 'video' in it).
--   B2 · endpoint is a bare R2 account endpoint
--        (https://<32 hex>.[eu.|fedramp.]r2.cloudflarestorage.com, no path):
--        a path or a bucket sub-domain in it would move every signed URL into
--        whatever bucket it names, whatever bucket_name says.
--   B3 · path_prefix, if set, holds only [A-Za-z0-9_/-].
--   B4 · lane: p32.lane = 'staging' → bucket_name = '50mm-staging';
--        p32.lane = 'production' → bucket_name = '50mm' (as assertStorageLane).
-- Reported, not failed: lane, enabled, bucket_name, public_url host.
-- A missing or disabled row is a PASS with that said: the photo functions
-- then sign nothing at all.
--
-- LIMIT, stated: this proves the CONFIGURATION. It cannot prove the photo
-- credential's R2 token is scoped to its own bucket — that is the token's
-- permission list in Cloudflare (R2 → Manage API tokens), read by a human.
-- See docs/evidence/d2/phase5/VID-1/BUCKET-SEPARATION-staging.md.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
DO $probe$
DECLARE
  hits      text := '';
  _lane     text := coalesce(current_setting('p32.lane', true), '');
  _found    boolean;
  _enabled  boolean;
  _bucket   text;
  _endpoint text;
  _prefix   text;
  _pubhost  text;
BEGIN
  SELECT true,
         coalesce(s.value->>'enabled', '') = 'true',
         btrim(coalesce(s.value->>'bucket_name', '')),
         btrim(coalesce(s.value->>'endpoint', '')),
         coalesce(s.value->>'path_prefix', ''),
         substring(coalesce(s.value->>'public_url', '') from '^https?://([^/]+)')
    INTO _found, _enabled, _bucket, _endpoint, _prefix, _pubhost
    FROM public.site_settings s
   WHERE s.key = 's3_storage_settings';

  IF NOT coalesce(_found, false) THEN
    RAISE NOTICE 'PROBE PASS VID-1-R4: lane %; no s3_storage_settings row — the photo functions sign nothing', nullif(_lane, '');
    RETURN;
  END IF;

  -- B1
  IF _bucket !~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$' THEN
    hits := hits || format(E'\n  B1 bucket_name %L is not a valid R2 bucket name', _bucket);
  END IF;
  IF _bucket = '50mm-staging-video' THEN
    hits := hits || E'\n  B1 bucket_name IS the staging video bucket 50mm-staging-video';
  ELSIF position('video' in lower(_bucket)) > 0 THEN
    hits := hits || format(E'\n  B1 bucket_name %L names a video bucket', _bucket);
  END IF;

  -- B2 (the value is never printed)
  IF _endpoint !~ '^https://[0-9a-f]{32}\.(eu\.|fedramp\.)?r2\.cloudflarestorage\.com/*$' THEN
    hits := hits || E'\n  B2 endpoint is not a bare R2 account endpoint (value withheld: it carries the account id)';
  END IF;

  -- B3
  IF _prefix <> '' AND _prefix !~ '^[A-Za-z0-9_/-]+$' THEN
    hits := hits || E'\n  B3 path_prefix holds a character outside [A-Za-z0-9_/-]';
  END IF;

  -- B4
  IF _lane = 'staging' AND _bucket <> '50mm-staging' THEN
    hits := hits || format(E'\n  B4 lane staging but bucket_name is %L, not 50mm-staging', _bucket);
  ELSIF _lane = 'production' AND _bucket <> '50mm' THEN
    hits := hits || format(E'\n  B4 lane production but bucket_name is %L, not 50mm', _bucket);
  END IF;

  IF hits <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL VID-1-R4:%', hits;
  END IF;
  RAISE NOTICE 'PROBE PASS VID-1-R4: lane %; enabled %; photo bucket_name % (not a video bucket); endpoint = bare R2 account endpoint; public_url host %',
    nullif(_lane, ''), _enabled, _bucket, coalesce(_pubhost, '(none)');
END
$probe$;
ROLLBACK;
