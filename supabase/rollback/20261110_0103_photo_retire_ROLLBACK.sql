-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261110_0103 photo retire (photo plan U6).
-- Puts every competition entry photo the mark swapped back to its full-size
-- URL (only where the entry still shows the 2048 copy the mark wrote), then
-- removes the daily job, the functions, photo_retire, the switch row (audited)
-- and the key from feature_access_feature_check (every other key kept).
-- REFUSES:
--   · when any file has been DELETED (state 'deleted'): a deleted file cannot
--     come back, and dropping the list would lose the record of what went;
--   · when U7 rows (kind 'post_old') exist — roll U7 back first;
--   · while competition_fullsize_purge is not 'off' (turn it Off in Admin first).
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
DECLARE _mode text; _found boolean; _n bigint;
BEGIN
  SELECT fa.mode, true INTO _mode, _found FROM public.feature_access fa WHERE fa.feature = 'competition_fullsize_purge';
  IF to_regclass('public.photo_retire') IS NULL AND to_regprocedure('public.competition_fullsize_mark(boolean)') IS NULL
     AND _found IS NULL AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'competition-fullsize-retire') THEN
    RAISE EXCEPTION 'U6-0103-RB-PRE-001: 20261110_0103 is not applied on this lane — nothing to roll back';
  END IF;
  IF _found AND _mode <> 'off' THEN
    RAISE EXCEPTION 'U6-0103-RB-PRE-002: competition_fullsize_purge is % — turn it Off before rolling back', _mode;
  END IF;
  IF to_regclass('public.photo_retire') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.photo_retire WHERE state = ''deleted''' INTO _n;
    IF _n > 0 THEN
      RAISE EXCEPTION 'U6-0103-RB-PRE-003: % file(s) are already deleted — they cannot come back; refusing to drop their record', _n;
    END IF;
    EXECUTE 'SELECT count(*) FROM public.photo_retire WHERE kind = ''post_old''' INTO _n;
    IF _n > 0 THEN
      RAISE EXCEPTION 'U6-0103-RB-PRE-004: % U7 row(s) exist — roll U7 back first', _n;
    END IF;
  END IF;
END
$pre$;

DO $restore$
DECLARE _r record; _back int := 0; _kept int := 0;
BEGIN
  IF to_regclass('public.photo_retire') IS NULL THEN RETURN; END IF;
  FOR _r IN EXECUTE 'SELECT source_id, ord, object_url, replacement_url FROM public.photo_retire WHERE kind = ''comp_full'' ORDER BY id' LOOP
    UPDATE public.competition_entries e SET photos[_r.ord + 1] = _r.object_url
     WHERE e.id = _r.source_id AND e.photos[_r.ord + 1] = _r.replacement_url;
    IF FOUND THEN _back := _back + 1; ELSE _kept := _kept + 1; END IF;
  END LOOP;
  RAISE NOTICE 'U6-0103 rollback: % entry photo(s) back on their full size · % changed since (not touched)', _back, _kept;
END
$restore$;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'competition-fullsize-retire') THEN
    PERFORM cron.unschedule('competition-fullsize-retire');
  END IF;
END
$cron$;

DROP FUNCTION IF EXISTS public.photo_retire_done(bigint, bigint);
DROP FUNCTION IF EXISTS public.photo_retire_claim(integer, text, bigint);
DROP FUNCTION IF EXISTS public.competition_fullsize_mark(boolean);
DROP FUNCTION IF EXISTS public.photo_retire_referenced(text[]);
DROP FUNCTION IF EXISTS public.competition_results_final_at(uuid);
DROP FUNCTION IF EXISTS public.photo_retire_cdn();
DROP TABLE IF EXISTS public.photo_retire;

WITH del AS (
  DELETE FROM public.feature_access WHERE feature = 'competition_fullsize_purge' RETURNING mode
)
INSERT INTO public.feature_access_audit (actor, feature, action, old_value, new_value, note)
SELECT NULL, 'competition_fullsize_purge', 'mode', del.mode, NULL, '20261110_0103 ROLLBACK: switch removed'
  FROM del;

DO $switch$
DECLARE _def text; _keys text[];
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO _def FROM pg_constraint c
   WHERE c.conrelid = 'public.feature_access'::regclass AND c.conname = 'feature_access_feature_check';
  IF _def IS NULL OR _def !~ '^CHECK \(\(feature = ANY \(ARRAY\[''[a-z0-9_]+''::text(, ''[a-z0-9_]+''::text)*\]\)\)\)$' THEN
    RAISE EXCEPTION 'U6-0103-RB-PRE-005: feature_access_feature_check is not a plain key list (read: %)', coalesce(_def, '<none>');
  END IF;
  SELECT array_agg(t.m[1] ORDER BY t.i) INTO _keys
    FROM regexp_matches(_def, '''([a-z0-9_]+)''::text', 'g') WITH ORDINALITY AS t(m, i);
  IF 'competition_fullsize_purge' = ANY (_keys) THEN
    IF array_length(_keys, 1) < 2 THEN
      RAISE EXCEPTION 'U6-0103-RB-PRE-005: competition_fullsize_purge is the only key — refusing to leave an empty list';
    END IF;
    EXECUTE format(
      'ALTER TABLE public.feature_access DROP CONSTRAINT feature_access_feature_check, '
      'ADD CONSTRAINT feature_access_feature_check CHECK (feature IN (%s))',
      (SELECT string_agg(quote_literal(k), ', ' ORDER BY i)
         FROM unnest(array_remove(_keys, 'competition_fullsize_purge')) WITH ORDINALITY AS u(k, i)));
  END IF;
  RAISE NOTICE 'U6-0103 rolled back on %', current_setting('p32.lane');
END
$switch$;

COMMIT;
