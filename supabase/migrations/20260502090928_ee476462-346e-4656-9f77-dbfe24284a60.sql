-- ============================================================================
-- Phase 7 — Email template re-keying (Notification Backbone canonical stage_key)
-- ============================================================================
-- Goal: every email payload emitted by a judging-lifecycle trigger now carries
-- a canonical v3 `stageKey` (e.g. r1_shortlisted_r2, r4_top_50). This closes
-- the legacy-decision-string gap flagged in Phase 7 of the v3 plan.
--
-- Strategy:
--   1. New SECURITY DEFINER helper `_resolve_stage_key_from_entry(status,
--      current_round, progression_decision)` — single source of truth that
--      mirrors the mapping table in `trg_entry_status_lifecycle_emit`.
--   2. Replace `notify_entry_status_change`, `notify_round_published`,
--      `notify_round_published_insert`, `backfill_judging_notifications` so
--      every `emit_notification` call includes `stageKey` in the email_data
--      JSONB payload.
--   3. Templates already prefer `stageKey` and resolve labels via
--      `labelForStageKey()` — no template changes required.
--
-- Zero-damage: legacy `placement` / `entryStatus` payload fields are kept
-- alongside the new `stageKey` so any in-flight queue entries / older
-- template versions still render. Behavior change is additive only.
-- ============================================================================

-- 1) Canonical mapping helper -------------------------------------------------
CREATE OR REPLACE FUNCTION public._resolve_stage_key_from_entry(
  _status text,
  _current_round text,
  _progression_decision text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  _round_num integer;
  _key text;
BEGIN
  -- Highest priority: explicit progression_decision (already canonical v3).
  _key := NULLIF(_progression_decision, '');
  IF _key IS NOT NULL THEN
    RETURN _key;
  END IF;

  _round_num := NULLIF(regexp_replace(COALESCE(_current_round, ''), '\D', '', 'g'), '')::integer;

  RETURN CASE
    WHEN _round_num = 1 AND _status ILIKE '%shortlist%'        THEN 'r1_shortlisted_r2'
    WHEN _round_num = 1 AND _status = 'approved'                THEN 'r1_accepted'
    WHEN _round_num = 1 AND _status = 'rejected'                THEN 'r1_rejected'
    WHEN _round_num = 1 AND _status ILIKE '%needs%verif%'       THEN 'r1_needs_verification'
    WHEN _round_num = 1 AND _status ILIKE '%needs%review%'      THEN 'r1_needs_verification'
    WHEN _round_num = 2 AND (_status ILIKE '%qualified%' OR _status = 'qualified') THEN 'r2_qualified_r3'
    WHEN _round_num = 2 AND _status = 'approved'                THEN 'r2_accepted'
    WHEN _round_num = 2 AND _status = 'rejected'                THEN 'r2_not_selected'
    WHEN _round_num = 3 AND (_status ILIKE '%qualified%' OR _status = 'qualified') THEN 'r3_qualified_final'
    WHEN _round_num = 3 AND _status = 'approved'                THEN 'r3_accepted'
    WHEN _round_num = 3 AND _status = 'rejected'                THEN 'r3_not_selected'
    WHEN _status = 'winner'                                     THEN 'r4_winner'
    WHEN _status IN ('runner_up','runner_up_1','1st_runner_up') THEN 'r4_runner_up_1'
    WHEN _status IN ('runner_up_2','2nd_runner_up')             THEN 'r4_runner_up_2'
    WHEN _status IN ('honorable_mention','honourable_mention','honorary_mention') THEN 'r4_honorary_mention'
    WHEN _status = 'special_jury'                               THEN 'r4_special_jury'
    WHEN _status = 'top_50'                                     THEN 'r4_top_50'
    WHEN _status = 'top_100'                                    THEN 'r4_top_100'
    WHEN _status = 'finalist'                                   THEN 'r4_finalist'
    ELSE NULL
  END;
END;
$$;

COMMENT ON FUNCTION public._resolve_stage_key_from_entry(text,text,text) IS
'Phase 7: single source of truth mapping legacy entry.status + current_round → canonical v3 stage_key. Used by every judging-lifecycle email emitter so payloads always carry stageKey. progression_decision wins when present.';

-- 2) Re-key notify_entry_status_change ---------------------------------------
CREATE OR REPLACE FUNCTION public.notify_entry_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _comp_title text;
  _comp_slug text;
  _round_num integer;
  _action_url text;
  _site_url text := 'https://www.50mmretina.com';
  _stage_key text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT title, slug INTO _comp_title, _comp_slug FROM public.competitions WHERE id = NEW.competition_id;
  _round_num := NULLIF(regexp_replace(COALESCE(NEW.current_round, ''), '\D', '', 'g'), '')::integer;
  _action_url := _site_url || '/dashboard?entry=' || NEW.id::text;
  _stage_key := public._resolve_stage_key_from_entry(NEW.status, NEW.current_round, NEW.progression_decision);

  IF NEW.status ILIKE '%shortlist%' THEN
    PERFORM public.emit_notification(
      'entry_shortlisted', NEW.id, _round_num, NEW.user_id,
      'entry_shortlisted', 'Your entry was shortlisted',
      'Your entry in "' || COALESCE(_comp_title, 'the competition') || '" has been shortlisted.',
      NEW.competition_id, 'entry-shortlisted',
      jsonb_build_object('entryTitle', NEW.title, 'competitionTitle', _comp_title, 'roundNumber', _round_num, 'stageKey', _stage_key),
      _action_url
    );
  ELSIF NEW.status ILIKE 'round%qualified' OR NEW.status = 'qualified' THEN
    PERFORM public.emit_notification(
      'entry_qualified_round', NEW.id, _round_num, NEW.user_id,
      'entry_qualified', 'You advanced to the next round',
      'Your entry in "' || COALESCE(_comp_title, 'the competition') || '" qualified for Round ' || COALESCE(_round_num + 1, 2) || '.',
      NEW.competition_id, 'entry-qualified-round',
      jsonb_build_object('entryTitle', NEW.title, 'competitionTitle', _comp_title, 'roundNumber', _round_num, 'nextRound', COALESCE(_round_num, 1) + 1, 'stageKey', _stage_key),
      _action_url
    );
  ELSIF NEW.status = 'rejected' THEN
    PERFORM public.emit_notification(
      'entry_rejected', NEW.id, _round_num, NEW.user_id,
      'entry_rejected', 'Update on your entry',
      'Your entry in "' || COALESCE(_comp_title, 'the competition') || '" did not advance.',
      NEW.competition_id, 'entry-rejected',
      jsonb_build_object('entryTitle', NEW.title, 'competitionTitle', _comp_title, 'roundNumber', _round_num, 'stageKey', _stage_key),
      _action_url
    );
  ELSIF NEW.status = 'finalist' THEN
    PERFORM public.emit_notification(
      'entry_finalist', NEW.id, _round_num, NEW.user_id,
      'entry_finalist', 'You are a finalist!',
      'Your entry in "' || COALESCE(_comp_title, 'the competition') || '" is a finalist.',
      NEW.competition_id, 'entry-finalist',
      jsonb_build_object('entryTitle', NEW.title, 'competitionTitle', _comp_title, 'stageKey', _stage_key),
      _action_url
    );
  ELSIF NEW.status IN ('winner','runner_up','runner_up_1','runner_up_2','honorable_mention','honourable_mention','honorary_mention','special_jury','top_50','top_100') THEN
    PERFORM public.emit_notification(
      'entry_award', NEW.id, _round_num, NEW.user_id,
      'competition_winner', 'Congratulations on your award!',
      'Your entry in "' || COALESCE(_comp_title, 'the competition') || '" received: ' || NEW.status || '.',
      NEW.competition_id, 'entry-winner',
      -- placement kept for back-compat with templates that still read it; stageKey is canonical
      jsonb_build_object('entryTitle', NEW.title, 'competitionTitle', _comp_title, 'placement', NEW.status, 'stageKey', _stage_key),
      _action_url
    );
  ELSIF NEW.status = 'approved' THEN
    PERFORM public.emit_notification(
      'entry_approved', NEW.id, _round_num, NEW.user_id,
      'entry_approved', 'Entry Approved',
      'Your entry in "' || COALESCE(_comp_title, 'the competition') || '" has been approved.',
      NEW.competition_id, 'entry-shortlisted',
      jsonb_build_object('entryTitle', NEW.title, 'competitionTitle', _comp_title, 'stageKey', _stage_key),
      _action_url
    );
  END IF;

  RETURN NEW;
END;
$$;

-- 3) Re-key round-published emitters -----------------------------------------
CREATE OR REPLACE FUNCTION public.notify_round_published()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _comp_title text;
  _entry record;
  _action_url text;
  _site_url text := 'https://www.50mmretina.com';
  _stage_key text;
BEGIN
  IF OLD.published_at IS NOT NULL OR NEW.published_at IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT title INTO _comp_title FROM public.competitions WHERE id = NEW.competition_id;

  FOR _entry IN
    SELECT id, user_id, title, status, current_round, progression_decision
    FROM public.competition_entries
    WHERE competition_id = NEW.competition_id
  LOOP
    _action_url := _site_url || '/dashboard?entry=' || _entry.id::text;
    _stage_key := public._resolve_stage_key_from_entry(_entry.status, _entry.current_round, _entry.progression_decision);
    PERFORM public.emit_notification(
      'round_published', _entry.id, NEW.round_number, _entry.user_id,
      'round_results_published', 'Round ' || NEW.round_number || ' results are out',
      'Round ' || NEW.round_number || ' results for "' || COALESCE(_comp_title, 'the competition') || '" are now available.',
      NEW.competition_id,
      'round-published-summary',
      jsonb_build_object(
        'competitionTitle', _comp_title,
        'roundNumber', NEW.round_number,
        'entryTitle', _entry.title,
        -- entryStatus kept for back-compat; stageKey is canonical
        'entryStatus', _entry.status,
        'stageKey', _stage_key
      ),
      _action_url
    );
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_round_published_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _comp_title text;
  _entry record;
  _action_url text;
  _site_url text := 'https://www.50mmretina.com';
  _stage_key text;
BEGIN
  IF NEW.published_at IS NULL THEN RETURN NEW; END IF;

  SELECT title INTO _comp_title FROM public.competitions WHERE id = NEW.competition_id;

  FOR _entry IN
    SELECT id, user_id, title, status, current_round, progression_decision
    FROM public.competition_entries
    WHERE competition_id = NEW.competition_id
  LOOP
    _action_url := _site_url || '/dashboard?entry=' || _entry.id::text;
    _stage_key := public._resolve_stage_key_from_entry(_entry.status, _entry.current_round, _entry.progression_decision);
    PERFORM public.emit_notification(
      'round_published', _entry.id, NEW.round_number, _entry.user_id,
      'round_results_published', 'Round ' || NEW.round_number || ' results are out',
      'Round ' || NEW.round_number || ' results for "' || COALESCE(_comp_title, 'the competition') || '" are now available.',
      NEW.competition_id,
      'round-published-summary',
      jsonb_build_object(
        'competitionTitle', _comp_title,
        'roundNumber', NEW.round_number,
        'entryTitle', _entry.title,
        'entryStatus', _entry.status,
        'stageKey', _stage_key
      ),
      _action_url
    );
  END LOOP;

  RETURN NEW;
END;
$$;

-- 4) Re-key backfill so historical emits also carry stageKey -----------------
CREATE OR REPLACE FUNCTION public.backfill_judging_notifications(_window_days integer DEFAULT 90, _dry_run boolean DEFAULT true)
RETURNS TABLE(scanned bigint, would_emit bigint, emitted bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _scanned bigint := 0;
  _candidates bigint := 0;
  _emitted bigint := 0;
  _row record;
  _tmpl record;
  _site_url text := 'https://fiftymmretinaworld.lovable.app';
  _stage_key text;
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin_only';
  END IF;

  FOR _row IN
    SELECT ce.id, ce.user_id, ce.competition_id, ce.status, ce.placement,
           ce.current_round, ce.progression_decision, ce.title
    FROM competition_entries ce
    WHERE ce.updated_at > now() - make_interval(days => _window_days)
  LOOP
    _scanned := _scanned + 1;
    SELECT * INTO _tmpl FROM public._notification_template_for_entry(_row.status, _row.placement);
    CONTINUE WHEN _tmpl.email_template IS NULL;

    IF EXISTS (
      SELECT 1 FROM notification_emit_log
      WHERE entity_id = _row.id
        AND email_template = _tmpl.email_template
        AND recipient_user_id = _row.user_id
    ) THEN
      CONTINUE;
    END IF;

    _candidates := _candidates + 1;
    _stage_key := public._resolve_stage_key_from_entry(_row.status, _row.current_round, _row.progression_decision);

    IF NOT _dry_run THEN
      PERFORM public.emit_notification(
        _tmpl.kind,
        _row.id,
        NULLIF(regexp_replace(COALESCE(_row.current_round,''), '\D','','g'),'')::int,
        _row.user_id,
        _tmpl.in_app_type,
        _tmpl.in_app_title,
        _tmpl.in_app_message,
        _row.competition_id,
        _tmpl.email_template,
        jsonb_build_object('entryTitle', _row.title, 'backfilled', true, 'stageKey', _stage_key),
        _site_url || '/dashboard?entry=' || _row.id::text
      );
      _emitted := _emitted + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT _scanned, _candidates, _emitted;
END;
$$;
