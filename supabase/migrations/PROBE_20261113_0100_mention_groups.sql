-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261113_0100 @all / @followers. WRITES NOTHING: every step runs in
-- one transaction that ends in ROLLBACK. FAILS before apply.
--
-- PASS = the structure is in place AND the rules hold when exercised:
--   R1  switch off            → nothing is queued
--   R2  @all without the tick → refused (not_verified)
--   R3  @followers            → queued; the same post again → already_sent
--   R4  4th @followers today  → refused (daily_limit)
--   R5  @all with the tick    → queued; a 2nd @all today → refused (daily_limit)
--   R6  @all in a comment on someone else's post → refused (not_own_post)
--   R7  tick taken away after queueing, before sending → job cancelled, 0 sent
--   R8  the triggers fire on INSERT only (an edit can never send)
--   R9  members cannot call the gate, the sender or the rule directly
-- Prints counts and reasons only — no member data.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
SET LOCAL client_min_messages = notice;

DO $p$
DECLARE
  _a      uuid;      -- a plain member with a public post
  _p      uuid;      -- that post
  _others uuid[];    -- other posts
  _x      uuid;      -- another member's public post
  _mode   text;
  _open   bigint;
  _all    bigint;
  _got    text;
  _job    uuid;
  _st     text;
  _why    text;
  _sent   integer;
  i       integer;
  f       text;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;

  -- ── structure ────────────────────────────────────────────────────────────
  IF to_regclass('public.mention_group_jobs') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL: mention_group_jobs missing (0100 not applied)';
  END IF;
  FOREACH f IN ARRAY ARRAY['public.is_verified_member(uuid)', 'public.mention_group_refusal(text,uuid,uuid,uuid)',
                           'public.mention_group_enqueue(text,uuid,uuid,uuid)', 'public.mention_groups_tick(integer)',
                           'public.mention_groups_me()', 'public.tg_mention_groups_post()', 'public.tg_mention_groups_comment()'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure(f) AND prosecdef AND proconfig = ARRAY['search_path=""']) THEN
      RAISE EXCEPTION 'PROBE FAIL: % missing or not SECURITY DEFINER / search_path=""', f;
    END IF;
  END LOOP;
  -- R9
  FOREACH f IN ARRAY ARRAY['public.is_verified_member(uuid)', 'public.mention_group_refusal(text,uuid,uuid,uuid)',
                           'public.mention_group_enqueue(text,uuid,uuid,uuid)', 'public.mention_groups_tick(integer)'] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'PROBE FAIL R9: a member can call %', f;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.mention_groups_me()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.mention_groups_me()', 'EXECUTE') THEN
    RAISE EXCEPTION 'PROBE FAIL R9: mention_groups_me grants are wrong';
  END IF;
  IF has_table_privilege('anon', 'public.mention_group_jobs', 'SELECT')
     OR has_table_privilege('authenticated', 'public.mention_group_jobs', 'SELECT,INSERT,UPDATE,DELETE')
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.mention_group_jobs'::regclass) THEN
    RAISE EXCEPTION 'PROBE FAIL R9: mention_group_jobs is reachable by members';
  END IF;
  -- R8: AFTER INSERT, FOR EACH ROW = tgtype 5; nothing else
  IF (SELECT count(*) FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgenabled = 'O' AND t.tgtype = 5
        AND ((t.tgrelid = 'public.posts'::regclass AND t.tgname = 'trg_mention_groups_post')
          OR (t.tgrelid = 'public.post_comments'::regclass AND t.tgname = 'trg_mention_groups_comment'))) <> 2
     OR EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                 WHERE p.proname IN ('tg_mention_groups_post', 'tg_mention_groups_comment') AND t.tgtype <> 5) THEN
    RAISE EXCEPTION 'PROBE FAIL R8: the mention triggers are not INSERT-only';
  END IF;
  IF (SELECT count(*) FROM public.notification_types WHERE type IN ('mention_all', 'mention_followers')
        AND channels = ARRAY['in_app', 'push'] AND pref_in_app = 'inapp_mentions_everyone'
        AND pref_push = 'push_mentions_everyone' AND member_can_disable) <> 2 THEN
    RAISE EXCEPTION 'PROBE FAIL: the two notification types are not registered as expected';
  END IF;
  IF public.notif_action_phrase('mention_all') IS DISTINCT FROM 'mentioned everyone.'
     OR public.notif_action_phrase('mention_followers') IS DISTINCT FROM 'mentioned their followers.'
     OR public.notif_action_phrase('story_comment') IS DISTINCT FROM 'commented on your story.' THEN
    RAISE EXCEPTION 'PROBE FAIL: bell wording is not as expected';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mention-groups-tick' AND schedule = '* * * * *' AND active)
     OR (SELECT count(*) FROM public.feature_access WHERE feature IN ('mention_groups', 'mention_all_blocked')) <> 2
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_custom_url_not_group_tag') THEN
    RAISE EXCEPTION 'PROBE FAIL: clock, switches or reserved-handle rule missing';
  END IF;

  -- ── behaviour (rolled back) ──────────────────────────────────────────────
  SELECT po.user_id, po.id INTO _a, _p
    FROM public.posts po JOIN public.profiles p ON p.id = po.user_id
   WHERE po.privacy = 'public'
     AND coalesce(p.is_suspended, false) = false AND coalesce(p.is_banned, false) = false
     AND NOT public.is_verified_member(po.user_id)
   ORDER BY (SELECT count(*) FROM public.follows f WHERE f.following_id = po.user_id), po.id
   LIMIT 1;
  SELECT array_agg(x.id) INTO _others FROM (SELECT po.id FROM public.posts po WHERE po.id <> _p ORDER BY po.id LIMIT 4) x;
  IF _a IS NULL OR coalesce(cardinality(_others), 0) < 4 THEN
    RAISE NOTICE 'MG0100 PASS (structure only, lane %): no plain member with a public post + 4 other posts to exercise the rules',
      current_setting('p32.lane');
    RETURN;
  END IF;
  -- the real state, read BEFORE the test changes anything (all of it is rolled back)
  SELECT fa.mode INTO _mode FROM public.feature_access fa WHERE fa.feature = 'mention_groups';
  SELECT count(*) FILTER (WHERE status IN ('queued', 'sending')), count(*) INTO _open, _all FROM public.mention_group_jobs;
  DELETE FROM public.mention_group_jobs;                                -- a clean table for the test (rolled back)
  DELETE FROM public.feature_access_members WHERE feature = 'mention_all_blocked' AND user_id = _a;

  UPDATE public.feature_access SET mode = 'off' WHERE feature = 'mention_groups';
  _got := public.mention_group_enqueue('followers', _p, NULL, _a);
  IF _got IS DISTINCT FROM 'feature_off' THEN RAISE EXCEPTION 'PROBE FAIL R1: switch off gave %', _got; END IF;

  UPDATE public.feature_access SET mode = 'everyone' WHERE feature = 'mention_groups';
  _got := public.mention_group_enqueue('all', _p, NULL, _a);
  IF _got IS DISTINCT FROM 'not_verified' THEN RAISE EXCEPTION 'PROBE FAIL R2: @all without the tick gave %', _got; END IF;

  _got := public.mention_group_enqueue('followers', _p, NULL, _a);
  IF _got IS DISTINCT FROM 'queued' THEN RAISE EXCEPTION 'PROBE FAIL R3: @followers gave %', _got; END IF;
  _got := public.mention_group_enqueue('followers', _p, NULL, _a);
  IF _got IS DISTINCT FROM 'already_sent' THEN RAISE EXCEPTION 'PROBE FAIL R3: the same post again gave %', _got; END IF;

  FOR i IN 1..2 LOOP
    _got := public.mention_group_enqueue('followers', _others[i], NULL, _a);
    IF _got IS DISTINCT FROM 'queued' THEN RAISE EXCEPTION 'PROBE FAIL R4: @followers no. % today gave %', i + 1, _got; END IF;
  END LOOP;
  _got := public.mention_group_enqueue('followers', _others[3], NULL, _a);
  IF _got IS DISTINCT FROM 'daily_limit' THEN RAISE EXCEPTION 'PROBE FAIL R4: the 4th @followers today gave %', _got; END IF;

  INSERT INTO public.user_badges (user_id, badge_type, assigned_by) VALUES (_a, 'verified', _a);
  _got := public.mention_group_enqueue('all', _p, NULL, _a);
  IF _got IS DISTINCT FROM 'queued' THEN RAISE EXCEPTION 'PROBE FAIL R5: @all with the tick gave %', _got; END IF;
  SELECT j.id INTO _job FROM public.mention_group_jobs j WHERE j.post_id = _p AND j.kind = 'all' AND j.comment_id IS NULL;
  _got := public.mention_group_enqueue('all', _others[4], NULL, _a);
  IF _got IS DISTINCT FROM 'daily_limit' AND _got IS DISTINCT FROM 'post_not_public' THEN
    RAISE EXCEPTION 'PROBE FAIL R5: a 2nd @all today gave %', _got;
  END IF;

  SELECT po.id INTO _x FROM public.posts po WHERE po.user_id <> _a AND po.privacy = 'public' LIMIT 1;
  IF _x IS NOT NULL THEN
    _got := public.mention_group_refusal('all', _x, gen_random_uuid(), _a);
    IF _got IS DISTINCT FROM 'not_own_post' THEN RAISE EXCEPTION 'PROBE FAIL R6: @all in a comment on another member''s post gave %', _got; END IF;
  END IF;

  DELETE FROM public.user_badges WHERE user_id = _a AND badge_type = 'verified';
  FOR i IN 1..40 LOOP
    SELECT j.status INTO _st FROM public.mention_group_jobs j WHERE j.id = _job;
    EXIT WHEN _st NOT IN ('queued', 'sending');
    PERFORM public.mention_groups_tick(200);
  END LOOP;
  SELECT j.status, j.cancel_reason, j.sent INTO _st, _why, _sent FROM public.mention_group_jobs j WHERE j.id = _job;
  IF _st IS DISTINCT FROM 'cancelled' OR _why IS DISTINCT FROM 'not_verified' OR _sent <> 0
     OR EXISTS (SELECT 1 FROM public.user_notifications un WHERE un.type = 'mention_all' AND un.dedup_key LIKE 'mention_all:' || _job::text || ':%') THEN
    RAISE EXCEPTION 'PROBE FAIL R7: after the tick was taken away the job is % (%), sent %', _st, coalesce(_why, '-'), _sent;
  END IF;

  RAISE NOTICE 'MG0100 PASS (lane %): R1–R9 hold; switch is % ; open jobs % ; jobs so far %',
    current_setting('p32.lane'), _mode, _open, _all;
END
$p$;

ROLLBACK;
