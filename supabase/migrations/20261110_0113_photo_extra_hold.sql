-- ═══════════════════════════════════════════════════════════════════════════
-- Photo clean-up · 20261110_0113 — queue the OLD EXTRA copies of feed photos
-- for a MOVE to the private holding folder (Owner, 5 Nov 2026: "GO MOVE").
-- Lanes: staging and production. Nothing is deleted by this file or by the
-- mover: a held file can be put back with one run for 14 days; deleting it for
-- good is a later unit, only on the Owner's final yes.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT IS QUEUED (kind 'post_extra', state 'hold_due') — measured unused:
--   A · old credit copies  post-images/<member>/posts/credit/<post>-<ord>-<hash>.webp
--       (photo_old_credit, 0109) of photos in a member's POST folder. Since
--       #916 every such photo's save draws the credit in the browser
--       (src/lib/photoCreditSave.ts drawsCreditOnSave → photoSaveTarget.ts never
--       offers the stored copy). KEPT: copies of "avatars" (My Photos) photos —
--       their save still uses the stored copy.
--   B · the never-shown 3 Nov `-l4` set's credited 2048 master `…-l4.webp` and
--       its `…-l4-r320.webp` (photo_set_backfill, 0101), only while the post
--       still shows the OLD photo (it never shows the set). KEPT: `-l4-r1080`
--       and `-l4-thumb` — post_photo_feed_copies (0112) serves them now.
-- NOT QUEUED: any file a post shows, `-l3-r1440` (PostMedia.tsx srcset still
-- offers it — needs a client without the 1440 rung on web AND app first),
-- `-l5` copies, the 4 left-behind `-l4` sets, competitions.
-- Then a reference scan (every public text/json column except the photo
-- plan's own logs, which name these files on purpose) turns any key still
-- named anywhere into 'kept'.
--
-- PIECES:
--   · photo_retire: kind 'post_extra'; states hold_due → held → (restored);
--     columns held_key / held_at / restored_at; a check that ties post_extra to
--     its states (the deleter's claim reads state 'due' only, so it can never
--     see a post_extra row).
--   · public.photo_extra_referenced(text[])  the reference scan (as 0103's,
--     photo_old_credit also excepted).
--   · public.photo_extra_mark() → jsonb      queue (idempotent: ON CONFLICT
--     on object_key), then the scan. postgres or an admin (PHOTO-EX-001).
--   · public.photo_extra_claim(_op, _limit, _after) / photo_extra_record(_op, _rows)
--     the mover's two calls, admin or converter only (PHOTO-EX-002).
-- The move itself: Pages route /api/media/hold (PHOTOS → MEDIA
-- `photo-holding/<key>`, size checked before the public file goes), driven by
-- tools/media-derivatives/hold.mjs from photo-hold.yml.
--
-- NOT RE-RUNNABLE: PRE-002 refuses once photo_extra_mark exists (re-mark by
-- calling SELECT public.photo_extra_mark() through a PROBE-style file).
-- ROLLBACK: supabase/rollback/20261110_0113_photo_extra_hold_ROLLBACK.sql
--           (refuses while any file is held — restore first)
-- PROBE:    supabase/migrations/PROBE_20261110_0113_photo_extra_hold.sql
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
  -- PRE-001 · what this file builds on.
  IF to_regclass('public.photo_retire') IS NULL OR to_regclass('public.photo_old_credit') IS NULL
     OR to_regclass('public.photo_set_backfill') IS NULL OR to_regclass('public.posts') IS NULL
     OR to_regprocedure('public.photo_retire_cdn()') IS NULL
     OR to_regprocedure('public.post_photo_feed_copies(uuid[])') IS NULL
     OR to_regprocedure('public.media_derivative_worker_ok()') IS NULL
     OR to_regprocedure('public.has_role(uuid,public.app_role)') IS NULL THEN
    RAISE EXCEPTION 'EX-0113-PRE-001: photo_retire (0103), photo_old_credit (0109), photo_set_backfill (0101), posts, photo_retire_cdn, post_photo_feed_copies (0112), media_derivative_worker_ok or has_role is missing';
  END IF;
  -- PRE-002 · not applied already.
  IF to_regprocedure('public.photo_extra_mark()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'photo_retire' AND column_name = 'held_key') THEN
    RAISE EXCEPTION 'EX-0113-PRE-002: photo_extra objects already exist — 20261110_0113 is applied';
  END IF;
  -- PRE-003 · the two checks this file rebuilds are exactly 0103's.
  IF (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conrelid = 'public.photo_retire'::regclass AND c.conname = 'photo_retire_kind_check')
       IS DISTINCT FROM 'CHECK ((kind = ANY (ARRAY[''comp_full''::text, ''post_old''::text])))'
     OR (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conrelid = 'public.photo_retire'::regclass AND c.conname = 'photo_retire_state_check')
       IS DISTINCT FROM 'CHECK ((state = ANY (ARRAY[''due''::text, ''deleted''::text, ''kept''::text])))' THEN
    RAISE EXCEPTION 'EX-0113-PRE-003: photo_retire_kind_check / photo_retire_state_check are not 0103''s — refusing to rebuild them';
  END IF;
END
$pre$;

-- ── 1. the list learns the move ─────────────────────────────────────────────
ALTER TABLE public.photo_retire
  DROP CONSTRAINT photo_retire_kind_check,
  ADD CONSTRAINT photo_retire_kind_check CHECK (kind IN ('comp_full', 'post_old', 'post_extra')),
  DROP CONSTRAINT photo_retire_state_check,
  ADD CONSTRAINT photo_retire_state_check CHECK (state IN ('due', 'deleted', 'kept', 'hold_due', 'held', 'restored')),
  ADD COLUMN held_key    text,
  ADD COLUMN held_at     timestamptz,
  ADD COLUMN restored_at timestamptz,
  ADD CONSTRAINT photo_retire_held_key_check CHECK (held_key IS NULL OR held_key = 'photo-holding/' || object_key),
  ADD CONSTRAINT photo_retire_extra_state_check CHECK (
    (kind = 'post_extra') = (state IN ('hold_due', 'held', 'restored'))
    OR (kind = 'post_extra' AND state = 'kept'));
-- P28: photo_retire · post_extra adds ≈ 1,800 rows once (production census 5 Nov) · partial, the mover reads hold_due / held by id
CREATE INDEX photo_retire_extra_idx ON public.photo_retire (id) WHERE kind = 'post_extra' AND state IN ('hold_due', 'held');
COMMENT ON COLUMN public.photo_retire.held_key IS
  '0113: where a post_extra file waits in the lane''s private MEDIA bucket (photo-holding/<object_key>) until restored or, on the Owner''s yes, deleted.';

-- ── 2. the reference scan (0103's, photo_old_credit excepted too) ───────────
CREATE FUNCTION public.photo_extra_referenced(_keys text[])
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
       AND c.table_name NOT IN ('photo_retire', 'photo_set_backfill', 'photo_set_swap', 'photo_old_credit')
       AND (c.data_type IN ('text', 'character varying', 'json', 'jsonb')
            OR (c.data_type = 'ARRAY' AND c.udt_name IN ('_text', '_varchar')))
     ORDER BY 1, 2
  LOOP
    RETURN QUERY EXECUTE format(
      'SELECT DISTINCT m[1], %L FROM public.%I t, regexp_matches(t.%I::text, %L, ''g'') m WHERE m[1] = ANY ($1)',
      _c.t || '.' || _c.col, _c.t, _c.col,
      '(post-images/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_./-]+?\.webp)')
    USING _keys;
  END LOOP;
END;
$fn$;
REVOKE ALL ON FUNCTION public.photo_extra_referenced(text[]) FROM PUBLIC, anon, authenticated;

-- ── 3. the mark ─────────────────────────────────────────────────────────────
CREATE FUNCTION public.photo_extra_mark()
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE
  _uid uuid := (SELECT auth.uid());
  _pre text := '^https://' || replace(public.photo_retire_cdn(), '.', '\.') || '/';
  _uuid constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  _a int; _b int; _keys text[]; _ref record; _kept int := 0;
BEGIN
  IF _uid IS NOT NULL AND NOT public.has_role(_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'PHOTO-EX-001 only an admin (or a migration) may queue extra photo copies' USING ERRCODE = '42501';
  END IF;

  -- A · old credit copies of POST-folder photos (never of avatars / My Photos)
  INSERT INTO public.photo_retire (kind, object_key, object_url, source_table, source_id, ord, state, note)
  SELECT 'post_extra', regexp_replace(c.credited_url, _pre, ''), c.credited_url, 'photo_old_credit', c.post_id, c.ord, 'hold_due',
         'old credit copy (save draws the credit since #916)'
    FROM public.photo_old_credit c
   WHERE c.credited_url ~ (_pre || 'post-images/' || _uuid || '/posts/credit/' || _uuid || '-[0-9]{1,2}-[0-9a-f]{12}\.webp$')
     AND c.src_url ~ ('/post-images/' || _uuid || '/')
     AND c.src_url !~ '/posts/credit/'
     AND c.src_url !~ '/avatars/'
  ON CONFLICT (object_key) DO NOTHING;
  GET DIAGNOSTICS _a = ROW_COUNT;

  -- B · the never-shown -l4 master + its 320, only while the post shows the OLD photo
  INSERT INTO public.photo_retire (kind, object_key, object_url, source_table, source_id, ord, state, note)
  SELECT 'post_extra', regexp_replace(x.u, _pre, ''), x.u, 'photo_set_backfill', x.post_id, x.ord, 'hold_due', x.what
    FROM (
      SELECT b.post_id, b.ord, b.new_url AS u, '-l4 credited 2048, never shown' AS what
        FROM public.photo_set_backfill b JOIN public.posts p ON p.id = b.post_id
       WHERE p.image_urls[b.ord + 1] = b.old_url
      UNION ALL
      SELECT b.post_id, b.ord, regexp_replace(b.new_url, '-l4\.webp$', '-l4-r320.webp'), '-l4 320, never shown'
        FROM public.photo_set_backfill b JOIN public.posts p ON p.id = b.post_id
       WHERE p.image_urls[b.ord + 1] = b.old_url
         AND greatest((regexp_match(b.new_url, '-w([0-9]{1,4})h([0-9]{1,4})-l4\.webp$'))[1]::int,
                      (regexp_match(b.new_url, '-w([0-9]{1,4})h([0-9]{1,4})-l4\.webp$'))[2]::int) > 320
    ) x
   WHERE x.u ~ (_pre || 'post-images/' || _uuid || '/[A-Za-z0-9_./-]+-w[0-9]{1,4}h[0-9]{1,4}-l4(-r320)?\.webp$')
     AND position('..' IN x.u) = 0
  ON CONFLICT (object_key) DO NOTHING;
  GET DIAGNOSTICS _b = ROW_COUNT;

  -- anything still named anywhere else is KEPT (re-checked for every row not moved yet)
  SELECT array_agg(r.object_key) INTO _keys FROM public.photo_retire r WHERE r.kind = 'post_extra' AND r.state = 'hold_due';
  FOR _ref IN SELECT f.object_key, string_agg(DISTINCT f.found_in, ', ') AS w FROM public.photo_extra_referenced(_keys) f GROUP BY f.object_key LOOP
    UPDATE public.photo_retire r SET state = 'kept', note = r.note || ' · kept: still named in ' || _ref.w
     WHERE r.object_key = _ref.object_key AND r.state = 'hold_due';
    _kept := _kept + 1;
  END LOOP;

  RETURN jsonb_build_object('queued_credit_copies', _a, 'queued_l4_copies', _b, 'kept_still_named', _kept,
    'hold_due', (SELECT count(*) FROM public.photo_retire WHERE kind = 'post_extra' AND state = 'hold_due'),
    'held', (SELECT count(*) FROM public.photo_retire WHERE kind = 'post_extra' AND state = 'held'));
END;
$fn$;
REVOKE ALL ON FUNCTION public.photo_extra_mark() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_extra_mark() TO authenticated;

-- ── 4. the mover's two calls (admin or converter) ───────────────────────────
-- _op 'move' → rows waiting to move (hold_due); 'restore' → rows held.
CREATE FUNCTION public.photo_extra_claim(_op text, _limit integer DEFAULT 50, _after bigint DEFAULT 0)
RETURNS TABLE(id bigint, object_key text, held_key text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
#variable_conflict use_column
BEGIN
  IF NOT public.media_derivative_worker_ok() THEN
    RAISE EXCEPTION 'PHOTO-EX-002 only an admin or the converter may read the hold list' USING ERRCODE = '42501';
  END IF;
  IF _op IS NULL OR _op NOT IN ('move', 'restore') THEN
    RAISE EXCEPTION 'PHOTO-EX-003 op must be move or restore' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT r.id, r.object_key, 'photo-holding/' || r.object_key FROM public.photo_retire r
   WHERE r.kind = 'post_extra' AND r.state = CASE _op WHEN 'move' THEN 'hold_due' ELSE 'held' END
     AND r.id > coalesce(_after, 0)
   ORDER BY r.id LIMIT least(greatest(coalesce(_limit, 50), 1), 50);
END;
$fn$;

-- _rows: [{"id": <bigint>, "bytes": <bigint>}] — move: hold_due → held (bytes 0 = the file was
-- already absent); restore: held → restored. Returns how many rows changed.
CREATE FUNCTION public.photo_extra_record(_op text, _rows jsonb)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE _n integer;
BEGIN
  IF NOT public.media_derivative_worker_ok() THEN
    RAISE EXCEPTION 'PHOTO-EX-002 only an admin or the converter may record a move' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(_rows) > 50 THEN
    RAISE EXCEPTION 'PHOTO-EX-004 rows must be an array of at most 50' USING ERRCODE = '22023';
  END IF;
  IF _op = 'move' THEN
    UPDATE public.photo_retire r
       SET state = 'held', held_key = 'photo-holding/' || r.object_key, held_at = now(),
           bytes = greatest(coalesce((e->>'bytes')::bigint, 0), 0)
      FROM jsonb_array_elements(_rows) e
     WHERE r.id = (e->>'id')::bigint AND r.kind = 'post_extra' AND r.state = 'hold_due';
  ELSIF _op = 'restore' THEN
    UPDATE public.photo_retire r SET state = 'restored', restored_at = now()
      FROM jsonb_array_elements(_rows) e
     WHERE r.id = (e->>'id')::bigint AND r.kind = 'post_extra' AND r.state = 'held';
  ELSE
    RAISE EXCEPTION 'PHOTO-EX-003 op must be move or restore' USING ERRCODE = '22023';
  END IF;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$fn$;

REVOKE ALL ON FUNCTION public.photo_extra_claim(text, integer, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.photo_extra_record(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photo_extra_claim(text, integer, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.photo_extra_record(text, jsonb) TO authenticated;

-- ── 5. queue now ────────────────────────────────────────────────────────────
DO $mark$
DECLARE _r jsonb;
BEGIN
  _r := public.photo_extra_mark();
  RAISE NOTICE 'EX-0113 applied on % (CDN %): %', current_setting('p32.lane'), public.photo_retire_cdn(), _r;
END
$mark$;

COMMIT;
