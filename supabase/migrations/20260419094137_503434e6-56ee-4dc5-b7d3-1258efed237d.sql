CREATE OR REPLACE FUNCTION public.extract_photo_hashes(_meta jsonb)
RETURNS TABLE(photo_index integer, sha256 text, phash text)
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT
    (idx - 1)::integer AS photo_index,
    NULLIF(elem->'image_hash'->>'sha256', '') AS sha256,
    NULLIF(elem->'image_hash'->>'phash',  '') AS phash
  FROM jsonb_array_elements(COALESCE(_meta, '[]'::jsonb)) WITH ORDINALITY AS arr(elem, idx)
  WHERE elem ? 'image_hash'
    AND elem->'image_hash' IS NOT NULL
    AND elem->'image_hash' <> 'null'::jsonb;
$$;

CREATE OR REPLACE FUNCTION public.hex_hamming_distance(_a text, _b text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  _ba bytea;
  _bb bytea;
  _i  integer;
  _x  integer;
  _dist integer := 0;
BEGIN
  IF _a IS NULL OR _b IS NULL OR length(_a) <> length(_b) OR length(_a) = 0 THEN
    RETURN NULL;
  END IF;

  BEGIN
    _ba := decode(_a, 'hex');
    _bb := decode(_b, 'hex');
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;

  FOR _i IN 0..length(_ba) - 1 LOOP
    _x := get_byte(_ba, _i) # get_byte(_bb, _i);
    WHILE _x > 0 LOOP
      _dist := _dist + 1;
      _x := _x & (_x - 1);
    END LOOP;
  END LOOP;

  RETURN _dist;
END;
$$;