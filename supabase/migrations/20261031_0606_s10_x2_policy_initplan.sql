-- ═══════════════════════════════════════════════════════════════════════════
-- S10 · X2 — 32 RLS policies stop calling auth.uid() / auth.role() once PER
-- ROW. Both lanes.
--
-- MEASURED (PROBE_20261031_0605, staging 41069834234, production 41072016755,
-- 2026-10-30): the same 32 policies on 16 tables on both lanes call
-- auth.uid() or auth.role() bare. Postgres then evaluates the call for every
-- row it checks. Wrapped as `( SELECT auth.uid() AS uid)` — the form the
-- other ~700 policies already use — the planner evaluates it once per query
-- (an InitPlan). auth.uid() and auth.role() are STABLE and read only the
-- request's JWT settings, which cannot change inside one statement, so the
-- value is the same either way: WHO SEES WHAT DOES NOT CHANGE. This file
-- proves that in the same transaction, two ways:
--   E1 · text: for every policy, the new USING / WITH CHECK with the wrappers
--        removed is byte-identical to the old one (deparsed with an empty
--        search_path, so every name is fully qualified). Roles, command and
--        permissive/restrictive are unchanged.
--   E2 · behaviour (the access-equivalence matrix): for each of the 16 tables,
--        the number of rows visible to anon, to every admin (max 5), to up to
--        3 real row owners per owner column, and to 3 ordinary members is
--        counted BEFORE and AFTER the change. Every cell must match.
-- Any surprise (a listed policy missing, a call form not rewritten, a cell
-- that differs) raises and the whole file rolls back.
--
-- NOT CHANGED: which policies exist, their roles, commands, or any other
-- policy (X1 duplicate-policy consolidation is a separate unit).
--
-- PROBE:    supabase/migrations/PROBE_20261031_0606_s10_x2_policy_initplan.sql
-- Rollback: supabase/rollback/20261031_0606_s10_x2_policy_initplan_ROLLBACK.sql
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
-- Deparse with every name fully qualified, so the rewritten text re-parses to
-- the same objects whatever the caller's search_path.
SET LOCAL search_path = '';

DO $x2$
DECLARE
  targets constant text[][] := ARRAY[
    ['ad_creative_comments',  'Members comment as themselves'],
    ['ad_creative_comments',  'Members edit their own ad comment'],
    ['ad_creative_comments',  'Members or admins delete an ad comment'],
    ['ad_creative_reactions', 'Members change their own ad reaction'],
    ['ad_creative_reactions', 'Members react as themselves'],
    ['ad_creative_reactions', 'Members remove their own ad reaction'],
    ['ad_creative_shares',    'Members remove their own ad share'],
    ['ad_creative_shares',    'Members share as themselves'],
    ['ad_creatives',          'ad_creatives_admin_all'],
    ['categories',            'Admins manage categories'],
    ['media_objects',         'media_objects_insert_own'],
    ['media_objects',         'media_objects_select'],
    ['ops_alarm_settings',    'admins read ops_alarm_settings'],
    ['ops_alarms',            'admins read ops_alarms'],
    ['ops_probe_requests',    'admins read ops_probe_requests'],
    ['post_drafts',           'pd_delete_own'],
    ['post_drafts',           'pd_insert_own'],
    ['post_drafts',           'pd_select_own'],
    ['post_drafts',           'pd_update_own'],
    ['post_media',            'post_media_delete_own'],
    ['post_media',            'post_media_select'],
    ['post_media',            'post_media_write_own'],
    ['post_tags',             'Members create tags as themselves'],
    ['push_config',           'service role manages push config'],
    ['push_tokens',           'delete own push tokens'],
    ['push_tokens',           'read own push tokens'],
    ['search_recents',        'Own recents delete'],
    ['search_recents',        'Own recents read'],
    ['search_recents',        'Own recents update'],
    ['search_recents',        'Own recents write'],
    ['story_views',           'Users insert own story views'],
    ['story_views',           'Users read own story views']
  ];
  -- wrapped form as pg_get_expr prints it, e.g. "( SELECT auth.uid() AS uid)"
  wrapped_re constant text := '\(\s*SELECT\s+auth\.(uid|role|jwt|email)\(\)\s+AS\s+\w+\s*\)';
  bare_re    constant text := 'auth\.(uid|role|jwt|email)\(\)';
  i int; tbl text; pol text; rel oid;
  r record;
  old_q text; old_w text; new_q text; new_w text;
  before jsonb := '{}'; after jsonb := '{}';
  ids jsonb := '[]'; id jsonb; t text; n bigint; cols text[]; c text;
  tables text[];
  diff text := '';
  changed int := 0;
  k int := 0;
  shape_before jsonb; shape_after jsonb;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'S10-X2-PRE-001: running as %, not postgres', current_user;
  END IF;

  -- PRE · every listed policy exists exactly once and still has a bare call.
  FOR i IN 1 .. array_length(targets, 1) LOOP
    tbl := targets[i][1]; pol := targets[i][2];
    rel := to_regclass(format('public.%I', tbl));
    IF rel IS NULL THEN
      RAISE EXCEPTION 'S10-X2-PRE-002: table public.% is missing on this lane', tbl;
    END IF;
    SELECT pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)
      INTO old_q, old_w
      FROM pg_policy p WHERE p.polrelid = rel AND p.polname = pol;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'S10-X2-PRE-003: policy "%" on public.% is missing on this lane', pol, tbl;
    END IF;
    IF regexp_replace(coalesce(old_q, '') || ' ' || coalesce(old_w, ''), wrapped_re, '', 'gi') !~* bare_re THEN
      RAISE EXCEPTION 'S10-X2-PRE-004: policy "%" on public.% has no bare auth call — already applied, or the lane drifted', pol, tbl;
    END IF;
  END LOOP;

  SELECT array_agg(DISTINCT x) INTO tables FROM unnest(targets[:][1:1]) AS x;

  -- Identities for the matrix (E2): anon, admins, real row owners, members.
  ids := ids || jsonb_build_object('k', 'anon', 'role', 'anon', 'sub', NULL);
  FOR r IN
    SELECT ur.user_id FROM public.user_roles ur WHERE ur.role::text = 'admin' ORDER BY ur.user_id LIMIT 5
  LOOP
    k := k + 1;
    ids := ids || jsonb_build_object('k', 'admin#' || k, 'role', 'authenticated', 'sub', r.user_id);
  END LOOP;
  FOREACH t IN ARRAY tables LOOP
    SELECT array_agg(a.attname::text) INTO cols
      FROM pg_attribute a
     WHERE a.attrelid = to_regclass(format('public.%I', t)) AND a.attnum > 0 AND NOT a.attisdropped
       AND a.atttypid = 'uuid'::regtype
       AND a.attname IN ('user_id', 'owner_id', 'viewer_id', 'tagger_id', 'created_by');
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
  -- one entry per identity (an admin can also be an owner); labels never print an id
  SELECT jsonb_agg(e ORDER BY ord) INTO ids FROM (
    SELECT DISTINCT ON (coalesce(e ->> 'sub', 'anon')) e, ord
      FROM jsonb_array_elements(ids) WITH ORDINALITY AS x(e, ord)
     ORDER BY coalesce(e ->> 'sub', 'anon'), ord) d;

  -- E2 before
  FOR id IN SELECT * FROM jsonb_array_elements(ids) LOOP
    PERFORM set_config('request.jwt.claims',
      CASE WHEN id ->> 'sub' IS NULL THEN json_build_object('role', id ->> 'role')
           ELSE json_build_object('sub', id ->> 'sub', 'role', id ->> 'role') END::text, true);
    PERFORM set_config('request.jwt.claim.sub', coalesce(id ->> 'sub', ''), true);
    PERFORM set_config('request.jwt.claim.role', id ->> 'role', true);
    EXECUTE format('SET LOCAL ROLE %I', id ->> 'role');
    FOREACH t IN ARRAY tables LOOP
      BEGIN
        EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
      EXCEPTION WHEN insufficient_privilege THEN n := -1;   -- no table grant: same before and after
      END;
      before := before || jsonb_build_object(t || '|' || (id ->> 'k'), n);
    END LOOP;
    RESET ROLE;
  END LOOP;

  -- every public policy's command, kind and roles, to prove only USING/CHECK changed
  SELECT jsonb_object_agg(c.relname || '|' || p.polname,
           jsonb_build_array(p.polcmd::text, p.polpermissive, p.polroles::text))
    INTO shape_before
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
   WHERE c.relnamespace = 'public'::regnamespace;

  -- Rewrite
  FOR i IN 1 .. array_length(targets, 1) LOOP
    tbl := targets[i][1]; pol := targets[i][2];
    rel := to_regclass(format('public.%I', tbl));
    SELECT pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)
      INTO old_q, old_w FROM pg_policy p WHERE p.polrelid = rel AND p.polname = pol;
    -- protect calls that are already wrapped, wrap the bare ones, restore.
    new_q := old_q; new_w := old_w;
    IF new_q IS NOT NULL THEN
      new_q := regexp_replace(new_q, '\(\s*SELECT\s+auth\.(uid|role|jwt|email)\(\)\s+AS\s+(\w+)\s*\)', '<<W:\1:\2>>', 'gi');
      new_q := regexp_replace(new_q, 'auth\.(uid|role|jwt|email)\(\)', '( SELECT auth.\1() AS \1)', 'gi');
      new_q := regexp_replace(new_q, '<<W:(\w+):(\w+)>>', '( SELECT auth.\1() AS \2)', 'g');
    END IF;
    IF new_w IS NOT NULL THEN
      new_w := regexp_replace(new_w, '\(\s*SELECT\s+auth\.(uid|role|jwt|email)\(\)\s+AS\s+(\w+)\s*\)', '<<W:\1:\2>>', 'gi');
      new_w := regexp_replace(new_w, 'auth\.(uid|role|jwt|email)\(\)', '( SELECT auth.\1() AS \1)', 'gi');
      new_w := regexp_replace(new_w, '<<W:(\w+):(\w+)>>', '( SELECT auth.\1() AS \2)', 'g');
    END IF;
    EXECUTE format('ALTER POLICY %I ON public.%I', pol, tbl)
         || CASE WHEN new_q IS NOT NULL THEN format(' USING (%s)', new_q) ELSE '' END
         || CASE WHEN new_w IS NOT NULL THEN format(' WITH CHECK (%s)', new_w) ELSE '' END;
    changed := changed + 1;

    -- E1 · text equivalence, read back from the catalog.
    SELECT pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)
      INTO new_q, new_w FROM pg_policy p WHERE p.polrelid = rel AND p.polname = pol;
    IF regexp_replace(coalesce(new_q, ''), wrapped_re, 'auth.\1()', 'gi')
         IS DISTINCT FROM regexp_replace(coalesce(old_q, ''), wrapped_re, 'auth.\1()', 'gi')
       OR regexp_replace(coalesce(new_w, ''), wrapped_re, 'auth.\1()', 'gi')
         IS DISTINCT FROM regexp_replace(coalesce(old_w, ''), wrapped_re, 'auth.\1()', 'gi')
       OR (new_q IS NULL) <> (old_q IS NULL) OR (new_w IS NULL) <> (old_w IS NULL) THEN
      RAISE EXCEPTION 'S10-X2-E1: policy "%" on public.% is not the same expression after the rewrite', pol, tbl;
    END IF;
    IF regexp_replace(coalesce(new_q, '') || ' ' || coalesce(new_w, ''), wrapped_re, '', 'gi') ~* bare_re THEN
      RAISE EXCEPTION 'S10-X2-POST-001: policy "%" on public.% still has a bare auth call', pol, tbl;
    END IF;
  END LOOP;

  -- E2 after
  FOR id IN SELECT * FROM jsonb_array_elements(ids) LOOP
    PERFORM set_config('request.jwt.claims',
      CASE WHEN id ->> 'sub' IS NULL THEN json_build_object('role', id ->> 'role')
           ELSE json_build_object('sub', id ->> 'sub', 'role', id ->> 'role') END::text, true);
    PERFORM set_config('request.jwt.claim.sub', coalesce(id ->> 'sub', ''), true);
    PERFORM set_config('request.jwt.claim.role', id ->> 'role', true);
    EXECUTE format('SET LOCAL ROLE %I', id ->> 'role');
    FOREACH t IN ARRAY tables LOOP
      BEGIN
        EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
      EXCEPTION WHEN insufficient_privilege THEN n := -1;
      END;
      after := after || jsonb_build_object(t || '|' || (id ->> 'k'), n);
    END LOOP;
    RESET ROLE;
  END LOOP;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);

  SELECT string_agg(format(' %s(before=%s after=%s)', b.key, b.value, after -> b.key), '')
    INTO diff
    FROM jsonb_each(before) b
   WHERE after -> b.key IS DISTINCT FROM b.value;
  IF diff IS NOT NULL THEN
    RAISE EXCEPTION 'S10-X2-E2: access changed for (table|identity):%', diff;
  END IF;

  -- POST · nothing else about any policy changed (roles, command, kind), and no policy was added or removed.
  SELECT jsonb_object_agg(c.relname || '|' || p.polname,
           jsonb_build_array(p.polcmd::text, p.polpermissive, p.polroles::text))
    INTO shape_after
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
   WHERE c.relnamespace = 'public'::regnamespace;
  IF shape_after IS DISTINCT FROM shape_before THEN
    RAISE EXCEPTION 'S10-X2-POST-003: a policy''s roles, command or kind changed, or a policy was added/removed';
  END IF;
  IF changed <> 32 THEN
    RAISE EXCEPTION 'S10-X2-POST-002: rewrote % policies, expected 32', changed;
  END IF;

  RAISE NOTICE 'S10 X2 applied (lane %): 32 policies on % tables now evaluate auth calls once per query; E1 text-identical, E2 % identities x % tables = % matrix cells identical before/after',
    current_setting('p32.lane'), array_length(tables, 1), jsonb_array_length(ids), array_length(tables, 1),
    jsonb_array_length(ids) * array_length(tables, 1);
END
$x2$;

COMMIT;
