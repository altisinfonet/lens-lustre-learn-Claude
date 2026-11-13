-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261113_0700 — JUDGING RULES AUDIT, INSPECT ONLY (Owner 13 Nov:
-- "Deep audit in the Competition Judging Rules — any flaw as per rules?").
-- READ ONLY, ROLLBACK. Prints (1) the LIVE rule set — stage catalog, system
-- tags, every enabled trigger on the judging tables and the bodies of the
-- functions that enforce the rules — and (2) COUNTS of rows that break a rule.
-- Counts only, never a member's data. Each check runs in its own block, so a
-- column that differs on this lane reports itself instead of stopping the rest.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL client_min_messages = notice;

DO $p$
DECLARE
  r record; f text; q text; n bigint;
  checks text[][] := ARRAY[
    -- [label, count query]
    ['C01 competitions by status/phase', $q$SELECT count(*) FROM public.competitions$q$],
    ['D01 photos with DIFFERENT decisions from different judges in the same round', $q$SELECT count(*) FROM (SELECT entry_id, photo_index, round_number FROM public.judge_decisions GROUP BY 1,2,3 HAVING count(DISTINCT decision) > 1) x$q$],
    ['D02 photos decided by MORE THAN ONE judge in a round (any decision)', $q$SELECT count(*) FROM (SELECT entry_id, photo_index, round_number FROM public.judge_decisions GROUP BY 1,2,3 HAVING count(DISTINCT judge_id) > 1) x$q$],
    ['D03 judge decided their OWN entry', $q$SELECT count(*) FROM public.judge_decisions d JOIN public.competition_entries e ON e.id = d.entry_id WHERE e.user_id = d.judge_id$q$],
    ['D04 judge is also an ENTRANT in the competition they judge', $q$SELECT count(*) FROM public.competition_judges j JOIN public.competition_entries e ON e.competition_id = j.competition_id AND e.user_id = j.judge_id$q$],
    ['D05 decisions by a judge NOT assigned to that competition', $q$SELECT count(*) FROM public.judge_decisions d JOIN public.competition_entries e ON e.id = d.entry_id WHERE NOT EXISTS (SELECT 1 FROM public.competition_judges j WHERE j.competition_id = e.competition_id AND j.judge_id = d.judge_id)$q$],
    ['D06 scores by a judge NOT assigned to that competition', $q$SELECT count(*) FROM public.judge_scores s JOIN public.competition_entries e ON e.id = s.entry_id WHERE NOT EXISTS (SELECT 1 FROM public.competition_judges j WHERE j.competition_id = e.competition_id AND j.judge_id = s.judge_id)$q$],
    ['D07 decisions in a round AFTER the photo was rejected in an earlier round', $q$SELECT count(*) FROM public.judge_decisions d WHERE EXISTS (SELECT 1 FROM public.judge_decisions p WHERE p.entry_id = d.entry_id AND p.photo_index IS NOT DISTINCT FROM d.photo_index AND p.round_number < d.round_number AND p.decision IN ('reject','rejected'))$q$],
    ['D08 decisions using a RETIRED stage key', $q$SELECT count(*) FROM public.judge_decisions d JOIN public.v3_stage_catalog c ON c.stage_key = d.stage_key WHERE NOT c.is_active$q$],
    ['D09 entries whose stage_key is RETIRED or unknown', $q$SELECT count(*) FROM public.competition_entries e WHERE e.stage_key IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.v3_stage_catalog c WHERE c.stage_key = e.stage_key AND c.is_active)$q$],
    ['D10 scores outside 0..10', $q$SELECT count(*) FROM public.judge_scores WHERE score < 0 OR score > 10$q$],
    ['E01 entries submitted AFTER the competition closed', $q$SELECT count(*) FROM public.competition_entries e JOIN public.competitions c ON c.id = e.competition_id WHERE c.ends_at IS NOT NULL AND e.created_at > c.ends_at$q$],
    ['E02 members OVER the entry limit in a competition', $q$SELECT count(*) FROM (SELECT e.competition_id, e.user_id, count(*) n, max(c.max_entries_per_user) lim FROM public.competition_entries e JOIN public.competitions c ON c.id = e.competition_id GROUP BY 1,2) x WHERE lim IS NOT NULL AND n > lim$q$],
    ['E03 entries OVER the photo limit', $q$SELECT count(*) FROM public.competition_entries e JOIN public.competitions c ON c.id = e.competition_id WHERE c.max_photos_per_entry IS NOT NULL AND cardinality(e.photos) > c.max_photos_per_entry$q$],
    ['E04 AI-flagged entries in competitions that do NOT allow AI', $q$SELECT count(*) FROM public.competition_entries e JOIN public.competitions c ON c.id = e.competition_id WHERE coalesce(c.ai_images_allowed, false) = false AND coalesce(e.is_ai_generated, false)$q$],
    ['E05 the SAME photo file in two entries of one competition', $q$SELECT count(*) FROM (SELECT e.competition_id, p FROM public.competition_entries e, unnest(e.photos) p GROUP BY 1,2 HAVING count(DISTINCT e.id) > 1) x$q$],
    ['V01 SELF votes (voter = entrant)', $q$SELECT count(*) FROM public.competition_votes v JOIN public.competition_entries e ON e.id = v.entry_id WHERE v.user_id = e.user_id$q$],
    ['V02 DUPLICATE votes (same voter, entry, photo)', $q$SELECT count(*) FROM (SELECT user_id, entry_id, photo_index FROM public.competition_votes GROUP BY 1,2,3 HAVING count(*) > 1) x$q$],
    ['V03 votes OUTSIDE the voting window', $q$SELECT count(*) FROM public.competition_votes v JOIN public.competition_entries e ON e.id = v.entry_id JOIN public.competitions c ON c.id = e.competition_id WHERE (c.voting_starts_at IS NOT NULL AND v.created_at < c.voting_starts_at) OR (c.voting_ends_at IS NOT NULL AND v.created_at > c.voting_ends_at)$q$],
    ['V04 votes by a JUDGE of that competition', $q$SELECT count(*) FROM public.competition_votes v JOIN public.competition_entries e ON e.id = v.entry_id JOIN public.competition_judges j ON j.competition_id = e.competition_id AND j.judge_id = v.user_id$q$],
    ['P01 competitions with MORE THAN ONE winner placement', $q$SELECT count(*) FROM (SELECT competition_id FROM public.competition_entries WHERE placement IN ('winner','1st','first','1') OR stage_key = 'r4_winner' GROUP BY 1 HAVING count(*) > 1) x$q$],
    ['P02 Round-4 awards on entries with NO Round-3 qualifying decision', $q$SELECT count(*) FROM public.competition_entries e WHERE e.stage_key LIKE 'r4_%' AND NOT EXISTS (SELECT 1 FROM public.judge_decisions d WHERE d.entry_id = e.id AND d.round_number = 3)$q$],
    ['K01 certificates issued TWICE (same member, type, reference, not revoked)', $q$SELECT count(*) FROM (SELECT user_id, type, reference_id FROM public.certificates WHERE NOT coalesce(is_revoked, false) GROUP BY 1,2,3 HAVING count(*) > 1) x$q$],
    ['K02 certificates for an entry whose stage is NOT certificate-eligible', $q$SELECT count(*) FROM public.certificates k JOIN public.competition_entries e ON e.id::text = k.reference_id::text JOIN public.v3_stage_catalog c ON c.stage_key = e.stage_key WHERE NOT c.cert_eligible AND NOT coalesce(k.is_revoked, false)$q$],
    ['K03 cert-eligible entries in COMPLETED competitions with NO certificate', $q$SELECT count(*) FROM public.competition_entries e JOIN public.competitions c ON c.id = e.competition_id JOIN public.v3_stage_catalog s ON s.stage_key = e.stage_key WHERE s.cert_eligible AND c.status IN ('completed','closed','archived') AND NOT EXISTS (SELECT 1 FROM public.certificates k WHERE k.reference_id::text = e.id::text AND NOT coalesce(k.is_revoked, false))$q$],
    ['A01 entries holding MORE THAN ONE Round-4 award tag (last one written wins)', $q$SELECT count(*) FROM (SELECT entry_id FROM public.judge_tag_assignments WHERE round_number = 4 GROUP BY 1 HAVING count(DISTINCT tag_id) > 1) x$q$],
    ['A02 REJECTED entries that hold a photo a judge QUALIFIED for the next round', $q$SELECT count(*) FROM public.competition_entries e WHERE e.status = 'rejected' AND EXISTS (SELECT 1 FROM public.judge_decisions d WHERE d.entry_id = e.id AND d.decision IN ('shortlist','shortlisted','qualified_r3','qualified_final','shortlisted_final','qualified'))$q$],
    ['A03 photos that went FORWARD on one judge''s yes while another judge said reject', $q$SELECT count(*) FROM (SELECT entry_id, photo_index, round_number FROM public.judge_decisions GROUP BY 1,2,3 HAVING bool_or(decision IN ('reject','rejected')) AND bool_or(decision IN ('shortlist','shortlisted','qualified_r3','qualified_final','shortlisted_final','qualified'))) x$q$],
    ['A04 decisions CHANGED after the round was locked', $q$SELECT count(*) FROM public.judge_decisions d JOIN public.competition_entries e ON e.id = d.entry_id JOIN public.competition_round_publish p ON p.competition_id = e.competition_id AND p.round_number = d.round_number WHERE p.closed_at IS NOT NULL AND d.updated_at > p.closed_at$q$],
    ['A05 decisions CHANGED after the round was declared to members', $q$SELECT count(*) FROM public.judge_decisions d JOIN public.competition_entries e ON e.id = d.entry_id JOIN public.competition_round_publish p ON p.competition_id = e.competition_id AND p.round_number = d.round_number WHERE p.published_at IS NOT NULL AND d.updated_at > p.published_at$q$],
    ['A06 rounds DECLARED while the round before is not declared', $q$SELECT count(*) FROM public.competition_round_publish p WHERE p.published_at IS NOT NULL AND p.round_number > 1 AND NOT EXISTS (SELECT 1 FROM public.competition_round_publish q WHERE q.competition_id = p.competition_id AND q.round_number = p.round_number - 1 AND q.published_at IS NOT NULL)$q$],
    ['A07 entries tagged Winner in Round 4 whose placement is NOT winner (finished competitions)', $q$SELECT count(DISTINCT e.id) FROM public.judge_tag_assignments a JOIN public.judging_tags t ON t.id = a.tag_id JOIN public.competition_entries e ON e.id = a.entry_id JOIN public.competitions c ON c.id = e.competition_id WHERE a.round_number = 4 AND lower(t.label) = 'winner' AND c.phase = 'result' AND e.placement IS DISTINCT FROM 'winner'$q$],
    ['A08 members holding the judge role', $q$SELECT count(DISTINCT user_id) FROM public.user_roles WHERE role::text = 'judge'$q$],
    ['A09 judges assigned to at least one competition', $q$SELECT count(DISTINCT judge_id) FROM public.competition_judges$q$],
    ['A10 scores saved by a judge for a photo they gave NO decision on', $q$SELECT count(*) FROM public.judge_scores s WHERE NOT EXISTS (SELECT 1 FROM public.judge_decisions d WHERE d.entry_id = s.entry_id AND d.judge_id = s.judge_id AND d.round_number = s.round_number AND d.photo_index = s.photo_index)$q$],
    ['W01 unvote penalties charged with NO vote behind them', $q$SELECT count(*) FROM public.wallet_transactions WHERE type = 'unvote_penalty' AND reference_type = 'competition_entry'$q$],
    ['W02 the SAME vote penalised more than once for one member', $q$SELECT count(*) FROM (SELECT user_id, reference_id FROM public.wallet_transactions WHERE type = 'unvote_penalty' GROUP BY 1,2 HAVING count(*) > 1) x$q$],
    ['W03 unvote penalties in total', $q$SELECT count(*) FROM public.wallet_transactions WHERE type = 'unvote_penalty'$q$],
    ['W04 vote rewards in total', $q$SELECT count(*) FROM public.wallet_transactions WHERE type = 'vote_reward'$q$],
    ['W05 votes cast BEFORE the competition stopped taking entries', $q$SELECT count(*) FROM public.competition_votes v JOIN public.competition_entries e ON e.id = v.entry_id JOIN public.competitions c ON c.id = e.competition_id WHERE c.ends_at IS NOT NULL AND v.created_at < c.ends_at$q$]
  ];
  i int;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;

  -- ── 1. the live rule set ─────────────────────────────────────────────────
  FOR r IN SELECT stage_key, round_number, family, decision_token, tag_label_canonical, advances_to_round, blocks_from_round, cert_eligible, is_active
             FROM public.v3_stage_catalog ORDER BY round_number, stage_key LOOP
    RAISE NOTICE 'CAT % r% % % "%" adv=% blocks=% cert=% active=%', r.stage_key, r.round_number, r.family, r.decision_token,
      r.tag_label_canonical, r.advances_to_round, r.blocks_from_round, r.cert_eligible, r.is_active;
  END LOOP;
  BEGIN
    FOR r IN EXECUTE $q$SELECT to_jsonb(t) j FROM public.judging_tags t WHERE coalesce((to_jsonb(t)->>'is_system')::boolean, false) ORDER BY 1$q$ LOOP
      RAISE NOTICE 'TAG %', left(r.j::text, 300);
    END LOOP;
  EXCEPTION WHEN others THEN RAISE NOTICE 'TAG read failed: %', SQLERRM; END;
  FOR r IN SELECT c.relname, t.tgname, p.proname, t.tgenabled, t.tgtype
             FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
            WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace
              AND c.relname IN ('competition_entries','judge_decisions','judge_scores','judge_tag_assignments','competition_votes','judging_rounds','competitions','certificates')
            ORDER BY 1, 2 LOOP
    RAISE NOTICE 'TRG %.% -> %() enabled=% type=%', r.relname, r.tgname, r.proname, r.tgenabled, r.tgtype;
  END LOOP;
  FOR r IN SELECT DISTINCT p.oid::regprocedure::text AS sig, p.oid
             FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND (p.oid IN (SELECT t.tgfoid FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                              WHERE NOT t.tgisinternal AND c.relname IN ('competition_entries','judge_decisions','judge_scores','judge_tag_assignments','competition_votes','judging_rounds'))
                   OR p.proname IN ('compute_entry_rank_score','get_per_photo_placement','get_round_eligible_photos','acquire_judge_lock',
                                    'cast_photo_vote','v3_record_decision','record_judge_decision','complete_round','publish_round','get_public_final_votes',
                                    'judging_write_decision_atomic','progression_order','admin_rewind_stage','current_phase',
                                    'get_round_pending_entries','wallet_transaction','get_needs_review_recipients_for_round'))
            ORDER BY 1 LOOP
    RAISE NOTICE 'BODY %: %', r.sig, pg_get_functiondef(r.oid);
  END LOOP;
  -- switches and settings the rules depend on (settings, never a member's data)
  BEGIN
    FOR r IN SELECT key, value FROM public.system_flags ORDER BY 1 LOOP
      RAISE NOTICE 'FLAG % = %', r.key, r.value;
    END LOOP;
    FOR r IN SELECT key, value FROM public.site_settings WHERE key = 'vote_reward_config' LOOP
      RAISE NOTICE 'SETTING % = %', r.key, left(r.value::text, 300);
    END LOOP;
    FOR r IN SELECT round_number, threshold, min_judges, count(*) n FROM public.judging_config GROUP BY 1, 2, 3 ORDER BY 1 LOOP
      RAISE NOTICE 'JCONFIG r% threshold=% min_judges=% n=%', r.round_number, r.threshold, r.min_judges, r.n;
    END LOOP;
    RAISE NOTICE 'VIEW entry_final_votes: %', pg_get_viewdef('public.entry_final_votes'::regclass, true);
  EXCEPTION WHEN others THEN RAISE NOTICE 'settings read failed: %', SQLERRM; END;

  -- ── 2. rows that break a rule (counts only) ──────────────────────────────
  FOR i IN 1 .. array_length(checks, 1) LOOP
    BEGIN
      EXECUTE checks[i][2] INTO n;
      RAISE NOTICE 'CHECK % = %', checks[i][1], n;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'CHECK % = could not run: %', checks[i][1], SQLERRM;
    END;
  END LOOP;
  FOR r IN SELECT coalesce(status, '-') s, coalesce(phase, '-') ph, count(*) n FROM public.competitions GROUP BY 1, 2 ORDER BY 3 DESC LOOP
    RAISE NOTICE 'COMP status=% phase=% n=%', r.s, r.ph, r.n;
  END LOOP;
  FOR r IN SELECT round_number, decision, count(*) n FROM public.judge_decisions GROUP BY 1, 2 ORDER BY 1, 2 LOOP
    RAISE NOTICE 'DEC r% % n=%', r.round_number, r.decision, r.n;
  END LOOP;

  RAISE NOTICE 'JA0700 INSPECT DONE (lane %)', current_setting('p32.lane');
END
$p$;

ROLLBACK;
