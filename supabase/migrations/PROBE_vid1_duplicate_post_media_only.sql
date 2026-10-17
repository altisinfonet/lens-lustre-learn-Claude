-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · VID-1 duplicate-post guard (20261011_0002). READ-ONLY. Ends in ROLLBACK.
-- Raises (and so fails the dispatch) on a hit.
--   D1 · detect_duplicate_post() has the media-only early return (no text AND
--        no image_urls AND no image_url → content_hash NULL, RETURN NEW).
--   D2 · the text/photo path is intact: hash, advisory lock, 10-minute window,
--        the "Duplicate post detected" refusal.
--   D3 · still SECURITY DEFINER with search_path public; trigger still BEFORE
--        INSERT on public.posts; trg_rate_limit_posts still attached.
--   D4 · a replay (same user_id + idempotency_key) passes through to the
--        unique index, and that index exists, is unique and valid.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
DO $probe$
DECLARE
  hits text := '';
  _src text;
  _p   record;
BEGIN
  IF to_regprocedure('public.detect_duplicate_post()') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL VID-DUP: public.detect_duplicate_post() is missing';
  END IF;
  SELECT prosrc, prosecdef, proconfig INTO _p FROM pg_proc WHERE oid = 'public.detect_duplicate_post()'::regprocedure;
  _src := _p.prosrc;

  IF position('btrim(COALESCE(NEW.content, '''')) = ''''' IN _src) = 0
     OR position('cardinality(NEW.image_urls)' IN _src) = 0
     OR position('NEW.content_hash := NULL' IN _src) = 0 THEN
    hits := hits || E'\n  D1 the media-only early return is not in detect_duplicate_post()';
  END IF;

  IF position('pg_advisory_xact_lock(hashtextextended(NEW.user_id::text' IN _src) = 0
     OR position('interval ''10 minutes''' IN _src) = 0
     OR position('Duplicate post detected' IN _src) = 0 THEN
    hits := hits || E'\n  D2 the text/photo duplicate check is not intact';
  END IF;

  IF NOT _p.prosecdef OR _p.proconfig IS NULL OR NOT ('search_path=public' = ANY (_p.proconfig)) THEN
    hits := hits || E'\n  D3 not SECURITY DEFINER with search_path=public';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.posts'::regclass AND t.tgname = 'trg_detect_duplicate_post'
                   AND t.tgenabled <> 'D' AND pg_get_triggerdef(t.oid) ILIKE '%BEFORE INSERT%') THEN
    hits := hits || E'\n  D3 trg_detect_duplicate_post is not an enabled BEFORE INSERT trigger on posts';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.posts'::regclass AND tgname = 'trg_rate_limit_posts' AND tgenabled <> 'D') THEN
    hits := hits || E'\n  D3 trg_rate_limit_posts is not attached (spam volume would be unlimited)';
  END IF;

  IF position('AND idempotency_key = NEW.idempotency_key' IN _src) = 0 THEN
    hits := hits || E'\n  D4 the idempotency-key replay pass-through is not in detect_duplicate_post()';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = 'public.posts'::regclass AND c.relname = 'posts_user_idempotency_key'
      AND i.indisunique AND i.indisvalid
  ) THEN
    hits := hits || E'\n  D4 unique index posts_user_idempotency_key is missing or invalid';
  END IF;

  IF hits <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL VID-DUP:%', hits;
  END IF;
  RAISE NOTICE 'PROBE PASS VID-DUP: media-only posts skip the hash check; replays reach the unique index; text/photo check intact; rate limit attached';
END
$probe$;
ROLLBACK;
