-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261020_0001 · admin Delete user works for a member with post_media.
-- FAILS before the migration (RESTRICT → 23503 in the account cascade),
-- PASSES after (NO ACTION, checked at end of statement).
--
-- ONE transaction ending in ROLLBACK. The delete itself runs inside an EXCEPTION
-- block that is forced to raise, so it is undone even when it succeeds. Nothing
-- survives on any lane. Also proves the protection still holds: deleting ONLY a
-- media object that a live post still uses is still refused.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $probe$
DECLARE
  _def  text;
  _u    uuid;
  _m    uuid;
  _st   text;
  _msg  text;
  _del  text := 'not run';
  _keep text := 'not run';
BEGIN
  -- G1 · the rule is NO ACTION
  SELECT pg_get_constraintdef(c.oid) INTO _def FROM pg_constraint c
   WHERE c.conrelid = 'public.post_media'::regclass AND c.conname = 'post_media_media_id_fkey';
  IF _def IS DISTINCT FROM 'FOREIGN KEY (media_id) REFERENCES media_objects(id)' THEN
    RAISE EXCEPTION 'PROBE FAIL 20261020_0001 G1: post_media_media_id_fkey is "%" (expected NO ACTION) — not applied', _def;
  END IF;

  -- a member who owns a post that has post_media rows pointing at their own media
  SELECT p.user_id, pm.media_id INTO _u, _m
    FROM public.post_media pm JOIN public.posts p ON p.id = pm.post_id
    JOIN public.media_objects mo ON mo.id = pm.media_id AND mo.owner_id = p.user_id
   ORDER BY p.created_at DESC LIMIT 1;
  IF _u IS NULL THEN
    RAISE NOTICE 'PROBE 20261020_0001: no post_media rows on this lane — G2/G3 skipped (G1 passed)';
    RETURN;
  END IF;

  -- G2 · the account delete cascade now succeeds (undone)
  BEGIN
    PERFORM public.admin_delete_auth_user(_u);
    _del := 'OK';
    RAISE EXCEPTION 'probe-undo-G2';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _st = RETURNED_SQLSTATE, _msg = MESSAGE_TEXT;
    IF _msg <> 'probe-undo-G2' THEN _del := _st || ': ' || _msg; END IF;
  END;
  IF _del <> 'OK' THEN
    RAISE EXCEPTION 'PROBE FAIL 20261020_0001 G2: account delete still blocked: %', _del;
  END IF;

  -- G3 · protection kept: deleting a media object a live post still uses is refused
  BEGIN
    DELETE FROM public.media_objects WHERE id = _m;
    _keep := 'DELETED (protection lost)';
    RAISE EXCEPTION 'probe-undo-G3';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _st = RETURNED_SQLSTATE, _msg = MESSAGE_TEXT;
    IF _msg = 'probe-undo-G3' THEN NULL;
    ELSIF _st = '23503' THEN _keep := 'refused 23503';
    ELSE _keep := _st || ': ' || _msg; END IF;
  END;
  IF _keep <> 'refused 23503' THEN
    RAISE EXCEPTION 'PROBE FAIL 20261020_0001 G3: deleting an in-use media object was not refused (%)', _keep;
  END IF;

  RAISE NOTICE 'PROBE PASS 20261020_0001: rule NO ACTION; account delete cascade OK (undone); in-use media delete still refused (23503)';
END
$probe$;
ROLLBACK;
