-- ═══════════════════════════════════════════════════════════════════════════
-- CG-2 SEEDED HARNESS — SCHEMA + SEEDS (2026-08-14)
-- Faithful replica of the production judging surface, pulled from live
-- catalogs this session (pg_policies, pg_get_functiondef, pg_constraint,
-- pg_get_triggerdef). Run as superuser on the local PG16 harness (port 5433).
--
-- FIDELITY LEDGER (every deviation listed, with why it cannot change a verdict):
--  1. auth.uid() reads request.jwt.claim.sub GUC (established V11 pattern);
--     auth.users is a bare id table. account_is_live() is otherwise verbatim.
--  2. Column DEFAULTs on competitions/competition_entries omitted — all rows
--     are seeded with explicit values; policies reference columns, not defaults.
--  3. user_roles.role DEFAULT is plain 'user' (production: 'user'::app_role
--     cast) — every seed supplies role explicitly, default never evaluated.
--  4. competition_round_publish carries NO triggers here (production has 6
--     side-effect triggers not pulled). Probes against this table are
--     DENY-only: a MORE permissive harness that still denies proves
--     production (a superset of restrictions) also denies. No ALLOW verdict
--     is read from this table.
--  5. db_audit_logs / entry_score_cache are minimal shapes sufficient for the
--     faithful audit/refresh trigger functions to insert into.
--  All RLS policies, gating triggers (enforce_round_lock, guard_needs_review,
--  mirror_system_tag_to_decision, rate_limit, validators, tag protectors) and
--  authz functions are VERBATIM from production.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

-- ── auth scaffolding (reuse if the feed-cycle harness already created it) ──
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
GRANT SELECT ON auth.users TO anon, authenticated;

DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM
    ('user','judge','content_editor','admin','registered_photographer','student');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- profiles exists from the feed cycle; is_banned() needs the column.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_banned boolean DEFAULT false;

-- ── clean slate for CG-2 objects ──
DROP TABLE IF EXISTS public.judge_award_tags, public.judge_tag_assignments,
  public.judge_decisions, public.judge_scores, public.judge_entry_assignments,
  public.competition_judges, public.competition_round_publish,
  public.judging_rounds, public.judging_tags, public.v3_tag_label_alias,
  public.v3_stage_catalog, public.v3_mirror_log, public.competition_entries,
  public.competitions, public.user_roles, public.db_audit_logs,
  public.entry_score_cache CASCADE;

-- ═══ TABLES (faithful shapes) ═══

CREATE TABLE public.user_roles (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'user',           -- deviation #3
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

CREATE TABLE public.competitions (
  id uuid NOT NULL PRIMARY KEY,
  title text NOT NULL,
  description text,
  cover_image_url text,
  category text NOT NULL,
  entry_fee numeric,
  prize_info text,
  status text NOT NULL,
  max_entries_per_user integer,
  max_photos_per_entry integer,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ai_images_allowed boolean NOT NULL DEFAULT false,
  slug text,
  phase text NOT NULL,
  current_round text,
  judge_assignment_mode text NOT NULL,
  voting_ends_at timestamptz,
  judging_completed boolean NOT NULL DEFAULT false,
  notification_sent boolean NOT NULL DEFAULT false
);

CREATE TABLE public.competition_entries (
  id uuid NOT NULL PRIMARY KEY,
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  photos text[] NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  placement text,
  is_pinned boolean NOT NULL DEFAULT false,
  view_count integer NOT NULL DEFAULT 0,
  is_trending boolean NOT NULL DEFAULT false,
  is_ai_generated boolean NOT NULL DEFAULT false,
  ai_detection_result jsonb,
  exif_data jsonb,
  current_round text,
  certificate_ready boolean NOT NULL DEFAULT false,
  photo_thumbnails text[],
  photo_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_ai_advisory boolean NOT NULL DEFAULT false,
  progression_decision text,
  stage_key text,
  public_status_derived text,
  public_round_derived text,
  public_placement_derived text,
  public_progression_note_derived text,
  public_r4_tags_derived text[],
  current_round_int integer
);

CREATE TABLE public.competition_judges (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  judge_id uuid NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by uuid NOT NULL,
  UNIQUE (competition_id, judge_id)
);

CREATE TABLE public.judge_entry_assignments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  judge_id uuid NOT NULL,
  entry_id uuid NOT NULL REFERENCES public.competition_entries(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (competition_id, judge_id, entry_id)
);

CREATE TABLE public.judging_rounds (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  round_number integer NOT NULL DEFAULT 1,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (competition_id, round_number)
);

CREATE TABLE public.judging_tags (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  label text NOT NULL,
  color text NOT NULL DEFAULT '#6366f1',
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  icon text DEFAULT 'award',
  image_url text,
  is_quality_tag boolean DEFAULT false,
  visible_in_round integer[] NOT NULL,
  is_system boolean NOT NULL DEFAULT false,
  is_visible boolean NOT NULL DEFAULT true,
  CONSTRAINT chk_visible_round_not_empty CHECK (visible_in_round IS NOT NULL AND array_length(visible_in_round,1) > 0),
  CONSTRAINT unique_tag_label_per_round UNIQUE (label, visible_in_round)
);

CREATE TABLE public.judge_scores (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entry_id uuid NOT NULL REFERENCES public.competition_entries(id) ON DELETE CASCADE,
  judge_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  score numeric(3,1),
  feedback text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  photo_index integer NOT NULL DEFAULT 0 CHECK (photo_index >= 0),
  composition_score integer, color_palette_score integer, technique_score integer,
  line_score integer, shape_score integer, form_score integer, texture_score integer,
  space_score integer, tone_score integer, balance_score integer, light_score integer,
  depth_score integer,
  round_number integer NOT NULL DEFAULT 1 CHECK (round_number >= 1 AND round_number <= 4),
  editing_score integer CHECK (editing_score IS NULL OR (editing_score >= 0 AND editing_score <= 10)),
  story_score integer CHECK (story_score IS NULL OR (story_score >= 0 AND story_score <= 10)),
  moment_score integer CHECK (moment_score IS NULL OR (moment_score >= 0 AND moment_score <= 10)),
  CONSTRAINT feedback_length_check CHECK (feedback IS NULL OR length(feedback) <= 500),
  CONSTRAINT judge_scores_score_check CHECK (score::numeric >= 0 AND score::numeric <= 10),
  CONSTRAINT judge_scores_entry_judge_round_photo_key UNIQUE (entry_id, judge_id, round_number, photo_index)
);

CREATE TABLE public.judge_decisions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entry_id uuid NOT NULL REFERENCES public.competition_entries(id) ON DELETE CASCADE,
  judge_id uuid NOT NULL,
  round_number integer NOT NULL,
  decision text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  photo_index integer NOT NULL DEFAULT 0,
  stage_key text,
  CONSTRAINT judge_decisions_decision_check_v2 CHECK (decision = ANY (ARRAY[
    'accept','reject','shortlist','needs_review','needs_verification',
    'qualified_r3','qualified_final','shortlisted_final','not_selected_r3',
    'not_selected_final','winner','runner_up_1','runner_up_2',
    'honorary_mention','special_jury','top_50','top_100','finalist_only'])),
  CONSTRAINT judge_decisions_entry_judge_round_photo_unique UNIQUE (entry_id, judge_id, round_number, photo_index)
);

CREATE TABLE public.judge_tag_assignments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entry_id uuid NOT NULL REFERENCES public.competition_entries(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES public.judging_tags(id) ON DELETE CASCADE,
  judge_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  photo_index integer NOT NULL DEFAULT 0 CHECK (photo_index >= 0),
  round_number integer NOT NULL CHECK (round_number >= 1 AND round_number <= 4),
  CONSTRAINT judge_tag_assignments_entry_tag_judge_round_photo_key UNIQUE (entry_id, tag_id, judge_id, round_number, photo_index)
);

CREATE TABLE public.judge_award_tags (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entry_id uuid NOT NULL REFERENCES public.competition_entries(id) ON DELETE CASCADE,
  judge_id uuid NOT NULL,
  photo_index integer NOT NULL CHECK (photo_index >= 0),
  round_number integer NOT NULL CHECK (round_number = 4),
  stage_key text NOT NULL,
  decision_token text NOT NULL,
  tag_label text NOT NULL,
  tag_id uuid REFERENCES public.judging_tags(id) ON DELETE SET NULL,
  source_assignment_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT judge_award_tags_unique UNIQUE (entry_id, judge_id, round_number, photo_index, stage_key)
);

CREATE TABLE public.competition_round_publish (
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  round_number integer NOT NULL CHECK (round_number >= 1 AND round_number <= 4),
  closed_at timestamptz,
  closed_by uuid,
  published_at timestamptz,
  published_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (competition_id, round_number)
);
-- deviation #4: production's 6 side-effect triggers not attached; DENY-only probes.

CREATE TABLE public.v3_stage_catalog (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  stage_key text NOT NULL UNIQUE,
  round_number integer NOT NULL CHECK (round_number >= 1 AND round_number <= 4),
  family text NOT NULL CHECK (family = ANY (ARRAY['progression_pass','progression_fail','rejection','needs_review','verification','award'])),
  decision_token text NOT NULL,
  tag_label_canonical text NOT NULL,
  advances_to_round integer CHECK (advances_to_round IS NULL OR (advances_to_round >= 2 AND advances_to_round <= 4)),
  blocks_from_round integer CHECK (blocks_from_round IS NULL OR (blocks_from_round >= 2 AND blocks_from_round <= 4)),
  description text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cert_eligible boolean NOT NULL DEFAULT false,
  UNIQUE (round_number, tag_label_canonical)
);

CREATE TABLE public.v3_tag_label_alias (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  alias_label text NOT NULL,
  round_number integer NOT NULL CHECK (round_number >= 1 AND round_number <= 4),
  canonical_stage_key text NOT NULL REFERENCES public.v3_stage_catalog(stage_key) ON UPDATE CASCADE,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.v3_mirror_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  trigger_op text NOT NULL,
  action text NOT NULL CHECK (action = ANY (ARRAY['upsert','delete','noop','bypassed','error','r4_award_upsert','r4_award_delete','alias_resolved','upsert_via_alias','noop_alias_miss'])),
  source_tag_id uuid, tag_id uuid, tag_label text, matched_stage text,
  entry_id uuid, judge_id uuid, round_number integer, photo_index integer,
  decision_token text, error_message text, write_path text,
  reviewed_at timestamptz, reviewed_by uuid, reviewed_note text
);

-- deviation #5: minimal shapes for faithful side-effect trigger functions.
CREATE TABLE public.db_audit_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  table_name text, operation text, row_id text,
  old_data jsonb, new_data jsonb, changed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.entry_score_cache (
  entry_id uuid PRIMARY KEY,
  avg_score numeric, total_scores integer, last_updated timestamptz
);

-- ═══ FUNCTIONS (verbatim from pg_get_functiondef) ═══

CREATE OR REPLACE FUNCTION public.account_is_live() RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  select exists (select 1 from auth.users u where u.id = auth.uid());
$function$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role::text)
$function$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role text) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$function$;

CREATE OR REPLACE FUNCTION public.is_banned(_user_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT is_banned FROM public.profiles WHERE id = _user_id), false);
$function$;

CREATE OR REPLACE FUNCTION public.judge_can_access_entry(_entry_id uuid, _judge_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM competition_entries ce
    JOIN competition_judges cj ON cj.competition_id = ce.competition_id AND cj.judge_id = _judge_id
    JOIN competitions c ON c.id = ce.competition_id
    WHERE ce.id = _entry_id
      AND (
        c.judge_assignment_mode != 'distributed'
        OR EXISTS (
          SELECT 1 FROM judge_entry_assignments ja
          WHERE ja.entry_id = _entry_id AND ja.judge_id = _judge_id
        )
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.judge_round_open_by_number(_entry_id uuid, _round_number integer) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT NOT EXISTS (
    SELECT 1
    FROM public.judging_rounds jr
    JOIN public.competition_entries ce ON ce.competition_id = jr.competition_id
    WHERE ce.id = _entry_id
      AND jr.round_number = _round_number
      AND jr.status = 'completed'
  );
$function$;

CREATE OR REPLACE FUNCTION public.enforce_round_lock() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _comp_id uuid;
  _round_status text;
  _round_number int;
  _entry_id uuid;
  _row jsonb;
  _current_round_text text;
BEGIN
  IF current_setting('app.bypass_round_lock', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN _row := to_jsonb(OLD); ELSE _row := to_jsonb(NEW); END IF;

  _entry_id := NULLIF(_row->>'entry_id','')::uuid;
  IF _entry_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF _row ? 'round_number' AND NULLIF(_row->>'round_number','') IS NOT NULL THEN
    _round_number := (_row->>'round_number')::int;
  END IF;

  IF _round_number IS NULL AND _row ? 'round_id' AND NULLIF(_row->>'round_id','') IS NOT NULL THEN
    SELECT round_number INTO _round_number
    FROM public.judging_rounds WHERE id = (_row->>'round_id')::uuid;
  END IF;

  IF _round_number IS NULL THEN
    SELECT competition_id, current_round
      INTO _comp_id, _current_round_text
    FROM public.competition_entries WHERE id = _entry_id;
    _round_number := NULLIF(regexp_replace(COALESCE(_current_round_text, ''), '\D', '', 'g'), '')::int;
  ELSE
    SELECT competition_id INTO _comp_id
    FROM public.competition_entries WHERE id = _entry_id;
  END IF;

  IF _round_number IS NOT NULL AND _comp_id IS NOT NULL THEN
    SELECT status INTO _round_status
    FROM public.judging_rounds
    WHERE competition_id = _comp_id AND round_number = _round_number;

    IF _round_status = 'completed' THEN
      RAISE EXCEPTION 'This round has been completed. Scoring is locked.';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_needs_review_round1_only() RETURNS trigger
 LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.decision = 'needs_review' AND COALESCE(NEW.round_number, 0) <> 1 THEN
    RAISE EXCEPTION
      '"Needs Review" decisions are only permitted in Round 1 (Spec V3). Got round_number=%',
      NEW.round_number
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rate_limit_judge_scores() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  recent_count integer;
BEGIN
  SELECT COUNT(*) INTO recent_count
  FROM public.judge_scores
  WHERE judge_id = NEW.judge_id
    AND created_at > now() - interval '1 minute';
  IF recent_count >= 20 THEN
    RAISE EXCEPTION 'Rate limit exceeded: maximum 20 score submissions per minute';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validate_judge_score_range() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.score < 0 OR NEW.score > 10 THEN
    RAISE EXCEPTION 'Score must be between 0 and 10, got %', NEW.score;
  END IF;
  IF NEW.composition_score IS NOT NULL AND (NEW.composition_score < 0 OR NEW.composition_score > 10) THEN
    RAISE EXCEPTION 'Composition score must be between 0 and 10';
  END IF;
  IF NEW.color_palette_score IS NOT NULL AND (NEW.color_palette_score < 0 OR NEW.color_palette_score > 10) THEN
    RAISE EXCEPTION 'Color palette score must be between 0 and 10';
  END IF;
  IF NEW.technique_score IS NOT NULL AND (NEW.technique_score < 0 OR NEW.technique_score > 10) THEN
    RAISE EXCEPTION 'Technique score must be between 0 and 10';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validate_judge_criteria_scores() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.line_score IS NOT NULL AND (NEW.line_score < 0 OR NEW.line_score > 10) THEN
    RAISE EXCEPTION 'Line score must be between 0 and 10';
  END IF;
  IF NEW.shape_score IS NOT NULL AND (NEW.shape_score < 0 OR NEW.shape_score > 10) THEN
    RAISE EXCEPTION 'Shape score must be between 0 and 10';
  END IF;
  IF NEW.form_score IS NOT NULL AND (NEW.form_score < 0 OR NEW.form_score > 10) THEN
    RAISE EXCEPTION 'Form score must be between 0 and 10';
  END IF;
  IF NEW.texture_score IS NOT NULL AND (NEW.texture_score < 0 OR NEW.texture_score > 10) THEN
    RAISE EXCEPTION 'Texture score must be between 0 and 10';
  END IF;
  IF NEW.space_score IS NOT NULL AND (NEW.space_score < 0 OR NEW.space_score > 10) THEN
    RAISE EXCEPTION 'Space score must be between 0 and 10';
  END IF;
  IF NEW.tone_score IS NOT NULL AND (NEW.tone_score < 0 OR NEW.tone_score > 10) THEN
    RAISE EXCEPTION 'Tone score must be between 0 and 10';
  END IF;
  IF NEW.balance_score IS NOT NULL AND (NEW.balance_score < 0 OR NEW.balance_score > 10) THEN
    RAISE EXCEPTION 'Balance score must be between 0 and 10';
  END IF;
  IF NEW.light_score IS NOT NULL AND (NEW.light_score < 0 OR NEW.light_score > 10) THEN
    RAISE EXCEPTION 'Light score must be between 0 and 10';
  END IF;
  IF NEW.depth_score IS NOT NULL AND (NEW.depth_score < 0 OR NEW.depth_score > 10) THEN
    RAISE EXCEPTION 'Depth score must be between 0 and 10';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_system_tags_fn() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.is_system THEN
    RAISE EXCEPTION 'System tags cannot be deleted (label=%)', OLD.label;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_system AND NEW.label IS DISTINCT FROM OLD.label THEN
    IF current_setting('app.allow_system_tag_rename', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'System tag labels cannot be renamed via UI (label=%)', OLD.label;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_non_system_tags_round4() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(NEW.is_system, false) = false THEN
    IF NEW.visible_in_round IS NULL
       OR array_length(NEW.visible_in_round, 1) IS DISTINCT FROM 1
       OR NEW.visible_in_round[1] <> 4 THEN
      RAISE EXCEPTION 'Non-system judging tags must have visible_in_round = ARRAY[4] (Spec v3 Golden Rule #3). Got: %', NEW.visible_in_round
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.audit_sensitive_table() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.db_audit_logs (table_name, operation, row_id, old_data, changed_by)
    VALUES (TG_TABLE_NAME, 'DELETE', OLD.id::text, to_jsonb(OLD), auth.uid());
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.db_audit_logs (table_name, operation, row_id, old_data, new_data, changed_by)
    VALUES (TG_TABLE_NAME, 'UPDATE', NEW.id::text, to_jsonb(OLD), to_jsonb(NEW), auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO public.db_audit_logs (table_name, operation, row_id, new_data, changed_by)
    VALUES (TG_TABLE_NAME, 'INSERT', NEW.id::text, to_jsonb(NEW), auth.uid());
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.audit_nr_drift_at_r2_plus() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.decision = 'needs_review' AND NEW.round_number <> 1 THEN
    INSERT INTO public.db_audit_logs (table_name, operation, row_id, new_data, changed_by)
    VALUES (
      'judge_decisions', 'NR_DRIFT_R2_PLUS', NEW.id::text,
      jsonb_build_object(
        'phase','1.1','gap','G1','entry_id',NEW.entry_id,'judge_id',NEW.judge_id,
        'round_number',NEW.round_number,'photo_index',NEW.photo_index,'decision',NEW.decision,
        'message','NR decision written for R2+; trigger trg_guard_needs_review_round1_only may be dropped/bypassed/reordered'
      ),
      auth.uid()
    );
    RAISE WARNING 'Phase 1.1 NR drift detected: NR row at round_number=% (entry_id=%, judge_id=%)',
      NEW.round_number, NEW.entry_id, NEW.judge_id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_score_cache() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  target_entry_id UUID;
BEGIN
  target_entry_id := COALESCE(NEW.entry_id, OLD.entry_id);
  INSERT INTO public.entry_score_cache (entry_id, avg_score, total_scores, last_updated)
  SELECT
    target_entry_id,
    COALESCE(
      AVG(
        COALESCE(
          (
            SELECT AVG(v)::numeric
            FROM unnest(ARRAY[
              js.line_score::numeric, js.shape_score::numeric, js.form_score::numeric,
              js.texture_score::numeric, js.space_score::numeric, js.tone_score::numeric,
              js.balance_score::numeric, js.light_score::numeric, js.depth_score::numeric
            ]) AS v
            WHERE v IS NOT NULL
          ),
          js.score::numeric
        )
      ),
      0
    ),
    COUNT(*),
    now()
  FROM public.judge_scores js
  WHERE js.entry_id = target_entry_id
  ON CONFLICT (entry_id) DO UPDATE SET
    avg_score = EXCLUDED.avg_score,
    total_scores = EXCLUDED.total_scores,
    last_updated = EXCLUDED.last_updated;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at_column() RETURNS trigger
 LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

-- mirror_system_tag_to_decision: verbatim (the award write path under test).
CREATE OR REPLACE FUNCTION public.mirror_system_tag_to_decision() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_bypass        text;
  v_tag_id        uuid;
  v_tag_label     text;
  v_stage         public.v3_stage_catalog%ROWTYPE;
  v_alias_key     text;
  v_resolved_via  text := 'direct';
  v_entry_id      uuid;
  v_judge_id      uuid;
  v_round         integer;
  v_photo_idx     integer;
  v_op            text := TG_OP;
BEGIN
  BEGIN
    v_bypass := current_setting('app.bypass_mirror_trigger', true);
  EXCEPTION WHEN OTHERS THEN
    v_bypass := NULL;
  END;
  IF v_bypass = 'on' THEN
    INSERT INTO public.v3_mirror_log
      (trigger_op, action, source_tag_id, tag_id, entry_id, judge_id, round_number, photo_index)
    VALUES (
      v_op, 'bypassed',
      COALESCE(NEW.id, OLD.id),
      COALESCE(NEW.tag_id, OLD.tag_id),
      COALESCE(NEW.entry_id, OLD.entry_id),
      COALESCE(NEW.judge_id, OLD.judge_id),
      COALESCE(NEW.round_number, OLD.round_number),
      COALESCE(NEW.photo_index, OLD.photo_index, 0)
    );
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_op = 'DELETE' THEN
    v_tag_id    := OLD.tag_id;
    v_entry_id  := OLD.entry_id;
    v_judge_id  := OLD.judge_id;
    v_round     := OLD.round_number;
    v_photo_idx := COALESCE(OLD.photo_index, 0);
  ELSE
    v_tag_id    := NEW.tag_id;
    v_entry_id  := NEW.entry_id;
    v_judge_id  := NEW.judge_id;
    v_round     := NEW.round_number;
    v_photo_idx := COALESCE(NEW.photo_index, 0);
  END IF;

  SELECT label INTO v_tag_label FROM public.judging_tags WHERE id = v_tag_id;

  IF v_tag_label IS NULL THEN
    INSERT INTO public.v3_mirror_log
      (trigger_op, action, source_tag_id, tag_id, entry_id, judge_id, round_number, photo_index, error_message)
    VALUES (v_op, 'noop', COALESCE(NEW.id, OLD.id), v_tag_id,
            v_entry_id, v_judge_id, v_round, v_photo_idx,
            'tag row not found in judging_tags');
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT * INTO v_stage
  FROM public.v3_stage_catalog
  WHERE is_active = true
    AND round_number = v_round
    AND lower(trim(tag_label_canonical)) = lower(trim(v_tag_label))
  LIMIT 1;

  IF v_stage.stage_key IS NULL THEN
    SELECT canonical_stage_key INTO v_alias_key
    FROM public.v3_tag_label_alias
    WHERE round_number = v_round
      AND lower(trim(alias_label)) = lower(trim(v_tag_label))
    LIMIT 1;

    IF v_alias_key IS NOT NULL THEN
      SELECT * INTO v_stage
      FROM public.v3_stage_catalog
      WHERE stage_key = v_alias_key
        AND is_active = true
      LIMIT 1;
      IF v_stage.stage_key IS NOT NULL THEN
        v_resolved_via := 'alias';
        INSERT INTO public.v3_mirror_log
          (trigger_op, action, source_tag_id, tag_id, tag_label, matched_stage,
           entry_id, judge_id, round_number, photo_index, decision_token)
        VALUES (v_op, 'alias_resolved', COALESCE(NEW.id, OLD.id), v_tag_id, v_tag_label,
                v_stage.stage_key, v_entry_id, v_judge_id, v_round, v_photo_idx,
                v_stage.decision_token);
      END IF;
    END IF;
  END IF;

  IF v_stage.stage_key IS NULL THEN
    INSERT INTO public.v3_mirror_log
      (trigger_op, action, source_tag_id, tag_id, tag_label, entry_id, judge_id,
       round_number, photo_index, error_message)
    VALUES (v_op, 'noop_alias_miss', COALESCE(NEW.id, OLD.id), v_tag_id, v_tag_label,
            v_entry_id, v_judge_id, v_round, v_photo_idx,
            'no direct catalog hit and no alias entry');
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_op = 'DELETE' THEN
    IF v_round = 4 THEN
      DELETE FROM public.judge_award_tags
       WHERE entry_id     = v_entry_id
         AND judge_id     = v_judge_id
         AND round_number = v_round
         AND photo_index  = v_photo_idx
         AND stage_key    = v_stage.stage_key;

      INSERT INTO public.v3_mirror_log
        (trigger_op, action, source_tag_id, tag_id, tag_label, matched_stage,
         entry_id, judge_id, round_number, photo_index, decision_token)
      VALUES (v_op, 'r4_award_delete', OLD.id, v_tag_id, v_tag_label, v_stage.stage_key,
              v_entry_id, v_judge_id, v_round, v_photo_idx, v_stage.decision_token);
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.judge_tag_assignments other_jta
      JOIN public.judging_tags other_t ON other_t.id = other_jta.tag_id
      LEFT JOIN public.v3_stage_catalog other_s
        ON other_s.is_active = true
       AND other_s.round_number = other_jta.round_number
       AND lower(trim(other_s.tag_label_canonical)) = lower(trim(other_t.label))
      LEFT JOIN public.v3_tag_label_alias other_a
        ON other_a.round_number = other_jta.round_number
       AND lower(trim(other_a.alias_label)) = lower(trim(other_t.label))
      WHERE other_jta.entry_id = v_entry_id
        AND other_jta.judge_id = v_judge_id
        AND other_jta.round_number = v_round
        AND COALESCE(other_jta.photo_index, 0) = v_photo_idx
        AND other_jta.id <> OLD.id
        AND (other_s.stage_key IS NOT NULL OR other_a.canonical_stage_key IS NOT NULL)
    ) THEN
      DELETE FROM public.judge_decisions
       WHERE entry_id = v_entry_id
         AND judge_id = v_judge_id
         AND round_number = v_round
         AND COALESCE(photo_index, 0) = v_photo_idx;

      INSERT INTO public.v3_mirror_log
        (trigger_op, action, source_tag_id, tag_id, tag_label, matched_stage,
         entry_id, judge_id, round_number, photo_index, decision_token)
      VALUES (v_op, 'delete', OLD.id, v_tag_id, v_tag_label, v_stage.stage_key,
              v_entry_id, v_judge_id, v_round, v_photo_idx, v_stage.decision_token);
    ELSE
      INSERT INTO public.v3_mirror_log
        (trigger_op, action, source_tag_id, tag_id, tag_label, matched_stage,
         entry_id, judge_id, round_number, photo_index, error_message)
      VALUES (v_op, 'noop', OLD.id, v_tag_id, v_tag_label, v_stage.stage_key,
              v_entry_id, v_judge_id, v_round, v_photo_idx,
              'sibling system tag still present; preserving decision');
    END IF;

    RETURN OLD;
  END IF;

  IF v_round = 4 THEN
    INSERT INTO public.judge_award_tags
      (entry_id, judge_id, round_number, photo_index,
       stage_key, decision_token, tag_label, tag_id, source_assignment_id)
    VALUES
      (v_entry_id, v_judge_id, v_round, v_photo_idx,
       v_stage.stage_key, v_stage.decision_token, v_tag_label, v_tag_id, NEW.id)
    ON CONFLICT (entry_id, judge_id, round_number, photo_index, stage_key)
    DO UPDATE
      SET decision_token       = EXCLUDED.decision_token,
          tag_label            = EXCLUDED.tag_label,
          tag_id               = EXCLUDED.tag_id,
          source_assignment_id = EXCLUDED.source_assignment_id,
          updated_at           = now();

    INSERT INTO public.v3_mirror_log
      (trigger_op, action, source_tag_id, tag_id, tag_label, matched_stage,
       entry_id, judge_id, round_number, photo_index, decision_token)
    VALUES (v_op, 'r4_award_upsert', NEW.id, v_tag_id, v_tag_label, v_stage.stage_key,
            v_entry_id, v_judge_id, v_round, v_photo_idx, v_stage.decision_token);
  END IF;

  INSERT INTO public.judge_decisions
    (entry_id, judge_id, round_number, photo_index, decision, stage_key)
  VALUES
    (v_entry_id, v_judge_id, v_round, v_photo_idx, v_stage.decision_token, v_stage.stage_key)
  ON CONFLICT (entry_id, judge_id, round_number, photo_index)
  DO UPDATE
    SET decision   = EXCLUDED.decision,
        stage_key  = EXCLUDED.stage_key,
        updated_at = now();

  INSERT INTO public.v3_mirror_log
    (trigger_op, action, source_tag_id, tag_id, tag_label, matched_stage,
     entry_id, judge_id, round_number, photo_index, decision_token)
  VALUES (v_op,
          CASE WHEN v_resolved_via = 'alias' THEN 'upsert_via_alias' ELSE 'upsert' END,
          NEW.id, v_tag_id, v_tag_label, v_stage.stage_key,
          v_entry_id, v_judge_id, v_round, v_photo_idx, v_stage.decision_token);

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[mirror_system_tag_to_decision] entry=% judge=% round=% photo=%: %',
    v_entry_id, v_judge_id, v_round, v_photo_idx, SQLERRM;
  RAISE;
END;
$function$;

-- ═══ TRIGGERS (as pulled; competition_round_publish deliberately bare) ═══

CREATE TRIGGER audit_judge_scores AFTER INSERT OR DELETE OR UPDATE ON public.judge_scores FOR EACH ROW EXECUTE FUNCTION audit_sensitive_table();
CREATE TRIGGER trg_enforce_round_lock BEFORE INSERT OR DELETE OR UPDATE ON public.judge_scores FOR EACH ROW EXECUTE FUNCTION enforce_round_lock();
CREATE TRIGGER trg_rate_limit_judge_scores BEFORE INSERT ON public.judge_scores FOR EACH ROW EXECUTE FUNCTION rate_limit_judge_scores();
CREATE TRIGGER trg_refresh_score_cache AFTER INSERT OR DELETE OR UPDATE ON public.judge_scores FOR EACH ROW EXECUTE FUNCTION refresh_score_cache();
CREATE TRIGGER trg_validate_judge_score_range BEFORE INSERT OR UPDATE ON public.judge_scores FOR EACH ROW EXECUTE FUNCTION validate_judge_score_range();
CREATE TRIGGER validate_criteria_scores BEFORE INSERT OR UPDATE ON public.judge_scores FOR EACH ROW EXECUTE FUNCTION validate_judge_criteria_scores();

CREATE TRIGGER audit_judge_decisions AFTER INSERT OR DELETE OR UPDATE ON public.judge_decisions FOR EACH ROW EXECUTE FUNCTION audit_sensitive_table();
CREATE TRIGGER trg_audit_nr_drift_at_r2_plus AFTER INSERT OR UPDATE OF decision, round_number ON public.judge_decisions FOR EACH ROW EXECUTE FUNCTION audit_nr_drift_at_r2_plus();
CREATE TRIGGER trg_enforce_round_lock BEFORE INSERT OR DELETE OR UPDATE ON public.judge_decisions FOR EACH ROW EXECUTE FUNCTION enforce_round_lock();
CREATE TRIGGER trg_guard_needs_review_round1_only BEFORE INSERT OR UPDATE OF decision, round_number ON public.judge_decisions FOR EACH ROW EXECUTE FUNCTION guard_needs_review_round1_only();

CREATE TRIGGER audit_judge_tag_assignments AFTER INSERT OR DELETE OR UPDATE ON public.judge_tag_assignments FOR EACH ROW EXECUTE FUNCTION audit_sensitive_table();
CREATE TRIGGER trg_enforce_round_lock BEFORE INSERT OR DELETE OR UPDATE ON public.judge_tag_assignments FOR EACH ROW EXECUTE FUNCTION enforce_round_lock();
-- Production carries the mirror on THREE trigger names (base + _ins + _del).
-- Duplicated AFTER triggers fire in name order; replicate all three exactly.
CREATE TRIGGER trg_mirror_system_tag_to_decision AFTER INSERT OR DELETE OR UPDATE ON public.judge_tag_assignments FOR EACH ROW EXECUTE FUNCTION mirror_system_tag_to_decision();
CREATE TRIGGER trg_mirror_system_tag_to_decision_del AFTER DELETE ON public.judge_tag_assignments FOR EACH ROW EXECUTE FUNCTION mirror_system_tag_to_decision();
CREATE TRIGGER trg_mirror_system_tag_to_decision_ins AFTER INSERT ON public.judge_tag_assignments FOR EACH ROW EXECUTE FUNCTION mirror_system_tag_to_decision();

CREATE TRIGGER trg_judge_award_tags_touch BEFORE UPDATE ON public.judge_award_tags FOR EACH ROW EXECUTE FUNCTION set_updated_at_column();

CREATE TRIGGER protect_system_tags BEFORE DELETE OR UPDATE ON public.judging_tags FOR EACH ROW EXECUTE FUNCTION protect_system_tags_fn();
CREATE TRIGGER trg_enforce_non_system_tags_round4 BEFORE INSERT OR UPDATE OF visible_in_round, is_system ON public.judging_tags FOR EACH ROW EXECUTE FUNCTION enforce_non_system_tags_round4();
CREATE TRIGGER trg_protect_system_tags_fn BEFORE DELETE OR UPDATE ON public.judging_tags FOR EACH ROW EXECUTE FUNCTION protect_system_tags_fn();

-- ═══ RLS + POLICIES (verbatim from pg_policies) ═══

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_judges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.judge_entry_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.judging_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.judging_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.judge_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.judge_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.judge_tag_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.judge_award_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_round_publish ENABLE ROW LEVEL SECURITY;

-- judging_rounds
CREATE POLICY "Admins can manage judging rounds" ON public.judging_rounds AS PERMISSIVE FOR ALL TO authenticated
  USING (has_role((SELECT auth.uid()), 'admin'::app_role));
CREATE POLICY "Judges can view rounds" ON public.judging_rounds AS PERMISSIVE FOR SELECT TO authenticated
  USING (has_role((SELECT auth.uid()), 'judge'::app_role) OR has_role((SELECT auth.uid()), 'admin'::app_role));
CREATE POLICY "Deleted accounts cannot delete" ON public.judging_rounds AS RESTRICTIVE FOR DELETE TO authenticated USING ((SELECT account_is_live()));
CREATE POLICY "Deleted accounts cannot insert" ON public.judging_rounds AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((SELECT account_is_live()));
CREATE POLICY "Deleted accounts cannot update" ON public.judging_rounds AS RESTRICTIVE FOR UPDATE TO authenticated USING ((SELECT account_is_live()));

-- judge_scores
CREATE POLICY "Admins can manage scores" ON public.judge_scores AS PERMISSIVE FOR ALL TO authenticated
  USING (has_role((SELECT auth.uid()), 'admin'::app_role));
CREATE POLICY "Judges can insert own scores" ON public.judge_scores AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((judge_id = (SELECT auth.uid())) AND has_role((SELECT auth.uid()), 'judge'::app_role) AND judge_can_access_entry(entry_id, (SELECT auth.uid())) AND judge_round_open_by_number(entry_id, round_number));
CREATE POLICY "Judges can update own scores" ON public.judge_scores AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((judge_id = (SELECT auth.uid())) AND has_role((SELECT auth.uid()), 'judge'::app_role) AND judge_can_access_entry(entry_id, (SELECT auth.uid())) AND judge_round_open_by_number(entry_id, round_number))
  WITH CHECK ((judge_id = (SELECT auth.uid())) AND has_role((SELECT auth.uid()), 'judge'::app_role) AND judge_can_access_entry(entry_id, (SELECT auth.uid())) AND judge_round_open_by_number(entry_id, round_number));
CREATE POLICY "Judges can delete own scores" ON public.judge_scores AS PERMISSIVE FOR DELETE TO authenticated
  USING ((judge_id = (SELECT auth.uid())) AND has_role((SELECT auth.uid()), 'judge'::app_role) AND judge_can_access_entry(entry_id, (SELECT auth.uid())) AND judge_round_open_by_number(entry_id, round_number));
CREATE POLICY "Judges can view scores" ON public.judge_scores AS PERMISSIVE FOR SELECT TO authenticated
  USING ((has_role((SELECT auth.uid()), 'judge'::app_role) AND (EXISTS (SELECT 1 FROM competition_entries ce JOIN competition_judges cj ON cj.competition_id = ce.competition_id WHERE ce.id = judge_scores.entry_id AND cj.judge_id = (SELECT auth.uid())))) OR has_role((SELECT auth.uid()), 'admin'::app_role));
CREATE POLICY "Deleted accounts cannot delete" ON public.judge_scores AS RESTRICTIVE FOR DELETE TO authenticated USING ((SELECT account_is_live()));
CREATE POLICY "Deleted accounts cannot insert" ON public.judge_scores AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((SELECT account_is_live()));
CREATE POLICY "Deleted accounts cannot update" ON public.judge_scores AS RESTRICTIVE FOR UPDATE TO authenticated USING ((SELECT account_is_live()));

-- judge_decisions
CREATE POLICY "Admins can manage judge decisions" ON public.judge_decisions AS PERMISSIVE FOR ALL TO authenticated
  USING (has_role((SELECT auth.uid()), 'admin'::app_role));
CREATE POLICY "Judges can insert own decisions" ON public.judge_decisions AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((judge_id = (SELECT auth.uid())) AND has_role((SELECT auth.uid()), 'judge'::app_role) AND judge_can_access_entry(entry_id, (SELECT auth.uid())) AND judge_round_open_by_number(entry_id, round_number));
CREATE POLICY "Judges can update own decisions" ON public.judge_decisions AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((judge_id = (SELECT auth.uid())) AND has_role((SELECT auth.uid()), 'judge'::app_role) AND judge_can_access_entry(entry_id, (SELECT auth.uid())) AND judge_round_open_by_number(entry_id, round_number))
  WITH CHECK ((judge_id = (SELECT auth.uid())) AND has_role((SELECT auth.uid()), 'judge'::app_role) AND judge_can_access_entry(entry_id, (SELECT auth.uid())) AND judge_round_open_by_number(entry_id, round_number));
CREATE POLICY "Judges can view decisions" ON public.judge_decisions AS PERMISSIVE FOR SELECT TO authenticated
  USING ((has_role((SELECT auth.uid()), 'judge'::app_role) AND (EXISTS (SELECT 1 FROM competition_entries ce JOIN competition_judges cj ON cj.competition_id = ce.competition_id WHERE ce.id = judge_decisions.entry_id AND cj.judge_id = (SELECT auth.uid())))) OR has_role((SELECT auth.uid()), 'admin'::app_role));
CREATE POLICY "Deleted accounts cannot delete" ON public.judge_decisions AS RESTRICTIVE FOR DELETE TO authenticated USING ((SELECT account_is_live()));
CREATE POLICY "Deleted accounts cannot insert" ON public.judge_decisions AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((SELECT account_is_live()));
CREATE POLICY "Deleted accounts cannot update" ON public.judge_decisions AS RESTRICTIVE FOR UPDATE TO authenticated USING ((SELECT account_is_live()));

-- judge_tag_assignments
CREATE POLICY "Admins can manage tag assignments" ON public.judge_tag_assignments AS PERMISSIVE FOR ALL TO authenticated
  USING (has_role((SELECT auth.uid()), 'admin'::app_role));
CREATE POLICY "Judges can assign tags" ON public.judge_tag_assignments AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((judge_id = (SELECT auth.uid())) AND has_role((SELECT auth.uid()), 'judge'::app_role) AND judge_can_access_entry(entry_id, (SELECT auth.uid())) AND judge_round_open_by_number(entry_id, round_number));
CREATE POLICY "Judges can view tag assignments" ON public.judge_tag_assignments AS PERMISSIVE FOR SELECT TO authenticated
  USING ((has_role((SELECT auth.uid()), 'judge'::app_role) AND (EXISTS (SELECT 1 FROM competition_entries ce JOIN competition_judges cj ON cj.competition_id = ce.competition_id WHERE ce.id = judge_tag_assignments.entry_id AND cj.judge_id = (SELECT auth.uid())))) OR has_role((SELECT auth.uid()), 'admin'::app_role));
CREATE POLICY "Deleted accounts cannot delete" ON public.judge_tag_assignments AS RESTRICTIVE FOR DELETE TO authenticated USING ((SELECT account_is_live()));
CREATE POLICY "Deleted accounts cannot insert" ON public.judge_tag_assignments AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((SELECT account_is_live()));
CREATE POLICY "Deleted accounts cannot update" ON public.judge_tag_assignments AS RESTRICTIVE FOR UPDATE TO authenticated USING ((SELECT account_is_live()));

-- judge_award_tags: SELECT-only for judges/admins. NO INSERT/UPDATE/DELETE
-- policy exists for any member role — the mirror (SECURITY DEFINER) is the
-- only write path. This is the property probe C0 demonstrates.
CREATE POLICY "judge_award_tags_select_admin" ON public.judge_award_tags AS PERMISSIVE FOR SELECT TO authenticated
  USING (has_role((SELECT auth.uid()), 'admin'::text) OR has_role((SELECT auth.uid()), 'super_admin'::text));
CREATE POLICY "judge_award_tags_select_self" ON public.judge_award_tags AS PERMISSIVE FOR SELECT TO authenticated
  USING (judge_id = (SELECT auth.uid()));

-- competition_judges
CREATE POLICY "Admins can manage competition judges" ON public.competition_judges AS PERMISSIVE FOR ALL TO authenticated
  USING (has_role((SELECT auth.uid()), 'admin'::app_role));
CREATE POLICY "Judges can view own assignments" ON public.competition_judges AS PERMISSIVE FOR SELECT TO authenticated
  USING (judge_id = (SELECT auth.uid()));
CREATE POLICY "Deleted accounts cannot delete" ON public.competition_judges AS RESTRICTIVE FOR DELETE TO authenticated USING ((SELECT account_is_live()));
CREATE POLICY "Deleted accounts cannot insert" ON public.competition_judges AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((SELECT account_is_live()));
CREATE POLICY "Deleted accounts cannot update" ON public.competition_judges AS RESTRICTIVE FOR UPDATE TO authenticated USING ((SELECT account_is_live()));

-- competition_round_publish
CREATE POLICY "Admins can manage round publish state" ON public.competition_round_publish AS PERMISSIVE FOR ALL TO authenticated
  USING (has_role((SELECT auth.uid()), 'admin'::app_role)) WITH CHECK (has_role((SELECT auth.uid()), 'admin'::app_role));
CREATE POLICY "Anyone authenticated can read round publish state" ON public.competition_round_publish AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "Public can read published rounds" ON public.competition_round_publish AS PERMISSIVE FOR SELECT TO anon USING (published_at IS NOT NULL);
CREATE POLICY "Deleted accounts cannot delete" ON public.competition_round_publish AS RESTRICTIVE FOR DELETE TO authenticated USING ((SELECT account_is_live()));
CREATE POLICY "Deleted accounts cannot insert" ON public.competition_round_publish AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((SELECT account_is_live()));
CREATE POLICY "Deleted accounts cannot update" ON public.competition_round_publish AS RESTRICTIVE FOR UPDATE TO authenticated USING ((SELECT account_is_live()));

-- judging_tags
CREATE POLICY "Admins can manage judging tags" ON public.judging_tags AS PERMISSIVE FOR ALL TO authenticated
  USING (has_role((SELECT auth.uid()), 'admin'::app_role));
CREATE POLICY "All users can view active tags" ON public.judging_tags AS PERMISSIVE FOR SELECT TO authenticated USING (is_active = true);
CREATE POLICY "Judges can view active tags" ON public.judging_tags AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_active = true) AND (has_role((SELECT auth.uid()), 'judge'::app_role) OR has_role((SELECT auth.uid()), 'admin'::app_role)));
CREATE POLICY "Public can read R4 award tag definitions" ON public.judging_tags AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (label = ANY (ARRAY['Top 100','Top 50','Winner','1st Runner-Up','2nd Runner-Up','Honorary Mention','Special Jury']));
CREATE POLICY "Deleted accounts cannot delete" ON public.judging_tags AS RESTRICTIVE FOR DELETE TO authenticated USING ((SELECT account_is_live()));
CREATE POLICY "Deleted accounts cannot insert" ON public.judging_tags AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((SELECT account_is_live()));
CREATE POLICY "Deleted accounts cannot update" ON public.judging_tags AS RESTRICTIVE FOR UPDATE TO authenticated USING ((SELECT account_is_live()));

-- user_roles
CREATE POLICY "Admins can manage roles" ON public.user_roles AS PERMISSIVE FOR ALL TO authenticated
  USING (has_role((SELECT auth.uid()), 'admin'::app_role));
CREATE POLICY "Admins can view all roles" ON public.user_roles AS PERMISSIVE FOR SELECT TO authenticated
  USING (has_role((SELECT auth.uid()), 'admin'::app_role));
CREATE POLICY "Users can self-assign photographer role" ON public.user_roles AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((user_id = (SELECT auth.uid())) AND (role = 'registered_photographer'::text));
CREATE POLICY "Users can view own roles" ON public.user_roles AS PERMISSIVE FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY "Deleted accounts cannot delete" ON public.user_roles AS RESTRICTIVE FOR DELETE TO authenticated USING ((SELECT account_is_live()));
CREATE POLICY "Deleted accounts cannot insert" ON public.user_roles AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((SELECT account_is_live()));
CREATE POLICY "Deleted accounts cannot update" ON public.user_roles AS RESTRICTIVE FOR UPDATE TO authenticated USING ((SELECT account_is_live()));

-- competition_entries (needed by judge_can_access_entry joins + SELECT views)
CREATE POLICY "Admins can manage entries" ON public.competition_entries AS PERMISSIVE FOR ALL TO public
  USING (has_role((SELECT auth.uid()), 'admin'::app_role));
CREATE POLICY "Authenticated can view public-status entries" ON public.competition_entries AS PERMISSIVE FOR SELECT TO authenticated
  USING (status = ANY (ARRAY['submitted','approved','winner','runner_up','honorary','finalist','shortlisted','qualified','round1_qualified','round2_qualified','round3_qualified']));
CREATE POLICY "Deleted accounts cannot delete" ON public.competition_entries AS RESTRICTIVE FOR DELETE TO authenticated USING ((SELECT account_is_live()));
CREATE POLICY "Deleted accounts cannot insert" ON public.competition_entries AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((SELECT account_is_live()));
CREATE POLICY "Deleted accounts cannot update" ON public.competition_entries AS RESTRICTIVE FOR UPDATE TO authenticated USING ((SELECT account_is_live()));

-- ═══ GRANTS (member verbs as verified live post-20260814175909: SELECT/INSERT/UPDATE/DELETE) ═══
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;

-- ═══ SEEDS (fixed UUIDs; superuser writes, RLS not yet in play) ═══

INSERT INTO auth.users (id) VALUES
  ('00000000-0000-0000-0000-0000000000a1'), -- admin_u
  ('00000000-0000-0000-0000-0000000000a2'), -- judge_a   (judge, comp1)
  ('00000000-0000-0000-0000-0000000000a3'), -- judge_b   (judge, comp2 distributed)
  ('00000000-0000-0000-0000-0000000000a4'), -- member_m  (plain member)
  ('00000000-0000-0000-0000-0000000000a5')  -- judge_p   (judge AND participant, comp1)
ON CONFLICT DO NOTHING;

INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'admin'),
  ('00000000-0000-0000-0000-0000000000a2', 'judge'),
  ('00000000-0000-0000-0000-0000000000a3', 'judge'),
  ('00000000-0000-0000-0000-0000000000a5', 'judge');

INSERT INTO public.competitions (id, title, category, status, starts_at, ends_at, created_by, phase, judge_assignment_mode) VALUES
  ('00000000-0000-0000-0000-0000000000c1', 'CG2 Comp Centralized', 'open', 'active', now() - interval '30 days', now() + interval '30 days', '00000000-0000-0000-0000-0000000000a1', 'judging', 'centralized'),
  ('00000000-0000-0000-0000-0000000000c2', 'CG2 Comp Distributed', 'open', 'active', now() - interval '30 days', now() + interval '30 days', '00000000-0000-0000-0000-0000000000a1', 'judging', 'distributed');

INSERT INTO public.competition_judges (competition_id, judge_id, assigned_by) VALUES
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-0000000000a1');

INSERT INTO public.competition_entries (id, competition_id, user_id, title, photos, status, current_round) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a4', 'entry e1 (member_m, comp1)', ARRAY['p/e1.webp'], 'approved', '4'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a4', 'entry e2 (member_m, comp2)', ARRAY['p/e2.webp'], 'approved', '1'),
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a5', 'entry ep (judge_p OWN entry, comp1)', ARRAY['p/ep.webp'], 'approved', '4');

INSERT INTO public.judging_rounds (competition_id, round_number, name, status) VALUES
  ('00000000-0000-0000-0000-0000000000c1', 1, 'R1', 'active'),
  ('00000000-0000-0000-0000-0000000000c1', 2, 'R2', 'pending'),
  ('00000000-0000-0000-0000-0000000000c1', 3, 'R3', 'pending'),
  ('00000000-0000-0000-0000-0000000000c1', 4, 'R4', 'active'),
  ('00000000-0000-0000-0000-0000000000c2', 1, 'R1', 'active');

INSERT INTO public.judging_tags (id, label, created_by, visible_in_round, is_system) VALUES
  ('00000000-0000-0000-0000-00000000f0a1', 'Winner',        '00000000-0000-0000-0000-0000000000a1', ARRAY[4], true),
  ('00000000-0000-0000-0000-00000000f0a2', '1st Runner-Up', '00000000-0000-0000-0000-0000000000a1', ARRAY[4], true),
  ('00000000-0000-0000-0000-00000000f0a3', 'Judge Favourite (uncatalogued)', '00000000-0000-0000-0000-0000000000a1', ARRAY[4], false);

-- Stage catalog rows exactly as pulled from production (the three this cycle uses).
INSERT INTO public.v3_stage_catalog (stage_key, round_number, family, decision_token, tag_label_canonical, description) VALUES
  ('r4_winner',      4, 'award', 'winner',      'Winner',        'R4 winner'),
  ('r4_runner_up_1', 4, 'award', 'runner_up_1', '1st Runner-Up', 'R4 first runner-up'),
  ('r1_accepted',    1, 'progression_pass', 'accept', 'Accepted', 'R1 accept');

-- One publish row so the D3 deny probe has a target (deviation #4 applies).
INSERT INTO public.competition_round_publish (competition_id, round_number) VALUES
  ('00000000-0000-0000-0000-0000000000c1', 1);

SELECT 'SCHEMA+SEED OK' AS ok,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public') AS policies,
  (SELECT count(*) FROM auth.users) AS users;
