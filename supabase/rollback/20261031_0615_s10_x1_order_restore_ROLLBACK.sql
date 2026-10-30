-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261031_0615 — S10 X1 order restore.
-- Puts every merged policy's parts back in ASCENDING policy-name order, the
-- state 0608–0613 left (activity_logs and feed_events, merged by 0614,
-- are not touched). It is the same helper and the same per-table proof
-- (E1, ORDER, BIND, E2, POST, WIN) as the migration, with the direction
-- reversed. Access is unchanged in both directions.
-- ═══════════════════════════════════════════════════════════════════════════

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      '% REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Dispatch apply-migration.yml (it sets p32.lane from target).',
      'ROLLBACK', coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

-- Session-only helper (pg_temp): gone when this session ends.
CREATE FUNCTION pg_temp.x1_reorder(t text, dir text) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $f$
DECLARE
  rel oid; r record; id jsonb; c text; k int := 0; n int;
  ids jsonb := '[]'; cols text[]; h text; diff text; v_batch text;
  plan jsonb := '{}'; e1hash jsonb := '{}'; pk text; pv jsonb; a text;
  e2_before jsonb := '{}'; e2_after jsonb := '{}';
  restr_before jsonb; restr_after jsonb; shape_before jsonb; shape_after jsonb;
  bkr record; one text; old_tids tid[]; part_tids tid[];
  u_desc text; u_asc text; c_desc text; c_asc text; nu int; nc int;
  stored text; arm record; pos int; lastpos int; cand text; depth int; is_wrapped boolean; ch text;
  found_dir boolean; d text; joined text; nparts int; firstpart text; expect_hit boolean;
  t_lock timestamptz; win constant interval := interval '3 seconds'; altered int := 0;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'S10-X1RO-PRE-000: p32.lane is not staging or production';
  END IF;
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'S10-X1RO-PRE-001: running as %, not postgres', current_user;
  END IF;
  IF dir NOT IN ('DESC', 'ASC') THEN RAISE EXCEPTION 'S10-X1RO-PRE-009: bad direction %', dir; END IF;
  rel := to_regclass(format('public.%I', t));
  IF rel IS NULL THEN RAISE EXCEPTION 'S10-X1RO-PRE-002: table public.% is missing', t; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = rel AND p.polpermissive AND p.polname LIKE 'x1\_merged\_%') THEN
    RAISE NOTICE 'S10 X1 reorder: public.% has no x1_merged_* policies on this lane — skipped', t;
    RETURN;
  END IF;
  -- the backup is the source of the text: it must be owner-only
  IF (SELECT c0.relowner FROM pg_class c0 WHERE c0.oid = 'public.x1_policy_backup_20261031'::regclass) <> 'postgres'::regrole
     OR EXISTS (SELECT 1 FROM pg_class c0, aclexplode(c0.relacl) x
                 WHERE c0.oid = 'public.x1_policy_backup_20261031'::regclass AND x.grantee <> c0.relowner) THEN
    RAISE EXCEPTION 'S10-X1RO-PRE-007: public.x1_policy_backup_20261031 is not owner-only';
  END IF;
  SELECT count(DISTINCT bk.batch), min(bk.batch) INTO n, v_batch FROM public.x1_policy_backup_20261031 bk WHERE bk.tbl = t;
  IF n <> 1 THEN RAISE EXCEPTION 'S10-X1RO-PRE-003: public.% has % backup batches (needs exactly 1)', t, n; END IF;
  IF EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = rel AND p.polpermissive AND p.polname NOT LIKE 'x1\_merged\_%') THEN
    RAISE EXCEPTION 'S10-X1RO-PRE-004: public.% has permissive policies besides x1_merged_* — not the state the merge left', t;
  END IF;

  SELECT jsonb_object_agg(p.polname, jsonb_build_array(p.polcmd::text, p.polroles::text, pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)))
    INTO restr_before FROM pg_policy p WHERE p.polrelid = rel AND NOT p.polpermissive;
  SELECT jsonb_object_agg(p.polname, jsonb_build_array(p.polcmd::text, p.polroles::text))
    INTO shape_before FROM pg_policy p WHERE p.polrelid = rel AND p.polpermissive;

  -- Plan: each merged policy's clauses rebuilt from the backed-up originals,
  -- parts in the requested policy-name order ("C" collation, like pg_policy's index).
  FOR r IN SELECT p.polname, p.polcmd::text AS a FROM pg_policy p
            WHERE p.polrelid = rel AND p.polpermissive AND p.polname LIKE 'x1\_merged\_%' ORDER BY p.polname LOOP
    a := r.a;
    IF a NOT IN ('r', 'a', 'w', 'd') THEN
      RAISE EXCEPTION 'S10-X1RO-PRE-005: public.% policy % has command %, expected one action', t, r.polname, a;
    END IF;
    SELECT string_agg('(' || bk.using_expr || ')', ' OR ' ORDER BY bk.policyname COLLATE "C" DESC) FILTER (WHERE a <> 'a' AND bk.using_expr IS NOT NULL),
           string_agg('(' || bk.using_expr || ')', ' OR ' ORDER BY bk.policyname COLLATE "C" ASC)  FILTER (WHERE a <> 'a' AND bk.using_expr IS NOT NULL),
           count(*) FILTER (WHERE a <> 'a' AND bk.using_expr IS NOT NULL),
           string_agg('(' || coalesce(bk.check_expr, bk.using_expr) || ')', ' OR ' ORDER BY bk.policyname COLLATE "C" DESC) FILTER (WHERE a IN ('a', 'w')),
           string_agg('(' || coalesce(bk.check_expr, bk.using_expr) || ')', ' OR ' ORDER BY bk.policyname COLLATE "C" ASC)  FILTER (WHERE a IN ('a', 'w')),
           count(*) FILTER (WHERE a IN ('a', 'w'))
      INTO u_desc, u_asc, nu, c_desc, c_asc, nc
      FROM public.x1_policy_backup_20261031 bk
     WHERE bk.tbl = t AND bk.batch = v_batch AND (bk.cmd = '*' OR bk.cmd = a);
    IF (a <> 'a' AND u_desc IS NULL) OR (a IN ('a', 'w') AND c_desc IS NULL) THEN
      RAISE EXCEPTION 'S10-X1RO-PRE-006: public.% policy % has no backed-up parts for a clause it needs', t, r.polname;
    END IF;
    CONTINUE WHEN coalesce(nu, 0) <= 1 AND coalesce(nc, 0) <= 1;   -- one part: order cannot change
    plan := plan || jsonb_build_object(r.polname, jsonb_build_object('a', a,
              'u', CASE WHEN a <> 'a' THEN CASE dir WHEN 'DESC' THEN u_desc ELSE u_asc END END,
              'c', CASE WHEN a IN ('a', 'w') THEN CASE dir WHEN 'DESC' THEN c_desc ELSE c_asc END END));
  END LOOP;
  IF plan = '{}'::jsonb THEN
    RAISE NOTICE 'S10 X1 reorder: public.% — every merged clause has one part; nothing to reorder', t;
    RETURN;
  END IF;

  -- DRIFT-T (text, before the lock): each planned clause as stored now must
  -- EQUAL the backed-up parts joined in ascending or in descending order
  -- (exact string comparison; see the expected-text rule below). This catches
  -- drift the row-based check cannot see on the current data (for example on
  -- an empty table, or an extra arm that matches no rows yet).
  FOR pk, pv IN SELECT * FROM jsonb_each(plan) LOOP
    a := pv ->> 'a';
    FOREACH c IN ARRAY ARRAY['u', 'c'] LOOP
      CONTINUE WHEN (pv ->> c) IS NULL;
      SELECT CASE c WHEN 'u' THEN pg_get_expr(p.polqual, p.polrelid) ELSE pg_get_expr(p.polwithcheck, p.polrelid) END
        INTO stored FROM pg_policy p WHERE p.polrelid = rel AND p.polname = pk;
      found_dir := false;
      FOREACH d IN ARRAY ARRAY['ASC', 'DESC'] LOOP
        -- expected text for direction d: '(' || parts joined by ' OR ' || ')';
        -- one part: the part itself; the parser flattens "(A OR B) OR C", so the
        -- first part may also appear without its single outer pair of parentheses.
        SELECT string_agg(x, ' OR ' ORDER BY CASE WHEN d = 'DESC' THEN nm END COLLATE "C" DESC,
                                             CASE WHEN d = 'ASC'  THEN nm END COLLATE "C" ASC),
               count(*),
               (array_agg(x ORDER BY CASE WHEN d = 'DESC' THEN nm END COLLATE "C" DESC,
                                     CASE WHEN d = 'ASC'  THEN nm END COLLATE "C" ASC))[1]
          INTO joined, nparts, firstpart
          FROM (SELECT bk.policyname AS nm,
                       CASE c WHEN 'u' THEN bk.using_expr ELSE coalesce(bk.check_expr, bk.using_expr) END AS x
                  FROM public.x1_policy_backup_20261031 bk
                 WHERE bk.tbl = t AND bk.batch = v_batch AND (bk.cmd = '*' OR bk.cmd = a)) z
         WHERE x IS NOT NULL;
        IF nparts = 1 THEN
          expect_hit := coalesce(stored = joined, false);
        ELSE
          expect_hit := coalesce(stored = '(' || joined || ')', false);
          IF NOT expect_hit AND left(firstpart, 1) = '(' AND right(firstpart, 1) = ')' THEN
            depth := 0; is_wrapped := true;
            FOR i IN 1 .. length(firstpart) LOOP
              ch := substr(firstpart, i, 1);
              IF ch = '(' THEN depth := depth + 1; ELSIF ch = ')' THEN depth := depth - 1; END IF;
              IF depth = 0 AND i < length(firstpart) THEN is_wrapped := false; EXIT; END IF;
            END LOOP;
            IF is_wrapped THEN
              expect_hit := coalesce(stored = '(' || substr(firstpart, 2, length(firstpart) - 2)
                                                  || substr(joined, length(firstpart) + 1) || ')', false);
            END IF;
          END IF;
        END IF;
        IF expect_hit THEN found_dir := true; EXIT; END IF;
      END LOOP;
      IF NOT found_dir THEN
        RAISE EXCEPTION 'S10-X1RO-DRIFT-T: % % (%) as stored now is not exactly the backed-up parts in either order — it changed after the merge; refusing', t, pk, c;
      END IF;
    END LOOP;
  END LOOP;


  -- Identities: anon; up to 3 users of each app role; up to 3 owners per owner column; 3 members.
  ids := ids || jsonb_build_object('k', 'anon', 'role', 'anon', 'sub', NULL);
  FOR r IN SELECT ur.role::text AS role, ur.user_id,
                  row_number() OVER (PARTITION BY ur.role::text ORDER BY ur.user_id) AS rn
             FROM public.user_roles ur LOOP
    IF r.rn <= 3 THEN
      k := k + 1; ids := ids || jsonb_build_object('k', r.role || '#' || k, 'role', 'authenticated', 'sub', r.user_id);
    END IF;
  END LOOP;
  SELECT array_agg(a3.attname::text) INTO cols FROM pg_attribute a3
   WHERE a3.attrelid = rel AND a3.attnum > 0 AND NOT a3.attisdropped AND a3.atttypid = 'uuid'::regtype
     AND a3.attname IN ('user_id', 'owner_id', 'author_id', 'viewer_id', 'tagger_id', 'tagged_user_id', 'reporter_id', 'recipient_id', 'profile_id', 'created_by',
                       'judge_id', 'referrer_id', 'referred_id', 'requester_id', 'reviewer_id', 'buyer_id',
                       'addressee_id', 'friend_id', 'follower_id', 'following_id');
  FOREACH c IN ARRAY coalesce(cols, '{}') LOOP
    FOR r IN EXECUTE format('SELECT DISTINCT %I AS u FROM public.%I WHERE %I IS NOT NULL ORDER BY 1 LIMIT 3', c, t, c) LOOP
      k := k + 1; ids := ids || jsonb_build_object('k', 'owner#' || k, 'role', 'authenticated', 'sub', r.u);
    END LOOP;
  END LOOP;
  FOR r IN SELECT u0.id FROM auth.users u0 ORDER BY u0.created_at LIMIT 3 LOOP
    k := k + 1; ids := ids || jsonb_build_object('k', 'member#' || k, 'role', 'authenticated', 'sub', r.id);
  END LOOP;
  SELECT jsonb_agg(e ORDER BY ord) INTO ids FROM (
    SELECT DISTINCT ON (coalesce(e ->> 'sub', 'anon')) e, ord
      FROM jsonb_array_elements(ids) WITH ORDINALITY AS x(e, ord)
     ORDER BY coalesce(e ->> 'sub', 'anon'), ord) d;

  -- E2 before (through RLS)
  FOR id IN SELECT * FROM jsonb_array_elements(ids) LOOP
    PERFORM set_config('request.jwt.claims', CASE WHEN id ->> 'sub' IS NULL THEN json_build_object('role', id ->> 'role')
             ELSE json_build_object('sub', id ->> 'sub', 'role', id ->> 'role') END::text, true);
    PERFORM set_config('request.jwt.claim.sub', coalesce(id ->> 'sub', ''), true);
    PERFORM set_config('request.jwt.claim.role', id ->> 'role', true);
    EXECUTE format('SET LOCAL ROLE %I', id ->> 'role');
    BEGIN
      EXECUTE format('SELECT md5(coalesce(string_agg(ctid::text, %L ORDER BY ctid), %L)) FROM public.%I', ',', '', t) INTO h;
    EXCEPTION WHEN insufficient_privilege THEN h := 'no-grant';
    END;
    e2_before := e2_before || jsonb_build_object(id ->> 'k', h);
    RESET ROLE;
  END LOOP;

  -- E1 (before the lock): per identity x planned policy x clause, the union of
  -- each backed-up original's rows == the rows the new text accepts.
  FOR id IN SELECT * FROM jsonb_array_elements(ids) LOOP
    PERFORM set_config('request.jwt.claims', CASE WHEN id ->> 'sub' IS NULL THEN json_build_object('role', id ->> 'role')
             ELSE json_build_object('sub', id ->> 'sub', 'role', id ->> 'role') END::text, true);
    PERFORM set_config('request.jwt.claim.sub', coalesce(id ->> 'sub', ''), true);
    PERFORM set_config('request.jwt.claim.role', id ->> 'role', true);
    FOR pk, pv IN SELECT * FROM jsonb_each(plan) LOOP
      a := pv ->> 'a';
      FOREACH c IN ARRAY ARRAY['u', 'c'] LOOP
        CONTINUE WHEN (pv ->> c) IS NULL;
        old_tids := '{}';
        FOR bkr IN SELECT bk.using_expr, bk.check_expr FROM public.x1_policy_backup_20261031 bk
                  WHERE bk.tbl = t AND bk.batch = v_batch AND (bk.cmd = '*' OR bk.cmd = a) LOOP
          one := CASE c WHEN 'u' THEN bkr.using_expr ELSE coalesce(bkr.check_expr, bkr.using_expr) END;
          CONTINUE WHEN one IS NULL;
          EXECUTE format('SELECT coalesce(array_agg(ctid), %L) FROM public.%I WHERE coalesce((%s), false)', '{}', t, one) INTO part_tids;
          old_tids := old_tids || part_tids;
        END LOOP;
        SELECT md5(coalesce(string_agg(x::text, ',' ORDER BY x), '')) INTO h FROM (SELECT DISTINCT unnest(old_tids) AS x) z;
        EXECUTE format('SELECT md5(coalesce(string_agg(ctid::text, %L ORDER BY ctid), %L)) FROM public.%I WHERE coalesce((%s), false)',
                       ',', '', t, pv ->> c) INTO diff;
        IF h IS DISTINCT FROM diff THEN
          RAISE EXCEPTION 'S10-X1RO-E1: % % (%) new text accepts different rows for identity %', t, pk, c, id ->> 'k';
        END IF;
        -- DRIFT (rows): the clause as it stands now must also accept the same
        -- rows as the text rebuilt from the backup, for every identity.
        SELECT CASE c WHEN 'u' THEN pg_get_expr(p.polqual, p.polrelid) ELSE pg_get_expr(p.polwithcheck, p.polrelid) END
          INTO stored FROM pg_policy p WHERE p.polrelid = rel AND p.polname = pk;
        EXECUTE format('SELECT md5(coalesce(string_agg(ctid::text, %L ORDER BY ctid), %L)) FROM public.%I WHERE coalesce((%s), false)',
                       ',', '', t, coalesce(stored, 'false')) INTO h;
        IF h IS DISTINCT FROM diff THEN
          RAISE EXCEPTION 'S10-X1RO-DRIFT: % % (%) as stored now accepts different rows than the backup rebuilds (identity %) — it changed after the merge; refusing', t, pk, c, id ->> 'k';
        END IF;
        e1hash := e1hash || jsonb_build_object((id ->> 'k') || '|' || pk || '|' || c, diff);
      END LOOP;
    END LOOP;
  END LOOP;

  -- Lock window: this table only.
  EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE', t);
  t_lock := clock_timestamp();
  FOR pk, pv IN SELECT * FROM jsonb_each(plan) LOOP
    EXECUTE format('ALTER POLICY %I ON public.%I', pk, t)
         || CASE WHEN (pv ->> 'u') IS NOT NULL THEN format(' USING (%s)', pv ->> 'u') ELSE '' END
         || CASE WHEN (pv ->> 'c') IS NOT NULL THEN format(' WITH CHECK (%s)', pv ->> 'c') ELSE '' END;
    altered := altered + 1;
  END LOOP;

  -- ORDER: each stored clause now EQUALS the backed-up parts joined in the
  -- requested order (exact string comparison).
  FOR pk, pv IN SELECT * FROM jsonb_each(plan) LOOP
    a := pv ->> 'a';
    FOREACH c IN ARRAY ARRAY['u', 'c'] LOOP
      CONTINUE WHEN (pv ->> c) IS NULL;
      SELECT CASE c WHEN 'u' THEN pg_get_expr(p.polqual, p.polrelid) ELSE pg_get_expr(p.polwithcheck, p.polrelid) END
        INTO stored FROM pg_policy p WHERE p.polrelid = rel AND p.polname = pk;
      -- expected text for direction dir: '(' || parts joined by ' OR ' || ')';
      -- one part: the part itself; the parser flattens "(A OR B) OR C", so the
      -- first part may also appear without its single outer pair of parentheses.
      SELECT string_agg(x, ' OR ' ORDER BY CASE WHEN dir = 'DESC' THEN nm END COLLATE "C" DESC,
                                           CASE WHEN dir = 'ASC'  THEN nm END COLLATE "C" ASC),
             count(*),
             (array_agg(x ORDER BY CASE WHEN dir = 'DESC' THEN nm END COLLATE "C" DESC,
                                   CASE WHEN dir = 'ASC'  THEN nm END COLLATE "C" ASC))[1]
        INTO joined, nparts, firstpart
        FROM (SELECT bk.policyname AS nm,
                     CASE c WHEN 'u' THEN bk.using_expr ELSE coalesce(bk.check_expr, bk.using_expr) END AS x
                FROM public.x1_policy_backup_20261031 bk
               WHERE bk.tbl = t AND bk.batch = v_batch AND (bk.cmd = '*' OR bk.cmd = a)) z
       WHERE x IS NOT NULL;
      IF nparts = 1 THEN
        expect_hit := coalesce(stored = joined, false);
      ELSE
        expect_hit := coalesce(stored = '(' || joined || ')', false);
        IF NOT expect_hit AND left(firstpart, 1) = '(' AND right(firstpart, 1) = ')' THEN
          depth := 0; is_wrapped := true;
          FOR i IN 1 .. length(firstpart) LOOP
            ch := substr(firstpart, i, 1);
            IF ch = '(' THEN depth := depth + 1; ELSIF ch = ')' THEN depth := depth - 1; END IF;
            IF depth = 0 AND i < length(firstpart) THEN is_wrapped := false; EXIT; END IF;
          END LOOP;
          IF is_wrapped THEN
            expect_hit := coalesce(stored = '(' || substr(firstpart, 2, length(firstpart) - 2)
                                                || substr(joined, length(firstpart) + 1) || ')', false);
          END IF;
        END IF;
      END IF;
      IF NOT expect_hit THEN
        RAISE EXCEPTION 'S10-X1RO-ORDER: % % (%) — the stored clause is not the parts joined in % order', t, pk, c, dir;
      END IF;
    END LOOP;
  END LOOP;

  -- BIND: for anon and the first signed-in identity, each stored clause accepts the rows E1 proved.
  FOR id IN SELECT e FROM jsonb_array_elements(ids) WITH ORDINALITY AS x(e, o) WHERE o <= 2 LOOP
    IF clock_timestamp() - t_lock > win THEN
      RAISE EXCEPTION 'S10-X1RO-WIN: the exclusive lock on % has been held over 3 s — rolled back, nothing changed', t;
    END IF;
    PERFORM set_config('request.jwt.claims', CASE WHEN id ->> 'sub' IS NULL THEN json_build_object('role', id ->> 'role')
             ELSE json_build_object('sub', id ->> 'sub', 'role', id ->> 'role') END::text, true);
    PERFORM set_config('request.jwt.claim.sub', coalesce(id ->> 'sub', ''), true);
    PERFORM set_config('request.jwt.claim.role', id ->> 'role', true);
    FOR pk, pv IN SELECT * FROM jsonb_each(plan) LOOP
      FOREACH c IN ARRAY ARRAY['u', 'c'] LOOP
        CONTINUE WHEN (pv ->> c) IS NULL;
        SELECT CASE c WHEN 'u' THEN pg_get_expr(p.polqual, p.polrelid) ELSE pg_get_expr(p.polwithcheck, p.polrelid) END
          INTO stored FROM pg_policy p WHERE p.polrelid = rel AND p.polname = pk;
        EXECUTE format('SELECT md5(coalesce(string_agg(ctid::text, %L ORDER BY ctid), %L)) FROM public.%I WHERE coalesce((%s), false)',
                       ',', '', t, stored) INTO diff;
        IF diff IS DISTINCT FROM (e1hash ->> ((id ->> 'k') || '|' || pk || '|' || c)) THEN
          RAISE EXCEPTION 'S10-X1RO-BIND: stored % % (%) differs from the proven text for identity %', t, pk, c, id ->> 'k';
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  -- E2 after
  FOR id IN SELECT * FROM jsonb_array_elements(ids) LOOP
    IF clock_timestamp() - t_lock > win THEN
      RAISE EXCEPTION 'S10-X1RO-WIN: the exclusive lock on % has been held over 3 s — rolled back, nothing changed', t;
    END IF;
    PERFORM set_config('request.jwt.claims', CASE WHEN id ->> 'sub' IS NULL THEN json_build_object('role', id ->> 'role')
             ELSE json_build_object('sub', id ->> 'sub', 'role', id ->> 'role') END::text, true);
    PERFORM set_config('request.jwt.claim.sub', coalesce(id ->> 'sub', ''), true);
    PERFORM set_config('request.jwt.claim.role', id ->> 'role', true);
    EXECUTE format('SET LOCAL ROLE %I', id ->> 'role');
    BEGIN
      EXECUTE format('SELECT md5(coalesce(string_agg(ctid::text, %L ORDER BY ctid), %L)) FROM public.%I', ',', '', t) INTO h;
    EXCEPTION WHEN insufficient_privilege THEN h := 'no-grant';
    END;
    e2_after := e2_after || jsonb_build_object(id ->> 'k', h);
    RESET ROLE;
  END LOOP;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  SELECT string_agg(' ' || b.key, '') INTO diff FROM jsonb_each_text(e2_before) b WHERE (e2_after ->> b.key) IS DISTINCT FROM b.value;
  IF diff IS NOT NULL THEN
    RAISE EXCEPTION 'S10-X1RO-E2: visible rows of % changed for identity:%', t, diff;
  END IF;

  -- POST: restrictive policies and the permissive set (names, commands, roles) unchanged.
  IF clock_timestamp() - t_lock > win THEN
    RAISE EXCEPTION 'S10-X1RO-WIN: the exclusive lock on % has been held over 3 s — rolled back, nothing changed', t;
  END IF;
  SELECT jsonb_object_agg(p.polname, jsonb_build_array(p.polcmd::text, p.polroles::text, pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)))
    INTO restr_after FROM pg_policy p WHERE p.polrelid = rel AND NOT p.polpermissive;
  SELECT jsonb_object_agg(p.polname, jsonb_build_array(p.polcmd::text, p.polroles::text))
    INTO shape_after FROM pg_policy p WHERE p.polrelid = rel AND p.polpermissive;
  IF restr_after IS DISTINCT FROM restr_before THEN
    RAISE EXCEPTION 'S10-X1RO-POST-001: a restrictive policy on % changed', t;
  END IF;
  IF shape_after IS DISTINCT FROM shape_before THEN
    RAISE EXCEPTION 'S10-X1RO-POST-002: the permissive policy set on % changed (names, commands or roles)', t;
  END IF;

  RAISE NOTICE 'S10 X1 reorder % (lane %): public.% — % merged policies rebuilt with parts in % policy-name order; E1 % identities; E2 % visible-row sets identical',
    dir, current_setting('p32.lane'), t, altered, dir, jsonb_array_length(ids), (SELECT count(*) FROM jsonb_object_keys(e2_before));
END
$f$;

-- One transaction per table: each takes only its own lock, then commits.
-- If one table fails, earlier tables stay done (each is complete on its own);
-- the PROBE shows which are left, and the file can be re-run.

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.blocked_keywords IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('blocked_keywords', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.categories IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('categories', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.certificate_testimonials IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('certificate_testimonials', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.courses IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('courses', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.gift_announcements IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('gift_announcements', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.hero_banners IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('hero_banners', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.journal_articles IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('journal_articles', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.lessons IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('lessons', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.photo_of_the_day IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('photo_of_the_day', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.ad_creatives IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('ad_creatives', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.ai_chat_usage IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('ai_chat_usage', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.certificates IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('certificates', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.comment_reports IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('comment_reports', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.course_enrollments IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('course_enrollments', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.custom_url_history IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('custom_url_history', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.post_reports IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('post_reports', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.reports IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('reports', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.support_tickets IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('support_tickets', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.user_devices IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('user_devices', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.v3_tag_label_alias IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('v3_tag_label_alias', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.bank_details IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('bank_details', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.competition_judges IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('competition_judges', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.competition_judging_tags IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('competition_judging_tags', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.competition_orders IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('competition_orders', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.entry_score_cache IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('entry_score_cache', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.judge_activity_logs IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('judge_activity_logs', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.judge_award_tags IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('judge_award_tags', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.judge_comments IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('judge_comments', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.judge_decisions IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('judge_decisions', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.judge_entry_assignments IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('judge_entry_assignments', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.judge_entry_locks IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('judge_entry_locks', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.judge_scores IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('judge_scores', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.judge_tag_assignments IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('judge_tag_assignments', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.judging_config IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('judging_config', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.judging_rounds IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('judging_rounds', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.raw_commitments IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('raw_commitments', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.referral_codes IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('referral_codes', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.referrals IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('referrals', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.role_applications IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('role_applications', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.round_snapshots IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('round_snapshots', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.wallet_transactions IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('wallet_transactions', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.wallets IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('wallets', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.withdrawal_requests IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('withdrawal_requests', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.competitions IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('competitions', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.friendships IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('friendships', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.image_comments IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('image_comments', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.portfolio_images IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('portfolio_images', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.post_reactions IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('post_reactions', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.post_tags IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('post_tags', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.profile_views IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('profile_views', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.user_badges IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('user_badges', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.user_roles IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('user_roles', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.posts IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('posts', 'ASC');
COMMIT;

BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.post_comments IN ACCESS SHARE MODE;
SELECT pg_temp.x1_reorder('post_comments', 'ASC');
COMMIT;
