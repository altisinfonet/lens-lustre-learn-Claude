-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261020_0001 · admin Delete user works for a member with post_media.
-- FAILS before the migration (G1: body has no posts-first delete; and G2 would
-- hit 23503), PASSES after. ONE transaction ending in ROLLBACK; the delete runs
-- in an EXCEPTION block forced to raise, so it is undone even on success.
-- G3: the RESTRICT protection is kept (deleting an in-use media object alone is
-- still refused). G4: only postgres/service_role can EXECUTE the function.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $probe$
DECLARE
  _u    uuid;
  _m    uuid;
  _st   text;
  _msg  text;
  _del  text := 'not run';
  _keep text := 'not run';
BEGIN
  -- G1
  IF coalesce((SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure('public.admin_delete_auth_user(uuid)')), '')
     NOT LIKE '%DELETE FROM public.posts WHERE user_id = _uid%' THEN
    RAISE EXCEPTION 'PROBE FAIL 20261020_0001 G1: admin_delete_auth_user does not delete the member''s posts first — not applied';
  END IF;
  -- G4
  IF has_function_privilege('anon', 'public.admin_delete_auth_user(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.admin_delete_auth_user(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PROBE FAIL 20261020_0001 G4: anon/authenticated can EXECUTE admin_delete_auth_user';
  END IF;

  SELECT p.user_id, pm.media_id INTO _u, _m
    FROM public.post_media pm JOIN public.posts p ON p.id = pm.post_id
    JOIN public.media_objects mo ON mo.id = pm.media_id AND mo.owner_id = p.user_id
   ORDER BY p.created_at DESC LIMIT 1;
  IF _u IS NULL THEN
    RAISE NOTICE 'PROBE PASS 20261020_0001 (G1, G4): no post_media rows on this lane — G2/G3 not exercised';
    RETURN;
  END IF;

  -- G3 first (protection kept): deleting only an in-use media object is refused
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

  -- G2 · the account delete now succeeds (undone)
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

  RAISE NOTICE 'PROBE PASS 20261020_0001: posts-first delete; account delete OK (undone); in-use media delete still refused; EXECUTE postgres/service_role only';
END
$probe$;
ROLLBACK;
