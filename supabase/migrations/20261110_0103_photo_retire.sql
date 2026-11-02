-- ═══════════════════════════════════════════════════════════════════════════
-- Photo plan U6 · 20261110_0103 — competition FULL-SIZE auto-delete after
-- "results final + 30 days", and the one audited RETIRE path every photo
-- deletion of the plan goes through (U7 reuses it). Lanes: staging, production.
-- New switch `competition_fullsize_purge`, created OFF.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- GATE: an entry's full-size photo is retired only when (a) it is a v2 entry
-- photo (`…-w{W}h{H}-l4f.webp`, whose credited 2048 copy `-l4f-r2048` the
-- uploader stored first — the marker is that promise), (b) the competition's
-- results are FINAL — round 4 published (competition_round_publish
-- round_number = 4, published_at NOT NULL; the live trigger
-- sync_competition_result_state_from_round_publish sets phase/status 'result'
-- from exactly that row, and un-publishing it reverts them) — for 30 days,
-- (c) the switch is on, and (d) no column anywhere in the public schema still
-- names the file. The entry then shows its 2048 copy (photos[i] swapped,
-- audited) and only after that is the file queued for deletion.
--
-- "RESULTS FINAL" WAS MEASURED, NOT ASSUMED (2026-11-03): results publish per
-- round; round 4 is the final round (the live trigger above + get_public_round_scores
-- / auto_certificate_on_r4_award read round 4 as the result). Production holds
-- no competition visible to anon today; staging holds 2 (one with round 1 published).
--
-- PIECES:
--   · switch 'competition_fullsize_purge' (feature_access, audited, OFF; check
--     constraint rebuilt from the lane's own list under the lock).
--   · public.photo_retire — one row per file to delete: kind ('comp_full' here,
--     'post_old' for U7), object key + URL, where it came from, what the row
--     shows instead, state due → deleted (or kept, with the reason). RLS on,
--     nothing granted to anon / authenticated.
--   · public.photo_retire_cdn()                  this lane's photo CDN host (fixed at apply)
--   · public.competition_results_final_at(uuid)  round-4 published_at, or NULL
--   · public.photo_retire_referenced(text[])     which of these keys ANY public
--       text / varchar / text[] / json / jsonb column still names (photo_retire
--       and the photo-set backfill logs excepted). One regex pass per column.
--   · public.competition_fullsize_mark(_dry_run boolean DEFAULT true) → jsonb
--       dry run: what is due (count), changes nothing — always allowed;
--       run: only while the switch is 'everyone'; per entry in its own
--       sub-transaction: photos[i] → the -l4f-r2048 copy, photo_retire row;
--       then the reference scan turns still-named files to 'kept'.
--       postgres (cron) and admins only (PHOTO-RT-001).
--   · public.photo_retire_claim(_limit, _kind, _after) / photo_retire_done(_id, _bytes)
--       the deleter's two calls (admin or converter only, PHOTO-RT-001): claim
--       returns 'due' rows marked in the last 24 hours (older ones must be
--       re-checked by a fresh mark first); done records the deletion.
--   · pg_cron 'competition-fullsize-retire' 04:10 UTC daily:
--       SELECT public.competition_fullsize_mark(false) — a no-op while the switch is off.
-- The file deletion itself is the Pages route /api/media/retire (PHOTOS
-- binding), driven by tools/media-derivatives/retire.mjs from photo-retire.yml.
--
-- NOT RE-RUNNABLE: PRE-002 refuses once photo_retire exists.
-- ROLLBACK: supabase/rollback/20261110_0103_photo_retire_ROLLBACK.sql
--           (puts every swapped entry photo back while its file is not deleted yet)
-- PROBE:    supabase/migrations/PROBE_20261110_0103_photo_retire.sql (FAIL before, PASS after)
-- FIXTURE:  .github/workflows/d1-photo-retire-fixture.yml (both lane shapes)
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
DECLARE _mode text;
BEGIN
  -- PRE-001 · what this file builds on.
  IF to_regclass('public.competition_entries') IS NULL OR to_regclass('public.competition_round_publish') IS NULL
     OR to_regclass('public.feature_access') IS NULL OR to_regclass('public.feature_access_audit') IS NULL
     OR to_regprocedure('public.has_role(uuid,public.app_role)') IS NULL
     OR to_regprocedure('public.media_derivative_worker_ok()') IS NULL
     OR to_regprocedure('cron.schedule(text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'U6-0103-PRE-001: competition_entries, competition_round_publish, feature_access(+audit), has_role, media_derivative_worker_ok or pg_cron is missing';
  END IF;
  -- PRE-002 · not applied already.
  IF to_regclass('public.photo_retire') IS NOT NULL OR to_regprocedure('public.competition_fullsize_mark(boolean)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'competition-fullsize-retire') THEN
    RAISE EXCEPTION 'U6-0103-PRE-002: photo retire objects already exist — 20261110_0103 is applied';
  END IF;
  -- PRE-003 · never take over a switch somebody already turned on.
  SELECT fa.mode INTO _mode FROM public.feature_access fa WHERE fa.feature = 'competition_fullsize_purge';
  IF _mode IS NOT NULL AND _mode <> 'off' THEN
    RAISE EXCEPTION 'U6-0103-PRE-003: competition_fullsize_purge already exists with mode % — refusing (this file only creates it off)', _mode;
  END IF;
END
$pre$;

-- ── 1. the switch, OFF (current list + the new key, read under the lock) ────
LOCK TABLE public.feature_access IN ACCESS EXCLUSIVE MODE;

DO $switch$
DECLARE _def text; _keys text[];
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO _def FROM pg_constraint c
   WHERE c.conrelid = 'public.feature_access'::regclass AND c.conname = 'feature_access_feature_check';
  IF _def IS NULL OR _def !~ '^CHECK \(\(feature = ANY \(ARRAY\[''[a-z0-9_]+''::text(, ''[a-z0-9_]+''::text)*\]\)\)\)$' THEN
    RAISE EXCEPTION 'U6-0103-PRE-004: feature_access_feature_check is not a plain key list (read: %)', coalesce(_def, '<none>');
  END IF;
  SELECT array_agg(t.m[1] ORDER BY t.i) INTO _keys
    FROM regexp_matches(_def, '''([a-z0-9_]+)''::text', 'g') WITH ORDINALITY AS t(m, i);
  IF NOT ('competition_fullsize_purge' = ANY (_keys)) THEN
    EXECUTE format(
      'ALTER TABLE public.feature_access DROP CONSTRAINT feature_access_feature_check, '
      'ADD CONSTRAINT feature_access_feature_check CHECK (feature IN (%s))',
      (SELECT string_agg(quote_literal(k), ', ' ORDER BY i)
         FROM unnest(_keys || 'competition_fullsize_purge'::text) WITH ORDINALITY AS u(k, i)));
  END IF;
  RAISE NOTICE 'U6-0103: feature_access_feature_check kept % key(s) and allows competition_fullsize_purge', array_length(_keys, 1);
END
$switch$;

WITH ins AS (
  INSERT INTO public.feature_access (feature, mode) VALUES ('competition_fullsize_purge', 'off')
  ON CONFLICT (feature) DO NOTHING
  RETURNING feature
)
INSERT INTO public.feature_access_audit (actor, feature, action, old_value, new_value, note)
SELECT NULL, 'competition_fullsize_purge', 'mode', NULL, 'off',
       '20261110_0103: switch created, Off (photo plan U6: competition full size deleted 30 days after final results)'
  FROM ins;

-- ── 2. the retire list ──────────────────────────────────────────────────────
CREATE TABLE public.photo_retire (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind            text        NOT NULL CHECK (kind IN ('comp_full', 'post_old')),
  object_key      text        NOT NULL UNIQUE
                              CHECK (object_key ~ '^(post-images|competition-photos)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_./-]+\.webp$'
                                     AND position('..' IN object_key) = 0),
  object_url      text        NOT NULL,
  source_table    text        NOT NULL,
  source_id       uuid        NOT NULL,
  ord             integer,
  replacement_url text,
  state           text        NOT NULL DEFAULT 'due' CHECK (state IN ('due', 'deleted', 'kept')),
  note            text,
  bytes           bigint,
  marked_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  deleted_by      uuid
);
CREATE INDEX photo_retire_due_idx ON public.photo_retire (marked_at) WHERE state = 'due';
COMMENT ON TABLE public.photo_retire IS
  'Photo plan U6/U7: files queued for deletion (due), deleted, or kept because something still names them. '
  'Written by competition_fullsize_mark / the U7 mark; deleted only by /api/media/retire via photo_retire_claim/done.';
ALTER TABLE public.photo_retire ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.photo_retire FROM PUBLIC, anon, authenticated;

-- ── 3. helpers ──────────────────────────────────────────────────────────────
DO $cdn$
DECLARE _host text := CASE current_setting('p32.lane') WHEN 'production' THEN 'cdn.50mmretina.com' ELSE 'cdn-staging.50mmretina.com' END;
BEGIN
  EXECUTE format($f$
    CREATE FUNCTION public.photo_retire_cdn()
    RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO '' AS $b$ SELECT %L::text $b$
  $f$, _host);
END
$cdn$;

CREATE FUNCTION public.competition_results_final_at(_competition uuid)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path TO '' AS $fn$
  SELECT crp.published_at FROM public.competition_round_publish crp
   WHERE crp.competition_id = _competition AND crp.round_number = 4 AND crp.published_at IS NOT NULL
   ORDER BY crp.published_at DESC LIMIT 1;
$fn$;

CREATE FUNCTION public.photo_retire_referenced(_keys text[])
RETURNS TABLE(object_key text, found_in text)
LANGUAGE plpgsql STABLE SET search_path TO '' AS $fn$
DECLARE _c record;
BEGIN
  IF _keys IS NULL OR cardinality(_keys) = 0 THEN RETURN; END IF;
  FOR _c IN
    SELECT c.table_name::text AS t, c.column_name::text AS col
      FROM information_schema.columns c
      JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public'
       AND c.table_name NOT IN ('photo_retire', 'photo_set_backfill', 'photo_set_swap')
       AND (c.data_type IN ('text', 'character varying', 'json', 'jsonb')
            OR (c.data_type = 'ARRAY' AND c.udt_name IN ('_text', '_varchar')))
     ORDER BY 1, 2
  LOOP
    RETURN QUERY EXECUTE format(
      'SELECT DISTINCT m[1], %L FROM public.%I t, regexp_matches(t.%I::text, %L, ''g'') m WHERE m[1] = ANY ($1)',
      _c.t || '.' || _c.col, _c.t, _c.col,
      '((?:post-images|competition-photos)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_./-]+?\.webp)')
    USING _keys;
  END LOOP;
END;
$fn$;

REVOKE ALL ON FUNCTION public.photo_retire_cdn() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.competition_results_final_at(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.photo_retire_referenced(text[]) FROM PUBLIC, anon, authenticated;

-- ── 4. the competition mark (cron + admins) ─────────────────────────────────
CREATE FUNCTION public.competition_fullsize_mark(_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE
  _uid uuid := (SELECT auth.uid()); _mode text; _r record; _new text; _swapped int := 0; _skipped int := 0;
  _due int; _kept int := 0; _keys text[]; _ref record;
  _re constant text := '^https://' || replace(public.photo_retire_cdn(), '.', '\.')
    || '/(competition-photos/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/competitions/[A-Za-z0-9_.-]+-w[0-9]{1,5}h[0-9]{1,5}-l4f\.webp)(\?[^#]*)?$';
BEGIN
  -- cron runs as postgres (no JWT); a signed-in caller must be an admin.
  IF _uid IS NOT NULL AND NOT public.has_role(_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'PHOTO-RT-001 only an admin (or the daily job) may mark competition full-size photos' USING ERRCODE = '42501';
  END IF;
  SELECT fa.mode INTO _mode FROM public.feature_access fa WHERE fa.feature = 'competition_fullsize_purge';

  CREATE TEMP TABLE IF NOT EXISTS _cf_due (entry_id uuid, ord int, url text, object_key text, final_at timestamptz) ON COMMIT DROP;
  TRUNCATE _cf_due;
  INSERT INTO _cf_due
  SELECT e.id, (u.i - 1)::int, u.url, (regexp_match(u.url, _re))[1], public.competition_results_final_at(e.competition_id)
    FROM public.competition_entries e
   CROSS JOIN LATERAL unnest(e.photos) WITH ORDINALITY AS u(url, i)
   WHERE u.url ~ _re
     AND public.competition_results_final_at(e.competition_id) <= now() - interval '30 days'
     AND NOT EXISTS (SELECT 1 FROM public.photo_retire r WHERE r.object_key = (regexp_match(u.url, _re))[1]);
  SELECT count(*) INTO _due FROM _cf_due;

  IF _dry_run OR coalesce(_mode, 'off') <> 'everyone' THEN
    RETURN jsonb_build_object('dry_run', true, 'switch', coalesce(_mode, '<none>'), 'due', _due,
                              'note', CASE WHEN NOT _dry_run THEN 'switch competition_fullsize_purge is not on — nothing changed' END);
  END IF;

  FOR _r IN SELECT * FROM _cf_due ORDER BY entry_id, ord LOOP
    _new := regexp_replace(_r.url, '-l4f\.webp(\?[^#]*)?$', '-l4f-r2048.webp');
    BEGIN
      UPDATE public.competition_entries e SET photos[_r.ord + 1] = _new
       WHERE e.id = _r.entry_id AND e.photos[_r.ord + 1] = _r.url;
      IF NOT FOUND THEN RAISE EXCEPTION 'the entry changed'; END IF;
      INSERT INTO public.photo_retire (kind, object_key, object_url, source_table, source_id, ord, replacement_url, note)
      VALUES ('comp_full', _r.object_key, _r.url, 'competition_entries', _r.entry_id, _r.ord, _new,
              'results final ' || to_char(_r.final_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC + 30 days');
      _swapped := _swapped + 1;
    EXCEPTION WHEN OTHERS THEN
      _skipped := _skipped + 1;
      RAISE NOTICE 'U6 skipped entry % photo % (%: %)', _r.entry_id, _r.ord, SQLSTATE, SQLERRM;
    END;
  END LOOP;

  -- anything still named elsewhere (a featured photo, a certificate, a post …) is KEPT
  SELECT array_agg(r.object_key) INTO _keys FROM public.photo_retire r
   WHERE r.kind = 'comp_full' AND r.state = 'due' AND r.marked_at >= now() - interval '1 minute';
  FOR _ref IN SELECT f.object_key, string_agg(DISTINCT f.found_in, ', ') AS w FROM public.photo_retire_referenced(_keys) f GROUP BY f.object_key LOOP
    UPDATE public.photo_retire r SET state = 'kept', note = r.note || ' · kept: still named in ' || _ref.w
     WHERE r.object_key = _ref.object_key AND r.state = 'due';
    _kept := _kept + 1;
  END LOOP;

  RETURN jsonb_build_object('dry_run', false, 'switch', _mode, 'due_found', _due, 'swapped', _swapped,
                            'skipped', _skipped, 'kept_still_named', _kept);
END;
$fn$;
REVOKE ALL ON FUNCTION public.competition_fullsize_mark(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.competition_fullsize_mark(boolean) TO authenticated;

-- ── 5. the deleter's two calls (admin or converter) ─────────────────────────
CREATE FUNCTION public.photo_retire_claim(_limit integer DEFAULT 50, _kind text DEFAULT NULL, _after bigint DEFAULT 0)
RETURNS TABLE(id bigint, kind text, object_key text, marked_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
#variable_conflict use_column
BEGIN
  IF NOT public.media_derivative_worker_ok() THEN
    RAISE EXCEPTION 'PHOTO-RT-001 only an admin or the converter may read the retire list' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT r.id, r.kind, r.object_key, r.marked_at FROM public.photo_retire r
   WHERE r.state = 'due' AND r.marked_at >= now() - interval '24 hours'
     AND (_kind IS NULL OR r.kind = _kind) AND r.id > coalesce(_after, 0)
   ORDER BY r.id LIMIT least(greatest(coalesce(_limit, 50), 1), 200);
END;
$fn$;

CREATE FUNCTION public.photo_retire_done(_id bigint, _bytes bigint)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $fn$
BEGIN
  IF NOT public.media_derivative_worker_ok() THEN
    RAISE EXCEPTION 'PHOTO-RT-001 only an admin or the converter may record a deletion' USING ERRCODE = '42501';
  END IF;
  UPDATE public.photo_retire r SET state = 'deleted', bytes = greatest(coalesce(_bytes, 0), 0),
         deleted_at = now(), deleted_by = (SELECT auth.uid())
   WHERE r.id = _id AND r.state = 'due';
  RETURN FOUND;
END;
$fn$;

REVOKE ALL ON FUNCTION public.photo_retire_claim(integer, text, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.photo_retire_done(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_retire_claim(integer, text, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.photo_retire_done(bigint, bigint) TO authenticated;

-- ── 6. the daily job (a no-op while the switch is off) ──────────────────────
SELECT cron.schedule('competition-fullsize-retire', '10 4 * * *', 'SELECT public.competition_fullsize_mark(false)');

DO $done$
BEGIN
  RAISE NOTICE 'U6-0103 applied on % (CDN %): switch competition_fullsize_purge = off, daily job scheduled (no-op while off).',
    current_setting('p32.lane'), public.photo_retire_cdn();
END
$done$;

COMMIT;
