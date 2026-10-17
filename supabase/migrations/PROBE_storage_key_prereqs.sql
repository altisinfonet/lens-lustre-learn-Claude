-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · storage-key validation (PR #421) — deploy prerequisites.
-- READ-ONLY. Ends in ROLLBACK. Raises (and so fails the dispatch) on a hit.
--
-- PRINTS COUNTS AND BOOLEANS ONLY. No value from the settings row, and no
-- value from any attachment or image column, is ever placed in a NOTICE or in
-- an error. Nothing below casts a stored value (a failed cast would echo it).
--
-- The edge functions now refuse, before signing anything, a configuration or a
-- key outside the storage-key grammar (supabase/functions/_shared/s3.ts). These
-- checks confirm the live configuration is inside it, so the deploy cannot turn
-- every storage request into a refusal:
--
--   K1 · bucket_name is a string matching ^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$ and
--        does not name a video bucket (assertStorageLane).
--   K2 · path_prefix is absent, null, empty, or a string matching
--        ^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*/*$ (so no leading "/"), with no "."
--        or ".." segment and at most 512 characters once trailing slashes are
--        dropped (normalisedPathPrefix / storageKeyWithPrefix).
--   K3 · endpoint is absent, null, empty, or exactly
--        https://<32 lowercase hex>.r2.cloudflarestorage.com — one trailing "/"
--        allowed (the code drops it); no other path, no query, no whitespace.
--
-- REPORT ONLY (never fails):
--   R1 · stored attachment keys (not http/https) that validateStorageKey would
--        refuse, for each (table, column) below that exists on this lane. The
--        key is formed as the client sends it to s3-signed-url: the bucket
--        prefix "support-attachments/" added when missing, ends trimmed.
--        In the migrations only ticket_replies has attachment_url;
--        support_tickets is listed so a column added outside the migrations is
--        still counted, and is reported absent otherwise.
--   R2 · hero_banners / portfolio_images image URLs whose part after the last
--        "/portfolio-images/" contains "%" or a non-ASCII character — and,
--        separately, any part the key grammar refuses. The admin delete path
--        sends "portfolio-images/<that part>" to s3-delete.
--
-- Every table and column is looked up first (to_regclass, information_schema),
-- so the PROBE never errors on a lane where one is missing.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
DO $probe$
DECLARE
  hits     text := '';
  report   text := '';
  s        jsonb;
  present  boolean := false;
  is_obj   boolean := false;
  enabled  boolean := false;
  pp_set   boolean := false;
  ep_set   boolean := false;
  t        text;
  v        text;
  r        record;
  n_bad    bigint;
  n_all    bigint;
  n_pct    bigint;
BEGIN
  -- ── The settings row ──────────────────────────────────────────────────────
  IF to_regclass('public.site_settings') IS NOT NULL THEN
    SELECT value INTO s FROM public.site_settings WHERE key = 's3_storage_settings';
    present := FOUND;
  END IF;
  is_obj  := COALESCE(present AND jsonb_typeof(s) = 'object', false);
  enabled := COALESCE(is_obj AND (s -> 'enabled') = 'true'::jsonb, false);

  IF is_obj THEN
    -- K1 · bucket_name
    t := jsonb_typeof(s -> 'bucket_name');
    IF t IS DISTINCT FROM 'string' THEN
      hits := hits || E'\n  K1 bucket_name is missing or not a string';
    ELSE
      v := s ->> 'bucket_name';
      IF v !~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$' THEN
        hits := hits || E'\n  K1 bucket_name is not a plain bucket name (3-63 of a-z 0-9 -)';
      ELSIF v ~* 'video' THEN
        hits := hits || E'\n  K1 bucket_name names a video bucket';
      END IF;
    END IF;

    -- K2 · path_prefix
    t := jsonb_typeof(s -> 'path_prefix');
    IF t IS NULL OR t = 'null' THEN
      NULL;
    ELSIF t <> 'string' THEN
      hits := hits || E'\n  K2 path_prefix is not a string';
    ELSE
      v := s ->> 'path_prefix';
      pp_set := v <> '';
      IF v = '' THEN
        NULL;
      ELSIF v !~ '^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*/*$' THEN
        hits := hits || E'\n  K2 path_prefix is outside the key grammar or starts with "/"';
      ELSIF ('/' || rtrim(v, '/') || '/') ~ '/[.]{1,2}/' THEN
        hits := hits || E'\n  K2 path_prefix has a "." or ".." segment';
      ELSIF char_length(rtrim(v, '/')) > 512 THEN
        hits := hits || E'\n  K2 path_prefix is longer than 512 characters';
      END IF;
    END IF;

    -- K3 · endpoint
    t := jsonb_typeof(s -> 'endpoint');
    IF t IS NULL OR t = 'null' THEN
      NULL;
    ELSIF t <> 'string' THEN
      hits := hits || E'\n  K3 endpoint is not a string';
    ELSE
      v := s ->> 'endpoint';
      ep_set := v <> '';
      IF v <> '' AND v !~ '^https://[0-9a-f]{32}[.]r2[.]cloudflarestorage[.]com/?$' THEN
        hits := hits || E'\n  K3 endpoint is not a bare https://<32 hex>.r2.cloudflarestorage.com';
      END IF;
    END IF;
  END IF;
  v := NULL;  -- nothing from the settings row outlives the checks above

  -- ── R1 · stored attachment keys the validator would refuse ────────────────
  FOR r IN SELECT * FROM (VALUES ('support_tickets', 'attachment_url'),
                                 ('ticket_replies',  'attachment_url')) AS p(tbl, col) LOOP
    IF to_regclass('public.' || quote_ident(r.tbl)) IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = r.tbl AND column_name = r.col) THEN
      EXECUTE format($q$
        SELECT count(*) FILTER (WHERE char_length(key) > 512
                                   OR key !~ '^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$'
                                   OR ('/' || key || '/') ~ '/[.]{1,2}/'),
               count(*)
          FROM (SELECT btrim(CASE WHEN left(raw, 20) = 'support-attachments/' THEN raw
                                  ELSE 'support-attachments/' || raw END, E' \t\r\n') AS key
                  FROM (SELECT %I AS raw FROM public.%I) a
                 WHERE raw IS NOT NULL AND raw <> '' AND left(raw, 4) <> 'http') k
      $q$, r.col, r.tbl) INTO n_bad, n_all;
      report := report || format(E'\n  R1 %s.%s: %s of %s stored keys would be refused',
                                 r.tbl, r.col, n_bad, n_all);
    ELSE
      report := report || format(E'\n  R1 %s.%s: absent on this lane', r.tbl, r.col);
    END IF;
  END LOOP;

  -- ── R2 · portfolio-images delete paths ────────────────────────────────────
  FOR r IN SELECT * FROM (VALUES ('hero_banners',     'image_url'),
                                 ('portfolio_images', 'image_url')) AS p(tbl, col) LOOP
    IF to_regclass('public.' || quote_ident(r.tbl)) IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = r.tbl AND column_name = r.col) THEN
      EXECUTE format($q$
        SELECT count(*) FILTER (WHERE strpos(tail, chr(37)) > 0
                                   OR octet_length(tail) <> char_length(tail)),
               count(*) FILTER (WHERE char_length('portfolio-images/' || tail) > 512
                                   OR ('portfolio-images/' || tail) !~ '^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$'
                                   OR ('/portfolio-images/' || tail || '/') ~ '/[.]{1,2}/'),
               count(*)
          FROM (SELECT regexp_replace(url, '^.*/portfolio-images/', '') AS tail
                  FROM (SELECT %I AS url FROM public.%I) a
                 WHERE url IS NOT NULL AND strpos(url, '/portfolio-images/') > 0) k
      $q$, r.col, r.tbl) INTO n_pct, n_bad, n_all;
      report := report || format(E'\n  R2 %s.%s: %s of %s portfolio-images paths contain %s or non-ASCII; %s would be refused by the key grammar',
                                 r.tbl, r.col, n_pct, n_all, chr(37), n_bad);
    ELSE
      report := report || format(E'\n  R2 %s.%s: absent on this lane', r.tbl, r.col);
    END IF;
  END LOOP;

  RAISE NOTICE 'PROBE REPORT storage-keys (counts only, never fails):%', report;

  IF hits <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL storage-keys:%', hits;
  END IF;
  RAISE NOTICE 'PROBE PASS storage-keys: settings row present: %, object: %, enabled: %, path_prefix set: %, endpoint set: %',
    present, is_obj, enabled, pp_set, ep_set;
END
$probe$;
ROLLBACK;
