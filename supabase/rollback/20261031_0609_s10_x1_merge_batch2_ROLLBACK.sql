-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261031_0609 — S10 X1 batch 2.
-- Drops the x1_merged_* policies on the 11 batch-2 tables and recreates every
-- original permissive policy from public.x1_policy_backup_20261031, byte-for-
-- byte (checked against the backup after re-creation). Access is the same in
-- both directions (see the migration header); E2 re-proves it on live rows.
-- Removes this batch's backup rows, and the backup table once it is empty.
-- Refuses unless 0609 is applied.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';

DO $x1_rb$
DECLARE
  v_batch constant text := '0609_batch2';
  tables constant text[] := ARRAY['ad_creatives', 'ai_chat_usage', 'certificates', 'comment_reports', 'course_enrollments',
                                  'custom_url_history', 'post_reports', 'reports', 'support_tickets',
                                  'user_devices', 'v3_tag_label_alias'];
  t text; rel oid; r record; id jsonb; h text; k int := 0; diff text;
  ids jsonb := '[]'; e2_before jsonb := '{}'; e2_after jsonb := '{}';
  q text; ck text;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'S10-X1B2-RB-PRE-001: running as %, not postgres', current_user;
  END IF;
  IF to_regclass('public.x1_policy_backup_20261031') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.x1_policy_backup_20261031 b WHERE b.batch = v_batch) THEN
    RAISE EXCEPTION 'S10-X1B2-RB-PRE-002: no backup rows for batch % — 0609 is not applied', v_batch;
  END IF;
  -- the rows below are EXECUTEd as postgres: the table must be owner-only.
  IF (SELECT c0.relowner FROM pg_class c0 WHERE c0.oid = 'public.x1_policy_backup_20261031'::regclass) <> 'postgres'::regrole
     OR EXISTS (SELECT 1 FROM pg_class c0, aclexplode(c0.relacl) x
                 WHERE c0.oid = 'public.x1_policy_backup_20261031'::regclass AND x.grantee <> c0.relowner) THEN
    RAISE EXCEPTION 'S10-X1B2-RB-PRE-004: public.x1_policy_backup_20261031 is not owner-only — refusing to execute its contents';
  END IF;
  FOREACH t IN ARRAY tables LOOP
    rel := to_regclass(format('public.%I', t));
    IF EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = rel AND p.polpermissive AND p.polname NOT LIKE 'x1\_merged\_%') THEN
      RAISE EXCEPTION 'S10-X1B2-RB-PRE-003: public.% has permissive policies besides x1_merged_* — not the state 0609 leaves', t;
    END IF;
  END LOOP;

  -- identities for E2: anon, 3 users per app role, 3 members (labels only)
  ids := ids || jsonb_build_object('k', 'anon', 'role', 'anon', 'sub', NULL);
  FOR r IN SELECT ur.role::text AS role, ur.user_id, row_number() OVER (PARTITION BY ur.role::text ORDER BY ur.user_id) AS rn
             FROM public.user_roles ur LOOP
    IF r.rn <= 3 THEN k := k + 1; ids := ids || jsonb_build_object('k', r.role || '#' || k, 'role', 'authenticated', 'sub', r.user_id); END IF;
  END LOOP;
  FOR r IN SELECT u.id FROM auth.users u ORDER BY u.created_at LIMIT 3 LOOP
    k := k + 1; ids := ids || jsonb_build_object('k', 'member#' || k, 'role', 'authenticated', 'sub', r.id);
  END LOOP;

  FOR id IN SELECT * FROM jsonb_array_elements(ids) LOOP
    PERFORM set_config('request.jwt.claims', CASE WHEN id ->> 'sub' IS NULL THEN json_build_object('role', id ->> 'role')
             ELSE json_build_object('sub', id ->> 'sub', 'role', id ->> 'role') END::text, true);
    PERFORM set_config('request.jwt.claim.sub', coalesce(id ->> 'sub', ''), true);
    PERFORM set_config('request.jwt.claim.role', id ->> 'role', true);
    EXECUTE format('SET LOCAL ROLE %I', id ->> 'role');
    FOREACH t IN ARRAY tables LOOP
      BEGIN EXECUTE format('SELECT md5(coalesce(string_agg(ctid::text, %L ORDER BY ctid), %L)) FROM public.%I', ',', '', t) INTO h;
      EXCEPTION WHEN insufficient_privilege THEN h := 'no-grant'; END;
      e2_before := e2_before || jsonb_build_object(t || '|' || (id ->> 'k'), h);
    END LOOP;
    RESET ROLE;
  END LOOP;

  FOREACH t IN ARRAY tables LOOP
    rel := to_regclass(format('public.%I', t));
    FOR r IN SELECT p.polname FROM pg_policy p WHERE p.polrelid = rel AND p.polname LIKE 'x1\_merged\_%' LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', r.polname, t);
    END LOOP;
    FOR r IN SELECT * FROM public.x1_policy_backup_20261031 b WHERE b.batch = v_batch AND b.tbl = t ORDER BY b.policyname LOOP
      EXECUTE format('CREATE POLICY %I ON public.%I AS PERMISSIVE FOR %s TO %s', r.policyname, t,
                     CASE r.cmd WHEN '*' THEN 'ALL' WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE' ELSE 'DELETE' END,
                     CASE WHEN r.roles = ARRAY['PUBLIC'] THEN 'PUBLIC'
                          ELSE (SELECT string_agg(quote_ident(x), ', ') FROM unnest(r.roles) x) END)
           || CASE WHEN r.using_expr IS NOT NULL THEN format(' USING (%s)', r.using_expr) ELSE '' END
           || CASE WHEN r.check_expr IS NOT NULL THEN format(' WITH CHECK (%s)', r.check_expr) ELSE '' END;
      SELECT pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid) INTO q, ck
        FROM pg_policy p WHERE p.polrelid = rel AND p.polname = r.policyname;
      IF q IS DISTINCT FROM r.using_expr OR ck IS DISTINCT FROM r.check_expr THEN
        RAISE EXCEPTION 'S10-X1B2-RB-E1: recreated policy "%" on public.% differs from the backup', r.policyname, t;
      END IF;
    END LOOP;
  END LOOP;

  FOR id IN SELECT * FROM jsonb_array_elements(ids) LOOP
    PERFORM set_config('request.jwt.claims', CASE WHEN id ->> 'sub' IS NULL THEN json_build_object('role', id ->> 'role')
             ELSE json_build_object('sub', id ->> 'sub', 'role', id ->> 'role') END::text, true);
    PERFORM set_config('request.jwt.claim.sub', coalesce(id ->> 'sub', ''), true);
    PERFORM set_config('request.jwt.claim.role', id ->> 'role', true);
    EXECUTE format('SET LOCAL ROLE %I', id ->> 'role');
    FOREACH t IN ARRAY tables LOOP
      BEGIN EXECUTE format('SELECT md5(coalesce(string_agg(ctid::text, %L ORDER BY ctid), %L)) FROM public.%I', ',', '', t) INTO h;
      EXCEPTION WHEN insufficient_privilege THEN h := 'no-grant'; END;
      e2_after := e2_after || jsonb_build_object(t || '|' || (id ->> 'k'), h);
    END LOOP;
    RESET ROLE;
  END LOOP;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  SELECT string_agg(' ' || b.key, '') INTO diff FROM jsonb_each_text(e2_before) b WHERE (e2_after ->> b.key) IS DISTINCT FROM b.value;
  IF diff IS NOT NULL THEN
    RAISE EXCEPTION 'S10-X1B2-RB-E2: visible rows changed for (table|identity):%', diff;
  END IF;

  DELETE FROM public.x1_policy_backup_20261031 b WHERE b.batch = v_batch;
  IF NOT EXISTS (SELECT 1 FROM public.x1_policy_backup_20261031) THEN
    DROP TABLE public.x1_policy_backup_20261031;
  END IF;
  RAISE NOTICE 'S10 X1 batch 2 rolled back (lane %): original policies recreated byte-for-byte on % tables; E2 % visible-row sets identical',
    current_setting('p32.lane'), array_length(tables, 1), (SELECT count(*) FROM jsonb_object_keys(e2_before));
END
$x1_rb$;

COMMIT;
