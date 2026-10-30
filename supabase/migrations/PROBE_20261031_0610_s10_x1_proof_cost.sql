-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · S10 X1 · how long the merge proof would hold each remaining table.
-- READ ONLY, ROLLBACK. Changes nothing. Prints table names, row estimates,
-- identity counts and milliseconds only (no row data, no ids; public log).
--
-- Why: an X1 merge (0608/0609, live) holds ACCESS EXCLUSIVE on each table
-- from its CREATE POLICY until COMMIT, while E1/E2 run. That was ~1-2 s for
-- low-traffic tables; the 36 uniform-role tables still to merge include the
-- feed's hot tables (posts, post_tags, user_badges, friendships, …). This
-- runs, without any DDL, the same per-table work the proof does under lock —
-- E1 exactly as 0609 runs it (per action × clause: each original policy's
-- row-id set, their union, and the merged OR expression's ordered row-id
-- hash) and E2 (each identity's visible-row hash through RLS) — and times it.
-- Figures are per-table LOWER BOUNDS; a batch's lock is about their sum.
--
-- Identities as in 0609, per table: anon, ≤3 users per app role, ≤3 owners
-- per owner column of THIS table, 3 members.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
-- Top level, so they bind the DO statement below (a SET inside a running DO
-- does not re-arm its timer): bounded run, never waits on a lock.
SET LOCAL statement_timeout = '300s';
SET LOCAL lock_timeout = '5s';

DO $probe$
DECLARE
  tables constant text[] := ARRAY[
    'activity_logs', 'bank_details', 'competition_judges', 'competition_judging_tags',
    'competition_orders', 'competitions', 'entry_score_cache', 'feed_events', 'friendships',
    'image_comments', 'judge_activity_logs', 'judge_award_tags', 'judge_comments', 'judge_decisions',
    'judge_entry_assignments', 'judge_entry_locks', 'judge_scores', 'judge_tag_assignments',
    'judging_config', 'judging_rounds', 'portfolio_images', 'post_comments', 'post_reactions',
    'post_tags', 'posts', 'profile_views', 'raw_commitments', 'referral_codes', 'referrals',
    'role_applications', 'round_snapshots', 'user_badges', 'user_roles', 'wallet_transactions',
    'wallets', 'withdrawal_requests'];
  t text; rel oid; r record; id jsonb; ids jsonb; cols text[]; c text; k int;
  t0 timestamptz; e1_ms numeric; e2_ms numeric; n bigint; skipped text := '';
  est numeric; rows_est bigint; npol int; a text; cl text; one text; parts text[]; total numeric := 0;
  old_tids tid[]; part_tids tid[]; h text;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not staging or production';
  END IF;

  FOREACH t IN ARRAY tables LOOP
    rel := to_regclass(format('public.%I', t));
    IF rel IS NULL THEN skipped := skipped || ' ' || t || '(missing)'; CONTINUE; END IF;
    SELECT count(*) INTO npol FROM pg_policy p WHERE p.polrelid = rel AND p.polpermissive;
    IF NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = rel AND p.polpermissive AND p.polname NOT LIKE 'x1\_merged\_%') THEN
      skipped := skipped || ' ' || t || '(already merged)'; CONTINUE;
    END IF;
    IF npol < 2 OR (SELECT count(DISTINCT polroles) FROM pg_policy WHERE polrelid = rel AND polpermissive) <> 1 THEN
      skipped := skipped || ' ' || t || '(not uniform)'; CONTINUE;
    END IF;
    SELECT greatest(c.reltuples, 0)::bigint INTO rows_est FROM pg_class c WHERE c.oid = rel;

    ids := jsonb_build_array(jsonb_build_object('role', 'anon', 'sub', NULL));
    FOR r IN SELECT ur.user_id, row_number() OVER (PARTITION BY ur.role::text ORDER BY ur.user_id) AS rn FROM public.user_roles ur LOOP
      IF r.rn <= 3 THEN ids := ids || jsonb_build_object('role', 'authenticated', 'sub', r.user_id); END IF;
    END LOOP;
    SELECT array_agg(a.attname::text) INTO cols FROM pg_attribute a
     WHERE a.attrelid = rel AND a.attnum > 0 AND NOT a.attisdropped AND a.atttypid = 'uuid'::regtype
       AND a.attname IN ('user_id', 'owner_id', 'author_id', 'viewer_id', 'tagger_id', 'tagged_user_id', 'reporter_id', 'recipient_id', 'profile_id', 'created_by',
                         'judge_id', 'follower_id', 'following_id', 'friend_id', 'requester_id', 'addressee_id', 'referrer_id', 'referred_id');
    FOREACH c IN ARRAY coalesce(cols, '{}') LOOP
      FOR r IN EXECUTE format('SELECT DISTINCT %I AS u FROM public.%I WHERE %I IS NOT NULL ORDER BY 1 LIMIT 3', c, t, c) LOOP
        ids := ids || jsonb_build_object('role', 'authenticated', 'sub', r.u);
      END LOOP;
    END LOOP;
    FOR r IN SELECT u.id FROM auth.users u ORDER BY u.created_at LIMIT 3 LOOP
      ids := ids || jsonb_build_object('role', 'authenticated', 'sub', r.id);
    END LOOP;
    SELECT jsonb_agg(DISTINCT e) INTO ids FROM jsonb_array_elements(ids) e;

    e1_ms := 0; e2_ms := 0;
    FOR id IN SELECT * FROM jsonb_array_elements(ids) LOOP
      PERFORM set_config('request.jwt.claims', CASE WHEN id ->> 'sub' IS NULL THEN json_build_object('role', id ->> 'role')
               ELSE json_build_object('sub', id ->> 'sub', 'role', id ->> 'role') END::text, true);
      PERFORM set_config('request.jwt.claim.sub', coalesce(id ->> 'sub', ''), true);
      PERFORM set_config('request.jwt.claim.role', id ->> 'role', true);
      -- E1 as the merge runs it: per action × clause, the union of each
      -- applicable original policy's rows (ctid arrays) and the merged OR
      -- expression's rows (ordered ctid list + md5), as owner.
      t0 := clock_timestamp();
      FOREACH a IN ARRAY ARRAY['r', 'a', 'w', 'd'] LOOP
        FOREACH cl IN ARRAY ARRAY['u', 'c'] LOOP
          CONTINUE WHEN (cl = 'u' AND a = 'a') OR (cl = 'c' AND a IN ('r', 'd'));
          parts := '{}'; old_tids := '{}';
          FOR r IN SELECT pg_get_expr(p.polqual, p.polrelid) AS u, pg_get_expr(p.polwithcheck, p.polrelid) AS ck
                     FROM pg_policy p WHERE p.polrelid = rel AND p.polpermissive AND (p.polcmd = '*' OR p.polcmd::text = a) LOOP
            one := CASE cl WHEN 'u' THEN r.u ELSE coalesce(r.ck, r.u) END;
            CONTINUE WHEN one IS NULL;
            parts := parts || ('(' || one || ')');
            EXECUTE format('SELECT coalesce(array_agg(ctid), %L) FROM public.%I WHERE coalesce((%s), false)', '{}', t, one) INTO part_tids;
            old_tids := old_tids || part_tids;
          END LOOP;
          CONTINUE WHEN cardinality(parts) = 0;
          SELECT md5(coalesce(string_agg(x::text, ',' ORDER BY x), '')) INTO h FROM (SELECT DISTINCT unnest(old_tids) AS x) z;
          EXECUTE format('SELECT md5(coalesce(string_agg(ctid::text, %L ORDER BY ctid), %L)) FROM public.%I WHERE coalesce((%s), false)',
                         ',', '', t, array_to_string(parts, ' OR ')) INTO h;
        END LOOP;
      END LOOP;
      e1_ms := e1_ms + extract(epoch FROM clock_timestamp() - t0) * 1000;
      -- E2-like: visible rows through RLS as the identity's role
      EXECUTE format('SET LOCAL ROLE %I', id ->> 'role');
      t0 := clock_timestamp();
      BEGIN
        EXECUTE format('SELECT md5(coalesce(string_agg(ctid::text, %L ORDER BY ctid), %L)) FROM public.%I', ',', '', t) INTO h;
      EXCEPTION WHEN insufficient_privilege THEN NULL;
      END;
      e2_ms := e2_ms + extract(epoch FROM clock_timestamp() - t0) * 1000;
      RESET ROLE;
    END LOOP;
    -- under lock the merge runs E1 (old union + merged, measured together above) and E2-after
    est := round(e1_ms + e2_ms);
    total := total + est;
    -- one notice per table, so a timeout later keeps what was measured
    RAISE NOTICE 'X1 PROOF COST (lane %) %: rows≈% identities=% E1=%ms E2=%ms lock_lower_bound≈%ms running_total≈%ms',
      current_setting('p32.lane'), t, rows_est, jsonb_array_length(ids), round(e1_ms), round(e2_ms), est, total;
  END LOOP;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);

  RAISE NOTICE 'X1 PROOF COST (lane %) done: per-table figures are LOWER BOUNDS — a real batch locks every table in it from its CREATE POLICY until COMMIT, uses the union of all its tables'' owners as identities, so a batch''s lock ≈ the sum of its tables'' figures or more. skipped:%',
    current_setting('p32.lane'), CASE WHEN skipped = '' THEN ' none' ELSE skipped END;
END
$probe$;

ROLLBACK;
