-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · VID-1 one-step video publish (20261011_0003). READ-ONLY. Ends in ROLLBACK.
-- Raises (and so fails the dispatch) on a hit.
--   P1 · video_publish_post(uuid,text,text,text[],text) exists, SECURITY INVOKER,
--        search_path '', returns uuid.
--   P2 · EXECUTE: authenticated yes; anon and PUBLIC no.
--   P3 · its body writes the post AND the post_videos link, sets the
--        transaction-local marker, and has the idempotent replay.
--   P4 · detect_duplicate_post(): the video-publish skip re-checks the video
--        (ready, author's own, purpose post, not yet linked); the 0002 parts
--        (media-only early return, lock, replay pass-through, 10-minute window)
--        are intact; still SECURITY DEFINER with search_path public.
--   P5 · the rules SECURITY INVOKER relies on are present: posts "own user_id"
--        INSERT policy, post_videos_insert_own, tg_post_videos_link_guard,
--        trg_detect_duplicate_post and trg_rate_limit_posts enabled.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
DO $probe$
DECLARE
  hits text := '';
  _fn  regprocedure := to_regprocedure('public.video_publish_post(uuid,text,text,text[],text)');
  _p   record;
  _d   record;
BEGIN
  IF _fn IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL VID-PUB: public.video_publish_post(uuid,text,text,text[],text) is missing';
  END IF;
  SELECT prosrc, prosecdef, proconfig, prorettype::regtype::text AS ret INTO _p FROM pg_proc WHERE oid = _fn;

  IF _p.prosecdef OR _p.proconfig IS NULL OR NOT ('search_path=""' = ANY (_p.proconfig)) OR _p.ret <> 'uuid' THEN
    hits := hits || E'\n  P1 not SECURITY INVOKER / search_path '''' / returns uuid';
  END IF;

  IF NOT has_function_privilege('authenticated', _fn, 'EXECUTE') THEN
    hits := hits || E'\n  P2 authenticated cannot execute video_publish_post';
  END IF;
  IF has_function_privilege('anon', _fn, 'EXECUTE') THEN
    hits := hits || E'\n  P2 anon can execute video_publish_post';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc, aclexplode(coalesce(proacl, acldefault('f', proowner))) a
              WHERE oid = _fn AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    hits := hits || E'\n  P2 PUBLIC can execute video_publish_post';
  END IF;

  IF position('INSERT INTO public.posts (user_id, content, privacy, categories, idempotency_key)' IN _p.prosrc) = 0
     OR position('INSERT INTO public.post_videos (post_id, video_id) VALUES (_post, _video_id)' IN _p.prosrc) = 0
     OR position('set_config(''vid1.publishing_video'', _video_id::text, true)' IN _p.prosrc) = 0
     OR position('p.idempotency_key = _idempotency_key' IN _p.prosrc) = 0 THEN
    hits := hits || E'\n  P3 the body is not the one-step publish (post + link + marker + replay)';
  END IF;

  SELECT prosrc, prosecdef, proconfig INTO _d FROM pg_proc WHERE oid = to_regprocedure('public.detect_duplicate_post()');
  IF _d.prosrc IS NULL
     OR position('current_setting(''vid1.publishing_video'', true)' IN _d.prosrc) = 0
     OR position('v.owner_id = NEW.user_id' IN _d.prosrc) = 0
     OR position('v.state = ''ready''' IN _d.prosrc) = 0
     OR position('v.purpose = ''post''' IN _d.prosrc) = 0
     OR position('NOT EXISTS (SELECT 1 FROM public.post_videos pv WHERE pv.video_id = pub::uuid)' IN _d.prosrc) = 0 THEN
    hits := hits || E'\n  P4 the video-publish skip does not re-check the video';
  END IF;
  IF position('NEW.content_hash := NULL' IN _d.prosrc) = 0
     OR position('pg_advisory_xact_lock(hashtextextended(NEW.user_id::text' IN _d.prosrc) = 0
     OR position('AND idempotency_key = NEW.idempotency_key' IN _d.prosrc) = 0
     OR position('interval ''10 minutes''' IN _d.prosrc) = 0
     OR position('Duplicate post detected' IN _d.prosrc) = 0 THEN
    hits := hits || E'\n  P4 a 0002 part of detect_duplicate_post() is missing';
  END IF;
  IF NOT _d.prosecdef OR _d.proconfig IS NULL OR NOT ('search_path=public' = ANY (_d.proconfig)) THEN
    hits := hits || E'\n  P4 detect_duplicate_post() is not SECURITY DEFINER with search_path=public';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.posts'::regclass AND polcmd = 'a'
                   AND pg_get_expr(polwithcheck, polrelid) ILIKE '%user_id = ( SELECT auth.uid()%') THEN
    hits := hits || E'\n  P5 posts has no "own user_id" INSERT policy';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.post_videos'::regclass AND polname = 'post_videos_insert_own') THEN
    hits := hits || E'\n  P5 post_videos_insert_own is missing';
  END IF;
  IF (SELECT count(*) FROM pg_trigger
       WHERE tgenabled <> 'D' AND ((tgrelid = 'public.post_videos'::regclass AND tgname = 'tg_post_videos_link_guard')
          OR (tgrelid = 'public.posts'::regclass AND tgname IN ('trg_detect_duplicate_post', 'trg_rate_limit_posts')))) <> 3 THEN
    hits := hits || E'\n  P5 link guard / duplicate guard / rate limit trigger not all enabled';
  END IF;

  IF hits <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL VID-PUB:%', hits;
  END IF;
  RAISE NOTICE 'PROBE PASS VID-PUB: one-step publish (invoker, authenticated only); duplicate guard re-checks the video; all rules in place';
END
$probe$;
ROLLBACK;
