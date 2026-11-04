-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261110_0111 — drop the new photos' credit record and its worker
-- functions, and put back photo_l4_rectify's default. No post is touched (0111
-- never repointed one). The credited copies the worker stored stay in the
-- bucket: they are `-r2048c` siblings the web finds by name. New uploads then
-- get no credited copy until the code that follows this file is rolled back too
-- (the browser canvas is in the commit before #U3's).
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
  IF to_regclass('public.photo_set_credit') IS NULL THEN
    RAISE EXCEPTION 'SC-0111-RB-PRE-001: 20261110_0111 is not applied on this lane — nothing to roll back';
  END IF;
END
$rb$;

ALTER TABLE public.photo_l4_rectify ALTER COLUMN credit_version SET DEFAULT 3;
CREATE OR REPLACE FUNCTION public.photo_old_credit_queue(_limit integer, _after uuid)
RETURNS TABLE(post_id uuid, ord integer, src_url text, owner_full_name text, owner_handle text, owner_is_admin boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
#variable_conflict use_column
BEGIN
  IF NOT public.media_derivative_worker_ok() THEN
    RAISE EXCEPTION 'PHOTO-OC-001 only an admin or the converter may read the old-credit queue' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT p.id, (u.i - 1)::integer, u.url, pr.full_name, pr.custom_url,
         public.has_role(p.user_id, 'admin'::public.app_role)
    FROM public.posts p
   CROSS JOIN LATERAL unnest(p.image_urls) WITH ORDINALITY AS u(url, i)
    LEFT JOIN public.profiles pr ON pr.id = p.user_id
   WHERE u.i <= 50
     AND (_after IS NULL OR p.id > _after)
     AND public.photo_old_credit_class(u.url) IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.photo_old_credit c
                      WHERE c.post_id = p.id AND c.ord = u.i - 1 AND c.src_url = u.url AND c.credit_version >= 4)
   ORDER BY p.id, u.i
   LIMIT least(greatest(coalesce(_limit, 50), 1), 200);
END;
$fn$;
REVOKE ALL ON FUNCTION public.photo_old_credit_queue(integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_old_credit_queue(integer, uuid) TO authenticated;
DROP FUNCTION public.photo_old_credit_record(uuid, integer, text, integer);
DROP FUNCTION public.photo_credit_parked_count();
DROP FUNCTION public.photo_credit_failed(text, text);
DROP FUNCTION public.photo_set_credit_record(text, integer, boolean, text);
DROP FUNCTION public.photo_set_credit_target(text);
DROP FUNCTION public.photo_set_credit_queue(integer, text);
DROP FUNCTION public.photo_set_credit_named();
DROP FUNCTION public.photo_credit_parked(text);
DROP TABLE public.photo_credit_failure;
DROP TABLE public.photo_set_credit;

DO $done$ BEGIN RAISE NOTICE 'SC-0111 rolled back on %', current_setting('p32.lane'); END $done$;

COMMIT;
