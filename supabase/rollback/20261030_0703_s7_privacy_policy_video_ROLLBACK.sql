-- ROLLBACK for 20261030_0703_s7_privacy_policy_video.sql — takes the video block
-- back out of the Privacy Policy page (site_settings.managed_pages, slug
-- privacy-policy). Removes ONLY the marked block and reverts the two exact
-- production phrases; every other page and every other word stays. If the
-- result is byte-for-byte the version read on 2026-10-31, that version's
-- updated_at is restored too; if the Owner edited the page since, his edits
-- stay and only the block goes. The old content is also in db_audit_logs
-- (audit_site_settings trigger).
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'APPLY REFUSED — p32.lane is not asserted' USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $rb$
DECLARE
  _pages jsonb;
  _idx   integer;
  _old   text;
  _new   text;
  _s     integer;
  _e     integer;
  _ts    text;
BEGIN
  SELECT value INTO _pages FROM public.site_settings WHERE key = 'managed_pages' FOR UPDATE;
  SELECT (o - 1)::int, e ->> 'content' INTO _idx, _old
    FROM jsonb_array_elements(_pages) WITH ORDINALITY AS t(e, o) WHERE e ->> 'slug' = 'privacy-policy';
  IF _idx IS NULL OR strpos(coalesce(_old, ''), '<!-- s7-video-privacy -->') = 0 THEN
    RAISE NOTICE 'S7-0703-ROLLBACK: no video block on lane % — nothing to do', current_setting('p32.lane');
    RETURN;
  END IF;
  _s := strpos(_old, '<!-- s7-video-privacy -->');
  _e := strpos(_old, '<!-- /s7-video-privacy -->');
  IF _e < _s THEN RAISE EXCEPTION 'S7-0703-ROLLBACK: block markers out of order — fix by hand'; END IF;
  _new := left(_old, _s - 1) || substr(_old, _e + length('<!-- /s7-video-privacy -->'));
  _new := replace(_new, 'content delivery, security and photo and video storage (Cloudflare), video conversion on our own server (Oracle Cloud)',
                  'content delivery and security (Cloudflare)');
  _new := replace(_new, 'Last updated: 31st October 2026', 'Last updated: 17th October 2026');
  _ts := CASE md5(_new) WHEN '9e2488beef9242f12ce730c6c8ec5e92' THEN '2026-10-17T05:51:34.199Z'
                        WHEN 'a45df80ca998dc39521c385b4670fb52' THEN '2026-04-05T04:13:54.221Z'
                        ELSE to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END;
  UPDATE public.site_settings
     SET value = jsonb_set(jsonb_set(_pages, ARRAY[_idx::text, 'content'], to_jsonb(_new)), ARRAY[_idx::text, 'updated_at'], to_jsonb(_ts)),
         updated_at = now()
   WHERE key = 'managed_pages';
  RAISE NOTICE 'S7-0703-ROLLBACK: video block removed on lane % (now md5 %; %)', current_setting('p32.lane'), md5(_new),
    CASE WHEN md5(_new) IN ('9e2488beef9242f12ce730c6c8ec5e92', 'a45df80ca998dc39521c385b4670fb52')
         THEN 'identical to the version read on 2026-10-31' ELSE 'later Owner edits kept' END;
END
$rb$;

DO $post$ BEGIN
  IF EXISTS (SELECT 1 FROM public.site_settings s, jsonb_array_elements(s.value) e
              WHERE s.key = 'managed_pages' AND e ->> 'slug' = 'privacy-policy'
                AND strpos(e ->> 'content', 's7-video-privacy') > 0) THEN
    RAISE EXCEPTION 'S7-0703-ROLLBACK-POST: the video block is still on the page';
  END IF;
END $post$;

COMMIT;
