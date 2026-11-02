-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261110_0100 photo camera details (photo plan U1a).
-- Drops exactly what the migration created, in reverse:
--   post_photo_camera_for · set_post_photo_camera_hidden · set_post_photo_camera
--   · post_photo_camera_hidden · post_photo_camera · the photo_set_v2 row
--   (audited) · 'photo_set_v2' from feature_access_feature_check (every other
--   key the lane holds is kept — the list is read under the lock, not assumed).
-- REFUSES unless photo_set_v2 is 'off' (turn it Off in Admin first).
-- ⚠ The camera-details rows are DROPPED with their table (counted in a NOTICE first).
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
LOCK TABLE public.feature_access IN ACCESS EXCLUSIVE MODE;

DO $pre$
DECLARE _mode text; _found boolean;
BEGIN
  SELECT fa.mode, true INTO _mode, _found FROM public.feature_access fa WHERE fa.feature = 'photo_set_v2';
  IF to_regclass('public.post_photo_camera') IS NULL
     AND to_regclass('public.post_photo_camera_hidden') IS NULL
     AND to_regprocedure('public.set_post_photo_camera(uuid,jsonb)') IS NULL
     AND to_regprocedure('public.set_post_photo_camera_hidden(uuid,boolean)') IS NULL
     AND to_regprocedure('public.post_photo_camera_for(uuid[])') IS NULL
     AND _found IS NULL THEN
    RAISE EXCEPTION 'U1A-0100-RB-PRE-001: 20261110_0100 is not applied on this lane — nothing to roll back';
  END IF;
  IF _found AND _mode <> 'off' THEN
    RAISE EXCEPTION 'U1A-0100-RB-PRE-002: photo_set_v2 is % — turn it Off before rolling back', _mode;
  END IF;
  IF to_regclass('public.post_photo_camera') IS NOT NULL THEN
    RAISE NOTICE 'U1A-0100 rollback: dropping % camera-details row(s) and % hidden flag(s)',
      (SELECT count(*) FROM public.post_photo_camera),
      (SELECT count(*) FROM public.post_photo_camera_hidden);
  END IF;
END
$pre$;

DROP FUNCTION IF EXISTS public.post_photo_camera_for(uuid[]);
DROP FUNCTION IF EXISTS public.set_post_photo_camera_hidden(uuid, boolean);
DROP FUNCTION IF EXISTS public.set_post_photo_camera(uuid, jsonb);
DROP TABLE IF EXISTS public.post_photo_camera_hidden;
DROP TABLE IF EXISTS public.post_photo_camera;

WITH del AS (
  DELETE FROM public.feature_access WHERE feature = 'photo_set_v2' RETURNING mode
)
INSERT INTO public.feature_access_audit (actor, feature, action, old_value, new_value, note)
SELECT NULL, 'photo_set_v2', 'mode', del.mode, NULL, '20261110_0100 ROLLBACK: switch removed'
  FROM del;

DO $switch$
DECLARE _def text; _keys text[];
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO _def FROM pg_constraint c
   WHERE c.conrelid = 'public.feature_access'::regclass AND c.conname = 'feature_access_feature_check';
  IF _def IS NULL OR _def !~ '^CHECK \(\(feature = ANY \(ARRAY\[''[a-z0-9_]+''::text(, ''[a-z0-9_]+''::text)*\]\)\)\)$' THEN
    RAISE EXCEPTION 'U1A-0100-RB-PRE-003: feature_access_feature_check is not a plain key list (read: %)', coalesce(_def, '<none>');
  END IF;
  SELECT array_agg(t.m[1] ORDER BY t.i) INTO _keys
    FROM regexp_matches(_def, '''([a-z0-9_]+)''::text', 'g') WITH ORDINALITY AS t(m, i);
  IF 'photo_set_v2' = ANY (_keys) THEN
    IF array_length(_keys, 1) < 2 THEN
      RAISE EXCEPTION 'U1A-0100-RB-PRE-003: photo_set_v2 is the only key — refusing to leave an empty list';
    END IF;
    EXECUTE format(
      'ALTER TABLE public.feature_access DROP CONSTRAINT feature_access_feature_check, '
      'ADD CONSTRAINT feature_access_feature_check CHECK (feature IN (%s))',
      (SELECT string_agg(quote_literal(k), ', ' ORDER BY i)
         FROM unnest(array_remove(_keys, 'photo_set_v2')) WITH ORDINALITY AS u(k, i)));
  END IF;
END
$switch$;

DO $post$
BEGIN
  IF to_regclass('public.post_photo_camera') IS NOT NULL
     OR to_regclass('public.post_photo_camera_hidden') IS NOT NULL
     OR to_regprocedure('public.set_post_photo_camera(uuid,jsonb)') IS NOT NULL
     OR to_regprocedure('public.set_post_photo_camera_hidden(uuid,boolean)') IS NOT NULL
     OR to_regprocedure('public.post_photo_camera_for(uuid[])') IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.feature_access WHERE feature = 'photo_set_v2')
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.feature_access'::regclass
                 AND conname = 'feature_access_feature_check' AND pg_get_constraintdef(oid) ~ 'photo_set_v2') THEN
    RAISE EXCEPTION 'U1A-0100-RB-POST-001: 20261110_0100 objects still present';
  END IF;
  RAISE NOTICE 'U1A-0100 rolled back (lane %)', current_setting('p32.lane');
END
$post$;

COMMIT;
