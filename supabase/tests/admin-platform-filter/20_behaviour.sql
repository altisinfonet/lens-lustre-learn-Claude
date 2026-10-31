-- ═══════════════════════════════════════════════════════════════════════════
-- FIXTURE · admin users platform filter · the behaviour, as assertions.
-- Run inside BEGIN … ROLLBACK by the runner.
--
-- 250 synthetic members (emails @fixture.invalid): 125 web, 63 app, 62 with no
-- recorded platform; roles, badges and names spread across them; created_at
-- shared by pairs so the id tiebreak matters. Paged 100 at a time, as the UI.
--
-- "What the admin gets for a tab" is admin_search_users_v3(_platform) when it
-- exists. Before 20261103_0101 there is no server-side platform filter: the
-- only list is admin_search_users_v2, and the only count is its total_count —
-- so F-1 (Web users lists only web members, across pages) and F-3 (the tab
-- counts) are RED before the fix, each for its own reason.
-- ═══════════════════════════════════════════════════════════════════════════
DO $b$
DECLARE
  admin_id  uuid := '00000000-0000-0000-0000-000000000001';
  member_id uuid := '00000000-0000-0000-0000-000000000002';
  has_v3     boolean := to_regprocedure('public.admin_search_users_v3(text, text, text, text, text, integer, integer)') IS NOT NULL;
  has_counts boolean := to_regprocedure('public.admin_user_platform_counts(text, text, text, text)') IS NOT NULL;
  plat text; combo record; got uuid[]; want uuid[]; page_ids uuid[]; tot bigint; page_tot bigint; pg int;
  c record; d record; caught text; v2ids uuid[]; v3ids uuid[];
BEGIN
  -- ── seed (as the table owner) ──────────────────────────────────────────
  INSERT INTO auth.users (id, email, created_at)
  SELECT ('00000000-0000-0000-0000-' || lpad(to_hex(i), 12, '0'))::uuid,
         'm' || lpad(i::text, 3, '0') || '@fixture.invalid', '2026-01-01'::timestamptz
    FROM generate_series(1, 250) i;
  INSERT INTO public.profiles (id, full_name, created_at, last_platform)
  SELECT ('00000000-0000-0000-0000-' || lpad(to_hex(i), 12, '0'))::uuid,
         CASE WHEN i % 5 = 0 THEN 'Alpha ' ELSE 'Member ' END || i,
         '2026-01-01'::timestamptz + ((i / 2) || ' hours')::interval,
         CASE WHEN i % 2 = 0 THEN 'web' WHEN i % 4 = 1 THEN 'app' ELSE NULL END
    FROM generate_series(1, 250) i;
  INSERT INTO public.user_roles (user_id, role)
  SELECT id, 'user' FROM public.profiles;
  INSERT INTO public.user_roles (user_id, role) VALUES (admin_id, 'admin');
  INSERT INTO public.user_roles (user_id, role)
  SELECT ('00000000-0000-0000-0000-' || lpad(to_hex(i), 12, '0'))::uuid, 'judge'
    FROM generate_series(1, 250) i WHERE i % 3 = 0;
  INSERT INTO public.user_badges (user_id, badge_type, assigned_by)
  SELECT ('00000000-0000-0000-0000-' || lpad(to_hex(i), 12, '0'))::uuid, 'verified', admin_id
    FROM generate_series(1, 250) i WHERE i % 7 = 0;

  IF (SELECT count(*) FROM public.profiles WHERE last_platform = 'web') <> 125
     OR (SELECT count(*) FROM public.profiles WHERE last_platform = 'app') <> 63
     OR (SELECT count(*) FROM public.profiles WHERE last_platform IS NULL) <> 62 THEN
    RAISE EXCEPTION 'FIXTURE SEED: expected 125 web / 63 app / 62 unknown';
  END IF;

  -- ── F-1 / F-2 · each tab lists exactly its members, across every page ──
  FOREACH plat IN ARRAY ARRAY['web', 'app', 'unknown'] LOOP
    SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO want FROM public.profiles
     WHERE (plat = 'unknown' AND last_platform IS NULL) OR last_platform = plat;
    got := '{}'; tot := NULL; pg := 0;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    LOOP
      IF has_v3 THEN
        SELECT coalesce(array_agg(r.id), '{}'), max(r.total_count) INTO page_ids, page_tot
          FROM public.admin_search_users_v3('', 'name', NULL, NULL, plat, 100, pg * 100) r;
      ELSE
        -- Before 0101: the only list there is. No platform filter exists.
        SELECT coalesce(array_agg(r.id), '{}'), max(r.total_count) INTO page_ids, page_tot
          FROM public.admin_search_users_v2('', 'name', NULL, NULL, 100, pg * 100) r;
      END IF;
      EXIT WHEN cardinality(page_ids) = 0;
      IF got && page_ids THEN
        RESET ROLE;
        RAISE EXCEPTION 'FIXTURE FAIL F-2: tab % — page % repeats a member from an earlier page', plat, pg + 1;
      END IF;
      got := got || page_ids;
      tot := page_tot;
      pg := pg + 1;
      EXIT WHEN pg > 10;
    END LOOP;
    RESET ROLE;
    SELECT coalesce(array_agg(x ORDER BY x), '{}') INTO got FROM unnest(got) x;
    IF got IS DISTINCT FROM want THEN
      RAISE EXCEPTION 'FIXTURE FAIL F-1: tab "%" listed % members over % page(s), % of them not %; expected exactly the % % members',
        plat, cardinality(got), pg,
        (SELECT count(*) FROM unnest(got) x JOIN public.profiles p ON p.id = x
          WHERE NOT ((plat = 'unknown' AND p.last_platform IS NULL) OR p.last_platform = plat)),
        plat, cardinality(want), plat;
    END IF;
    IF tot IS DISTINCT FROM cardinality(want)::bigint THEN
      RAISE EXCEPTION 'FIXTURE FAIL F-1: tab "%" total_count % ≠ % members', plat, tot, cardinality(want);
    END IF;
  END LOOP;
  RAISE NOTICE 'FIXTURE PASS F-1/F-2: Web 125 over 2 pages, App 63, Unknown 62 — only their own members, pages disjoint';

  -- ── F-3 · counts match the fixture for the current combination ─────────
  IF NOT has_counts THEN
    RAISE EXCEPTION 'FIXTURE FAIL F-3: no admin_user_platform_counts — a tab could only count the 100 rows loaded';
  END IF;
  FOR combo IN
    SELECT * FROM (VALUES
      ('',      'name',  NULL::text, NULL::text),
      ('',      'name',  'judge',    NULL),
      ('',      'name',  NULL,       'verified'),
      ('Alpha', 'name',  NULL,       NULL),
      ('m01',   'email', NULL,       NULL),
      ('Alpha', 'name',  'judge',    'verified'),
      ('nobody','name',  NULL,       NULL)
    ) v(q, sby, role, badge)
  LOOP
    SELECT count(*) AS a,
           count(*) FILTER (WHERE p.last_platform = 'app') AS app,
           count(*) FILTER (WHERE p.last_platform = 'web') AS web,
           count(*) FILTER (WHERE p.last_platform IS NULL) AS unk
      INTO d
      FROM public.profiles p JOIN auth.users u ON u.id = p.id
     WHERE (combo.q = '' OR (combo.sby = 'email' AND u.email ILIKE '%' || combo.q || '%')
                        OR (combo.sby = 'name' AND p.full_name ILIKE '%' || combo.q || '%'))
       AND (combo.role IS NULL OR EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role = combo.role))
       AND (combo.badge IS NULL OR EXISTS (SELECT 1 FROM public.user_badges b WHERE b.user_id = p.id AND b.badge_type = combo.badge));
    PERFORM set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT * INTO c FROM public.admin_user_platform_counts(combo.q, combo.sby, combo.role, combo.badge);
    RESET ROLE;
    IF (c.all_count, c.app_count, c.web_count, c.unknown_count) IS DISTINCT FROM (d.a, d.app, d.web, d.unk) THEN
      RAISE EXCEPTION 'FIXTURE FAIL F-3: counts for q=% by=% role=% badge=% are %/%/%/%, fixture says %/%/%/%',
        combo.q, combo.sby, combo.role, combo.badge, c.all_count, c.app_count, c.web_count, c.unknown_count, d.a, d.app, d.web, d.unk;
    END IF;
    -- every tab's list total agrees with its count, in the same combination
    FOREACH plat IN ARRAY ARRAY['', 'app', 'web', 'unknown'] LOOP
      SET LOCAL ROLE authenticated;
      SELECT coalesce(max(r.total_count), 0) INTO tot
        FROM public.admin_search_users_v3(combo.q, combo.sby, combo.role, combo.badge, plat, 100, 0) r;
      RESET ROLE;
      IF tot <> (CASE plat WHEN '' THEN d.a WHEN 'app' THEN d.app WHEN 'web' THEN d.web ELSE d.unk END) THEN
        RAISE EXCEPTION 'FIXTURE FAIL F-3: list total % for tab "%" (q=% role=% badge=%) disagrees with the count',
          tot, plat, combo.q, combo.role, combo.badge;
      END IF;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'FIXTURE PASS F-3: counts = fixture for 7 combinations (all 250 = app 63 + web 125 + unknown 62)';

  -- ── F-4 · admin only: a signed-in member and a signed-out caller get nothing
  PERFORM set_config('request.jwt.claims', json_build_object('sub', member_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM * FROM public.admin_search_users_v3('', 'name', NULL, NULL, 'web', 100, 0);
    caught := NULL;
  EXCEPTION WHEN raise_exception THEN caught := SQLERRM; END;
  IF caught IS DISTINCT FROM 'Not authorized' THEN RESET ROLE; RAISE EXCEPTION 'FIXTURE FAIL F-4: non-admin list call was not refused (%)', caught; END IF;
  BEGIN
    PERFORM * FROM public.admin_user_platform_counts('', 'name', NULL, NULL);
    caught := NULL;
  EXCEPTION WHEN raise_exception THEN caught := SQLERRM; END;
  IF caught IS DISTINCT FROM 'Not authorized' THEN RESET ROLE; RAISE EXCEPTION 'FIXTURE FAIL F-4: non-admin counts call was not refused (%)', caught; END IF;
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    PERFORM * FROM public.admin_user_platform_counts('', 'name', NULL, NULL);
    caught := NULL;
  EXCEPTION WHEN raise_exception THEN caught := SQLERRM; END;
  RESET ROLE;
  IF caught IS DISTINCT FROM 'Not authorized' THEN RAISE EXCEPTION 'FIXTURE FAIL F-4: signed-out counts call was not refused (%)', caught; END IF;
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM * FROM public.admin_user_platform_counts('', 'name', NULL, NULL);
    caught := NULL;
  EXCEPTION WHEN insufficient_privilege THEN caught := 'denied'; END;
  RESET ROLE;
  IF caught IS DISTINCT FROM 'denied' THEN RAISE EXCEPTION 'FIXTURE FAIL F-4: anon can EXECUTE admin_user_platform_counts'; END IF;
  RAISE NOTICE 'FIXTURE PASS F-4: non-admin and signed-out refused with Not authorized; anon has no EXECUTE';

  -- ── F-5 · a bad tab value is refused, not silently "all" ────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM * FROM public.admin_search_users_v3('', 'name', NULL, NULL, 'desktop', 100, 0);
    caught := NULL;
  EXCEPTION WHEN invalid_parameter_value THEN caught := '22023'; END;
  IF caught IS DISTINCT FROM '22023' THEN RESET ROLE; RAISE EXCEPTION 'FIXTURE FAIL F-5: _platform=desktop was not refused with 22023'; END IF;

  -- ── F-6 · "All" (NULL and '') is exactly v2: same members, same order ───
  FOR pg IN 0..2 LOOP
    SELECT coalesce(array_agg(r.id), '{}') INTO v2ids FROM public.admin_search_users_v2('', 'name', 'judge', NULL, 100, pg * 100) r;
    SELECT coalesce(array_agg(r.id), '{}') INTO v3ids FROM public.admin_search_users_v3('', 'name', 'judge', NULL, NULL, 100, pg * 100) r;
    IF v2ids IS DISTINCT FROM v3ids THEN RESET ROLE; RAISE EXCEPTION 'FIXTURE FAIL F-6: All (NULL) page % differs from v2', pg + 1; END IF;
    SELECT coalesce(array_agg(r.id), '{}') INTO v2ids FROM public.admin_search_users_v2('', 'email', NULL, NULL, 100, pg * 100) r;
    SELECT coalesce(array_agg(r.id), '{}') INTO v3ids FROM public.admin_search_users_v3('', 'email', NULL, NULL, '', 100, pg * 100) r;
    IF v2ids IS DISTINCT FROM v3ids THEN RESET ROLE; RAISE EXCEPTION 'FIXTURE FAIL F-6: All ('''') page % differs from v2', pg + 1; END IF;
  END LOOP;
  RESET ROLE;
  RAISE NOTICE 'FIXTURE PASS F-5/F-6: bad tab refused (22023); All = v2 page for page';
  RAISE NOTICE 'FIXTURE PASS: all assertions';
END
$b$;
