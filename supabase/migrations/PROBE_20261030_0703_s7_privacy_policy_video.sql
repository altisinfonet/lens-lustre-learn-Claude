-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261030_0703 — S7 privacy policy: videos + music recognition
-- READ-ONLY in effect: reads site_settings / db_audit_logs and ends in ROLLBACK.
-- FAILS before 20261030_0703 (G1: the page has no video block).
--
--   G0 · lane guard.
--   G1 · the privacy-policy page carries the block exactly once, with its
--        three headings (Videos · Music recognition (copyright check) · Video
--        reports and removal), the "switched off today" statement and the
--        30-day rule; no '@' inside the block. Where the page has the
--        "Contact / Grievance Officer" heading (production) the block sits
--        right before it, the date reads 31st October 2026 and the processor
--        list names video storage and the conversion server.
--   G2 · the page is still published and anon (how the site and apps read it)
--        sees the block.
--   G3 · if the audit trigger recorded the change: every OTHER page is
--        byte-identical before and after it, and on the privacy page only
--        content and updated_at changed.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $g0$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted (read: %)', coalesce(current_setting('p32.lane', true), '(unset)');
  END IF;
END
$g0$;

DO $g1_g3$
DECLARE
  _p jsonb; _c text; _blk text; _bad text := ''; _anon text; _ao jsonb; _an jsonb; _o jsonb; _n jsonb; _diff int;
  _anchor constant text := '<p dir="ltr"><strong>Contact / Grievance Officer</strong>';
BEGIN
  SELECT e INTO _p FROM public.site_settings s, jsonb_array_elements(s.value) e
   WHERE s.key = 'managed_pages' AND e ->> 'slug' = 'privacy-policy';
  _c := _p ->> 'content';
  IF _c IS NULL THEN RAISE EXCEPTION 'PROBE FAIL G1 (20261030_0703): no privacy-policy page'; END IF;
  IF (length(_c) - length(replace(_c, '<!-- s7-video-privacy -->', ''))) / length('<!-- s7-video-privacy -->') <> 1
     OR (length(_c) - length(replace(_c, '<!-- /s7-video-privacy -->', ''))) / length('<!-- /s7-video-privacy -->') <> 1 THEN
    RAISE EXCEPTION 'PROBE FAIL G1 (20261030_0703): the video block is not on the privacy policy exactly once';
  END IF;
  _blk := substr(_c, strpos(_c, '<!-- s7-video-privacy -->'),
                 strpos(_c, '<!-- /s7-video-privacy -->') - strpos(_c, '<!-- s7-video-privacy -->'));
  IF strpos(_blk, '<strong>Videos</strong>') = 0 THEN _bad := _bad || E'\n  heading Videos missing'; END IF;
  IF strpos(_blk, '<strong>Music recognition (copyright check)</strong>') = 0 THEN _bad := _bad || E'\n  heading Music recognition missing'; END IF;
  IF strpos(_blk, '<strong>Video reports and removal</strong>') = 0 THEN _bad := _bad || E'\n  heading Video reports missing'; END IF;
  IF strpos(_blk, 'This check is switched off today.') = 0 THEN _bad := _bad || E'\n  "switched off today" missing'; END IF;
  IF strpos(_blk, 'kept for 30 days and then permanently deleted') = 0 THEN _bad := _bad || E'\n  30-day rule missing'; END IF;
  -- conversion is a site-wide admin setting (src/lib/video/conversionMode.ts:4-7), never a member's choice (review #727)
  IF strpos(_blk, 'if you choose') > 0 OR strpos(_blk, 'When we switch on server preparation') = 0 THEN
    _bad := _bad || E'\n  the conversion sentence does not say that we (not the member) switch server preparation on';
  END IF;
  IF strpos(_blk, '@') > 0 THEN _bad := _bad || E'\n  an @ (address) inside the block'; END IF;
  IF strpos(_c, _anchor) > 0 THEN
    IF strpos(_c, '<!-- /s7-video-privacy -->' || _anchor) = 0 THEN _bad := _bad || E'\n  block not right before Contact / Grievance Officer'; END IF;
    IF strpos(_c, 'Last updated: 31st October 2026') = 0 THEN _bad := _bad || E'\n  date not 31st October 2026'; END IF;
    IF strpos(_c, 'photo and video storage (Cloudflare), video conversion on our own server (Oracle Cloud)') = 0 THEN
      _bad := _bad || E'\n  processor list does not name video storage / the conversion server';
    END IF;
  END IF;
  IF _bad <> '' THEN RAISE EXCEPTION 'PROBE FAIL G1 (20261030_0703):%', _bad; END IF;

  -- G2 · published, and anon sees it
  IF (_p ->> 'is_published')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'PROBE FAIL G2: the privacy policy is not published'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  SELECT e ->> 'content' INTO _anon FROM public.site_settings s, jsonb_array_elements(s.value) e
   WHERE s.key = 'managed_pages' AND e ->> 'slug' = 'privacy-policy';
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  IF _anon IS DISTINCT FROM _c THEN RAISE EXCEPTION 'PROBE FAIL G2: anon does not read the updated privacy policy'; END IF;

  -- G3 · the recorded change touched only this page's content and updated_at
  IF to_regclass('public.db_audit_logs') IS NOT NULL THEN
    EXECUTE $q$SELECT old_data -> 'value' AS o, new_data -> 'value' AS n FROM public.db_audit_logs
                WHERE table_name = 'site_settings' AND row_id = 'managed_pages'
                  AND strpos(new_data::text, 's7-video-privacy') > 0 AND strpos(old_data::text, 's7-video-privacy') = 0
                ORDER BY created_at DESC LIMIT 1$q$ INTO _ao, _an;
  END IF;
  IF _ao IS NULL THEN
    RAISE NOTICE 'PROBE G3: no audit row of the change on this lane — the other-pages check is not checkable here';
  ELSE
    SELECT count(*) INTO _diff FROM (
      SELECT e FROM jsonb_array_elements(_ao) e WHERE e ->> 'slug' <> 'privacy-policy'
      EXCEPT ALL SELECT e FROM jsonb_array_elements(_an) e WHERE e ->> 'slug' <> 'privacy-policy') x;
    IF _diff <> 0 OR jsonb_array_length(_ao) <> jsonb_array_length(_an) THEN RAISE EXCEPTION 'PROBE FAIL G3: another page changed'; END IF;
    SELECT e - 'content' - 'updated_at' INTO _o FROM jsonb_array_elements(_ao) e WHERE e ->> 'slug' = 'privacy-policy';
    SELECT e - 'content' - 'updated_at' INTO _n FROM jsonb_array_elements(_an) e WHERE e ->> 'slug' = 'privacy-policy';
    IF _o IS DISTINCT FROM _n THEN RAISE EXCEPTION 'PROBE FAIL G3: a privacy-page field other than content / updated_at changed'; END IF;
  END IF;

  RAISE NOTICE 'PROBE PASS 20261030_0703 (lane %): video block once with 3 headings, off-today + 30-day statements, no address; %; published and read by anon; %',
    current_setting('p32.lane', true),
    CASE WHEN strpos(_c, _anchor) > 0 THEN 'before Contact, date 31 Oct, processors named' ELSE 'appended (no Contact heading on this lane)' END,
    CASE WHEN _ao IS NULL THEN 'other-pages check not checkable' ELSE 'other pages byte-identical' END;
END
$g1_g3$;

ROLLBACK;
