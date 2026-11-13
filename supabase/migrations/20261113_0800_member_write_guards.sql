-- ═══════════════════════════════════════════════════════════════════════════
-- 20261113_0800 · A MEMBER CANNOT WRITE A RESULT — the database decides
--
-- Owner 13 Nov 2026 (security audit, read of the 17 Oct live copy):
--   1. A member could change ANY column of their own entry while the
--      competition takes entries (the policy "Users can update own metadata
--      only" is a row rule; Postgres row rules cannot limit columns). Walking
--      status submitted → … → winner made trg_auto_certificate_r4_award issue a
--      real Winner certificate. is_pinned / is_trending / view_count likewise.
--   2. A member could insert their own "winner" / "finalist" certificate: the
--      insert policy only checked user_id = me and a type list.
--   3. Votes after voting closed: cast-photo-vote checks the window, the
--      database did not, so a direct insert skipped it.
--
-- One rule per concept, every caller the same:
--   • trg_0_entry_member_write_guard (competition_entries, BEFORE INSERT OR
--     UPDATE, named to run first): a DIRECT write from the app by a member
--     (current_user authenticated/anon, not an admin) may change only
--     title, description, photos, photo_thumbnails, photo_meta, exif_data,
--     updated_at — exactly what useUpdateCompetitionEntry sends. A new entry
--     inserted directly must start as draft/submitted with no result.
--   • trg_0_certificate_member_request_guard (certificates, BEFORE INSERT,
--     runs before trg_generate_certificate_identifiers): a member may insert
--     only the certificate the Certificates page offers — the same
--     eligibility rule (src/pages/Certificates.tsx resolveEligibleRound) over
--     get_my_certificate_entries(); the title/description are set from the
--     page's own template; every other column gets its default.
--   • trg_0_vote_window_guard (competition_votes, BEFORE INSERT OR UPDATE,
--     every writer): the same window cast-photo-vote already applies —
--     current_phase in (voting, submission_open) and not after voting_ends_at.
--
-- NOT CHANGED: admins (has_role admin), edge functions (service_role),
-- SECURITY DEFINER functions and cron run as another role, so their writes
-- (judging, complete-round, auto certificates, admin screens) are untouched.
-- No policy, grant or existing function is altered.
--
-- Rollback: supabase/rollback/20261113_0800_member_write_guards_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261113_0800_member_write_guards.sql
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'APPLY REFUSED — p32.lane is not asserted as staging or production. Dispatch apply-migration.yml.';
  END IF;
END
$lane_guard$;

-- ── 1. entries: a member edits words and photos, never a result ────────────
-- SECURITY INVOKER on purpose: current_user is the caller's role only in an
-- invoker function (inside a definer one it would be the owner).
CREATE FUNCTION public.tg_entry_member_write_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = ''
AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _changed text[];
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;  -- server code, definer functions, edge functions, cron
  END IF;
  IF _uid IS NOT NULL AND public.has_role(_uid, 'admin'::public.app_role) THEN
    RETURN NEW;  -- admin screens
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(n.key ORDER BY n.key) INTO _changed
      FROM jsonb_each(to_jsonb(NEW)) n
     WHERE n.key NOT IN ('title', 'description', 'photos', 'photo_thumbnails', 'photo_meta',
                         'exif_data', 'updated_at', 'current_round_int')
       AND n.value IS DISTINCT FROM (to_jsonb(OLD) -> n.key);
    IF _changed IS NOT NULL THEN
      RAISE EXCEPTION 'Only the title, description and photos of an entry can be changed by its owner (not: %)',
        array_to_string(_changed, ', ') USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.status NOT IN ('draft', 'submitted')
       OR NEW.placement IS NOT NULL OR NEW.stage_key IS NOT NULL OR NEW.progression_decision IS NOT NULL
       OR coalesce(NEW.current_round, '1') <> '1'
       OR coalesce(NEW.certificate_ready, false) OR coalesce(NEW.is_pinned, false) OR coalesce(NEW.is_trending, false)
       OR coalesce(NEW.view_count, 0) <> 0
       OR NEW.ai_detection_result IS NOT NULL OR NEW.is_ai_advisory IS DISTINCT FROM true
       OR NEW.public_status_derived IS NOT NULL OR NEW.public_round_derived IS NOT NULL
       OR NEW.public_placement_derived IS NOT NULL OR NEW.public_progression_note_derived IS NOT NULL
       OR NEW.public_r4_tags_derived IS NOT NULL THEN
      RAISE EXCEPTION 'A new entry starts as submitted with no result — results are set by the judges'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.tg_entry_member_write_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_0_entry_member_write_guard
  BEFORE INSERT OR UPDATE ON public.competition_entries
  FOR EACH ROW EXECUTE FUNCTION public.tg_entry_member_write_guard();

-- ── 2. certificates: a member gets only the one the page offers ────────────
CREATE FUNCTION public.tg_certificate_member_request_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = ''
AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _e record;
  _pub int[];
  _round int;
  _type text;
  _comp text;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;  -- auto_certificate_on_r4_award, edge functions, cron
  END IF;
  IF _uid IS NOT NULL AND public.has_role(_uid, 'admin'::public.app_role) THEN
    RETURN NEW;  -- AdminCertificates
  END IF;
  IF _uid IS NULL OR NEW.user_id IS DISTINCT FROM _uid THEN
    RAISE EXCEPTION 'A certificate can only be requested for yourself' USING ERRCODE = '42501';
  END IF;

  -- the same rows the Certificates page reads (own, certificate_ready, a round declared)
  SELECT * INTO _e FROM public.get_my_certificate_entries() g WHERE g.id = NEW.reference_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This certificate is not available for this entry' USING ERRCODE = '42501';
  END IF;
  SELECT array_agg(p.round_number) INTO _pub
    FROM public.competition_round_publish p
   WHERE p.competition_id = _e.competition_id AND p.published_at IS NOT NULL;
  _round := coalesce(_e.current_round_int, nullif(regexp_replace(coalesce(_e.current_round, ''), '\D', '', 'g'), '')::int);

  -- src/pages/Certificates.tsx resolveEligibleRound, high → low, same order
  _type := CASE
    WHEN 4 = ANY(_pub) AND _e.placement = 'winner' THEN 'winner'
    WHEN 4 = ANY(_pub) AND _e.placement IN ('1st_runner_up', '2nd_runner_up') THEN 'finalist'
    WHEN 4 = ANY(_pub) AND _e.status IN ('finalist', 'shortlisted') THEN 'finalist'
    WHEN 4 = ANY(_pub) AND _e.progression_decision = 'qualified' AND _round = 4 THEN 'participation_r4'
    WHEN 3 = ANY(_pub) AND _e.progression_decision = 'qualified' AND _round = 3 THEN 'participation_r3'
    WHEN 2 = ANY(_pub) AND _e.progression_decision = 'qualified' AND _round = 2 THEN 'participation_r2'
    WHEN 1 = ANY(_pub) AND _e.progression_decision IN ('accept', 'accepted') THEN 'participation_r1'
  END;
  IF _type IS NULL OR _type IS DISTINCT FROM NEW.type THEN
    RAISE EXCEPTION 'This certificate is not available for this entry' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.certificates c
              WHERE c.user_id = _uid AND c.type = NEW.type
                AND c.reference_id IN (_e.id, _e.competition_id)) THEN
    RAISE EXCEPTION 'You already have this certificate' USING ERRCODE = '23505';
  END IF;

  -- the page's own wording (certLabel) — never the member's
  _comp := coalesce(nullif(_e.competition_title, ''), 'Competition');
  NEW.title := CASE NEW.type
    WHEN 'winner' THEN 'Winner — ' || _comp
    WHEN 'finalist' THEN 'Finalist — ' || _comp
    WHEN 'participation_r4' THEN 'Qualified for Final — ' || _comp
    WHEN 'participation_r3' THEN 'Round 3 Qualifier — ' || _comp
    WHEN 'participation_r2' THEN 'Round 2 Qualifier — ' || _comp
    ELSE 'Accepted — ' || _comp END;
  NEW.description := CASE NEW.type
    WHEN 'winner' THEN 'Winner certificate for ' || _comp
    WHEN 'finalist' THEN 'Finalist certificate for ' || _comp
    WHEN 'participation_r4' THEN 'Final-round qualification for ' || _comp
    WHEN 'participation_r3' THEN 'Round 3 qualification for ' || _comp
    WHEN 'participation_r2' THEN 'Round 2 qualification for ' || _comp
    ELSE 'Round 1 acceptance for ' || _comp END;
  -- everything else as if the column had been left out
  NEW.issued_at := now();
  NEW.published_at := now();
  NEW.file_url := NULL;
  NEW.heading := NULL;
  NEW.is_featured := false;
  NEW.featured_quote := NULL;
  NEW.featured_order := 0;
  NEW.is_revoked := false;
  NEW.revoked_at := NULL;
  NEW.revoked_reason := NULL;
  NEW.certificate_id := NULL;      -- trg_generate_certificate_identifiers fills both
  NEW.verification_token := NULL;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.tg_certificate_member_request_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_0_certificate_member_request_guard
  BEFORE INSERT ON public.certificates
  FOR EACH ROW EXECUTE FUNCTION public.tg_certificate_member_request_guard();

-- ── 3. votes: the window cast-photo-vote already uses, for every writer ────
CREATE FUNCTION public.tg_vote_window_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $fn$
DECLARE
  _comp uuid;
  _phase text;
  _vend timestamptz;
BEGIN
  SELECT e.competition_id INTO _comp FROM public.competition_entries e WHERE e.id = NEW.entry_id;
  IF _comp IS NULL THEN
    RETURN NEW;  -- the foreign key refuses it
  END IF;
  _phase := coalesce(public.current_phase(_comp), 'submission_open');
  SELECT c.voting_ends_at INTO _vend FROM public.competitions c WHERE c.id = _comp;
  IF _phase NOT IN ('voting', 'submission_open') OR (_vend IS NOT NULL AND now() > _vend) THEN
    RAISE EXCEPTION 'Voting is not open for this competition' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.tg_vote_window_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_0_vote_window_guard
  BEFORE INSERT OR UPDATE ON public.competition_votes
  FOR EACH ROW EXECUTE FUNCTION public.tg_vote_window_guard();

COMMIT;
