-- ============================================================================
-- P5 SAFEGUARDS
-- ============================================================================

-- 1. Extend photo_meta validation: hash + exif_available + photo cap + text caps
CREATE OR REPLACE FUNCTION public.validate_competition_entry_photo_meta()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _photos_len  integer := COALESCE(array_length(NEW.photos, 1), 0);
  _meta_len    integer := COALESCE(jsonb_array_length(NEW.photo_meta), 0);
  _i           integer;
  _item        jsonb;
  _sha         text;
  _exif_avail  jsonb;
BEGIN
  -- Photos cap
  IF _photos_len > 10 THEN
    RAISE EXCEPTION 'Maximum 10 photos per entry (got %)', _photos_len
      USING ERRCODE = 'check_violation';
  END IF;

  -- Title length 3-200
  IF NEW.title IS NULL OR char_length(btrim(NEW.title)) < 3 OR char_length(NEW.title) > 200 THEN
    RAISE EXCEPTION 'Title must be 3-200 characters'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Description cap
  IF NEW.description IS NOT NULL AND char_length(NEW.description) > 5000 THEN
    RAISE EXCEPTION 'Description must be at most 5000 characters'
      USING ERRCODE = 'check_violation';
  END IF;

  -- meta length must match photo count
  IF _photos_len = 0 AND _meta_len = 0 THEN
    RETURN NEW;
  END IF;
  IF _meta_len <> _photos_len THEN
    RAISE EXCEPTION 'photo_meta length (%) must match photos length (%)', _meta_len, _photos_len
      USING ERRCODE = 'check_violation';
  END IF;

  -- Per-photo integrity: image_hash.sha256 (64 hex) + exif_available boolean
  FOR _i IN 0 .. _meta_len - 1 LOOP
    _item := NEW.photo_meta -> _i;

    _exif_avail := _item -> 'exif_available';
    IF _exif_avail IS NULL OR jsonb_typeof(_exif_avail) <> 'boolean' THEN
      RAISE EXCEPTION 'photo_meta[%].exif_available must be boolean', _i
        USING ERRCODE = 'check_violation';
    END IF;

    _sha := _item #>> '{image_hash,sha256}';
    IF _sha IS NULL OR _sha !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'photo_meta[%].image_hash.sha256 must be 64 hex chars', _i
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

-- 2. AI advisory consistency trigger
CREATE OR REPLACE FUNCTION public.validate_competition_entry_ai_advisory()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_ai_advisory = true AND NEW.ai_detection_result IS NULL THEN
    RAISE EXCEPTION 'is_ai_advisory cannot be true without ai_detection_result'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_competition_entry_ai_advisory ON public.competition_entries;
CREATE TRIGGER trg_validate_competition_entry_ai_advisory
BEFORE INSERT OR UPDATE OF is_ai_advisory, ai_detection_result ON public.competition_entries
FOR EACH ROW
EXECUTE FUNCTION public.validate_competition_entry_ai_advisory();

-- 3. Status transition guard
CREATE OR REPLACE FUNCTION public.validate_competition_entry_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _allowed text[] := ARRAY[
    'draft','submitted','approved','round1_qualified','round2_qualified',
    'finalist','winner','rejected','hold'
  ];
  _ok boolean := false;
BEGIN
  -- Validate the new value is in our known set
  IF NOT (NEW.status = ANY(_allowed)) THEN
    RAISE EXCEPTION 'Unknown entry status %', NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- INSERT: only allow draft / submitted / approved as starting states
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('draft','submitted','approved') THEN
      RAISE EXCEPTION 'New entries must start as draft, submitted, or approved (got %)', NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: same status is always fine
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Allowed forward paths
  _ok := CASE OLD.status
    WHEN 'draft'             THEN NEW.status IN ('submitted','rejected')
    WHEN 'submitted'         THEN NEW.status IN ('approved','rejected','hold','round1_qualified')
    WHEN 'approved'          THEN NEW.status IN ('round1_qualified','rejected','hold')
    WHEN 'round1_qualified'  THEN NEW.status IN ('round2_qualified','rejected','hold')
    WHEN 'round2_qualified'  THEN NEW.status IN ('finalist','rejected','hold')
    WHEN 'finalist'          THEN NEW.status IN ('winner','rejected','hold')
    WHEN 'hold'              THEN NEW.status IN ('approved','submitted','rejected','round1_qualified','round2_qualified','finalist')
    WHEN 'rejected'          THEN NEW.status IN ('hold','submitted')
    WHEN 'winner'            THEN NEW.status IN ('hold')
    ELSE false
  END;

  IF NOT _ok THEN
    RAISE EXCEPTION 'Illegal status transition % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_competition_entry_status_transition ON public.competition_entries;
CREATE TRIGGER trg_validate_competition_entry_status_transition
BEFORE INSERT OR UPDATE OF status ON public.competition_entries
FOR EACH ROW
EXECUTE FUNCTION public.validate_competition_entry_status_transition();

-- 4. Submission throttle: max 5 inserts per user per competition per 60s
CREATE OR REPLACE FUNCTION public.throttle_competition_entry_inserts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _recent integer;
BEGIN
  SELECT count(*) INTO _recent
  FROM public.competition_entries
  WHERE user_id = NEW.user_id
    AND competition_id = NEW.competition_id
    AND created_at > now() - interval '60 seconds';

  IF _recent >= 5 THEN
    RAISE EXCEPTION 'Submission throttle: too many entries in the last 60 seconds (max 5 per competition)'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_throttle_competition_entry_inserts ON public.competition_entries;
CREATE TRIGGER trg_throttle_competition_entry_inserts
BEFORE INSERT ON public.competition_entries
FOR EACH ROW
EXECUTE FUNCTION public.throttle_competition_entry_inserts();