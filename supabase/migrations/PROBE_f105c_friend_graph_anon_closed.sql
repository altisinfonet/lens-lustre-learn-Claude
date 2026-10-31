-- F-105c GATE PROBE — the friend graph is not anonymously readable. READS ONLY.
--
-- Run with: psql "$DB_URL" -f supabase/migrations/PROBE_f105c_friend_graph_anon_closed.sql
-- Exits non-zero on the first failed assertion. Writes nothing.
--
-- ⚠ THE CATALOGUE IS HALF THE PROOF. This probe asks proacl. The other half is
-- an anonymous HTTP call, and it is the half that matters, because the whole
-- finding is "a caller with no account reaches this over the wire".
--
-- ⚠⚠ AND THE HTTP HALF MUST BE READ ON STATUS, NOT ON PAYLOAD. Staging carries
-- ZERO accepted friendships (measured 2026-09-06: 1 pending row, 0 accepted,
-- 515 profiles). So all three functions answer an anonymous caller with `[]`,
-- `0` and `false` — EMPTY BECAUSE THERE IS NO DATA, not because they are
-- closed. After the revoke they answer 401. A reviewer comparing PAYLOADS sees
-- empty before and empty after and calls it unchanged; a reviewer comparing
-- STATUS sees 200 before and 401 after. Compare the status.
--
--   BEFORE, staging, publishable key only, no account (2026-09-06):
--     mutual_friend_ids     HTTP 200   []
--     mutual_friends_count  HTTP 200   0
--     are_friends           HTTP 200   false
--     clear_custom_url      HTTP 401         <- NEGATIVE CONTROL, closed by 0012
--
--   The control is what makes the other three mean something: same client, same
--   instant, same call shape, and a function that IS closed returns 401. So a
--   200 is a reachability reading and not an artefact of how the call was made.
--
-- ⚠ DISCLOSURE IS NOT DEMONSTRABLE ON STAGING. The 94 accepted friendships are
-- on PRODUCTION, and we do not call these functions there. What staging proves
-- is that an anonymous caller is ADMITTED. What production's row count proves is
-- that there is something behind the door. Neither lane proves both halves, and
-- no reading in this file should be quoted as if it did.

DO $probe$
DECLARE
  _r        record;
  _n        int;
  _bad      text := '';
  _accepted int;
BEGIN
  RAISE NOTICE '--- F-105c gate probe: friend-graph functions @ % UTC ---',
    to_char(clock_timestamp() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');

  -- H1 · ALL THREE EXIST, EXACTLY ONCE EACH.
  SELECT count(*) INTO _n
    FROM pg_proc p
   WHERE p.pronamespace='public'::regnamespace
     AND p.proname IN ('mutual_friend_ids','mutual_friends_count','are_friends');
  IF _n <> 3 THEN
    RAISE EXCEPTION
      'H1 FAILED — expected exactly 3 friend-graph functions, found %. An overload would make every per-name reading below ambiguous, and a missing one means something dropped it.', _n;
  END IF;

  -- H2 · NO EMPTY-GRANTEE ENTRY ON ANY OF THEM. This is the unit.
  FOR _r IN
    SELECT p.proname, p.oid, array_to_string(p.proacl,' | ') AS acl,
           (SELECT count(*) FROM aclexplode(p.proacl) a WHERE a.grantee=0) AS pub
      FROM pg_proc p
     WHERE p.pronamespace='public'::regnamespace
       AND p.proname IN ('mutual_friend_ids','mutual_friends_count','are_friends')
  LOOP
    IF _r.pub > 0 THEN
      _bad := _bad || format(E'\n  %s (oid %s) — PUBLIC entry present. acl = %s',
                             _r.proname, _r.oid, _r.acl);
    END IF;
  END LOOP;
  IF _bad <> '' THEN
    RAISE EXCEPTION
      'H2 FAILED — the empty-grantee entry survives, so PUBLIC still holds EXECUTE and an anonymous caller can still read the friend graph over PostgREST. A revoke written FROM anon alone does exactly this: it removes anon''s own entry and leaves the inherited grant (F-62/F-98). If this is the FIRST run, it is the expected fail-first reading and 0017 has not been applied.%s', _bad;
  END IF;

  -- H3 · anon HAS NO ENTRY OF ITS OWN EITHER.
  _bad := '';
  FOR _r IN
    SELECT p.proname, array_to_string(p.proacl,' | ') AS acl,
           (SELECT count(*) FROM aclexplode(p.proacl) a WHERE a.grantee='anon'::regrole) AS an
      FROM pg_proc p
     WHERE p.pronamespace='public'::regnamespace
       AND p.proname IN ('mutual_friend_ids','mutual_friends_count','are_friends')
  LOOP
    IF _r.an > 0 THEN
      _bad := _bad || format(E'\n  %s — anon entry present. acl = %s', _r.proname, _r.acl);
    END IF;
  END LOOP;
  IF _bad <> '' THEN
    RAISE EXCEPTION 'H3 FAILED — anon holds a direct grant.%s', _bad;
  END IF;

  -- H4 · NOT AN OVER-REVOKE. authenticated must KEEP all three: the app calls
  --      every one of them from a signed-in browser.
  _bad := '';
  FOR _r IN
    SELECT p.proname, array_to_string(p.proacl,' | ') AS acl,
           (SELECT count(*) FROM aclexplode(p.proacl) a WHERE a.grantee='authenticated'::regrole) AS au
      FROM pg_proc p
     WHERE p.pronamespace='public'::regnamespace
       AND p.proname IN ('mutual_friend_ids','mutual_friends_count','are_friends')
  LOOP
    IF _r.au = 0 THEN
      _bad := _bad || format(E'\n  %s — authenticated LOST EXECUTE. acl = %s', _r.proname, _r.acl);
    END IF;
  END LOOP;
  IF _bad <> '' THEN
    RAISE EXCEPTION
      'H4 FAILED — this closed the signed-in path too. MutualFriends, DiscoverCard, Friends and useProfileData all call these from the browser; the mutual-friends line and the friend badge are DOWN. An over-revoke is as much a defect as an under-revoke.%s', _bad;
  END IF;

  -- H5 · THE HTTP HALF CANNOT BE FAKED FROM IN HERE, SO SAY SO LOUDLY.
  SELECT count(*) INTO _accepted FROM public.friendships WHERE status='accepted';
  IF _accepted = 0 THEN
    RAISE NOTICE 'H5 NOTE — this lane has 0 accepted friendships, so an anonymous call returns [] / 0 / false whether it is open or closed. THE PAYLOAD IS NOT THE READING ON THIS LANE. Compare HTTP status (200 open vs 401 closed) against the clear_custom_url control, or this probe''s green means only that the catalogue is right.';
  ELSE
    RAISE NOTICE 'H5 ok — % accepted friendships on this lane, so an anonymous call would have had something to return.', _accepted;
  END IF;

  RAISE NOTICE 'H1 ok — all three functions present, one each';
  RAISE NOTICE 'H2 ok — no empty-grantee entry on any of the three (the unit)';
  RAISE NOTICE 'H3 ok — anon holds no direct grant either';
  RAISE NOTICE 'H4 ok — authenticated retains EXECUTE on all three (not an over-revoke)';
  RAISE NOTICE '--- F-105c PROBE PASSED (catalogue; the anonymous HTTP call is the other half) ---';
END
$probe$;
