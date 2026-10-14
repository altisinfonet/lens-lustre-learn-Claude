-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261013_0005 — Stage L2 feed session seed (staging and production)
-- READ-ONLY (BEGIN READ ONLY … ROLLBACK). Raises, and so fails the dispatch, on
-- any hit. Run after 20261013_0005; the expectations are the same on both lanes.
--
--   G0 · lane guard: p32.lane must be staging or production.
--   G1 · the 5-argument get_broadcast_feed: present; SECURITY DEFINER, VOLATILE,
--        sql, search_path=public, owned by postgres; body md5 = the migration's.
--   G2 · the 4-argument overload is the one-line wrapper; the 2-/3-argument
--        bodies and feed_candidates / feed_rank_score are production's 2026-10-13
--        bodies (md5).
--   G3 · EXECUTE on all four overloads is exactly {postgres, authenticated,
--        service_role}, granted by postgres, not grantable — by aclexplode AND by
--        has_function_privilege (PUBLIC and anon: none).
--   G4 · behaviour, as this session (auth.uid() NULL — no member's data is
--        read as a member): page 1 with a seed → ≤ 10 rows, no duplicate id, no
--        author 3 in a row unless only that author remained; NULL seed = the
--        4-argument call, row for row; a second seed runs.
--   G5 · NOTICE only: feed_events volume (total, last hour, last 24 h, members
--        in 24 h) — the "events per minute" figure once the tracker is live —
--        and the table's heap and index sizes, for the index / retention
--        follow-up (this unit adds no index: measured and left out, see the
--        migration header).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
DO $probe$
DECLARE
  r      record;
  _bad   text := '';
  _new   oid := to_regprocedure('public.get_broadcast_feed(uuid[], integer, integer, text[], text)');
  _ids   uuid[];
  _auth  uuid[];
  _ids4  uuid[];
  _i     int;
  _j     int;
  _n     bigint;
  _h     bigint;
  _d     bigint;
  _m     bigint;
BEGIN
  -- G0 · lane guard.
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED 20261013_0005 — p32.lane reads %; dispatch apply-migration.yml with target=staging or production.',
      coalesce(current_setting('p32.lane', true), '(unset)');
  END IF;

  -- G1 · the new overload.
  IF _new IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL 20261013_0005 G1: the 5-argument get_broadcast_feed does not exist — the migration is not applied';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = _new AND p.prosecdef AND p.provolatile = 'v' AND l.lanname = 'sql'
          AND p.proconfig = ARRAY['search_path=public'] AND p.proowner = 'postgres'::regrole) THEN
    _bad := _bad || E'\n  G1 5-argument overload attributes differ (SECURITY DEFINER / VOLATILE / sql / search_path / owner)';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = _new) IS DISTINCT FROM '4c45f2b8b197609ead525b0db7d72e85' THEN
    _bad := _bad || E'\n  G1 5-argument body md5 ' || (SELECT md5(prosrc) FROM pg_proc WHERE oid = _new) || ', expected 4c45f2b8b197609ead525b0db7d72e85';
  END IF;

  -- G2 · the other bodies.
  IF (SELECT btrim(prosrc, E' \r\n\t') FROM pg_proc
       WHERE oid = to_regprocedure('public.get_broadcast_feed(uuid[], integer, integer, text[])'))
     IS DISTINCT FROM 'SELECT * FROM public.get_broadcast_feed(_exclude_ids, _limit, _newest_first, _categories, NULL::text);' THEN
    _bad := _bad || E'\n  G2 the 4-argument overload is not the one-line wrapper';
  END IF;
  FOR r IN
    SELECT v.sig, v.want, md5(p.prosrc) AS got
      FROM (VALUES
        ('get_broadcast_feed(_exclude_ids uuid[], _limit integer)', '6ff8f8ea3d8c8cf76e9abe0bd728915e'),
        ('get_broadcast_feed(_exclude_ids uuid[], _limit integer, _newest_first integer)', '59cebfbcfd89f6ad49e46399ee6fe4e2'),
        ('feed_candidates(_seed text, _categories text[], _recent integer, _sample integer, _own integer, _friends integer)', '288ea6c01b82d1c5ab7f541de3fa3f46'),
        ('feed_rank_score(_id uuid, _bucket integer, _seed text)', '3ae7718671ed2245f34c01c141164d80')
      ) AS v(sig, want)
      LEFT JOIN pg_proc p
        ON p.pronamespace = 'public'::regnamespace
       AND p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')' = v.sig
  LOOP
    IF r.got IS DISTINCT FROM r.want THEN
      _bad := _bad || E'\n  G2 ' || r.sig || ' md5 ' || coalesce(r.got, 'missing') || ', expected ' || r.want;
    END IF;
  END LOOP;

  -- G3 · grants, two ways.
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'get_broadcast_feed') <> 4 THEN
    _bad := _bad || E'\n  G3 expected exactly 4 get_broadcast_feed overloads';
  END IF;
  FOR r IN
    SELECT p.oid, pg_get_function_identity_arguments(p.oid) AS args,
           (SELECT string_agg(e.x, ',' ORDER BY e.x COLLATE "C")
              FROM (SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END
                           || ':' || a.privilege_type || ':' || pg_get_userbyid(a.grantor)::text || ':' || a.is_grantable::text AS x
                      FROM aclexplode(p.proacl) a) e) AS acl
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'get_broadcast_feed'
  LOOP
    IF r.acl IS DISTINCT FROM 'authenticated:EXECUTE:postgres:false,postgres:EXECUTE:postgres:false,service_role:EXECUTE:postgres:false'
       OR has_function_privilege('public', r.oid, 'EXECUTE')
       OR has_function_privilege('anon', r.oid, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', r.oid, 'EXECUTE')
       OR NOT has_function_privilege('service_role', r.oid, 'EXECUTE') THEN
      _bad := _bad || E'\n  G3 get_broadcast_feed(' || r.args || ') ACL ' || coalesce(r.acl, 'NULL (PUBLIC by default)');
    END IF;
  END LOOP;


  -- G4 · behaviour (read-only calls; auth.uid() is NULL in this session).
  SELECT array_agg(f.id ORDER BY f.o), array_agg(f.user_id ORDER BY f.o)
    INTO _ids, _auth
    FROM (SELECT g.id, g.user_id, row_number() OVER () AS o
            FROM public.get_broadcast_feed('{}'::uuid[], 10, 3, NULL::text[], 'probe-20261013-0005-a') g) f;
  IF coalesce(cardinality(_ids), 0) > 10 THEN
    _bad := _bad || E'\n  G4 page 1 returned ' || cardinality(_ids) || ' rows for _limit 10';
  END IF;
  IF coalesce(cardinality(_ids), 0) <> (SELECT count(DISTINCT x) FROM unnest(_ids) x) THEN
    _bad := _bad || E'\n  G4 page 1 repeats a post';
  END IF;
  FOR _i IN 3 .. coalesce(cardinality(_auth), 0) LOOP
    IF _auth[_i] = _auth[_i - 1] AND _auth[_i - 1] = _auth[_i - 2] THEN
      -- allowed only when every later place is the same author (nothing else was left)
      FOR _j IN _i .. cardinality(_auth) LOOP
        IF _auth[_j] IS DISTINCT FROM _auth[_i] THEN
          _bad := _bad || E'\n  G4 an author holds 3 places in a row at place ' || _i || ' while another author was available';
          EXIT;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  SELECT array_agg(f.id ORDER BY f.o) INTO _ids
    FROM (SELECT g.id, row_number() OVER () AS o FROM public.get_broadcast_feed('{}'::uuid[], 10, 3, NULL::text[], NULL::text) g) f;
  SELECT array_agg(f.id ORDER BY f.o) INTO _ids4
    FROM (SELECT g.id, row_number() OVER () AS o FROM public.get_broadcast_feed('{}'::uuid[], 10, 3, NULL::text[]) g) f;
  IF _ids IS DISTINCT FROM _ids4 THEN
    _bad := _bad || E'\n  G4 NULL _session_seed differs from the 4-argument call';
  END IF;
  PERFORM count(*) FROM public.get_broadcast_feed('{}'::uuid[], 10, 3, NULL::text[], 'probe-20261013-0005-b');

  IF _bad <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL 20261013_0005:%', _bad;
  END IF;

  -- G5 · NOTICE: feed_events volume.
  SELECT count(*), count(*) FILTER (WHERE created_at > now() - interval '1 hour'),
         count(*) FILTER (WHERE created_at > now() - interval '24 hours'),
         count(DISTINCT user_id) FILTER (WHERE created_at > now() - interval '24 hours')
    INTO _n, _h, _d, _m
    FROM public.feed_events WHERE event_type IN ('view', 'skip');
  RAISE NOTICE 'PROBE PASS 20261013_0005 (lane %): 4 overloads, EXECUTE = postgres + authenticated + service_role; page 1 unique, max 2 per author; NULL seed = 4-argument. feed_events view/skip: % total, % last hour (% /min), % last 24 h from % member(s); heap %, indexes %',
    current_setting('p32.lane'), _n, _h, round(_h / 60.0, 2), _d, _m,
    pg_size_pretty(pg_relation_size('public.feed_events')), pg_size_pretty(pg_indexes_size('public.feed_events'));
END
$probe$;
ROLLBACK;
