BEGIN;

DO $lane$
DECLARE fp text;
BEGIN
  SELECT system_identifier::text INTO fp FROM pg_control_system();
  IF fp <> '7656985631720456337' THEN
    RAISE EXCEPTION 'LANE GUARD: this file is for PRODUCTION jtdtehuqtinjxropkkcn (cluster 7656985631720456337). This cluster is %. Nothing applied.', fp;
  END IF;
END
$lane$;

CREATE OR REPLACE FUNCTION public.get_top_contributors_v3()
RETURNS TABLE (
  user_id           uuid,
  rank_position     integer,
  contributor_score integer,
  recent_score      integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  WITH recent AS (
    SELECT r.uid, r.score
    FROM public.contributor_points_since(
      ((now() AT TIME ZONE 'UTC')::date - 29)
    ) r
    WHERE r.score > 0
  ),
  lifetime AS (
    SELECT l.uid, l.score FROM public.contributor_points_since(NULL::date) l
  ),
  ranked AS (
    SELECT rc.uid,
           rc.score AS recent,
           ROW_NUMBER() OVER (ORDER BY rc.score DESC, rc.uid) AS pos
    FROM recent rc
  )
  SELECT rk.uid,
         rk.pos::integer,
         ROUND(COALESCE(lf.score, 0))::integer,
         ROUND(rk.recent)::integer
  FROM ranked rk
  LEFT JOIN lifetime lf ON lf.uid = rk.uid
  WHERE rk.pos <= 3
  ORDER BY rk.pos;
$fn$;

COMMENT ON FUNCTION public.get_top_contributors_v3() IS
  'Home page Top Contributors. Ranked by rolling last 30 UTC days and returns BOTH that 30-day score (recent_score, what the card displays) and the lifetime Contributor Score (contributor_score). Per OWNER-RULING-2026-09-03-02, which supersedes the 2026-08-11 instruction that the 30-day number is never returned; that instruction is preserved unedited in 20260811160000_top_contributors_v2.sql. Never returns counts, minutes, engagement figures or formula internals. get_top_contributors_v2 is unchanged and remains the rollback until the Auditor authorises its removal.';

REVOKE ALL ON FUNCTION public.get_top_contributors_v3() FROM public;
GRANT EXECUTE ON FUNCTION public.get_top_contributors_v3() TO anon, authenticated;

DO $verify$
DECLARE
  f_oid      oid;
  public_has boolean;
  acl        text;
BEGIN
  f_oid := to_regprocedure('public.get_top_contributors_v3()')::oid;
  IF f_oid IS NULL THEN
    RAISE EXCEPTION 'VERIFY FAILED: public.get_top_contributors_v3() does not exist after CREATE.';
  END IF;

  SELECT coalesce(proacl::text, 'NULL') INTO acl FROM pg_proc WHERE oid = f_oid;

  IF pg_get_function_result(f_oid) <> 'TABLE(user_id uuid, rank_position integer, contributor_score integer, recent_score integer)' THEN
    RAISE EXCEPTION 'VERIFY FAILED: return shape is %, not the frozen interface.', pg_get_function_result(f_oid);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = f_oid AND prosecdef AND provolatile = 's'
                   AND proconfig @> ARRAY['search_path=public'] AND pronargs = 0) THEN
    RAISE EXCEPTION 'VERIFY FAILED: v3 is not STABLE SECURITY DEFINER with search_path=public and zero arguments.';
  END IF;

  public_has := EXISTS (SELECT 1 FROM pg_proc p
                        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                        WHERE p.oid = f_oid AND x.grantee = 0 AND x.privilege_type = 'EXECUTE');
  IF public_has THEN
    RAISE EXCEPTION 'VERIFY FAILED: PUBLIC still holds EXECUTE (proacl %). F-62 trap left armed.', acl;
  END IF;

  IF NOT has_function_privilege('anon', f_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY FAILED: anon cannot EXECUTE (proacl %). The Home card would break.', acl;
  END IF;

  IF NOT has_function_privilege('authenticated', f_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY FAILED: authenticated cannot EXECUTE (proacl %).', acl;
  END IF;

  IF to_regprocedure('public.get_top_contributors_v2()') IS NULL THEN
    RAISE EXCEPTION 'VERIFY FAILED: get_top_contributors_v2() is gone. The rollback path was destroyed.';
  END IF;

  IF has_function_privilege('anon', to_regprocedure('public.contributor_points_since(date)')::oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY FAILED: contributor_points_since is anon-executable. The leaderboard helper is an enumeration endpoint.';
  END IF;
END
$verify$;

COMMIT;
