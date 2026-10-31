-- ═══════════════════════════════════════════════════════════════════════════
-- 20261104_0150 · NOTIFICATION CENTRE N1 — capture the live-only notification
-- functions into git. NO BEHAVIOUR CHANGE, and the file proves it.
--
-- N0 (PROBE 0100: staging run 41202968098, production run 41206791083) found
-- 12 notification functions whose LIVE source matches no applied migration —
-- only the commented-out bootstrap snapshot
-- supabase/migrations/UNAPPLIED_20260911101721_new_project_full_schema_bootstrap.sql,
-- byte-for-byte, and identical on both lanes. Below is that exact text for 10
-- of them, so a rebuild from git reproduces what runs today.
--
-- NOT captured: notify_round_published() and notify_round_published_insert().
-- Their live text lacks the canonical 'stageKey' in its e-mail payloads, which
-- git's own Phase 7 lock (src/test/notifications-stage-key-payload.spec.ts)
-- requires and git's latest version (20260502090928) has. Capturing live
-- would erase the intended code from git; applying git's version would change
-- what members receive. Recorded as a gap for the judging work (Owner:
-- "judging — later"); neither is touched here.
--
-- GRANTS are written out explicitly (repo rule m2FunctionCallersExplicit) and
-- reproduce exactly the live ACL read by PROBE 0100 on both lanes; the POST
-- check rolls everything back if any grant would differ.
--
-- HOW IT PROVES "NO CHANGE":
--   PRE   refuses unless every one of the 12 exists with exactly the pinned md5
--         of its live source (a newer live body is never overwritten);
--   SNAP  records every attribute of each function (definer, search_path,
--         volatility, strictness, leakproof, parallel, return type, argument
--         types and defaults, owner, grants, language, kind, planner cost and
--         rows, support function, SQL body, transforms) — a re-create without
--         a COST/ROWS clause resets those, so a live value off the default
--         makes the file roll back instead of silently changing it;
--   then  CREATE OR REPLACE with the identical text;
--   POST  refuses (and so rolls everything back) unless each source md5 and
--         every recorded attribute is unchanged, and the oid is the same;
--   TAG   COMMENT ON FUNCTION '… captured in git by 20261104_0150' — metadata
--         only, so the PROBE can tell before from after.
--
-- Rollback: supabase/rollback/20261104_0150_notification_capture_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261104_0150_notification_capture.sql
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane reads %. Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

CREATE TEMP TABLE n1_pin (sig text PRIMARY KEY, md5 text NOT NULL) ON COMMIT DROP;
INSERT INTO n1_pin VALUES
    ('public.emit_birthday_notifications()', 'e461c2744c0a6fd0ddd9d1fc6d9c7cc1'),
    ('public.emit_notification(text, uuid, integer, uuid, text, text, text, uuid, text, jsonb, text)', '560500fe41927f2270f19dcafafa2c75'),
    ('public.get_my_notifications_grouped(integer, timestamp with time zone)', '17e4a1a0f4424c69a3bfb3795b10e54f'),
    ('public.notify_entry_status_change()', '65021751cdfee21aa4edcf3fce670c5c'),
    ('public.notify_post_comment()', '26c9714d41a7027000364adffde5056e'),
    ('public.notify_post_reaction()', '4b865596e3973a814d0195fb7df2bc6b'),
    ('public.notify_post_tag()', '98231c0af09df073da2f245624226d22'),
    ('public.pj_handle_tag_notification(jsonb)', 'f9f9869c7690b79d414003d6d2d2658d'),
    ('public.prune_old_notifications(integer, integer)', '345ac2e51915b7bd6aeeaa55dee986a6'),
    ('public.send_notification_email()', '2e40fd53c30694881937bd0eb0e4e2fa');

DO $pre$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.sig, p.md5, to_regprocedure(p.sig) AS oid FROM n1_pin p LOOP
    IF r.oid IS NULL THEN
      RAISE EXCEPTION 'NC-0150-PRE-001: % does not exist on this lane', r.sig;
    END IF;
    IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = r.oid) <> r.md5 THEN
      RAISE EXCEPTION 'NC-0150-PRE-002: live source of % is not the pinned version (md5 %) — refusing to overwrite it', r.sig, r.md5;
    END IF;
    IF coalesce(obj_description(r.oid, 'pg_proc'), '') LIKE '%captured in git by 20261104_0150%' THEN
      RAISE EXCEPTION 'NC-0150-PRE-003: % is already tagged — 20261104_0150 was applied on this lane', r.sig;
    END IF;
  END LOOP;
END
$pre$;

CREATE TEMP TABLE n1_before ON COMMIT DROP AS
SELECT p.oid, n.sig,
       md5(concat_ws('|', p.prosecdef, coalesce(array_to_string(p.proconfig, ','), ''), p.provolatile, p.proisstrict,
                     p.proleakproof, p.proparallel, p.prorettype::regtype::text, p.proretset, oidvectortypes(p.proargtypes),
                     coalesce(pg_get_expr(p.proargdefaults, 0), ''), pg_get_userbyid(p.proowner),
                     coalesce(p.proacl::text, ''), p.prolang, p.prokind, coalesce(array_to_string(p.proallargtypes::regtype[], ','), ''),
                     coalesce(array_to_string(p.proargmodes, ','), ''), coalesce(array_to_string(p.proargnames, ','), ''),
                     p.procost, p.prorows, p.prosupport::text, coalesce(p.prosqlbody::text, ''),
                     coalesce(array_to_string(p.protrftypes, ','), ''))) AS attrs
  FROM n1_pin n JOIN pg_proc p ON p.oid = to_regprocedure(n.sig);

-- ── the captured text, verbatim from the live functions (via the snapshot) ──
CREATE OR REPLACE FUNCTION public.emit_birthday_notifications()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _inserted integer;
BEGIN
  WITH celebrants AS (
    SELECT p.id, public.notif_display_name(p.id) AS display_name
    FROM public.profiles p
    WHERE p.is_suspended = false
      AND p.date_of_birth IS NOT NULL
      AND to_char(p.date_of_birth, 'MM-DD') = to_char(now(), 'MM-DD')
      AND COALESCE(NULLIF(p.privacy_settings->>'dob_day_month', ''), 'friends') <> 'only_me'
  ),
  recipients AS (
    SELECT c.id AS actor_id, c.display_name,
           CASE WHEN f.requester_id = c.id THEN f.addressee_id ELSE f.requester_id END AS user_id
    FROM celebrants c
    JOIN public.friendships f
      ON f.status = 'accepted' AND (f.requester_id = c.id OR f.addressee_id = c.id)
  )
  INSERT INTO public.user_notifications
    (user_id, type, title, message, reference_id, actor_id, dedup_key, email_sent)
  SELECT r.user_id, 'birthday', 'Birthday',
         '🎉 Today is ' || r.display_name || '''s Birthday',
         r.actor_id, r.actor_id,
         'birthday:' || r.actor_id::text || ':' || to_char(now(), 'YYYY-MM-DD') || ':' || r.user_id::text,
         true
  FROM recipients r
  JOIN public.profiles rp ON rp.id = r.user_id AND rp.is_suspended = false
  WHERE r.user_id <> r.actor_id
  ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS _inserted = ROW_COUNT;
  RETURN _inserted;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.emit_notification(_kind text, _entity_id uuid, _round_number integer, _recipient_user_id uuid, _in_app_type text, _in_app_title text, _in_app_message text, _in_app_reference_id uuid, _email_template text, _email_data jsonb DEFAULT '{}'::jsonb, _action_url text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _existing_log_id uuid;
  _user_email text;
  _user_name text;
  _notif_id uuid;
  _msg_id text;
  _site_url text := 'https://50mmretina.com';
  _final_action_url text;
  _unsub text;
BEGIN
  -- Idempotency check
  SELECT id INTO _existing_log_id
  FROM public.notification_emit_log
  WHERE kind = _kind
    AND entity_id = _entity_id
    AND COALESCE(round_number, -1) = COALESCE(_round_number, -1)
    AND COALESCE(recipient_user_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(_recipient_user_id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF _existing_log_id IS NOT NULL THEN
    RETURN _existing_log_id; -- already emitted; do nothing
  END IF;

  -- Lookup recipient email + name (only if user-targeted)
  IF _recipient_user_id IS NOT NULL THEN
    SELECT email INTO _user_email FROM auth.users WHERE id = _recipient_user_id;
    SELECT COALESCE(full_name, 'there') INTO _user_name FROM public.profiles WHERE id = _recipient_user_id;
  END IF;

  _final_action_url := COALESCE(_action_url, _site_url || '/dashboard');

  -- 1) In-app notification (mark email_sent=true so the generic trigger does NOT also fire)
  IF _recipient_user_id IS NOT NULL THEN
    INSERT INTO public.user_notifications (user_id, type, title, message, reference_id, email_sent)
    VALUES (_recipient_user_id, _in_app_type, _in_app_title, _in_app_message, _in_app_reference_id, true)
    RETURNING id INTO _notif_id;
  END IF;

  -- 2) Enqueue email — but ONLY if the recipient hasn't opted out of this type
  --    and isn't on the suppression list. Attach an unsubscribe token.
  IF _user_email IS NOT NULL AND _email_template IS NOT NULL
     AND public.get_notification_email_enabled(_recipient_user_id, _in_app_type)
     AND NOT EXISTS (SELECT 1 FROM public.suppressed_emails WHERE email = lower(_user_email)) THEN

    -- unsubscribe token (reuse an unused one, else mint)
    SELECT token INTO _unsub FROM public.email_unsubscribe_tokens WHERE email = lower(_user_email) AND used_at IS NULL LIMIT 1;
    IF _unsub IS NULL THEN
      _unsub := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
      INSERT INTO public.email_unsubscribe_tokens (token, email) VALUES (_unsub, lower(_user_email)) ON CONFLICT (email) DO NOTHING;
      SELECT token INTO _unsub FROM public.email_unsubscribe_tokens WHERE email = lower(_user_email) AND used_at IS NULL LIMIT 1;
    END IF;

    _msg_id := _kind || '-' || _entity_id::text || '-' || COALESCE(_round_number::text, 'na') || '-' || COALESCE(_recipient_user_id::text, 'na');

    PERFORM public.enqueue_email('transactional_emails', jsonb_build_object(
      'message_id', _msg_id,
      'to', _user_email,
      'from', '50mm Retina World <no-reply@50mmretina.com>',
      'sender_domain', '50mmretina.com',
      'subject', _in_app_title || ' — 50mm Retina World',
      'purpose', 'transactional',
      'label', _email_template,
      'idempotency_key', _msg_id,
      'template_name', _email_template,
      'unsubscribe_token', _unsub,
      'template_data', _email_data || jsonb_build_object(
        'userName', _user_name,
        'participantName', _user_name,
        'actionUrl', _final_action_url,
        'entryUrl', _final_action_url,
        'unsubscribeUrl', _site_url || '/unsubscribe?token=' || _unsub
      ),
      'queued_at', now()::text
    ));
  END IF;

  -- 3) Forensic log
  INSERT INTO public.notification_emit_log (
    kind, entity_id, round_number, recipient_user_id, recipient_email,
    email_template, in_app_notification_id, email_message_id, payload
  ) VALUES (
    _kind, _entity_id, _round_number, _recipient_user_id, _user_email,
    _email_template, _notif_id, _msg_id, _email_data
  ) RETURNING id INTO _existing_log_id;

  RETURN _existing_log_id;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'emit_notification failed: kind=% entity=% err=%', _kind, _entity_id, SQLERRM;
  RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_notifications_grouped(_limit integer DEFAULT 30, _before timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(group_key text, type text, notification_ids uuid[], actor_ids uuid[], actor_names text[], actor_usernames text[], actor_avatars text[], actor_count integer, event_count integer, unread_count integer, reference_id uuid, thumbnail_url text, title text, message text, latest_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH mine AS (
  SELECT n.id, n.type, n.title, n.message, n.reference_id, n.actor_id,
         n.is_read, n.created_at,
         public.notif_group_key(n.type, n.created_at, n.id) AS gkey
    FROM public.user_notifications n
   WHERE auth.uid() IS NOT NULL
     AND n.user_id = auth.uid()
     AND (_before IS NULL OR n.created_at < _before)
),
actors AS (
  SELECT m.gkey, m.actor_id, max(m.created_at) AS last_at
    FROM mine m WHERE m.actor_id IS NOT NULL GROUP BY m.gkey, m.actor_id
),
actors_ranked AS (
  SELECT a.gkey, a.actor_id,
         row_number() OVER (PARTITION BY a.gkey ORDER BY a.last_at DESC, a.actor_id) AS rn,
         p.full_name, p.custom_url, p.avatar_url
    FROM actors a LEFT JOIN public.profiles p ON p.id = a.actor_id
),
actors_top AS (
  SELECT ar.gkey,
         array_agg(ar.actor_id ORDER BY ar.rn) AS actor_ids,
         array_agg(coalesce(ar.full_name,'') ORDER BY ar.rn) AS actor_names,
         array_agg(coalesce(ar.custom_url,'') ORDER BY ar.rn) AS actor_usernames,
         array_agg(coalesce(ar.avatar_url,'') ORDER BY ar.rn) AS actor_avatars
    FROM actors_ranked ar WHERE ar.rn <= 3 GROUP BY ar.gkey
),
grouped AS (
  SELECT m.gkey, min(m.type) AS type, max(m.created_at) AS latest_at,
         count(*)::int AS event_count,
         count(*) FILTER (WHERE NOT m.is_read)::int AS unread_count,
         count(DISTINCT m.actor_id)::int AS actor_count,
         (array_agg(m.id ORDER BY m.created_at DESC))[1:100] AS notification_ids
    FROM mine m GROUP BY m.gkey
),
latest AS (
  SELECT DISTINCT ON (m.gkey) m.gkey, m.title, m.message, m.reference_id
    FROM mine m ORDER BY m.gkey, m.created_at DESC, m.id
)
SELECT g.gkey AS group_key, g.type, g.notification_ids,
       coalesce(t.actor_ids,'{}'::uuid[]) AS actor_ids,
       coalesce(t.actor_names,'{}'::text[]) AS actor_names,
       coalesce(t.actor_usernames,'{}'::text[]) AS actor_usernames,
       coalesce(t.actor_avatars,'{}'::text[]) AS actor_avatars,
       g.actor_count, g.event_count, g.unread_count, l.reference_id,
       CASE WHEN p.id IS NOT NULL AND (p.privacy = 'public' OR p.user_id = auth.uid())
            THEN p.image_url END AS thumbnail_url,
       l.title, l.message, g.latest_at
  FROM grouped g
  JOIN latest l ON l.gkey = g.gkey
  LEFT JOIN actors_top t ON t.gkey = g.gkey
  LEFT JOIN public.posts p ON p.id = l.reference_id
 ORDER BY g.latest_at DESC
 LIMIT greatest(1, least(coalesce(_limit, 30), 100));
$function$
;

CREATE OR REPLACE FUNCTION public.notify_entry_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _comp_title text;
  _comp_slug text;
  _round_num integer;
  _action_url text;
  _site_url text := 'https://50mmretina.com';
  _stage_key text;
  -- computed notification payload for this status change
  _kind text;
  _itype text;
  _title text;
  _msg text;
  _tmpl text;
  _data jsonb;
  _is_result boolean := true;   -- result-type outcomes are declaration-gated
  _published boolean;
  _decision_round integer;
  _decision_token text;
  _hold_round integer;
BEGIN
  -- SAFE-MICRO suppression guard (2026-05-08): only judging_write_decision_atomic sets this.
  IF current_setting('app.write_path', true) = 'judging_write_decision_atomic' THEN
    RETURN NEW;
  END IF;

  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT title, slug INTO _comp_title, _comp_slug FROM public.competitions WHERE id = NEW.competition_id;
  _round_num := NULLIF(regexp_replace(COALESCE(NEW.current_round, ''), '\D', '', 'g'), '')::integer;
  _action_url := _site_url || '/dashboard?entry=' || NEW.id::text;
  _stage_key := public._resolve_stage_key_from_entry(NEW.status, NEW.current_round, NEW.progression_decision);
  -- BUG-109/113: the round a result BELONGS TO (and is released at) is the
  -- decision's source round from the catalog, NOT current_round (which for an
  -- advancer already points at the destination round N+1).
  SELECT round_number, decision_token INTO _decision_round, _decision_token
    FROM public.v3_stage_catalog WHERE stage_key = _stage_key;
  _hold_round := COALESCE(_decision_round, _round_num);

  IF NEW.status ILIKE '%shortlist%' THEN
    _kind := 'entry_shortlisted'; _itype := 'entry_shortlisted'; _tmpl := 'entry-shortlisted';
    _title := 'Your entry was shortlisted';
    _msg := 'Your entry in "' || COALESCE(_comp_title, 'the competition') || '" has been shortlisted.';
    _data := jsonb_build_object('entryTitle', NEW.title, 'competitionTitle', _comp_title, 'roundNumber', _round_num, 'stageKey', _stage_key);
  ELSIF NEW.status ILIKE 'round%qualified' OR NEW.status = 'qualified' THEN
    _kind := 'entry_qualified_round'; _itype := 'entry_qualified'; _tmpl := 'entry-qualified-round';
    IF _decision_token = 'accept' THEN
      -- PHASE-2 terminal: "Accepted in Round N" (journey ends at this round)
      _title := 'Accepted in Round ' || COALESCE(_decision_round, _round_num);
      _msg := 'Your entry in "' || COALESCE(_comp_title, 'the competition') || '" was accepted in Round ' || COALESCE(_decision_round, _round_num) || '.';
      _data := jsonb_build_object('entryTitle', NEW.title, 'competitionTitle', _comp_title, 'roundNumber', COALESCE(_decision_round, _round_num), 'stageKey', _stage_key, 'terminal', true);
    ELSE
      -- advancing: qualified FOR the next round (source round + 1)
      _title := 'You advanced to the next round';
      _msg := 'Your entry in "' || COALESCE(_comp_title, 'the competition') || '" qualified for Round ' || COALESCE(_decision_round + 1, _round_num, 2) || '.';
      _data := jsonb_build_object('entryTitle', NEW.title, 'competitionTitle', _comp_title, 'roundNumber', COALESCE(_decision_round, _round_num), 'nextRound', COALESCE(_decision_round, 1) + 1, 'stageKey', _stage_key);
    END IF;
  ELSIF NEW.status = 'rejected' THEN
    _kind := 'entry_rejected'; _itype := 'entry_rejected'; _tmpl := 'entry-rejected';
    _title := 'Update on your entry';
    _msg := 'Your entry in "' || COALESCE(_comp_title, 'the competition') || '" did not advance.';
    _data := jsonb_build_object('entryTitle', NEW.title, 'competitionTitle', _comp_title, 'roundNumber', _round_num, 'stageKey', _stage_key);
  ELSIF NEW.status = 'finalist' THEN
    _kind := 'entry_finalist'; _itype := 'entry_finalist'; _tmpl := 'entry-finalist';
    _title := 'You are a finalist!';
    _msg := 'Your entry in "' || COALESCE(_comp_title, 'the competition') || '" is a finalist.';
    _data := jsonb_build_object('entryTitle', NEW.title, 'competitionTitle', _comp_title, 'stageKey', _stage_key);
  ELSIF NEW.status IN ('winner','runner_up','runner_up_1','runner_up_2','honorable_mention','honourable_mention','honorary_mention','special_jury','top_50','top_100') THEN
    _kind := 'entry_award'; _itype := 'competition_winner'; _tmpl := 'entry-winner';
    _title := 'Congratulations on your award!';
    _msg := 'Your entry in "' || COALESCE(_comp_title, 'the competition') || '" received: ' || NEW.status || '.';
    _data := jsonb_build_object('entryTitle', NEW.title, 'competitionTitle', _comp_title, 'placement', NEW.status, 'stageKey', _stage_key);
  ELSIF NEW.status = 'approved' THEN
    -- Entry moderation (pre-judging), NOT a round result → notify immediately.
    _kind := 'entry_approved'; _itype := 'entry_approved'; _tmpl := 'entry-shortlisted';
    _title := 'Entry Approved';
    _msg := 'Your entry in "' || COALESCE(_comp_title, 'the competition') || '" has been approved.';
    _data := jsonb_build_object('entryTitle', NEW.title, 'competitionTitle', _comp_title, 'stageKey', _stage_key);
    _is_result := false;
  END IF;

  IF _kind IS NULL THEN
    RETURN NEW;  -- status change we don't notify on
  END IF;

  IF NOT _is_result THEN
    -- immediate (approved / moderation)
    PERFORM public.emit_notification(
      _kind, NEW.id, _round_num, NEW.user_id, _itype, _title, _msg,
      NEW.competition_id, _tmpl, _data, _action_url);
    RETURN NEW;
  END IF;

  -- Result-type: is this entry's round already declared?
  _published := (_hold_round IS NOT NULL) AND EXISTS (
    SELECT 1 FROM public.competition_round_publish crp
    WHERE crp.competition_id = NEW.competition_id
      AND crp.round_number = _hold_round
      AND crp.published_at IS NOT NULL
  );

  IF _published THEN
    -- Round already public (e.g. a post-declaration correction) → emit now.
    PERFORM public.emit_notification(
      _kind, NEW.id, _hold_round, NEW.user_id, _itype, _title, _msg,
      NEW.competition_id, _tmpl, _data, _action_url);
  ELSIF _hold_round IS NOT NULL THEN
    -- Not declared yet → HOLD until publish. Latest pre-publish outcome wins.
    INSERT INTO public.held_result_notifications (
      competition_id, round_number, entity_id, recipient_user_id,
      kind, in_app_type, in_app_title, in_app_message, in_app_reference_id,
      email_template, email_data, action_url)
    VALUES (
      NEW.competition_id, _hold_round, NEW.id, NEW.user_id,
      _kind, _itype, _title, _msg, NEW.competition_id,
      _tmpl, _data, _action_url)
    ON CONFLICT (entity_id, round_number, recipient_user_id) DO UPDATE SET
      kind = EXCLUDED.kind,
      in_app_type = EXCLUDED.in_app_type,
      in_app_title = EXCLUDED.in_app_title,
      in_app_message = EXCLUDED.in_app_message,
      email_template = EXCLUDED.email_template,
      email_data = EXCLUDED.email_data,
      action_url = EXCLUDED.action_url,
      created_at = now();
  END IF;
  -- If _round_num IS NULL for a result status (should never happen in practice),
  -- we neither emit nor hold: fail closed, never leak.

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_post_comment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.enqueue_post_job(jsonb_build_object(
    'type',       'comment_notification',
    'comment_id', NEW.id,
    'post_id',    NEW.post_id,
    'actor_id',   NEW.user_id,
    'parent_id',  NEW.parent_id          -- null when not a reply
  ));
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_post_reaction()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.enqueue_post_job(jsonb_build_object(
    'type',        'reaction_notification',
    'reaction_id', NEW.id,
    'post_id',     NEW.post_id,
    'actor_id',    NEW.user_id
  ));
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_post_tag()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Phase 4: enqueue instead of inserting the notification synchronously.
  PERFORM public.enqueue_post_job(jsonb_build_object(
    'type',           'tag_notification',
    'tag_id',         NEW.id,
    'post_id',        NEW.post_id,
    'tagger_id',      NEW.tagger_id,
    'tagged_user_id', NEW.tagged_user_id
  ));
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.pj_handle_tag_notification(_msg jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tag_id         uuid := (_msg->>'tag_id')::uuid;
  _post_id        uuid := (_msg->>'post_id')::uuid;
  _tagger_id      uuid := (_msg->>'tagger_id')::uuid;
  _tagged_user_id uuid := (_msg->>'tagged_user_id')::uuid;
  _tagger_name    text;
BEGIN
  -- Skip if the tag no longer exists (removed/declined before we ran).
  IF NOT EXISTS (SELECT 1 FROM public.post_tags WHERE id = _tag_id) THEN
    RETURN;
  END IF;

  SELECT COALESCE(full_name, 'Someone') INTO _tagger_name
  FROM public.profiles WHERE id = _tagger_id;

  -- Same title/message as the original sync trigger (migration 20260418111925).
  INSERT INTO public.user_notifications
    (user_id, actor_id, type, title, message, reference_id, dedup_key)
  VALUES (
    _tagged_user_id,
    _tagger_id,
    'post_tag',
    'New Photo Tag',
    COALESCE(_tagger_name, 'Someone') || ' tagged you in a photo. Approve or decline?',
    _post_id,
    'post_tag:' || _tag_id::text
  )
  ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.prune_old_notifications(_days integer DEFAULT 90, _max_rows integer DEFAULT 5000)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _deleted int;
  _window int := greatest(coalesce(_days, 90), 30);
  _cap    int := greatest(least(coalesce(_max_rows, 5000), 50000), 1);
BEGIN
  WITH doomed AS (
    SELECT id FROM public.user_notifications
     WHERE is_read = true AND created_at < now() - make_interval(days => _window)
     ORDER BY created_at LIMIT _cap
  )
  DELETE FROM public.user_notifications n USING doomed d WHERE n.id = d.id;
  GET DIAGNOSTICS _deleted = ROW_COUNT;
  RAISE LOG 'prune_old_notifications: deleted % read notifications older than % days', _deleted, _window;
  RETURN _deleted;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.send_notification_email()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _user_email text;
  _user_name text;
  _site_url text := 'https://50mmretina.com';
  _action_url text;
  _unsubscribe_token text;
  _html text;
  _plain_text text;
  _subject text;
  _message_id text;
  _notification_type text;
  _notification_message text;
  _email_enabled boolean;
BEGIN
  -- Skip if a richer emit_notification path already enqueued the lifecycle email
  IF NEW.email_sent IS TRUE THEN
    RETURN NEW;
  END IF;

  _email_enabled := get_notification_email_enabled(NEW.user_id, NEW.type);
  IF NOT _email_enabled THEN RETURN NEW; END IF;

  SELECT email INTO _user_email FROM auth.users WHERE id = NEW.user_id;
  IF _user_email IS NULL THEN RETURN NEW; END IF;

  IF EXISTS (SELECT 1 FROM public.suppressed_emails WHERE email = lower(_user_email)) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(full_name, 'there') INTO _user_name FROM public.profiles WHERE id = NEW.user_id;

  _notification_type := COALESCE(NEW.title, 'Notification');
  _notification_message := COALESCE(NEW.message, 'You have a new update on your account.');
  _message_id := gen_random_uuid()::text;

  _action_url := CASE
    WHEN NEW.type IN ('post_reaction', 'post_comment') THEN _site_url || '/feed'
    WHEN NEW.type IN ('image_reaction', 'image_comment', 'comment_reply') THEN _site_url || '/discover'
    WHEN NEW.type IN ('competition_vote', 'entry_approved', 'entry_rejected', 'competition_winner') THEN
      CASE WHEN NEW.reference_id IS NOT NULL THEN _site_url || '/competitions/' || NEW.reference_id ELSE _site_url || '/competitions' END
    WHEN NEW.type = 'new_follower' THEN
      CASE WHEN NEW.reference_id IS NOT NULL THEN _site_url || '/profile/' || NEW.reference_id ELSE _site_url || '/friends' END
    WHEN NEW.type = 'ticket_reply' THEN _site_url || '/help-support'
    ELSE _site_url || '/dashboard'
  END;

  SELECT token INTO _unsubscribe_token FROM public.email_unsubscribe_tokens WHERE email = lower(_user_email) AND used_at IS NULL LIMIT 1;
  IF _unsubscribe_token IS NULL THEN
    _unsubscribe_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    INSERT INTO public.email_unsubscribe_tokens (token, email) VALUES (_unsubscribe_token, lower(_user_email)) ON CONFLICT (email) DO NOTHING;
    SELECT token INTO _unsubscribe_token FROM public.email_unsubscribe_tokens WHERE email = lower(_user_email) AND used_at IS NULL LIMIT 1;
  END IF;

  _subject := _notification_type || E' \u2014 50mm Retina World';
  _html := '<!DOCTYPE html><html lang="en" dir="ltr"><head><meta charset="utf-8"/></head><body style="background-color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,sans-serif;"><div style="padding:32px 24px;max-width:480px;margin:0 auto;"><h1 style="font-size:20px;font-weight:700;color:#1c2d41;margin:0 0 8px;">Hi ' || public.html_escape(_user_name) || ',</h1><p style="font-size:11px;font-weight:600;color:#0284c7;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 12px;">' || public.html_escape(_notification_type) || '</p><p style="font-size:15px;color:#4b5563;line-height:1.6;margin:0 0 24px;">' || public.html_escape(_notification_message) || '</p><a href="' || _action_url || '" style="display:inline-block;background-color:#0284c7;color:#f0f9ff;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;">View Now</a><hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0 16px;"/><p style="font-size:12px;color:#9ca3af;line-height:1.5;margin:0;">You are receiving this because you have an account on 50mm Retina World.</p></div></body></html>';
  _plain_text := 'Hi ' || _user_name || ',' || E'\n\n' || _notification_type || E'\n\n' || _notification_message || E'\n\n' || 'View Now: ' || _action_url || E'\n\n---\nYou are receiving this because you have an account on 50mm Retina World.';

  INSERT INTO public.email_send_log (message_id, template_name, recipient_email, status)
  VALUES (_message_id, 'notification-alert', _user_email, 'pending');

  PERFORM enqueue_email('transactional_emails', jsonb_build_object(
    'message_id', _message_id, 'to', _user_email,
    'from', '50mm Retina World <no-reply@50mmretina.com>',
    'sender_domain', '50mmretina.com',
    'subject', _subject, 'html', _html, 'text', _plain_text,
    'purpose', 'transactional', 'label', 'notification-alert',
    'idempotency_key', 'notif-' || NEW.id,
    'unsubscribe_token', _unsubscribe_token,
    'queued_at', now()::text
  ));

  UPDATE public.user_notifications SET email_sent = true WHERE id = NEW.id;
  RETURN NEW;
END;
$function$
;

-- ── explicit grants = the live ACL (identical on both lanes, PROBE 0100) ──
REVOKE ALL ON FUNCTION public.emit_birthday_notifications() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emit_birthday_notifications() TO service_role;
REVOKE ALL ON FUNCTION public.emit_notification(text, uuid, integer, uuid, text, text, text, uuid, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emit_notification(text, uuid, integer, uuid, text, text, text, uuid, text, jsonb, text) TO service_role;
REVOKE ALL ON FUNCTION public.pj_handle_tag_notification(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pj_handle_tag_notification(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.prune_old_notifications(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_old_notifications(integer, integer) TO service_role;
-- the member's own grouped notification history: callable by members (as live)
GRANT EXECUTE ON FUNCTION public.get_my_notifications_grouped(integer, timestamp with time zone) TO PUBLIC, anon, authenticated, service_role;

DO $post$
DECLARE r record; now_attrs text;
BEGIN
  FOR r IN SELECT b.oid, b.sig, b.attrs, n.md5 FROM n1_before b JOIN n1_pin n USING (sig) LOOP
    IF to_regprocedure(r.sig) IS DISTINCT FROM r.oid THEN
      RAISE EXCEPTION 'NC-0150-POST-001: % changed identity (oid) — rolled back', r.sig;
    END IF;
    IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = r.oid) <> r.md5 THEN
      RAISE EXCEPTION 'NC-0150-POST-002: % source changed — rolled back', r.sig;
    END IF;
    SELECT md5(concat_ws('|', p.prosecdef, coalesce(array_to_string(p.proconfig, ','), ''), p.provolatile, p.proisstrict,
                     p.proleakproof, p.proparallel, p.prorettype::regtype::text, p.proretset, oidvectortypes(p.proargtypes),
                     coalesce(pg_get_expr(p.proargdefaults, 0), ''), pg_get_userbyid(p.proowner),
                     coalesce(p.proacl::text, ''), p.prolang, p.prokind, coalesce(array_to_string(p.proallargtypes::regtype[], ','), ''),
                     coalesce(array_to_string(p.proargmodes, ','), ''), coalesce(array_to_string(p.proargnames, ','), ''),
                     p.procost, p.prorows, p.prosupport::text, coalesce(p.prosqlbody::text, ''),
                     coalesce(array_to_string(p.protrftypes, ','), '')))
      INTO now_attrs FROM pg_proc p WHERE p.oid = r.oid;
    IF now_attrs <> r.attrs THEN
      RAISE EXCEPTION 'NC-0150-POST-003: an attribute of % changed (definer / search_path / volatility / grants / defaults / cost / rows …) — rolled back', r.sig;
    END IF;
    -- keep any existing comment; append the capture tag
    EXECUTE format('COMMENT ON FUNCTION %s IS %L', r.oid::regprocedure,
                   coalesce(obj_description(r.oid, 'pg_proc') || E'\n', '')
                   || 'Notification function captured in git by 20261104_0150 (N1): source = live, md5 ' || r.md5);
  END LOOP;
END
$post$;

COMMIT;
