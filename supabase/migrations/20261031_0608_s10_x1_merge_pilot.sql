-- ═══════════════════════════════════════════════════════════════════════════
-- S10 · X1 pilot — duplicate PERMISSIVE policies merged into one policy per
-- action, on 9 low-risk content tables. Both lanes. Access unchanged, proven.
--
-- MEASURED (PROBE_20261031_0607, staging 41083370690, production 41085650031,
-- identical): 82 tables have more than one permissive policy for some
-- (role, action); on 56 of them every permissive policy names the SAME roles.
-- This pilot takes 9 of those 56.
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
--          expression its action needs.
--   E1   · for every identity (anon, up to 3 users of each app role, up to 3
--          real row owners per owner column, 3 ordinary members) × every
--          action: the set of existing rows the OLD policies' combined
--          expression accepts == the set the NEW policy accepts (md5 of the
--          row-id list), for USING and for WITH CHECK.
--   E2   · the same identities, through RLS as anon/authenticated: the set of
--          rows each one can SELECT is identical before and after.
--   S    · restrictive policies byte-identical; exactly one permissive policy
--          per action that had one; roles unchanged.
--
-- BACKUP: every replaced policy (name, command, roles, USING, WITH CHECK) is
-- saved in public.x1_policy_backup_20261031 (no grants, RLS on, no policy) so
-- the rollback recreates them byte-for-byte.
--
-- PROBE:    supabase/migrations/PROBE_20261031_0608_s10_x1_merge_pilot.sql
-- Rollback: supabase/rollback/20261031_0608_s10_x1_merge_pilot_ROLLBACK.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

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

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';

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
REVOKE ALL ON TABLE public.x1_policy_backup_20261031 FROM PUBLIC, anon, authenticated;

DO $x1$
DECLARE
  v_batch constant text := '0608_pilot';
  tables constant text[] := ARRAY['blocked_keywords', 'categories', 'certificate_testimonials', 'courses',
                                  'gift_announcements', 'hero_banners', 'journal_articles', 'lessons',
                                  'photo_of_the_day'];
  acts constant text[] := ARRAY['r', 'a', 'w', 'd'];
  t text; a text; rel oid; r record; id jsonb; c text; k int := 0;
  roles_txt text; n int; dup int;
  using_parts text[]; check_parts text[]; new_using text; new_check text;
  old_expr jsonb := '{}';     -- "tbl|act|u" / "tbl|act|c" -> old combined expression
  e1 jsonb := '{}'; e2_before jsonb := '{}'; e2_after jsonb := '{}';
  ids jsonb := '[]'; cols text[]; h text; diff text;
  restrictive_before jsonb; restrictive_after jsonb;
  pname text; made int := 0; dropped int := 0;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'S10-X1-PRE-001: running as %, not postgres', current_user;
  END IF;

  -- PRE
  FOREACH t IN ARRAY tables LOOP
    rel := to_regclass(format('public.%I', t));
    IF rel IS NULL THEN RAISE EXCEPTION 'S10-X1-PRE-002: table public.% is missing', t; END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = rel) THEN
      RAISE EXCEPTION 'S10-X1-PRE-003: RLS is off on public.%', t;
    END IF;
    SELECT count(DISTINCT polroles) INTO n FROM pg_policy WHERE polrelid = rel AND polpermissive;
    IF n <> 1 THEN
      RAISE EXCEPTION 'S10-X1-PRE-004: public.% has % permissive role sets (needs exactly 1 for an exact merge)', t, n;
    END IF;
    SELECT count(*) INTO dup FROM (
      SELECT a2 FROM pg_policy p, unnest(acts) a2
       WHERE p.polrelid = rel AND p.polpermissive AND (p.polcmd = '*' OR p.polcmd::text = a2)
       GROUP BY a2 HAVING count(*) > 1) z;
    IF dup = 0 THEN
      RAISE EXCEPTION 'S10-X1-PRE-005: public.% has no duplicate permissive policy — already merged, or the lane drifted', t;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = rel AND p.polpermissive
                  AND p.polcmd IN ('*', 'r', 'w', 'd') AND p.polqual IS NULL) THEN
      RAISE EXCEPTION 'S10-X1-PRE-006: public.% has a permissive policy with no USING for an action that needs one — not handled by this merge', t;
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
       AND a3.attname IN ('user_id', 'owner_id', 'author_id', 'viewer_id', 'tagger_id', 'created_by');
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

  -- Merge
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
      SELECT array_agg('(' || pg_get_expr(p.polqual, p.polrelid) || ')' ORDER BY p.polname)
               FILTER (WHERE a <> 'a' AND p.polqual IS NOT NULL),
             array_agg('(' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), pg_get_expr(p.polqual, p.polrelid)) || ')' ORDER BY p.polname)
               FILTER (WHERE a IN ('a', 'w'))
        INTO using_parts, check_parts
        FROM pg_policy p
       WHERE p.polrelid = rel AND p.polpermissive AND (p.polcmd = '*' OR p.polcmd::text = a);
      IF using_parts IS NULL AND check_parts IS NULL THEN CONTINUE; END IF;
      new_using := CASE WHEN using_parts IS NOT NULL THEN array_to_string(using_parts, ' OR ') END;
      new_check := CASE WHEN check_parts IS NOT NULL THEN array_to_string(check_parts, ' OR ') END;
      old_expr := old_expr || jsonb_build_object(t || '|' || a || '|u', new_using, t || '|' || a || '|c', new_check);
      pname := 'x1_merged_' || CASE a WHEN 'r' THEN 'select' WHEN 'a' THEN 'insert' WHEN 'w' THEN 'update' ELSE 'delete' END;
      EXECUTE format('CREATE POLICY %I ON public.%I AS PERMISSIVE FOR %s TO %s', pname, t,
                     CASE a WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE' ELSE 'DELETE' END, roles_txt)
           || CASE WHEN a <> 'a' AND new_using IS NOT NULL THEN format(' USING (%s)', new_using) ELSE '' END
           || CASE WHEN a IN ('a', 'w') AND new_check IS NOT NULL THEN format(' WITH CHECK (%s)', new_check) ELSE '' END;
      made := made + 1;
    END LOOP;

    FOR r IN SELECT p.polname FROM public.x1_policy_backup_20261031 b
               JOIN pg_policy p ON p.polrelid = rel AND p.polname = b.policyname
              WHERE b.tbl = t AND b.batch = v_batch LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', r.polname, t);
      dropped := dropped + 1;
    END LOOP;
  END LOOP;

  -- E1 · old combined expression vs new policy, over existing rows, per identity (as owner: same context for both).
  FOR id IN SELECT * FROM jsonb_array_elements(ids) LOOP
    PERFORM set_config('request.jwt.claims', CASE WHEN id ->> 'sub' IS NULL THEN json_build_object('role', id ->> 'role')
             ELSE json_build_object('sub', id ->> 'sub', 'role', id ->> 'role') END::text, true);
    PERFORM set_config('request.jwt.claim.sub', coalesce(id ->> 'sub', ''), true);
    PERFORM set_config('request.jwt.claim.role', id ->> 'role', true);
    FOR r IN SELECT c3.relname AS t, p.polcmd::text AS a,
                    pg_get_expr(p.polqual, p.polrelid) AS u, pg_get_expr(p.polwithcheck, p.polrelid) AS ck
               FROM pg_policy p JOIN pg_class c3 ON c3.oid = p.polrelid
              WHERE c3.relnamespace = 'public'::regnamespace AND c3.relname = ANY (tables) AND p.polname LIKE 'x1\_merged\_%' LOOP
      FOREACH c IN ARRAY ARRAY['u', 'c'] LOOP
        CONTINUE WHEN (old_expr ->> (r.t || '|' || r.a || '|' || c)) IS NULL
                  AND (CASE c WHEN 'u' THEN r.u ELSE r.ck END) IS NULL;
        IF (old_expr ->> (r.t || '|' || r.a || '|' || c)) IS NULL OR (CASE c WHEN 'u' THEN r.u ELSE r.ck END) IS NULL THEN
          RAISE EXCEPTION 'S10-X1-E1: %.% % clause present on one side only', r.t, r.a, c;
        END IF;
        EXECUTE format('SELECT md5(coalesce(string_agg(ctid::text, %L ORDER BY ctid), %L)) FROM public.%I WHERE coalesce((%s), false)',
                       ',', '', r.t, old_expr ->> (r.t || '|' || r.a || '|' || c)) INTO h;
        EXECUTE format('SELECT md5(coalesce(string_agg(ctid::text, %L ORDER BY ctid), %L)) FROM public.%I WHERE coalesce((%s), false)',
                       ',', '', r.t, CASE c WHEN 'u' THEN r.u ELSE r.ck END) INTO diff;
        IF h IS DISTINCT FROM diff THEN
          RAISE EXCEPTION 'S10-X1-E1: % % (%) accepts different rows for identity % after the merge', r.t, r.a, c, id ->> 'k';
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  -- E2 after
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
    RAISE EXCEPTION 'S10-X1-E2: visible rows changed for (table|identity):%', diff;
  END IF;

  -- S
  SELECT jsonb_object_agg(c2.relname || '|' || p.polname,
           jsonb_build_array(p.polcmd::text, p.polroles::text, pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)))
    INTO restrictive_after
    FROM pg_policy p JOIN pg_class c2 ON c2.oid = p.polrelid
   WHERE c2.relnamespace = 'public'::regnamespace AND NOT p.polpermissive;
  IF restrictive_after IS DISTINCT FROM restrictive_before THEN
    RAISE EXCEPTION 'S10-X1-POST-001: a restrictive policy changed';
  END IF;
  FOREACH t IN ARRAY tables LOOP
    rel := to_regclass(format('public.%I', t));
    IF EXISTS (SELECT 1 FROM pg_policy p, unnest(acts) a2
                WHERE p.polrelid = rel AND p.polpermissive AND (p.polcmd = '*' OR p.polcmd::text = a2)
                GROUP BY a2 HAVING count(*) > 1) THEN
      RAISE EXCEPTION 'S10-X1-POST-002: public.% still has a duplicate permissive policy', t;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = rel AND p.polpermissive AND p.polname NOT LIKE 'x1\_merged\_%') THEN
      RAISE EXCEPTION 'S10-X1-POST-003: public.% kept an unmerged permissive policy', t;
    END IF;
  END LOOP;
  IF has_table_privilege('anon', 'public.x1_policy_backup_20261031', 'SELECT')
     OR has_table_privilege('authenticated', 'public.x1_policy_backup_20261031', 'SELECT') THEN
    RAISE EXCEPTION 'S10-X1-POST-004: the policy backup table is readable by anon or authenticated';
  END IF;

  RAISE NOTICE 'S10 X1 pilot applied (lane %): % tables, % permissive policies -> % merged (0 duplicates); E1 rows identical for % identities x every action; E2 % visible-row sets identical; restrictive policies unchanged',
    current_setting('p32.lane'), array_length(tables, 1), dropped, made, jsonb_array_length(ids),
    (SELECT count(*) FROM jsonb_object_keys(e2_before));
END
$x1$;

COMMIT;
