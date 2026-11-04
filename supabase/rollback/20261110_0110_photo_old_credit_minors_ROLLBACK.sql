-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261110_0110 — put back the 0109 class helper (any *.supabase.co
-- project's public storage) and the array_length(…, 1) caps of 0109 / 0100.
-- Same signatures, CREATE OR REPLACE; grants kept. No row, post or file touched.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'ROLLBACK REFUSED — p32.lane is not asserted';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $rb$
BEGIN
  IF to_regprocedure('public.post_photo_credit_for(uuid[])') IS NULL
     OR position('cardinality(p_post_ids)' IN pg_get_functiondef('public.post_photo_credit_for(uuid[])'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'OC-0110-RB-PRE-001: 20261110_0110 is not applied on this lane — nothing to roll back';
  END IF;
END
$rb$;

CREATE OR REPLACE FUNCTION public.photo_old_credit_class(_url text)
RETURNS text LANGUAGE plpgsql STABLE SET search_path TO '' AS $fn$
DECLARE _cdn text := public.photo_set_backfill_cdn();
BEGIN
  IF _url IS NULL OR position('..' IN _url) > 0 THEN RETURN NULL; END IF;
  -- a photo of the new sets (or one of their copies) is never an old photo
  IF _url ~* '-l[45]f?(-thumb|-r[0-9]{3,4}c?)?\.webp([?#].*)?$' THEN RETURN NULL; END IF;
  IF left(_url, length('https://' || _cdn || '/post-images/')) = 'https://' || _cdn || '/post-images/'
     AND _url !~ '/posts/credit/' THEN RETURN 'photos'; END IF;
  IF left(_url, length('https://' || _cdn || '/avatars/')) = 'https://' || _cdn || '/avatars/' THEN RETURN 'avatars'; END IF;
  IF _url ~ '^https://[a-z0-9]{20}\.supabase\.co/storage/v1/object/public/' THEN RETURN 'supabase'; END IF;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.photo_old_credit_class(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.post_photo_credit_for(p_post_ids uuid[])
RETURNS TABLE(post_id uuid, ord integer, src_url text, credited_url text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
#variable_conflict use_column
DECLARE _uid uuid := (SELECT auth.uid());
BEGIN
  IF p_post_ids IS NULL OR array_length(p_post_ids, 1) IS NULL THEN RETURN; END IF;
  IF array_length(p_post_ids, 1) > 50 THEN
    RAISE EXCEPTION 'PHOTO-OC-008: at most 50 post ids per call, got %', array_length(p_post_ids, 1) USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT c.post_id, c.ord, c.src_url, c.credited_url
    FROM public.photo_old_credit c
    JOIN public.posts p ON p.id = c.post_id
   WHERE c.post_id = ANY (p_post_ids)
     -- ⚠ DO NOT REMOVE. This is the access control (as post_photo_camera_for).
     AND public.can_view_post(_uid, p.user_id, p.privacy)
     -- only while the post still shows exactly that photo at that place
     AND p.image_urls[c.ord + 1] = c.src_url
   ORDER BY c.post_id, c.ord;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.post_photo_camera_for(p_post_ids uuid[])
RETURNS TABLE(post_id uuid, ord integer, info jsonb, hidden boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
#variable_conflict use_column
DECLARE _uid uuid := (SELECT auth.uid());
BEGIN
  IF p_post_ids IS NULL OR array_length(p_post_ids, 1) IS NULL THEN RETURN; END IF;
  IF array_length(p_post_ids, 1) > 50 THEN
    RAISE EXCEPTION 'PHOTO-CAM-008: at most 50 post ids per call, got %', array_length(p_post_ids, 1) USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT c.post_id, c.ord, c.info, (h.post_id IS NOT NULL)
    FROM public.post_photo_camera c
    JOIN public.posts p ON p.id = c.post_id
    LEFT JOIN public.post_photo_camera_hidden h ON h.post_id = c.post_id
   WHERE c.post_id = ANY (p_post_ids)
     -- ⚠ DO NOT REMOVE. This is the access control (as in post_media_for).
     AND public.can_view_post(_uid, p.user_id, p.privacy)
     -- Hidden: only the author sees the rows (NULL uid → NULL → no row).
     AND (h.post_id IS NULL OR p.user_id = _uid)
   ORDER BY c.post_id, c.ord;
END;
$fn$;

-- Who may run them: exactly as 0109 / 0100 granted (restated, unchanged).
REVOKE ALL ON FUNCTION public.post_photo_credit_for(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_photo_credit_for(uuid[]) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.post_photo_camera_for(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_photo_camera_for(uuid[]) TO anon, authenticated;

DO $done$ BEGIN RAISE NOTICE 'OC-0110 rolled back on %', current_setting('p32.lane'); END $done$;

COMMIT;
