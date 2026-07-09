-- P4 Judge: hash extraction + duplicate detection + RAW commitment summary.

-- GIN index for fast hash lookups inside photo_meta jsonb array.
CREATE INDEX IF NOT EXISTS idx_competition_entries_photo_meta_gin
  ON public.competition_entries USING gin (photo_meta jsonb_path_ops);

-- ───────────────────────────────────────────────────────────────────
-- Helper: extract (sha256, phash) pairs from an entry's photo_meta.
-- Returns one row per photo with non-null sha256 OR phash.
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.extract_photo_hashes(_meta jsonb)
RETURNS TABLE(photo_index integer, sha256 text, phash text)
LANGUAGE sql
IMMUTABLE
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

-- ───────────────────────────────────────────────────────────────────
-- Hamming distance between two equal-length hex strings (pHash usually 16 hex chars = 64 bits).
-- Returns NULL if lengths differ or inputs are malformed.
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hex_hamming_distance(_a text, _b text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
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
    -- Brian Kernighan bit-count
    WHILE _x > 0 LOOP
      _dist := _dist + 1;
      _x := _x & (_x - 1);
    END LOOP;
  END LOOP;

  RETURN _dist;
END;
$$;

-- ───────────────────────────────────────────────────────────────────
-- Duplicate clusters within ONE competition.
-- Returns one row per (entry_id, photo_index) that has at least one
-- collision with another (entry_id, photo_index) in the same competition.
-- match_type: 'exact' (sha256 match) or 'similar' (phash hamming ≤ 6).
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_competition_duplicate_clusters(_competition_id uuid)
RETURNS TABLE(
  cluster_key text,
  match_type text,
  entry_id uuid,
  photo_index integer,
  user_id uuid,
  entry_title text,
  photo_url text,
  thumbnail_url text,
  created_at timestamptz,
  matched_against_entry uuid,
  matched_against_photo integer,
  hamming_distance integer
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _caller uuid := auth.uid();
  _allowed boolean;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT public.has_role(_caller, 'admin'::app_role) OR EXISTS (
    SELECT 1 FROM public.competition_judges
    WHERE competition_id = _competition_id AND judge_id = _caller
  ) INTO _allowed;

  IF NOT _allowed THEN
    RAISE EXCEPTION 'Permission denied: not a judge for this competition';
  END IF;

  RETURN QUERY
  WITH photo_hashes AS (
    SELECT
      ce.id   AS entry_id,
      ce.user_id,
      ce.title,
      ce.created_at,
      ce.photos,
      ce.photo_thumbnails,
      ph.photo_index,
      ph.sha256,
      ph.phash
    FROM public.competition_entries ce
    CROSS JOIN LATERAL public.extract_photo_hashes(ce.photo_meta) ph
    WHERE ce.competition_id = _competition_id
      AND ce.status NOT IN ('rejected')
  ),
  -- exact sha256 collisions
  exact_pairs AS (
    SELECT
      a.sha256 AS cluster_key,
      'exact'::text AS match_type,
      a.entry_id,
      a.photo_index,
      a.user_id,
      a.title AS entry_title,
      a.photos[a.photo_index + 1] AS photo_url,
      COALESCE(a.photo_thumbnails[a.photo_index + 1], a.photos[a.photo_index + 1]) AS thumbnail_url,
      a.created_at,
      b.entry_id AS matched_against_entry,
      b.photo_index AS matched_against_photo,
      0 AS hamming_distance
    FROM photo_hashes a
    JOIN photo_hashes b
      ON a.sha256 = b.sha256
     AND a.sha256 IS NOT NULL
     AND (a.entry_id <> b.entry_id OR a.photo_index <> b.photo_index)
  ),
  -- perceptual collisions (only when not already exact-matched)
  similar_pairs AS (
    SELECT
      LEAST(a.phash, b.phash) || '~' || GREATEST(a.phash, b.phash) AS cluster_key,
      'similar'::text AS match_type,
      a.entry_id,
      a.photo_index,
      a.user_id,
      a.title AS entry_title,
      a.photos[a.photo_index + 1] AS photo_url,
      COALESCE(a.photo_thumbnails[a.photo_index + 1], a.photos[a.photo_index + 1]) AS thumbnail_url,
      a.created_at,
      b.entry_id AS matched_against_entry,
      b.photo_index AS matched_against_photo,
      public.hex_hamming_distance(a.phash, b.phash) AS hamming_distance
    FROM photo_hashes a
    JOIN photo_hashes b
      ON a.phash IS NOT NULL
     AND b.phash IS NOT NULL
     AND length(a.phash) = length(b.phash)
     AND (a.entry_id <> b.entry_id OR a.photo_index <> b.photo_index)
     AND (a.sha256 IS NULL OR b.sha256 IS NULL OR a.sha256 <> b.sha256)
    WHERE public.hex_hamming_distance(a.phash, b.phash) <= 6
  )
  SELECT * FROM exact_pairs
  UNION ALL
  SELECT * FROM similar_pairs
  ORDER BY match_type, cluster_key, created_at;
END;
$$;

-- ───────────────────────────────────────────────────────────────────
-- RAW commitment summary for a competition (Judge tab data).
-- Joins per-photo raw_required flag with the immutable raw_commitments ledger.
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_competition_raw_commitments(_competition_id uuid)
RETURNS TABLE(
  entry_id uuid,
  photo_index integer,
  user_id uuid,
  entry_title text,
  photo_url text,
  thumbnail_url text,
  photo_title text,
  raw_required boolean,
  exif_available boolean,
  committed_at timestamptz,
  source text,
  raw_delivered_at timestamptz,
  raw_file_url text,
  admin_verified_at timestamptz,
  admin_verified_by uuid
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _caller uuid := auth.uid();
  _allowed boolean;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT public.has_role(_caller, 'admin'::app_role) OR EXISTS (
    SELECT 1 FROM public.competition_judges
    WHERE competition_id = _competition_id AND judge_id = _caller
  ) INTO _allowed;

  IF NOT _allowed THEN
    RAISE EXCEPTION 'Permission denied: not a judge for this competition';
  END IF;

  RETURN QUERY
  WITH photo_meta_unnested AS (
    SELECT
      ce.id AS entry_id,
      ce.user_id,
      ce.title AS entry_title,
      ce.photos,
      ce.photo_thumbnails,
      (idx - 1)::integer AS photo_index,
      elem AS meta
    FROM public.competition_entries ce
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ce.photo_meta, '[]'::jsonb))
      WITH ORDINALITY AS arr(elem, idx)
    WHERE ce.competition_id = _competition_id
      AND ce.status NOT IN ('rejected')
  ),
  flagged AS (
    SELECT
      pmu.entry_id,
      pmu.photo_index,
      pmu.user_id,
      pmu.entry_title,
      pmu.photos[pmu.photo_index + 1] AS photo_url,
      COALESCE(pmu.photo_thumbnails[pmu.photo_index + 1], pmu.photos[pmu.photo_index + 1]) AS thumbnail_url,
      NULLIF(pmu.meta->>'title', '') AS photo_title,
      COALESCE((pmu.meta->>'raw_required')::boolean, false) AS raw_required,
      COALESCE((pmu.meta->>'exif_available')::boolean, false) AS exif_available
    FROM photo_meta_unnested pmu
    WHERE COALESCE((pmu.meta->>'raw_required')::boolean, false) = true
  )
  SELECT
    f.entry_id,
    f.photo_index,
    f.user_id,
    f.entry_title,
    f.photo_url,
    f.thumbnail_url,
    f.photo_title,
    f.raw_required,
    f.exif_available,
    rc.committed_at,
    rc.source,
    rc.raw_delivered_at,
    rc.raw_file_url,
    rc.admin_verified_at,
    rc.admin_verified_by
  FROM flagged f
  LEFT JOIN LATERAL (
    SELECT *
    FROM public.raw_commitments r
    WHERE r.entry_id = f.entry_id
      AND r.photo_index = f.photo_index
    ORDER BY r.committed_at DESC
    LIMIT 1
  ) rc ON true
  ORDER BY f.entry_title, f.photo_index;
END;
$$;