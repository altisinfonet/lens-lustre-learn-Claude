-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · SEC-P3E-1 · post_shares SELECT scoped to post visibility (20261010_0003)
-- Ends in ROLLBACK: every row it writes (shares, one friendship) is removed.
-- Raises — and so fails the dispatch — on the first false assertion.
--
-- S · static: exactly one permissive SELECT/ALL policy on post_shares; it is
--     not USING (true), calls can_view_post, wraps every auth.uid(); the INSERT
--     and DELETE policies are unchanged (own rows only).
-- B · behaviour, run under SET LOCAL ROLE authenticated with each member's JWT
--     claims, exactly as PostgREST runs a request. Live accounts and live posts
--     are picked; only share rows (and one friendship) are written, then rolled
--     back:  S = a non-admin member who shares one public, one friends-only and one
--     private post of other authors; X = a non-admin member who is none of those authors
--     and no friend of theirs.
--   B1 X sees S's share of the public post only (1 of 3)      ← fails on USING (true)
--   B2 S sees all three of their own shares
--   B3 each post's author sees the share of their own post
--   B4 once X is the friends-only author's friend: X sees that share too, still
--      not the private one
--   B5 anon sees none
--   B6 S can still remove their share of the private post (DELETE … WHERE)
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $probe$
DECLARE
  pu record;  pf record;  pp record;
  s uuid;  x uuid;
  n int;  q text;
BEGIN
  -- ── S · static ──────────────────────────────────────────────────────────
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'post_shares'
         AND cmd IN ('SELECT', 'ALL') AND permissive = 'PERMISSIVE') <> 1 THEN
    RAISE EXCEPTION 'PROBE FAIL SEC-P3E-1: S1 post_shares must have exactly one permissive SELECT/ALL policy';
  END IF;
  SELECT qual INTO q FROM pg_policies WHERE schemaname = 'public' AND tablename = 'post_shares'
     AND cmd = 'SELECT' AND permissive = 'PERMISSIVE';
  IF q IS NULL OR q = 'true' OR q !~ 'can_view_post' THEN
    RAISE EXCEPTION 'PROBE FAIL SEC-P3E-1: S2 the SELECT policy is not scoped by can_view_post (USING (true)?)';
  END IF;
  IF (length(q) - length(replace(q, 'auth.uid()', ''))) / 10 <> (length(q) - length(replace(q, 'SELECT auth.uid()', ''))) / 17 THEN
    RAISE EXCEPTION 'PROBE FAIL SEC-P3E-1: S3 a bare auth.uid() in the SELECT policy (must be (SELECT auth.uid()))';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'post_shares' AND cmd = 'INSERT'
                  AND permissive = 'PERMISSIVE' AND with_check ~ 'auth\.uid\(\).*= user_id|user_id = .*auth\.uid\(\)')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'post_shares' AND cmd = 'DELETE'
                  AND permissive = 'PERMISSIVE' AND qual ~ 'auth\.uid\(\).*= user_id|user_id = .*auth\.uid\(\)') THEN
    RAISE EXCEPTION 'PROBE FAIL SEC-P3E-1: S4 the INSERT / DELETE own-row policies changed';
  END IF;

  -- ── B · behaviour (picks live data; writes only shares + one friendship) ──
  SELECT p.id, p.user_id INTO pu FROM public.posts p JOIN auth.users u ON u.id = p.user_id WHERE p.privacy = 'public'  ORDER BY p.created_at DESC LIMIT 1;
  SELECT p.id, p.user_id INTO pf FROM public.posts p JOIN auth.users u ON u.id = p.user_id WHERE p.privacy = 'friends' ORDER BY p.created_at DESC LIMIT 1;
  SELECT p.id, p.user_id INTO pp FROM public.posts p JOIN auth.users u ON u.id = p.user_id WHERE p.privacy = 'private' ORDER BY p.created_at DESC LIMIT 1;
  IF pu.id IS NULL OR pf.id IS NULL OR pp.id IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL SEC-P3E-1: B0 this lane has no live public + friends + private post to test with';
  END IF;
  SELECT u.id INTO s FROM auth.users u
   WHERE u.id NOT IN (pu.user_id, pf.user_id, pp.user_id)
     AND NOT public.has_role(u.id, 'admin')        -- an admin sees every post (posts' admin policy)
     AND NOT EXISTS (SELECT 1 FROM public.post_shares ps WHERE ps.user_id = u.id AND ps.post_id IN (pu.id, pf.id, pp.id))
   ORDER BY u.created_at LIMIT 1;
  SELECT u.id INTO x FROM auth.users u
   WHERE u.id NOT IN (pu.user_id, pf.user_id, pp.user_id, coalesce(s, u.id))
     AND NOT public.are_friends(u.id, pf.user_id) AND NOT public.are_friends(u.id, pp.user_id)
     AND NOT public.has_role(u.id, 'admin')
   ORDER BY u.created_at LIMIT 1;
  IF s IS NULL OR x IS NULL OR s = x THEN
    RAISE EXCEPTION 'PROBE FAIL SEC-P3E-1: B0 this lane has too few live accounts for a cross-member test';
  END IF;
  INSERT INTO public.post_shares (post_id, user_id) VALUES (pu.id, s), (pf.id, s), (pp.id, s);

  -- B1 · X, a stranger to both authors
  PERFORM set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', x::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.post_shares WHERE user_id = s AND post_id IN (pu.id, pf.id, pp.id);
  IF n <> 1 OR NOT EXISTS (SELECT 1 FROM public.post_shares WHERE user_id = s AND post_id = pu.id) THEN
    RAISE EXCEPTION 'PROBE FAIL SEC-P3E-1: B1 a stranger sees % of 3 shares (want only the public post''s)', n;
  END IF;
  RESET ROLE;
  -- B2 · S, the sharer
  PERFORM set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', s::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.post_shares WHERE user_id = s AND post_id IN (pu.id, pf.id, pp.id);
  IF n <> 3 THEN RAISE EXCEPTION 'PROBE FAIL SEC-P3E-1: B2 the sharer sees % of their 3 shares', n; END IF;
  RESET ROLE;
  -- B3 · each author
  PERFORM set_config('request.jwt.claims', json_build_object('sub', pp.user_id, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', pp.user_id::text, true);
  SET LOCAL ROLE authenticated;
  IF NOT EXISTS (SELECT 1 FROM public.post_shares WHERE user_id = s AND post_id = pp.id) THEN
    RAISE EXCEPTION 'PROBE FAIL SEC-P3E-1: B3 the private post''s author cannot see a share of it';
  END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', pf.user_id, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', pf.user_id::text, true);
  SET LOCAL ROLE authenticated;
  IF NOT EXISTS (SELECT 1 FROM public.post_shares WHERE user_id = s AND post_id = pf.id) THEN
    RAISE EXCEPTION 'PROBE FAIL SEC-P3E-1: B3 the friends-only post''s author cannot see a share of it';
  END IF;
  RESET ROLE;
  -- B4 · X becomes the friends-only author's friend
  INSERT INTO public.friendships (requester_id, addressee_id, status) VALUES (x, pf.user_id, 'accepted');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', x::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.post_shares WHERE user_id = s AND post_id IN (pu.id, pf.id, pp.id);
  IF n <> 2 OR EXISTS (SELECT 1 FROM public.post_shares WHERE user_id = s AND post_id = pp.id) THEN
    RAISE EXCEPTION 'PROBE FAIL SEC-P3E-1: B4 a friend sees % of 3 shares (want public + friends-only, not private)', n;
  END IF;
  RESET ROLE;
  -- B5 · anon
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE anon;
  BEGIN
    SELECT count(*) INTO n FROM public.post_shares WHERE user_id = s;
  EXCEPTION WHEN insufficient_privilege THEN n := 0;
  END;
  IF n <> 0 THEN RAISE EXCEPTION 'PROBE FAIL SEC-P3E-1: B5 anon sees % share(s)', n; END IF;
  RESET ROLE;
  -- B6 · S removes their share of the private post
  PERFORM set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', s::text, true);
  SET LOCAL ROLE authenticated;
  DELETE FROM public.post_shares WHERE post_id = pp.id AND user_id = s;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'PROBE FAIL SEC-P3E-1: B6 the sharer could not remove their share of a private post (% rows)', n; END IF;
  RESET ROLE;

  RAISE NOTICE 'PROBE PASS SEC-P3E-1: S1–S4 static; B1 stranger 1/3, B2 sharer 3/3, B3 authors see theirs, B4 friend 2/3, B5 anon 0, B6 unshare of a private post works (all rolled back)';
END
$probe$;
ROLLBACK;
