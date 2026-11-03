-- ═══════════════════════════════════════════════════════════════════════════
-- Photo plan · 20261110_0110 — review minors of 0109 (#869 review, 7 + 8).
-- Lanes: staging and production. Applies once (PRE-002). Same signatures:
-- CREATE OR REPLACE only; grants and owners are kept.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 7  photo_old_credit_class(url): an old photo in Supabase storage counts only
--    when it is in THIS lane's own project (production jtdtehuqtinjxropkkcn,
--    staging fpszggreishhuvdpkmdr — fixed at apply time from p32.lane), not
--    any *.supabase.co project. The worker pins its sources the same way
--    (tools/media-derivatives/old-credit-source.mjs) and caps a source at 40 MB.
-- 8  post_photo_credit_for / post_photo_camera_for: the 50-id cap reads
--    cardinality(p_post_ids) — array_length(…, 1) is NULL for an empty array
--    and blind to a multi-dimensional one; cardinality counts every element.
--    Nothing else in either body changes.
--
-- ROLLBACK: supabase/rollback/20261110_0110_photo_old_credit_minors_ROLLBACK.sql (0109 / 0100 bodies)
-- PROBE:    supabase/migrations/PROBE_20261110_0110_photo_old_credit_minors.sql (FAIL before the apply)
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_assert$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_assert$;

SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  -- PRE-001 · 0109 and 0100 are applied.
  IF to_regprocedure('public.photo_old_credit_class(text)') IS NULL
     OR to_regprocedure('public.post_photo_credit_for(uuid[])') IS NULL
     OR to_regprocedure('public.post_photo_camera_for(uuid[])') IS NULL THEN
    RAISE EXCEPTION 'OC-0110-PRE-001: 20261110_0109 or 20261110_0100 is not applied on this lane';
  END IF;
  -- PRE-002 · not applied already.
  IF position('cardinality(p_post_ids)' IN pg_get_functiondef('public.post_photo_credit_for(uuid[])'::regprocedure)) > 0 THEN
    RAISE EXCEPTION 'OC-0110-PRE-002: 20261110_0110 is applied on this lane';
  END IF;
END
$pre$;

-- ── 7. the class helper: this lane's own Supabase project only ──────────────
DO $class$
DECLARE _ref text := CASE current_setting('p32.lane') WHEN 'production' THEN 'jtdtehuqtinjxropkkcn' ELSE 'fpszggreishhuvdpkmdr' END;
BEGIN
  EXECUTE format($f$
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
      -- 0110: THIS lane's own project only (fixed at apply time)
      IF left(_url, length('https://%1$s.supabase.co/storage/v1/object/public/')) = 'https://%1$s.supabase.co/storage/v1/object/public/' THEN RETURN 'supabase'; END IF;
      RETURN NULL;
    END;
    $fn$
  $f$, _ref);
END
$class$;
REVOKE ALL ON FUNCTION public.photo_old_credit_class(text) FROM PUBLIC, anon, authenticated;

-- ── 8. the 50-id caps: cardinality ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.post_photo_credit_for(p_post_ids uuid[])
RETURNS TABLE(post_id uuid, ord integer, src_url text, credited_url text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
#variable_conflict use_column
DECLARE _uid uuid := (SELECT auth.uid());
BEGIN
  IF p_post_ids IS NULL OR cardinality(p_post_ids) = 0 THEN RETURN; END IF;
  IF cardinality(p_post_ids) > 50 THEN
    RAISE EXCEPTION 'PHOTO-OC-008: at most 50 post ids per call, got %', cardinality(p_post_ids) USING ERRCODE = '22023';
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
  IF p_post_ids IS NULL OR cardinality(p_post_ids) = 0 THEN RETURN; END IF;
  IF cardinality(p_post_ids) > 50 THEN
    RAISE EXCEPTION 'PHOTO-CAM-008: at most 50 post ids per call, got %', cardinality(p_post_ids) USING ERRCODE = '22023';
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

DO $post$
BEGIN
  IF NOT has_function_privilege('anon', 'public.post_photo_credit_for(uuid[])', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.post_photo_camera_for(uuid[])', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.photo_old_credit_class(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'OC-0110-POST-001: a grant changed — refusing';
  END IF;
  RAISE NOTICE 'OC-0110 applied on %: Supabase sources pinned to this project; 50-id caps by cardinality', current_setting('p32.lane');
END
$post$;

COMMIT;
