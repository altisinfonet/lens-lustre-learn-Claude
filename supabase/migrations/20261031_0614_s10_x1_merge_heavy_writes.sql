-- ═══════════════════════════════════════════════════════════════════════════
-- S10 · X1 heavy-write tables — duplicate PERMISSIVE policies on
-- public.activity_logs and public.feed_events merged into one policy per
-- action. Both lanes. Access unchanged, proven.
--
-- Live before this: 0608, 0609, 0611, 0612 (53 tables); 0613 user_roles.
-- These two are written on most member actions, so they get the hardened
-- user_roles template (0613): the proof runs BEFORE the exclusive lock in one
-- REPEATABLE READ snapshot; an ACCESS SHARE lock taken before that snapshot
-- keeps any policy change on them from slipping in between plan and DDL
-- (ACCESS SHARE blocks no reader or writer); inside the exclusive lock only
-- CREATE/DROP POLICY, E1-bind, E2-after and the shape checks run.
-- PROBE 0610 measured the full proof on production (run 41114463704, lower
-- bounds): activity_logs ≈ 2.3 s, feed_events ≈ 0.9 s; E2-after is part of
-- that. lock_timeout is 2 s; once taken, the file checks the elapsed time
-- before each identity in BIND and E2-after and before the final checks and
-- rolls back past 3 s (WIN). The cap is checked between steps, so one slow
-- step can run past it (hard ceiling: statement_timeout 60 s). ACCESS
-- EXCLUSIVE blocks reads as well as writes on both tables; a query that waits
-- is delayed, not refused. The two exclusive locks are taken one after the
-- other (activity_logs, then feed_events), each with its own 2 s
-- lock_timeout, and the 3 s clock starts once both are held: worst case
-- activity_logs is blocked about 2 + 2 + 3 s plus the last step. No
-- transaction in the code touches feed_events and then activity_logs (the
-- account-deletion paths use separate requests; no SQL function or trigger
-- reads both), so no deadlock with member traffic is expected. If one
-- happens, Postgres aborts one side: either this file (it rolls back with
-- nothing changed) or that member's request (it fails once). If WIN fires on
-- production, the tables go in separate files.
--
-- WHY IT IS EXACT: Postgres ORs the permissive policies that apply to the
-- current role, per action (a FOR ALL policy applies to every action; for
-- INSERT/UPDATE a policy with no WITH CHECK uses its USING). With one role
-- set, replacing the policies of one action by a single policy whose USING is
-- the OR of their USINGs and whose WITH CHECK is the OR of their
-- coalesce(WITH CHECK, USING) gives the same answer for every row and every
-- user. RESTRICTIVE policies (e.g. "Deleted accounts cannot …") are not
-- touched. Postgres then evaluates one policy per action instead of several.
--
-- PROOF, in this transaction (any failure rolls the whole file back):
--   PRE  · each table: RLS on, every permissive policy has the same roles,
--          at least one duplicate exists, no applicable policy lacks the
--          expression its action needs (USING; WITH CHECK for INSERT).
--   E1   · for every identity (anon, up to 3 users of each app role, up to 3
--          real row owners per owner column, 3 ordinary members) × every
--          action: the UNION of the existing rows each ORIGINAL policy accepts
--          on its own (read back from the backup, evaluated one policy at a
--          time) == the rows the MERGED TEXT accepts (the exact string handed
--          to CREATE POLICY), for USING and for WITH CHECK (coalesce(check,
--          using)). Evaluated as the table owner with the identity's JWT
--          claims — the same context on both sides. Runs BEFORE the lock.
--   BIND · after CREATE POLICY, for anon and the first signed-in identity,
--          each STORED merged clause accepts exactly the rows its proven text
--          accepted in E1 (ties the catalog policy to what E1 proved).
--   E2   · the same identities, through RLS as anon/authenticated: the set of
--          rows each one can SELECT is identical before and after.
--   S    · restrictive policies byte-identical; exactly one permissive policy
--          per action that had one; roles unchanged.
--
-- BACKUP: every replaced policy (name, command, roles, USING, WITH CHECK) is
-- saved in public.x1_policy_backup_20261031 so the rollback recreates them
-- (action, roles, USING, WITH CHECK checked against it). The rollback EXECUTEs that text as postgres, so the table is
-- owner-only: owned by postgres, every grant revoked (PUBLIC, anon,
-- authenticated AND service_role — Supabase's default privileges grant all
-- three), RLS on with no policy; checked before use and after.
--
-- PROBE:    supabase/migrations/PROBE_20261031_0614_s10_x1_merge_heavy_writes.sql
-- Rollback: supabase/rollback/20261031_0614_s10_x1_merge_heavy_writes_ROLLBACK.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- One snapshot for the whole proof: E1 and E2-before run outside the lock
-- while members keep writing, so every comparison must read the same data
-- (READ COMMITTED would give each scan a fresh snapshot and ctid hashes would
-- drift under live UPDATEs). Nothing here writes to these tables, so
-- REPEATABLE READ cannot raise a serialization failure.
BEGIN ISOLATION LEVEL REPEATABLE READ;

SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
-- Taken BEFORE the first statement that takes the snapshot (LOCK and SET do
-- not), so no policy change on these tables can commit between the snapshot the
-- plan reads and the DDL below (CREATE/DROP POLICY need ACCESS EXCLUSIVE).
-- ACCESS SHARE blocks no reader or writer.
LOCK TABLE public.activity_logs, public.feed_events IN ACCESS SHARE MODE;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

CREATE TABLE IF NOT EXISTS public.x1_policy_backup_20261031 (
  batch       text        NOT NULL,
  tbl         text        NOT NULL,
  policyname  text        NOT NULL,
  cmd         text        NOT NULL,
  roles       text[]      NOT NULL,
  using_expr  text,
  check_expr  text,
  saved_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tbl, policyname)
);
COMMENT ON TABLE public.x1_policy_backup_20261031 IS
  'S10 X1: the permissive policies replaced by 20261031_0608+ merges, kept so the rollback can recreate them exactly. No member access. Drop once the merges are accepted (Auditor).';
ALTER TABLE public.x1_policy_backup_20261031 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.x1_policy_backup_20261031 FROM PUBLIC, anon, authenticated, service_role;

DO $x1$
DECLARE
  v_batch constant text := '0614_heavy';
  tables constant text[] := ARRAY['activity_logs', 'feed_events'];
  acts constant text[] := ARRAY['r', 'a', 'w', 'd'];
  t text; a text; rel oid; r record; id jsonb; c text; k int := 0;
  roles_txt text; n int; dup int;
  using_parts text[]; check_parts text[]; new_using text; new_check text;
  e1 jsonb := '{}'; e2_before jsonb := '{}'; e2_after jsonb := '{}';
  ids jsonb := '[]'; cols text[]; h text; diff text;
  restrictive_before jsonb; restrictive_after jsonb;
  pname text; made int := 0; dropped int := 0;
  plan jsonb := '{}'; e1hash jsonb := '{}'; pk text; pv jsonb;
  bkr record; one text; old_tids tid[]; part_tids tid[];
  t_lock timestamptz; win constant interval := interval '3 seconds';
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'S10-X1HW-PRE-001: running as %, not postgres', current_user;
  END IF;
  -- The backup is executed as postgres by the rollback: owner-only, always.
  IF (SELECT c0.relowner FROM pg_class c0 WHERE c0.oid = 'public.x1_policy_backup_20261031'::regclass) <> 'postgres'::regrole
     OR EXISTS (SELECT 1 FROM pg_class c0, aclexplode(c0.relacl) x
                 WHERE c0.oid = 'public.x1_policy_backup_20261031'::regclass AND x.grantee <> c0.relowner) THEN
    RAISE EXCEPTION 'S10-X1HW-PRE-007: public.x1_policy_backup_20261031 is not owner-only (owner postgres, no other grantee)';
  END IF;
  -- only rows this run writes may ever be executed: none may pre-exist for the batch
  IF EXISTS (SELECT 1 FROM public.x1_policy_backup_20261031 bk WHERE bk.batch = v_batch) THEN
    RAISE EXCEPTION 'S10-X1HW-PRE-008: the backup already holds rows for batch % — refusing to trust them', v_batch;
  END IF;

  -- PRE
  FOREACH t IN ARRAY tables LOOP
    rel := to_regclass(format('public.%I', t));
    IF rel IS NULL THEN RAISE EXCEPTION 'S10-X1HW-PRE-002: table public.% is missing', t; END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = rel) THEN
      RAISE EXCEPTION 'S10-X1HW-PRE-003: RLS is off on public.%', t;
    END IF;
    SELECT count(DISTINCT polroles) INTO n FROM pg_policy WHERE polrelid = rel AND polpermissive;
    IF n <> 1 THEN
      RAISE EXCEPTION 'S10-X1HW-PRE-004: public.% has % permissive role sets (needs exactly 1 for an exact merge)', t, n;
    END IF;
    SELECT count(*) INTO dup FROM (
      SELECT a2 FROM pg_policy p, unnest(acts) a2
       WHERE p.polrelid = rel AND p.polpermissive AND (p.polcmd = '*' OR p.polcmd::text = a2)
       GROUP BY a2 HAVING count(*) > 1) z;
    IF dup = 0 THEN
      RAISE EXCEPTION 'S10-X1HW-PRE-005: public.% has no duplicate permissive policy — already merged, or the lane drifted', t;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = rel AND p.polpermissive
                  AND ((p.polcmd IN ('*', 'r', 'w', 'd') AND p.polqual IS NULL)
                       OR (p.polcmd = 'a' AND p.polwithcheck IS NULL))) THEN
      RAISE EXCEPTION 'S10-X1HW-PRE-006: public.% has a permissive policy missing the expression its action needs (USING, or WITH CHECK for INSERT) — not handled by this merge', t;
    END IF;
  END LOOP;

  SELECT jsonb_object_agg(c2.relname || '|' || p.polname,
           jsonb_build_array(p.polcmd::text, p.polroles::text, pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)))
    INTO restrictive_before
    FROM pg_policy p JOIN pg_class c2 ON c2.oid = p.polrelid
   WHERE c2.relnamespace = 'public'::regnamespace AND NOT p.polpermissive;

  -- Identities: anon; up to 3 users of each app role; up to 3 owners per
  -- owner column; 3 ordinary members. Labels never carry an id.
  ids := ids || jsonb_build_object('k', 'anon', 'role', 'anon', 'sub', NULL);
  FOR r IN SELECT ur.role::text AS role, ur.user_id,
                  row_number() OVER (PARTITION BY ur.role::text ORDER BY ur.user_id) AS rn
             FROM public.user_roles ur LOOP
    IF r.rn <= 3 THEN
      k := k + 1;
      ids := ids || jsonb_build_object('k', r.role || '#' || k, 'role', 'authenticated', 'sub', r.user_id);
    END IF;
  END LOOP;
  FOREACH t IN ARRAY tables LOOP
    SELECT array_agg(a3.attname::text) INTO cols FROM pg_attribute a3
     WHERE a3.attrelid = to_regclass(format('public.%I', t)) AND a3.attnum > 0 AND NOT a3.attisdropped
       AND a3.atttypid = 'uuid'::regtype
       AND a3.attname IN ('user_id', 'owner_id', 'author_id', 'viewer_id', 'tagger_id', 'tagged_user_id', 'reporter_id', 'recipient_id', 'profile_id', 'created_by',
                         'judge_id', 'referrer_id', 'referred_id', 'requester_id', 'reviewer_id', 'buyer_id',
                         'addressee_id', 'friend_id', 'follower_id', 'following_id');
    FOREACH c IN ARRAY coalesce(cols, '{}') LOOP
      FOR r IN EXECUTE format('SELECT DISTINCT %I AS u FROM public.%I WHERE %I IS NOT NULL ORDER BY 1 LIMIT 3', c, t, c) LOOP
        k := k + 1;
        ids := ids || jsonb_build_object('k', 'owner#' || k, 'role', 'authenticated', 'sub', r.u);
      END LOOP;
    END LOOP;
  END LOOP;
  FOR r IN SELECT u.id FROM auth.users u ORDER BY u.created_at LIMIT 3 LOOP
    k := k + 1;
    ids := ids || jsonb_build_object('k', 'member#' || k, 'role', 'authenticated', 'sub', r.id);
  END LOOP;
  SELECT jsonb_agg(e ORDER BY ord) INTO ids FROM (
    SELECT DISTINCT ON (coalesce(e ->> 'sub', 'anon')) e, ord
      FROM jsonb_array_elements(ids) WITH ORDINALITY AS x(e, ord)
     ORDER BY coalesce(e ->> 'sub', 'anon'), ord) d;

  -- E2 before: rows each identity can SELECT through RLS (row-id set hash).
  FOR id IN SELECT * FROM jsonb_array_elements(ids) LOOP
    PERFORM set_config('request.jwt.claims', CASE WHEN id ->> 'sub' IS NULL THEN json_build_object('role', id ->> 'role')
             ELSE json_build_object('sub', id ->> 'sub', 'role', id ->> 'role') END::text, true);
    PERFORM set_config('request.jwt.claim.sub', coalesce(id ->> 'sub', ''), true);
    PERFORM set_config('request.jwt.claim.role', id ->> 'role', true);
    EXECUTE format('SET LOCAL ROLE %I', id ->> 'role');
    FOREACH t IN ARRAY tables LOOP
      BEGIN
        EXECUTE format('SELECT md5(coalesce(string_agg(ctid::text, %L ORDER BY ctid), %L)) FROM public.%I', ',', '', t) INTO h;
      EXCEPTION WHEN insufficient_privilege THEN h := 'no-grant';
      END;
      e2_before := e2_before || jsonb_build_object(t || '|' || (id ->> 'k'), h);
    END LOOP;
    RESET ROLE;
  END LOOP;

  -- Plan (no DDL yet): backup the originals and build each merged text.
  FOREACH t IN ARRAY tables LOOP
    rel := to_regclass(format('public.%I', t));
    SELECT CASE WHEN p.polroles = '{0}'::oid[] THEN 'PUBLIC'
                ELSE (SELECT string_agg(quote_ident(rr.rolname), ', ' ORDER BY rr.rolname)
                        FROM pg_roles rr WHERE rr.oid = ANY (p.polroles)) END
      INTO roles_txt
      FROM pg_policy p WHERE p.polrelid = rel AND p.polpermissive LIMIT 1;

    INSERT INTO public.x1_policy_backup_20261031 (batch, tbl, policyname, cmd, roles, using_expr, check_expr)
    SELECT v_batch, t, p.polname, p.polcmd::text,
           CASE WHEN p.polroles = '{0}'::oid[] THEN ARRAY['PUBLIC']
                ELSE (SELECT array_agg(rr.rolname::text ORDER BY rr.rolname) FROM pg_roles rr WHERE rr.oid = ANY (p.polroles)) END,
           pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)
      FROM pg_policy p WHERE p.polrelid = rel AND p.polpermissive;

    FOREACH a IN ARRAY acts LOOP
      -- Parts are joined in DESCENDING policy-name order: Postgres builds a
      -- table's policy list in reverse pg_policy index order (policy.c,
      -- RelationBuildRowSecurity: "built in reverse order") and rowsecurity.c
      -- ORs the permissive quals in that order, so
      -- this keeps the evaluation order the originals had (polname is type
      -- name, which compares in the "C" collation like the index).
      SELECT array_agg('(' || pg_get_expr(p.polqual, p.polrelid) || ')' ORDER BY p.polname DESC)
               FILTER (WHERE a <> 'a' AND p.polqual IS NOT NULL),
             array_agg('(' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), pg_get_expr(p.polqual, p.polrelid)) || ')' ORDER BY p.polname DESC)
               FILTER (WHERE a IN ('a', 'w'))
        INTO using_parts, check_parts
        FROM pg_policy p
       WHERE p.polrelid = rel AND p.polpermissive AND (p.polcmd = '*' OR p.polcmd::text = a);
      IF using_parts IS NULL AND check_parts IS NULL THEN CONTINUE; END IF;
      plan := plan || jsonb_build_object(t || '|' || a, jsonb_build_object(
                'roles', roles_txt,
                'u', CASE WHEN a <> 'a' AND using_parts IS NOT NULL THEN array_to_string(using_parts, ' OR ') END,
                'c', CASE WHEN a IN ('a', 'w') AND check_parts IS NOT NULL THEN array_to_string(check_parts, ' OR ') END));
    END LOOP;
  END LOOP;

  -- E1 (before the lock) · per identity × planned policy × clause: the union
  --      of each ORIGINAL policy's rows (one at a time, from the backup) vs
  --      the rows the MERGED TEXT accepts. Hashes kept for the bind check.
  FOR id IN SELECT * FROM jsonb_array_elements(ids) LOOP
    PERFORM set_config('request.jwt.claims', CASE WHEN id ->> 'sub' IS NULL THEN json_build_object('role', id ->> 'role')
             ELSE json_build_object('sub', id ->> 'sub', 'role', id ->> 'role') END::text, true);
    PERFORM set_config('request.jwt.claim.sub', coalesce(id ->> 'sub', ''), true);
    PERFORM set_config('request.jwt.claim.role', id ->> 'role', true);
    FOR pk, pv IN SELECT * FROM jsonb_each(plan) LOOP
      t := split_part(pk, '|', 1); a := split_part(pk, '|', 2);
      FOREACH c IN ARRAY ARRAY['u', 'c'] LOOP
        CONTINUE WHEN (c = 'u' AND a = 'a') OR (c = 'c' AND a IN ('r', 'd'));
        IF (pv ->> c) IS NULL THEN
          RAISE EXCEPTION 'S10-X1HW-E1: %.% has no % clause in the plan', t, a, c;
        END IF;
        old_tids := '{}';
        FOR bkr IN SELECT bk.using_expr, bk.check_expr FROM public.x1_policy_backup_20261031 bk
                  WHERE bk.batch = v_batch AND bk.tbl = t AND (bk.cmd = '*' OR bk.cmd = a) LOOP
          one := CASE c WHEN 'u' THEN bkr.using_expr ELSE coalesce(bkr.check_expr, bkr.using_expr) END;
          CONTINUE WHEN one IS NULL;
          EXECUTE format('SELECT coalesce(array_agg(ctid), %L) FROM public.%I WHERE coalesce((%s), false)', '{}', t, one) INTO part_tids;
          old_tids := old_tids || part_tids;
        END LOOP;
        SELECT md5(coalesce(string_agg(x::text, ',' ORDER BY x), '')) INTO h FROM (SELECT DISTINCT unnest(old_tids) AS x) z;
        EXECUTE format('SELECT md5(coalesce(string_agg(ctid::text, %L ORDER BY ctid), %L)) FROM public.%I WHERE coalesce((%s), false)',
                       ',', '', t, pv ->> c) INTO diff;
        IF h IS DISTINCT FROM diff THEN
          RAISE EXCEPTION 'S10-X1HW-E1: % % (%) merged text accepts different rows for identity %', t, a, c, id ->> 'k';
        END IF;
        e1hash := e1hash || jsonb_build_object((id ->> 'k') || '|' || pk || '|' || c, diff);
      END LOOP;
    END LOOP;
  END LOOP;

  -- Lock window starts here: both tables at once, in name order.
  LOCK TABLE public.activity_logs, public.feed_events IN ACCESS EXCLUSIVE MODE;
  -- writes to both tables wait while this lock is held: if the work inside it
  -- ever runs past 3 s, give up (whole file rolls back, nothing changed).
  t_lock := clock_timestamp();
  -- create the merged policies, drop the originals.
  FOR pk, pv IN SELECT * FROM jsonb_each(plan) LOOP
    t := split_part(pk, '|', 1); a := split_part(pk, '|', 2);
    pname := 'x1_merged_' || CASE a WHEN 'r' THEN 'select' WHEN 'a' THEN 'insert' WHEN 'w' THEN 'update' ELSE 'delete' END;
    EXECUTE format('CREATE POLICY %I ON public.%I AS PERMISSIVE FOR %s TO %s', pname, t,
                   CASE a WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE' ELSE 'DELETE' END, pv ->> 'roles')
         || CASE WHEN (pv ->> 'u') IS NOT NULL THEN format(' USING (%s)', pv ->> 'u') ELSE '' END
         || CASE WHEN (pv ->> 'c') IS NOT NULL THEN format(' WITH CHECK (%s)', pv ->> 'c') ELSE '' END;
    made := made + 1;
  END LOOP;
  FOREACH t IN ARRAY tables LOOP
    rel := to_regclass(format('public.%I', t));
    FOR r IN SELECT p.polname FROM public.x1_policy_backup_20261031 b
               JOIN pg_policy p ON p.polrelid = rel AND p.polname = b.policyname
              WHERE b.tbl = t AND b.batch = v_batch LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', r.polname, t);
      dropped := dropped + 1;
    END LOOP;
  END LOOP;

  -- E1-bind (in the lock, cheap) · for the first two identities (anon and
  --      the first signed-in one), each STORED merged policy clause accepts
  --      exactly the rows its proven text accepted in E1.
  FOR id IN SELECT e FROM jsonb_array_elements(ids) WITH ORDINALITY AS x(e, o) WHERE o <= 2 LOOP
    IF clock_timestamp() - t_lock > win THEN
      RAISE EXCEPTION 'S10-X1HW-WIN: the exclusive lock on activity_logs/feed_events has been held over 3 s — rolled back, nothing changed';
    END IF;
    PERFORM set_config('request.jwt.claims', CASE WHEN id ->> 'sub' IS NULL THEN json_build_object('role', id ->> 'role')
             ELSE json_build_object('sub', id ->> 'sub', 'role', id ->> 'role') END::text, true);
    PERFORM set_config('request.jwt.claim.sub', coalesce(id ->> 'sub', ''), true);
    PERFORM set_config('request.jwt.claim.role', id ->> 'role', true);
    FOR r IN SELECT c3.relname AS t, p.polcmd::text AS a,
                    pg_get_expr(p.polqual, p.polrelid) AS u, pg_get_expr(p.polwithcheck, p.polrelid) AS ck
               FROM pg_policy p JOIN pg_class c3 ON c3.oid = p.polrelid
              WHERE c3.relnamespace = 'public'::regnamespace AND c3.relname = ANY (tables) AND p.polname LIKE 'x1\_merged\_%' LOOP
      FOREACH c IN ARRAY ARRAY['u', 'c'] LOOP
        CONTINUE WHEN (c = 'u' AND r.a = 'a') OR (c = 'c' AND r.a IN ('r', 'd'));
        IF (CASE c WHEN 'u' THEN r.u ELSE r.ck END) IS NULL THEN
          RAISE EXCEPTION 'S10-X1HW-BIND: %.% has no % clause after the merge', r.t, r.a, c;
        END IF;
        EXECUTE format('SELECT md5(coalesce(string_agg(ctid::text, %L ORDER BY ctid), %L)) FROM public.%I WHERE coalesce((%s), false)',
                       ',', '', r.t, CASE c WHEN 'u' THEN r.u ELSE r.ck END) INTO diff;
        IF diff IS DISTINCT FROM (e1hash ->> ((id ->> 'k') || '|' || r.t || '|' || r.a || '|' || c)) THEN
          RAISE EXCEPTION 'S10-X1HW-BIND: stored % % (%) differs from the proven text for identity %', r.t, r.a, c, id ->> 'k';
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  -- E2 after
  FOR id IN SELECT * FROM jsonb_array_elements(ids) LOOP
    IF clock_timestamp() - t_lock > win THEN
      RAISE EXCEPTION 'S10-X1HW-WIN: the exclusive lock on activity_logs/feed_events has been held over 3 s — rolled back, nothing changed';
    END IF;
    PERFORM set_config('request.jwt.claims', CASE WHEN id ->> 'sub' IS NULL THEN json_build_object('role', id ->> 'role')
             ELSE json_build_object('sub', id ->> 'sub', 'role', id ->> 'role') END::text, true);
    PERFORM set_config('request.jwt.claim.sub', coalesce(id ->> 'sub', ''), true);
    PERFORM set_config('request.jwt.claim.role', id ->> 'role', true);
    EXECUTE format('SET LOCAL ROLE %I', id ->> 'role');
    FOREACH t IN ARRAY tables LOOP
      BEGIN
        EXECUTE format('SELECT md5(coalesce(string_agg(ctid::text, %L ORDER BY ctid), %L)) FROM public.%I', ',', '', t) INTO h;
      EXCEPTION WHEN insufficient_privilege THEN h := 'no-grant';
      END;
      e2_after := e2_after || jsonb_build_object(t || '|' || (id ->> 'k'), h);
    END LOOP;
    RESET ROLE;
  END LOOP;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);

  SELECT string_agg(format(' %s', b.key), '') INTO diff
    FROM jsonb_each_text(e2_before) b WHERE (e2_after ->> b.key) IS DISTINCT FROM b.value;
  IF diff IS NOT NULL THEN
    RAISE EXCEPTION 'S10-X1HW-E2: visible rows changed for (table|identity):%', diff;
  END IF;

  IF clock_timestamp() - t_lock > win THEN
    RAISE EXCEPTION 'S10-X1HW-WIN: the exclusive lock on activity_logs/feed_events has been held over 3 s — rolled back, nothing changed';
  END IF;
  -- S
  SELECT jsonb_object_agg(c2.relname || '|' || p.polname,
           jsonb_build_array(p.polcmd::text, p.polroles::text, pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)))
    INTO restrictive_after
    FROM pg_policy p JOIN pg_class c2 ON c2.oid = p.polrelid
   WHERE c2.relnamespace = 'public'::regnamespace AND NOT p.polpermissive;
  IF restrictive_after IS DISTINCT FROM restrictive_before THEN
    RAISE EXCEPTION 'S10-X1HW-POST-001: a restrictive policy changed';
  END IF;
  FOREACH t IN ARRAY tables LOOP
    rel := to_regclass(format('public.%I', t));
    IF EXISTS (SELECT 1 FROM pg_policy p, unnest(acts) a2
                WHERE p.polrelid = rel AND p.polpermissive AND (p.polcmd = '*' OR p.polcmd::text = a2)
                GROUP BY a2 HAVING count(*) > 1) THEN
      RAISE EXCEPTION 'S10-X1HW-POST-002: public.% still has a duplicate permissive policy', t;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = rel AND p.polpermissive AND p.polname NOT LIKE 'x1\_merged\_%') THEN
      RAISE EXCEPTION 'S10-X1HW-POST-003: public.% kept an unmerged permissive policy', t;
    END IF;
    -- every action that had an original policy has exactly one merged policy, and no other action has one
    IF (SELECT array_agg(DISTINCT a2 ORDER BY a2) FROM public.x1_policy_backup_20261031 bk, unnest(acts) a2
         WHERE bk.batch = v_batch AND bk.tbl = t AND (bk.cmd = '*' OR bk.cmd = a2))
       IS DISTINCT FROM
       (SELECT array_agg(p.polcmd::text ORDER BY p.polcmd::text) FROM pg_policy p
         WHERE p.polrelid = rel AND p.polpermissive AND p.polname LIKE 'x1\_merged\_%') THEN
      RAISE EXCEPTION 'S10-X1HW-POST-005: public.% merged actions differ from the actions its original policies granted', t;
    END IF;
    -- roles unchanged: every merged policy is granted to exactly the role set of the originals
    IF EXISTS (SELECT 1 FROM pg_policy p
                WHERE p.polrelid = rel AND p.polpermissive AND p.polname LIKE 'x1\_merged\_%'
                  AND (CASE WHEN p.polroles = '{0}'::oid[] THEN ARRAY['PUBLIC']
                            ELSE (SELECT array_agg(rr.rolname::text ORDER BY rr.rolname) FROM pg_roles rr WHERE rr.oid = ANY (p.polroles)) END)
                      IS DISTINCT FROM (SELECT bk.roles FROM public.x1_policy_backup_20261031 bk WHERE bk.batch = v_batch AND bk.tbl = t LIMIT 1))
       OR (SELECT count(DISTINCT bk.roles) FROM public.x1_policy_backup_20261031 bk WHERE bk.batch = v_batch AND bk.tbl = t) <> 1 THEN
      RAISE EXCEPTION 'S10-X1HW-POST-006: public.% merged policies are not granted to the original role set', t;
    END IF;
  END LOOP;
  IF (SELECT c0.relowner FROM pg_class c0 WHERE c0.oid = 'public.x1_policy_backup_20261031'::regclass) <> 'postgres'::regrole
     OR EXISTS (SELECT 1 FROM pg_class c0, aclexplode(c0.relacl) x
                 WHERE c0.oid = 'public.x1_policy_backup_20261031'::regclass AND x.grantee <> c0.relowner) THEN
    RAISE EXCEPTION 'S10-X1HW-POST-004: the policy backup table is not owner-only (owner postgres, no other grantee)';
  END IF;

  RAISE NOTICE 'S10 X1 heavy-write tables applied (lane %): % tables, % permissive policies -> % merged (0 duplicates); E1 (before the lock) identical for % identities x every action, bound to the stored policies; E2 % visible-row sets identical; restrictive policies unchanged',
    current_setting('p32.lane'), array_length(tables, 1), dropped, made, jsonb_array_length(ids),
    (SELECT count(*) FROM jsonb_object_keys(e2_before));
END
$x1$;

COMMIT;
