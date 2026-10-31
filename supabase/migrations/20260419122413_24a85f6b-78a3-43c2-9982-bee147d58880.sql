-- ============================================================================
-- Per-photo schema: title (required), description (optional, ≤500), is_ai_generated (boolean)
-- ============================================================================

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
  _title       text;
  _desc        text;
  _ai_flag     jsonb;
BEGIN
  -- Photos cap
  IF _photos_len > 10 THEN
    RAISE EXCEPTION 'Maximum 10 photos per entry (got %)', _photos_len
      USING ERRCODE = 'check_violation';
  END IF;

  -- Entry title length 3-200 (kept for back-compat with leaderboards/certificates)
  IF NEW.title IS NULL OR char_length(btrim(NEW.title)) < 3 OR char_length(NEW.title) > 200 THEN
    RAISE EXCEPTION 'Title must be 3-200 characters'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Entry description cap (kept for back-compat)
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

  -- Per-photo integrity
  FOR _i IN 0 .. _meta_len - 1 LOOP
    _item := NEW.photo_meta -> _i;

    -- exif_available boolean
    _exif_avail := _item -> 'exif_available';
    IF _exif_avail IS NULL OR jsonb_typeof(_exif_avail) <> 'boolean' THEN
      RAISE EXCEPTION 'photo_meta[%].exif_available must be boolean', _i
        USING ERRCODE = 'check_violation';
    END IF;

    -- image_hash.sha256 64 hex
    _sha := _item #>> '{image_hash,sha256}';
    IF _sha IS NULL OR _sha !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'photo_meta[%].image_hash.sha256 must be 64 hex chars', _i
        USING ERRCODE = 'check_violation';
    END IF;

    -- Per-photo title: required 1-120 (NEW)
    _title := _item ->> 'title';
    IF _title IS NULL OR char_length(btrim(_title)) < 1 OR char_length(_title) > 120 THEN
      RAISE EXCEPTION 'photo_meta[%].title must be 1-120 characters', _i
        USING ERRCODE = 'check_violation';
    END IF;

    -- Per-photo description: optional, max 500 chars (NEW)
    _desc := _item ->> 'description';
    IF _desc IS NOT NULL AND char_length(_desc) > 500 THEN
      RAISE EXCEPTION 'photo_meta[%].description must be at most 500 characters', _i
        USING ERRCODE = 'check_violation';
    END IF;

    -- Per-photo is_ai_generated: optional boolean (NEW)
    _ai_flag := _item -> 'is_ai_generated';
    IF _ai_flag IS NOT NULL AND jsonb_typeof(_ai_flag) <> 'boolean' THEN
      RAISE EXCEPTION 'photo_meta[%].is_ai_generated must be boolean when present', _i
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;