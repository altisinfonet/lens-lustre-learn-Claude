-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE for 20261003_0002_user_blocks_hardening.sql. Ends in ROLLBACK.
-- Supersedes PROBE_user_blocks_closed.sql (SEC-UB-2: that probe counted four
-- policies and never read what they say, so a policy of USING (true) passed it).
--
-- Raises — and so fails the dispatch — on the first false assertion.
--
-- TWO PARTS
--   S · static: what the catalogue says. Every policy's EXPRESSION is read, not
--       counted: a permissive policy of `true` fails S2/S3/S4.
--   B · behaviour: what two real members can actually do, executed under
--       SET LOCAL ROLE authenticated with each member's JWT claims, exactly as
--       PostgREST runs a request. This is the owner-isolation test SEC-UB-2 asks
--       for; B3 fails on a SELECT USING (true), B4 on a DELETE USING (true), B5 on
--       an INSERT WITH CHECK (true) — each shown in the harness transcript.
--       The probe picks two live, non-admin accounts with no block or notice
--       between them, writes one block row, and the final ROLLBACK removes it,
--       the notice row and the ledger row. Nothing is committed. The trigger's
--       admin_notifications INSERT is inside the same rolled-back transaction.
--
-- Read docs/evidence/d1/user-blocks/ub-0002-transcript.txt for the fail-first runs.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $probe$
DECLARE
  a uuid;  b uuid;  ghost uuid := gen_random_uuid();
  n int;   n0 int;  nb int;  q text;  w text;
  failed boolean;
BEGIN
  -- ── S · static ────────────────────────────────────────────────────────────
  -- S1 · table present, RLS on.
  IF to_regclass('public.user_blocks') IS NULL
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_blocks'::regclass) THEN
    RAISE EXCEPTION 'PROBE FAIL S1: public.user_blocks missing or RLS off';
  END IF;

  -- S2 · exactly one permissive SELECT policy, and it is own-or-admin.
  SELECT count(*), max(qual) INTO n, q FROM pg_policies
   WHERE schemaname='public' AND tablename='user_blocks' AND permissive='PERMISSIVE' AND cmd IN ('SELECT','ALL');
  IF n <> 1 OR q NOT LIKE '%blocker_id = ( SELECT auth.uid()%' OR q NOT LIKE '%has_role(( SELECT auth.uid()%' THEN
    RAISE EXCEPTION 'PROBE FAIL S2: % permissive SELECT/ALL policies; qual = %', n, q;
  END IF;

  -- S3 · exactly one permissive INSERT policy, WITH CHECK own blocker_id.
  SELECT count(*), max(with_check) INTO n, w FROM pg_policies
   WHERE schemaname='public' AND tablename='user_blocks' AND permissive='PERMISSIVE' AND cmd='INSERT';
  IF n <> 1 OR w IS DISTINCT FROM '(blocker_id = ( SELECT auth.uid() AS uid))' THEN
    RAISE EXCEPTION 'PROBE FAIL S3: % permissive INSERT policies; with_check = %', n, w;
  END IF;

  -- S4 · exactly one permissive DELETE policy, USING own blocker_id; no UPDATE policy.
  SELECT count(*), max(qual) INTO n, q FROM pg_policies
   WHERE schemaname='public' AND tablename='user_blocks' AND permissive='PERMISSIVE' AND cmd='DELETE';
  IF n <> 1 OR q IS DISTINCT FROM '(blocker_id = ( SELECT auth.uid() AS uid))' THEN
    RAISE EXCEPTION 'PROBE FAIL S4: % permissive DELETE policies; qual = %', n, q;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_blocks'
                                         AND permissive='PERMISSIVE' AND cmd='UPDATE') THEN
    RAISE EXCEPTION 'PROBE FAIL S4: a permissive UPDATE policy exists on user_blocks';
  END IF;

  -- S5 · the three restrictive live-account guards.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename='user_blocks' AND permissive='RESTRICTIVE'
     AND coalesce(qual, with_check) = '( SELECT account_is_live() AS account_is_live)'
     AND cmd IN ('INSERT','UPDATE','DELETE');
  IF n <> 3 THEN
    RAISE EXCEPTION 'PROBE FAIL S5: % of 3 restrictive account_is_live guards on user_blocks', n;
  END IF;

  -- S6 · grants: anon holds nothing; authenticated holds SELECT, INSERT, DELETE and nothing else.
  IF has_table_privilege('anon', 'public.user_blocks', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'PROBE FAIL S6: anon holds a privilege on public.user_blocks';
  END IF;
  IF NOT (has_table_privilege('authenticated', 'public.user_blocks', 'SELECT')
      AND has_table_privilege('authenticated', 'public.user_blocks', 'INSERT')
      AND has_table_privilege('authenticated', 'public.user_blocks', 'DELETE'))
     OR has_table_privilege('authenticated', 'public.user_blocks', 'UPDATE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'PROBE FAIL S6: authenticated privileges on user_blocks are not exactly SELECT, INSERT, DELETE';
  END IF;

  -- S7 · the ledger and the trigger function are closed to API roles; the cap is in the body.
  IF to_regclass('public.user_block_notices') IS NULL
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_block_notices'::regclass)
     OR has_table_privilege('anon', 'public.user_block_notices', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
     OR has_table_privilege('authenticated', 'public.user_block_notices', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') THEN
    RAISE EXCEPTION 'PROBE FAIL S7: public.user_block_notices missing, RLS off, or open to an API role';
  END IF;
  IF has_function_privilege('anon', 'public.notify_admin_user_blocked()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.notify_admin_user_blocked()', 'EXECUTE')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.user_blocks'::regclass AND tgname='user_blocks_notify_admin') THEN
    RAISE EXCEPTION 'PROBE FAIL S7: trigger missing, or notify_admin_user_blocked() executable by an API role';
  END IF;

  -- ── B · behaviour ─────────────────────────────────────────────────────────
  -- Two live, non-admin accounts that appear in no block and no notice at all.
  WITH c AS (
    SELECT u.id FROM auth.users u
     WHERE NOT public.has_role(u.id, 'admin')
       AND NOT EXISTS (SELECT 1 FROM public.user_blocks x WHERE u.id IN (x.blocker_id, x.blocked_id))
       AND NOT EXISTS (SELECT 1 FROM public.user_block_notices x WHERE u.id IN (x.blocker_id, x.blocked_id))
     ORDER BY u.id LIMIT 2)
  SELECT min(id::text)::uuid, max(id::text)::uuid INTO a, b FROM c HAVING count(*) = 2;
  IF a IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL B0: fewer than two live non-admin accounts without a block between them';
  END IF;
  SELECT count(*) INTO n0 FROM public.admin_notifications WHERE type='user_blocked' AND reference_id=b;

  -- B1 · A blocks B.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (a, b);
  -- B2 · A sees exactly that row.
  SELECT count(*) INTO n FROM public.user_blocks WHERE blocker_id = a AND blocked_id = b;
  IF n <> 1 THEN RAISE EXCEPTION 'PROBE FAIL B2: A sees % of its own block rows (want 1)', n; END IF;
  RESET ROLE;

  -- B3 · B cannot see A's row (owner isolation; fails on USING (true)).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', b::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.user_blocks WHERE blocker_id = a;
  IF n <> 0 THEN RAISE EXCEPTION 'PROBE FAIL B3: B sees % of A''s block rows (want 0)', n; END IF;
  -- B4 · B cannot delete A's row — or anyone's. A BARE DELETE (no WHERE), so
  -- only the DELETE policy decides: with a WHERE clause the SELECT policy also
  -- filters the rows, and a DELETE policy of USING (true) would hide behind it
  -- (UB0002-1, SEC 2026-10-04). B owns no rows (picked that way), so the
  -- correct policy deletes 0; USING (true) would delete every row, and the
  -- final ROLLBACK restores them either way.
  RESET ROLE;
  SELECT count(*) INTO nb FROM public.user_blocks;
  SET LOCAL ROLE authenticated;
  DELETE FROM public.user_blocks;
  RESET ROLE;
  SELECT count(*) INTO n FROM public.user_blocks;
  IF n <> nb THEN RAISE EXCEPTION 'PROBE FAIL B4: a bare DELETE by B removed % row(s) it does not own', nb - n; END IF;
  SELECT count(*) INTO n FROM public.user_blocks WHERE blocker_id = a AND blocked_id = b;
  IF n <> 1 THEN RAISE EXCEPTION 'PROBE FAIL B4: B deleted A''s block row'; END IF;

  -- B5 · B cannot write a row in A's name.
  SET LOCAL ROLE authenticated;
  failed := false;
  BEGIN
    INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (a, ghost);
  EXCEPTION
    WHEN insufficient_privilege THEN failed := (SQLERRM LIKE '%row-level security%');
    -- Reaching the FK (ghost is no account) or a duplicate means RLS let the row
    -- through: report it as B5, not as a stray constraint error (UB0002-2).
    WHEN foreign_key_violation OR unique_violation THEN failed := false;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'PROBE FAIL B5: B could insert a block with blocker_id = A'; END IF;
  -- B6 · no member can UPDATE a block row.
  failed := false;
  BEGIN
    UPDATE public.user_blocks SET created_at = created_at WHERE blocker_id = b;
  EXCEPTION WHEN insufficient_privilege THEN failed := true;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'PROBE FAIL B6: authenticated can UPDATE user_blocks'; END IF;
  RESET ROLE;

  -- B7 · a deleted account (valid JWT, no auth.users row) cannot block (SEC-UB-3).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ghost, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', ghost::text, true);
  SET LOCAL ROLE authenticated;
  failed := false;
  BEGIN
    INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (ghost, a);
  EXCEPTION
    WHEN insufficient_privilege THEN failed := (SQLERRM LIKE '%row-level security%');
    WHEN foreign_key_violation  THEN failed := false;  -- reached the FK: RLS let it through
  END;
  RESET ROLE;
  IF NOT failed THEN RAISE EXCEPTION 'PROBE FAIL B7: a deleted account was not refused by RLS'; END IF;

  -- B8 · anon reads nothing.
  SET LOCAL ROLE anon;
  failed := false;
  BEGIN
    PERFORM 1 FROM public.user_blocks LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN failed := true;
  END;
  RESET ROLE;
  IF NOT failed THEN RAISE EXCEPTION 'PROBE FAIL B8: anon can read user_blocks'; END IF;

  -- B9 · notice cap (SEC-UB-1): block, unblock, block again → one notice, not two.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  SET LOCAL ROLE authenticated;
  DELETE FROM public.user_blocks WHERE blocker_id = a AND blocked_id = b;
  INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (a, b);
  RESET ROLE;
  SELECT count(*) - n0 INTO n FROM public.admin_notifications WHERE type='user_blocked' AND reference_id=b;
  IF n <> 1 THEN RAISE EXCEPTION 'PROBE FAIL B9: block, unblock, block wrote % notices (want 1)', n; END IF;

  RAISE NOTICE 'PROBE PASS: user_blocks hardened — S1..S7 static, B1..B9 behaviour (all rolled back)';
END
$probe$;
ROLLBACK;
