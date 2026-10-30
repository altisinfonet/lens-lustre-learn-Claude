-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261031_0615 — S10 X1 order restore (staging and production).
-- READ ONLY, ROLLBACK. Prints counts and table/policy NAMES only (public log).
-- FAILS before 0615: the merges 0608–0613 joined parts in ascending policy-name
-- order. PASSES after.
--   G0 · lane asserted.
--   G1 · every merged clause with 2+ parts has them, read from the owner-only
--        backup, in DESCENDING policy-name order ("C" collation): the order
--        Postgres ORed the original policies in (rowsecurity.c builds the list
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
  tables constant text[] := ARRAY['blocked_keywords', 'categories', 'certificate_testimonials', 'courses', 'gift_announcements', 'hero_banners', 'journal_articles', 'lessons', 'photo_of_the_day', 'ad_creatives', 'ai_chat_usage', 'certificates', 'comment_reports', 'course_enrollments', 'custom_url_history', 'post_reports', 'reports', 'support_tickets', 'user_devices', 'v3_tag_label_alias', 'bank_details', 'competition_judges', 'competition_judging_tags', 'competition_orders', 'entry_score_cache', 'judge_activity_logs', 'judge_award_tags', 'judge_comments', 'judge_decisions', 'judge_entry_assignments', 'judge_entry_locks', 'judge_scores', 'judge_tag_assignments', 'judging_config', 'judging_rounds', 'raw_commitments', 'referral_codes', 'referrals', 'role_applications', 'round_snapshots', 'wallet_transactions', 'wallets', 'withdrawal_requests', 'competitions', 'friendships', 'image_comments', 'portfolio_images', 'post_reactions', 'post_tags', 'profile_views', 'user_badges', 'user_roles', 'posts', 'post_comments'];
  _bad text := ''; skipped text := ''; wrong text := '';
  t text; rel oid; r record; c text; stored text; arm record; pos int; lastpos int;
  checked int := 0; clauses int := 0; cand text; depth int; is_wrapped boolean; ch text;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not staging or production';
  END IF;
  IF to_regclass('public.x1_policy_backup_20261031') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL 20261031_0615 (lane %): G2(no policy backup table)', current_setting('p32.lane');
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
        lastpos := 0;
        FOR arm IN SELECT CASE c WHEN 'u' THEN bk.using_expr ELSE coalesce(bk.check_expr, bk.using_expr) END AS x
                     FROM public.x1_policy_backup_20261031 bk
                    WHERE bk.tbl = t AND (bk.cmd = '*' OR bk.cmd = r.a)
                      AND (CASE c WHEN 'u' THEN bk.using_expr ELSE coalesce(bk.check_expr, bk.using_expr) END) IS NOT NULL
                    ORDER BY bk.policyname COLLATE "C" DESC LOOP
          cand := arm.x;
          pos := strpos(substr(coalesce(stored, ''), lastpos + 1), cand);
          -- Postgres's parser flattens "(A OR B) OR C" into one OR, so a part that is
          -- itself an OR can lose its single is_wrapped pair of parentheses: try its inside.
          IF pos = 0 AND left(cand, 1) = '(' AND right(cand, 1) = ')' THEN
            depth := 0; is_wrapped := true;
            FOR i IN 1 .. length(cand) LOOP
              ch := substr(cand, i, 1);
              IF ch = '(' THEN depth := depth + 1; ELSIF ch = ')' THEN depth := depth - 1; END IF;
              IF depth = 0 AND i < length(cand) THEN is_wrapped := false; EXIT; END IF;
            END LOOP;
            IF is_wrapped THEN
              cand := substr(cand, 2, length(cand) - 2);
              pos := strpos(substr(coalesce(stored, ''), lastpos + 1), cand);
            END IF;
          END IF;
          IF pos = 0 THEN
            wrong := wrong || format(' %s.%s(%s)', t, r.polname, c);
            EXIT;
          END IF;
          lastpos := lastpos + pos + length(cand) - 1;
        END LOOP;
      END LOOP;
    END LOOP;
  END LOOP;
  IF wrong <> '' THEN _bad := _bad || ' G1(not in original order:' || wrong || ')'; END IF;
  IF checked = 0 THEN _bad := _bad || ' G2(no merged table found)'; END IF;
  IF _bad <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL 20261031_0615 (lane %):%', current_setting('p32.lane'), _bad;
  END IF;
  RAISE NOTICE 'PROBE PASS 20261031_0615 (lane %): % merged tables, % multi-part clauses all in original (descending policy-name) order; skipped (no merged policies here):%',
    current_setting('p32.lane'), checked, clauses, coalesce(nullif(skipped, ''), ' none');
END
$probe$;

ROLLBACK;
