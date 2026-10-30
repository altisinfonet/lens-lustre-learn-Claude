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
-- E2 (each identity counts its visible rows through RLS) and E1 (each
-- permissive policy's expression over the table, per identity) — and times
-- it, so batches can be cut to keep every hot table's lock short.
--
-- Identities as in 0609, per table: anon, ≤3 users per app role, ≤3 owners
-- per owner column of THIS table, 3 members.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;

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
  t0 timestamptz; e1_ms numeric; e2_ms numeric; n bigint; out text := ''; skipped text := '';
  est numeric; rows_est bigint; npol int;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not staging or production';
  END IF;
  SET LOCAL statement_timeout = '120s';

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
      -- E1-like: each permissive policy's USING and coalesce(CHECK, USING), as owner
      t0 := clock_timestamp();
      FOR r IN SELECT pg_get_expr(p.polqual, p.polrelid) AS u, pg_get_expr(p.polwithcheck, p.polrelid) AS ck
                 FROM pg_policy p WHERE p.polrelid = rel AND p.polpermissive LOOP
        IF r.u IS NOT NULL THEN
          EXECUTE format('SELECT count(*) FROM public.%I WHERE coalesce((%s), false)', t, r.u) INTO n;
        END IF;
        IF r.ck IS NOT NULL THEN
          EXECUTE format('SELECT count(*) FROM public.%I WHERE coalesce((%s), false)', t, r.ck) INTO n;
        END IF;
      END LOOP;
      e1_ms := e1_ms + extract(epoch FROM clock_timestamp() - t0) * 1000;
      -- E2-like: visible rows through RLS as the identity's role
      EXECUTE format('SET LOCAL ROLE %I', id ->> 'role');
      t0 := clock_timestamp();
      BEGIN
        EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
      EXCEPTION WHEN insufficient_privilege THEN NULL;
      END;
      e2_ms := e2_ms + extract(epoch FROM clock_timestamp() - t0) * 1000;
      RESET ROLE;
    END LOOP;
    -- under lock the merge runs E1 (old union + new) and E2 after: ~2×E1 + E2
    est := round(2 * e1_ms + e2_ms);
    out := out || format(E'\n  %-26s rows≈%-8s identities=%-3s E1=%-7s E2=%-7s est_lock_ms≈%s',
                         t, rows_est, jsonb_array_length(ids), round(e1_ms), round(e2_ms), est);
  END LOOP;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);

  RAISE NOTICE E'X1 PROOF COST (lane %): per table, time the merge proof would hold its lock (ms)%\n  skipped:%',
    current_setting('p32.lane'), out, CASE WHEN skipped = '' THEN ' none' ELSE skipped END;
END
$probe$;

ROLLBACK;
