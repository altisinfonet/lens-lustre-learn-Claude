-- ── P32 0034/0035 fixture · scratch PostgreSQL 17 only. ──────────────────
-- 52 stub functions carrying the EXACT identity signatures measured on
-- staging 2026-09-25 (md5 fb5307b3f330bda424d86d333fd5cab3 over the sorted
-- list, verified on both sides), each SECURITY DEFINER + VOLATILE, each
-- ending with the measured staging ACL:
--   {=X/postgres,postgres=X/postgres,anon=X/postgres,
--    authenticated=X/postgres,service_role=X/postgres}
-- Bodies are stubs: this is a grant change, and a body that did real work
-- would let a check pass or fail for a reason unrelated to the grant.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

-- who = the CALLER (the `role` GUC). current_user is NOT used: inside a
-- SECURITY DEFINER function it is the OWNER, which is the property under test.
CREATE TABLE public.p32_probe (id serial primary key, who text, ran_as text, fn text);
REVOKE ALL ON TABLE public.p32_probe FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public._ensure_stats_row(uid uuid)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, '_ensure_stats_row'); RETURN true; END $f$;
CREATE FUNCTION public._gen_competition_order_no()
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, '_gen_competition_order_no'); RETURN true; END $f$;
CREATE FUNCTION public.apply_decision_to_remaining(_competition_id uuid, _round_number integer, _decision text)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'apply_decision_to_remaining'); RETURN true; END $f$;
CREATE FUNCTION public.delete_email(queue_name text, message_id bigint)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'delete_email'); RETURN true; END $f$;
CREATE FUNCTION public.emit_birthday_notifications()
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'emit_birthday_notifications'); RETURN true; END $f$;
CREATE FUNCTION public.enqueue_post_job(_payload jsonb)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'enqueue_post_job'); RETURN true; END $f$;
CREATE FUNCTION public.expiring_post_drafts()
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'expiring_post_drafts'); RETURN true; END $f$;
CREATE FUNCTION public.get_derived_status_drift_admin()
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'get_derived_status_drift_admin'); RETURN true; END $f$;
CREATE FUNCTION public.judge_apply_single_tag(_entry_id uuid, _photo_index integer, _round_number integer, _tag_id uuid, _judge_id uuid)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'judge_apply_single_tag'); RETURN true; END $f$;
CREATE FUNCTION public.judging_write_decision_atomic(p_entry_id uuid, p_stage_key text, p_current_round text)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'judging_write_decision_atomic'); RETURN true; END $f$;
CREATE FUNCTION public.log_push_outcome(_user_id uuid, _notification_id uuid, _type text, _outcome text, _detail text)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'log_push_outcome'); RETURN true; END $f$;
CREATE FUNCTION public.pj_handle_comment_notification(_msg jsonb)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'pj_handle_comment_notification'); RETURN true; END $f$;
CREATE FUNCTION public.pj_handle_reaction_notification(_msg jsonb)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'pj_handle_reaction_notification'); RETURN true; END $f$;
CREATE FUNCTION public.pj_handle_recount_engagement(_msg jsonb)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'pj_handle_recount_engagement'); RETURN true; END $f$;
CREATE FUNCTION public.pj_handle_tag_notification(_msg jsonb)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'pj_handle_tag_notification'); RETURN true; END $f$;
CREATE FUNCTION public.process_post_jobs(_batch integer)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'process_post_jobs'); RETURN true; END $f$;
CREATE FUNCTION public.prune_activity_minutes(_dry_run boolean)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'prune_activity_minutes'); RETURN true; END $f$;
CREATE FUNCTION public.prune_client_errors(_days integer)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'prune_client_errors'); RETURN true; END $f$;
CREATE FUNCTION public.prune_old_notifications(_days integer, _max_rows integer)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'prune_old_notifications'); RETURN true; END $f$;
CREATE FUNCTION public.reap_post_drafts(_ids uuid[])
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'reap_post_drafts'); RETURN true; END $f$;
CREATE FUNCTION public.recompute_entry_from_tag_assignments(p_entry_id uuid)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'recompute_entry_from_tag_assignments'); RETURN true; END $f$;
CREATE FUNCTION public.recompute_entry_public_status(p_entry_id uuid)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'recompute_entry_public_status'); RETURN true; END $f$;
CREATE FUNCTION public.recount_hashtags(tag_ids uuid[])
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'recount_hashtags'); RETURN true; END $f$;
CREATE FUNCTION public.refresh_viewer_buckets()
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'refresh_viewer_buckets'); RETURN true; END $f$;
CREATE FUNCTION public.rollup_engagement_daily(_utc_date date)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'rollup_engagement_daily'); RETURN true; END $f$;
CREATE FUNCTION public.set_write_path(p text)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'set_write_path'); RETURN true; END $f$;
CREATE FUNCTION public.wallet_ledger_v2_diff_snapshot(p_window interval)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'wallet_ledger_v2_diff_snapshot'); RETURN true; END $f$;
CREATE FUNCTION public.acquire_judge_lock(_entry_id uuid, _photo_index integer, _judge_id uuid, _ttl_minutes integer)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'acquire_judge_lock'); RETURN true; END $f$;
CREATE FUNCTION public.admin_flag_entry_for_review(_entry_id uuid)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'admin_flag_entry_for_review'); RETURN true; END $f$;
CREATE FUNCTION public.admin_rewind_stage(_entry_id uuid, _to_stage_key text, _reason text)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'admin_rewind_stage'); RETURN true; END $f$;
CREATE FUNCTION public.admin_set_photo_rejected(_entry_id uuid, _photo_index integer, _rejected boolean, _reason text)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'admin_set_photo_rejected'); RETURN true; END $f$;
CREATE FUNCTION public.backfill_judging_notifications(_window_days integer, _dry_run boolean)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'backfill_judging_notifications'); RETURN true; END $f$;
CREATE FUNCTION public.backfill_tag_decision_drift_admin()
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'backfill_tag_decision_drift_admin'); RETURN true; END $f$;
CREATE FUNCTION public.create_system_post(_content text, _image_url text, _image_urls text[], _thumbnail_urls text[], _media_ids uuid[])
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'create_system_post'); RETURN true; END $f$;
CREATE FUNCTION public.enroll_in_course(_user_id uuid, _course_id uuid)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'enroll_in_course'); RETURN true; END $f$;
CREATE FUNCTION public.fix_certificate_readiness_admin(_entry_id uuid)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'fix_certificate_readiness_admin'); RETURN true; END $f$;
CREATE FUNCTION public.fix_gift_drift_admin(_announcement_id uuid)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'fix_gift_drift_admin'); RETURN true; END $f$;
CREATE FUNCTION public.fix_referral_drift_admin(_referral_id uuid)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'fix_referral_drift_admin'); RETURN true; END $f$;
CREATE FUNCTION public.get_broadcast_feed(_exclude_ids uuid[], _limit integer)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'get_broadcast_feed'); RETURN true; END $f$;
CREATE FUNCTION public.get_broadcast_feed(_exclude_ids uuid[], _limit integer, _newest_first integer)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'get_broadcast_feed'); RETURN true; END $f$;
CREATE FUNCTION public.get_broadcast_feed(_exclude_ids uuid[], _limit integer, _newest_first integer, _categories text[])
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'get_broadcast_feed'); RETURN true; END $f$;
CREATE FUNCTION public.get_certificate_drift_admin(p_competition_id uuid)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'get_certificate_drift_admin'); RETURN true; END $f$;
CREATE FUNCTION public.get_judge_collusion_admin(p_competition_id uuid, p_min_overlap integer, p_min_correlation numeric)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'get_judge_collusion_admin'); RETURN true; END $f$;
CREATE FUNCTION public.get_judging_tag_assignment_counts()
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'get_judging_tag_assignment_counts'); RETURN true; END $f$;
CREATE FUNCTION public.heartbeat_judge_lock(_entry_id uuid, _photo_index integer, _judge_id uuid, _ttl_minutes integer)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'heartbeat_judge_lock'); RETURN true; END $f$;
CREATE FUNCTION public.issue_course_completion_certificate(_course_id uuid)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'issue_course_completion_certificate'); RETURN true; END $f$;
CREATE FUNCTION public.mark_expiring_post_drafts(_days integer)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'mark_expiring_post_drafts'); RETURN true; END $f$;
CREATE FUNCTION public.record_activity_minute(_segment text, _interacted boolean)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'record_activity_minute'); RETURN true; END $f$;
CREATE FUNCTION public.register_push_token(_token text, _platform text)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'register_push_token'); RETURN true; END $f$;
CREATE FUNCTION public.release_judge_lock(_entry_id uuid, _photo_index integer, _judge_id uuid)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'release_judge_lock'); RETURN true; END $f$;
CREATE FUNCTION public.submit_competition_entry(_competition_id uuid, _title text, _description text, _photos text[], _photo_thumbnails text[], _photo_meta jsonb, _is_ai_generated boolean, _exif_data jsonb)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'submit_competition_entry'); RETURN true; END $f$;
CREATE FUNCTION public.unregister_push_token(_token text)
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $f$ BEGIN INSERT INTO public.p32_probe(who, ran_as, fn)
    VALUES (coalesce(current_setting('role', true),'(unset)'), current_user, 'unregister_push_token'); RETURN true; END $f$;

-- The measured staging ACL, granted AS postgres so every grantor is postgres.
-- CREATE FUNCTION already leaves EXECUTE to PUBLIC by the built-in default
-- (F-65); naming the three roles materialises the rest.
DO $g$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS ia
           FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND p.prosecdef
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO PUBLIC, anon, authenticated, service_role', r.proname, r.ia);
  END LOOP;
END $g$;

-- ── ROW 7 · the DEFINER-wrapper smoke test fixture. ──────────────────────
-- Owned by postgres, SECURITY DEFINER, calls a 0034 function. It stands in
-- for every trigger function and every cron-invoked DEFINER caller: after
-- `authenticated` loses EXECUTE on the callee, this must still succeed when
-- the session is SET ROLE authenticated.
CREATE FUNCTION public.definer_wrapper_smoke()
  RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path TO 'public'
  AS $w$ BEGIN RETURN public.recompute_entry_public_status('00000000-0000-0000-0000-000000000001'::uuid); END $w$;
GRANT EXECUTE ON FUNCTION public.definer_wrapper_smoke() TO anon, authenticated, service_role;

-- An INVOKER wrapper, for the contrast that makes the smoke test meaningful:
-- it runs as the session user, so it must FAIL for authenticated after 0034.
CREATE FUNCTION public.invoker_wrapper_smoke()
  RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER VOLATILE SET search_path TO 'public'
  AS $w$ BEGIN RETURN public.recompute_entry_public_status('00000000-0000-0000-0000-000000000001'::uuid); END $w$;
GRANT EXECUTE ON FUNCTION public.invoker_wrapper_smoke() TO anon, authenticated, service_role;
