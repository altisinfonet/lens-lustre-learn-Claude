-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · VID-1 bucket separation (CONVERTER-DESIGN.md v2 §7, review R4) — the
-- DATABASE half. READ-ONLY. Ends in ROLLBACK. Raises (and so fails the
-- dispatch) on a hit. Changes nothing; creates nothing; needs no migration.
--
-- The photo functions (s3-presign-upload, s3-upload, s3-delete, s3-signed-url)
-- take their bucket and credential from site_settings.s3_storage_settings and
-- nowhere else. The video Functions take theirs from the Pages project (binding
-- MEDIA / R2_BUCKET = the lane's video bucket). This probe proves, from the
-- live row, that the photo side is NOT configured for a video bucket.
--
-- SECRETS, AND THE LOG IS PUBLIC. This repository's Actions logs are public.
-- The probe reads ONLY value->>'enabled', 'bucket_name', 'endpoint',
-- 'path_prefix' and 'public_url' (never access_key_id or secret_access_key),
-- and prints nothing that could be a key, even when a field was filled in
-- wrongly (a key pasted into Bucket Name, the S3 endpoint into Public URL):
--   · endpoint and path_prefix are never printed;
--   · bucket_name is printed only when it is a valid R2 bucket name, and then
--     with any uuid, any run of 16+ hex characters and any run of 20+ letters
--     or digits replaced by a marker; an invalid one is withheld;
--   · the public_url host is printed only when it is a host under
--     50mmretina.com; a public_url that holds 32 hex characters or names
--     r2.cloudflarestorage.com FAILS (B5) and is withheld;
--   · p32.lane is printed only as staging / production / unset.
--
--   B1 · bucket_name is a valid R2 bucket name, is NOT '50mm-staging-video',
--        and names no video bucket at all (no 'video' in it).
--   B2 · endpoint is a bare R2 account endpoint
--        (https://<32 hex>.[eu.|fedramp.]r2.cloudflarestorage.com, no path):
--        a path or a bucket sub-domain in it would move every signed URL into
--        whatever bucket it names, whatever bucket_name says.
--   B3 · path_prefix, if set, holds only [A-Za-z0-9_/-].
--   B4 · lane, only when p32.lane is set (apply-migration.yml sets it):
--        staging → bucket_name must be exactly '50mm-staging'. That is
--        STRICTER than assertStorageLane, which on a non-production lane only
--        refuses the production bucket '50mm' and the production CDN host.
--        production → bucket_name must be '50mm' (the same as
--        assertStorageLane). Unset → not run, and the PASS line says so.
--   B5 · public_url holds no run of 32 hex characters and does not name
--        r2.cloudflarestorage.com: that is the S3 API endpoint, which carries
--        the account id, not a public host.
-- A MISSING row is a PASS, said so: the photo functions then sign nothing.
-- A row with enabled = false is still checked against B1–B5 (it can be
-- switched on again at any time) and is reported as disabled.
-- Reported, not failed: lane, enabled, bucket_name, public_url host.
--
-- LIMIT, stated: this proves the CONFIGURATION. It cannot prove the photo
-- credential's R2 token is scoped to its own bucket — that is the token's
-- permission list in Cloudflare (R2 → Manage API tokens).
-- See docs/evidence/d2/phase5/VID-1/BUCKET-SEPARATION-staging.md.
-- Behaviour test (PGlite, fake rows): docs/evidence/d2/phase5/VID-1/bucket-separation/.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
DO $probe$
DECLARE
  hits      text := '';
  _lane     text := coalesce(current_setting('p32.lane', true), '');
  _lane_out text;
  _found    boolean;
  _enabled  boolean;
  _bucket   text;
  _endpoint text;
  _prefix   text;
  _pub      text;
  _pubhost  text;
  _pub_bad  boolean;
  _b_out    text;   -- bucket_name as it may be printed
  _p_out    text;   -- public_url host as it may be printed
BEGIN
  _lane_out := CASE WHEN _lane IN ('staging', 'production') THEN _lane ELSE 'unset' END;

  SELECT true,
         coalesce(s.value->>'enabled', '') = 'true',
         btrim(coalesce(s.value->>'bucket_name', '')),
         btrim(coalesce(s.value->>'endpoint', '')),
         coalesce(s.value->>'path_prefix', ''),
         btrim(coalesce(s.value->>'public_url', ''))
    INTO _found, _enabled, _bucket, _endpoint, _prefix, _pub
    FROM public.site_settings s
   WHERE s.key = 's3_storage_settings';

  IF NOT coalesce(_found, false) THEN
    RAISE NOTICE 'PROBE PASS VID-1-R4: lane %; no s3_storage_settings row — the photo functions sign nothing', _lane_out;
    RETURN;
  END IF;

  -- What may be printed. Nothing else from the row ever is.
  _b_out := CASE
    WHEN _bucket = '' THEN '(empty)'
    WHEN _bucket ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$' THEN
      regexp_replace(
        regexp_replace(
          regexp_replace(left(_bucket, 63),
                         '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}', '<uuid withheld>', 'g'),
          '[0-9A-Fa-f]{16,}', '<hex withheld>', 'g'),
        '[0-9A-Za-z]{20,}', '<withheld>', 'g')
    ELSE '(withheld: not a valid bucket name)'
  END;
  _pub_bad := _pub ~ '[0-9A-Fa-f]{32}' OR position('r2.cloudflarestorage.com' in lower(_pub)) > 0;
  _pubhost := lower(substring(_pub from '^[Hh][Tt][Tt][Pp][Ss]?://([^/?#]+)'));
  _p_out := CASE
    WHEN _pub = '' THEN '(none)'
    WHEN _pub_bad THEN '(withheld)'
    WHEN _pubhost ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*50mmretina\.com$' THEN
      regexp_replace(_pubhost, '[0-9a-f]{16,}', '<hex withheld>', 'g')
    ELSE '(withheld: not a 50mmretina.com host)'
  END;

  -- B1
  IF _bucket !~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$' THEN
    hits := hits || E'\n  B1 bucket_name is not a valid R2 bucket name (value withheld)';
  END IF;
  IF _bucket = '50mm-staging-video' THEN
    hits := hits || E'\n  B1 bucket_name IS the staging video bucket 50mm-staging-video';
  ELSIF position('video' in lower(_bucket)) > 0 THEN
    hits := hits || format(E'\n  B1 bucket_name %s names a video bucket', _b_out);
  END IF;

  -- B2 (the value is never printed)
  IF _endpoint !~ '^https://[0-9a-f]{32}\.(eu\.|fedramp\.)?r2\.cloudflarestorage\.com/*$' THEN
    hits := hits || E'\n  B2 endpoint is not a bare R2 account endpoint (value withheld: it carries the account id)';
  END IF;

  -- B3 (the value is never printed)
  IF _prefix <> '' AND _prefix !~ '^[A-Za-z0-9_/-]+$' THEN
    hits := hits || E'\n  B3 path_prefix holds a character outside [A-Za-z0-9_/-] (value withheld)';
  END IF;

  -- B4
  IF _lane = 'staging' AND _bucket <> '50mm-staging' THEN
    hits := hits || format(E'\n  B4 lane staging but bucket_name is %s, not 50mm-staging', _b_out);
  ELSIF _lane = 'production' AND _bucket <> '50mm' THEN
    hits := hits || format(E'\n  B4 lane production but bucket_name is %s, not 50mm', _b_out);
  END IF;

  -- B5 (the value is never printed)
  IF _pub_bad THEN
    hits := hits || E'\n  B5 public_url holds 32 hex characters or names r2.cloudflarestorage.com (value withheld)';
  END IF;

  IF hits <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL VID-1-R4:%', hits;
  END IF;
  RAISE NOTICE 'PROBE PASS VID-1-R4: lane %; %; photo bucket_name % (not a video bucket); endpoint = bare R2 account endpoint (value withheld); public_url host %; %',
    _lane_out,
    CASE WHEN _enabled THEN 'enabled' ELSE 'DISABLED (checked anyway)' END,
    _b_out, _p_out,
    CASE _lane WHEN 'staging' THEN 'B4 run: staging pinned to 50mm-staging'
               WHEN 'production' THEN 'B4 run: production pinned to 50mm'
               ELSE 'B4 not run (p32.lane unset)' END;
END
$probe$;
ROLLBACK;
