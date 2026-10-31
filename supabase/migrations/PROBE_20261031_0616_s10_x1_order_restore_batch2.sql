-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261031_0616 — S10 X1 order restore, batch2 (the tables merged by
-- 0609; staging and production).
-- READ ONLY, ROLLBACK. Prints counts and table/policy NAMES only (public log).
-- FAILS before 20261031_0616: 0609 joined parts in ascending policy-name
-- order. PASSES after.
--   G0 · lane asserted.
--   G1 · every merged clause with 2+ parts EQUALS its parts, read from the
--        owner-only backup, joined in DESCENDING policy-name order ("C"
--        collation; exact text, the only allowance being the parser's
--        flattening of a first part that is itself an OR): the order
--        Postgres ORed the original policies in (policy.c builds the list
--        in reverse index order).
--   G2 · at least one merged table was checked. Tables with no merged policies
--        on this lane are listed as skipped, which is not a failure.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
-- The backup holds pg_get_expr text deparsed with an empty search_path
-- (fully qualified); read the stored policies the same way.
SET LOCAL search_path = '';

DO $probe$
DECLARE
  tables constant text[] := ARRAY['ad_creatives', 'ai_chat_usage', 'certificates', 'comment_reports', 'course_enrollments', 'custom_url_history', 'post_reports', 'reports', 'support_tickets', 'user_devices', 'v3_tag_label_alias'];
  _bad text := ''; skipped text := ''; wrong text := '';
  t text; rel oid; r record; c text; stored text; arm record; pos int; lastpos int;
  checked int := 0; clauses int := 0; depth int; is_wrapped boolean; ch text;
  joined text; nparts int; firstpart text; expect_hit boolean; d text;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not staging or production';
  END IF;
  IF to_regclass('public.x1_policy_backup_20261031') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL 20261031_0616 (lane %): G2(no policy backup table)', current_setting('p32.lane');
  END IF;
  FOREACH t IN ARRAY tables LOOP
    rel := to_regclass(format('public.%I', t));
    IF rel IS NULL OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = rel AND p.polpermissive AND p.polname LIKE 'x1\_merged\_%') THEN
      skipped := skipped || ' ' || t;
      CONTINUE;
    END IF;
    checked := checked + 1;
    FOR r IN SELECT p.polname, p.polcmd::text AS a, pg_get_expr(p.polqual, p.polrelid) AS u, pg_get_expr(p.polwithcheck, p.polrelid) AS ck
               FROM pg_policy p WHERE p.polrelid = rel AND p.polpermissive AND p.polname LIKE 'x1\_merged\_%' LOOP
      FOREACH c IN ARRAY ARRAY['u', 'c'] LOOP
        CONTINUE WHEN (c = 'u' AND r.a = 'a') OR (c = 'c' AND r.a NOT IN ('a', 'w'));
        stored := CASE c WHEN 'u' THEN r.u ELSE r.ck END;
        CONTINUE WHEN (SELECT count(*) FROM public.x1_policy_backup_20261031 bk
                        WHERE bk.tbl = t AND (bk.cmd = '*' OR bk.cmd = r.a)
                          AND (CASE c WHEN 'u' THEN bk.using_expr ELSE coalesce(bk.check_expr, bk.using_expr) END) IS NOT NULL) <= 1;
        clauses := clauses + 1;
        -- expected text for direction 'DESC': '(' || parts joined by ' OR ' || ')';
        -- one part: the part itself; the parser flattens "(A OR B) OR C", so the
        -- first part may also appear without its single outer pair of parentheses.
        SELECT string_agg(x, ' OR ' ORDER BY CASE WHEN 'DESC' = 'DESC' THEN nm END COLLATE "C" DESC,
                                             CASE WHEN 'DESC' = 'ASC'  THEN nm END COLLATE "C" ASC),
               count(*),
               (array_agg(x ORDER BY CASE WHEN 'DESC' = 'DESC' THEN nm END COLLATE "C" DESC,
                                     CASE WHEN 'DESC' = 'ASC'  THEN nm END COLLATE "C" ASC))[1]
          INTO joined, nparts, firstpart
          FROM (SELECT bk.policyname AS nm,
                       CASE c WHEN 'u' THEN bk.using_expr ELSE coalesce(bk.check_expr, bk.using_expr) END AS x
                  FROM public.x1_policy_backup_20261031 bk
                 WHERE bk.tbl = t AND (bk.cmd = '*' OR bk.cmd = r.a)) z
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
          wrong := wrong || format(' %s.%s(%s)', t, r.polname, c);
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  IF wrong <> '' THEN _bad := _bad || ' G1(not in original order:' || wrong || ')'; END IF;
  IF checked = 0 THEN _bad := _bad || ' G2(no merged table found)'; END IF;
  IF _bad <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL 20261031_0616 (lane %):%', current_setting('p32.lane'), _bad;
  END IF;
  RAISE NOTICE 'PROBE PASS 20261031_0616 (lane %): % merged tables, % multi-part clauses all in original (descending policy-name) order; skipped (no merged policies here):%',
    current_setting('p32.lane'), checked, clauses, coalesce(nullif(skipped, ''), ' none');
END
$probe$;

ROLLBACK;
