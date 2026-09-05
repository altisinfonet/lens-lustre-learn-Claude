-- F-93 · unit 2 of 5 — deriving a legal, unique, stable URL from a member's name.
--
-- THE FORMAT IS DICTATED BY THE COLUMN, NOT BY PREFERENCE:
--   profiles_custom_url_format
--     CHECK (custom_url ~ '^[a-z0-9_][a-z0-9._]{1,28}[a-z0-9_]$' AND custom_url !~ '\.\.')
-- so: lowercase a-z, digits, '.' and '_' ONLY; 3–30 characters; cannot begin or
-- end with a dot; no doubled dots. NOTE WHAT IS ABSENT: the hyphen. An earlier
-- spec for this work said reduce to [a-z0-9.-]; that would have produced values
-- this column rejects outright. Hyphens and apostrophes are therefore STRIPPED,
-- not substituted — "Jean-Luc Picard" becomes jeanluc.picard, not
-- jean.luc.picard — because 86 of the 97 existing production URLs are
-- single-dot first.last and a three-part value would look like a mistake to the
-- member who received it.

-- ---------------------------------------------------------------------------
-- Accent folding, done by hand and NOT with unaccent().
-- unaccent() is STABLE, not IMMUTABLE (its rules live in a mutable dictionary),
-- so a function built on it cannot itself be IMMUTABLE and cannot be indexed or
-- relied upon to give the same answer forever. A stable answer is the whole
-- point here: the same name must yield the same URL on every re-run, on both
-- lanes, for years. translate() is immutable, so this is.
CREATE OR REPLACE FUNCTION public.custom_url_fold_accents(_s text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT translate(
    lower(coalesce(_s, '')),
    'àáâãäåāăąèéêëēĕėęěìíîïĩīĭįıòóôõöøōŏőùúûüũūŭůűųñńņňçćĉċčŝśšşžźżýÿŷđðþßæœ',
    'aaaaaaaaaeeeeeeeeeiiiiiiiiiooooooooouuuuuuuuuunnnncccccsssszzzyyyddtsao'
  );
$$;

COMMENT ON FUNCTION public.custom_url_fold_accents(text) IS
  'F-93. Folds common Latin-script diacritics to ASCII. Deliberately NOT unaccent(): that function is STABLE rather than IMMUTABLE, and this derivation must give the same answer forever. Non-Latin scripts are not transliterated — they fold to nothing, which custom_url_slug() reports as NULL so the caller can use the id-based fallback.';

-- ---------------------------------------------------------------------------
-- The stem: first.last, one dot, house style.
-- Returns NULL — never '' and never '.' — when the name carries no usable
-- character at all. NULL is the honest answer and forces the caller to decide;
-- an empty string would sail straight into a URL.
CREATE OR REPLACE FUNCTION public.custom_url_slug(_full_name text)
RETURNS text LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  _folded text;
  _parts  text[];
  _clean  text[] := '{}';
  _p      text;
  _stem   text;
BEGIN
  _folded := public.custom_url_fold_accents(_full_name);

  -- Split on anything that is not a letter or digit. This is what removes
  -- hyphens, apostrophes and spaces in one step: "O'Brien-Nakamura" becomes
  -- three fragments, which are then rejoined WITHOUT separators inside the
  -- surname so the value keeps its two-part shape.
  _parts := regexp_split_to_array(_folded, '[^a-z0-9]+');

  FOREACH _p IN ARRAY coalesce(_parts, '{}') LOOP
    IF _p <> '' THEN _clean := _clean || _p; END IF;
  END LOOP;

  IF array_length(_clean, 1) IS NULL THEN
    RETURN NULL;                                    -- only punctuation, or only emoji, or a non-Latin script
  ELSIF array_length(_clean, 1) = 1 THEN
    _stem := _clean[1];                             -- a single-word name: no dot to add
  ELSE
    -- First token and LAST token. Middle names are dropped rather than joined,
    -- because first.middle.last is a three-part shape that exists nowhere on
    -- the site.
    _stem := _clean[1] || '.' || _clean[array_length(_clean, 1)];
  END IF;

  -- Fit the column: 30 characters, and the last character may not be a dot.
  _stem := left(_stem, 30);
  _stem := regexp_replace(_stem, '[._]+$', '');
  _stem := regexp_replace(_stem, '^[.]+', '');

  IF length(_stem) < 3 THEN
    RETURN NULL;                                    -- "Li Wu" is fine at 5; "A" is not, and padding it would invent a name
  END IF;

  RETURN _stem;
END;
$$;

COMMENT ON FUNCTION public.custom_url_slug(text) IS
  'F-93. first.last, one dot, [a-z0-9._], 3-30 chars. Hyphens/apostrophes/spaces are stripped, middle names dropped. Returns NULL (never an empty string) when the name reduces to nothing usable or to fewer than 3 characters.';

-- ---------------------------------------------------------------------------
-- Availability. One predicate, consulted by every caller, so the answer the UI
-- shows and the answer the claim path enforces cannot drift apart.
--
-- ⚠ HISTORY IS CHECKED, INCLUDING RELEASED ROWS. A released URL is NOT free.
-- If it were handed to a different member, every link ever shared for the first
-- member would silently begin opening the second member's profile — worse than
-- a 404, because nobody sees an error and nobody reports it. Link integrity
-- outranks the convenience of recycling a nice name, so a released URL stays
-- spent forever.
CREATE OR REPLACE FUNCTION public.custom_url_available(_candidate text, _for_user uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _candidate IS NOT NULL
     AND _candidate ~ '^[a-z0-9_][a-z0-9._]{1,28}[a-z0-9_]$'
     AND _candidate !~ '\.\.'
     AND NOT EXISTS (
           SELECT 1 FROM public.reserved_custom_urls r
            WHERE r.value = lower(_candidate))
     AND NOT EXISTS (
           SELECT 1 FROM public.profiles p
            WHERE lower(p.custom_url) = lower(_candidate)
              AND (_for_user IS NULL OR p.id <> _for_user))
     AND NOT EXISTS (
           SELECT 1 FROM public.custom_url_history h
            WHERE lower(h.custom_url) = lower(_candidate)
              AND (_for_user IS NULL OR h.user_id <> _for_user));
$$;

COMMENT ON FUNCTION public.custom_url_available(text, uuid) IS
  'F-93. The single source of truth for whether a custom_url may be issued: column format, reserved namespace, profiles, and custom_url_history INCLUDING released rows. Released URLs are never recycled — reissuing one would silently redirect every link previously shared for its former holder.';

-- ---------------------------------------------------------------------------
-- The generator.
CREATE OR REPLACE FUNCTION public.generate_custom_url(_full_name text, _user_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _stem      text;
  _candidate text;
  _suffix    text;
  _n         int := 2;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'generate_custom_url requires a user id: it is needed both for the fallback value and to let a member keep a URL they already hold';
  END IF;

  _stem := public.custom_url_slug(_full_name);

  -- THE EMPTY CASE, answered explicitly. A name that is only punctuation, only
  -- emoji, or a script this folds away yields NULL above. '' must never become
  -- a URL, and neither must a bare '.' or '-'. Such a member gets an
  -- id-derived value instead: deterministic, stable across re-runs, legal under
  -- the column CHECK, and still subject to every check below.
  IF _stem IS NULL THEN
    _stem := 'member.' || substr(replace(_user_id::text, '-', ''), 1, 8);
  END IF;

  IF public.custom_url_available(_stem, _user_id) THEN
    RETURN _stem;
  END IF;

  -- Collision: append digits, per the Owner's instruction. The stem is trimmed
  -- so stem+digits still fits 30 characters, and any trailing dot exposed by
  -- that trim is removed — 'ana.b' truncated to 'ana.' + '2' would otherwise
  -- produce 'ana.2', which is legal, whereas a trim landing on '..' is not.
  WHILE _n < 1000 LOOP
    _suffix    := _n::text;
    _candidate := regexp_replace(left(_stem, 30 - length(_suffix)), '[._]+$', '') || _suffix;
    IF public.custom_url_available(_candidate, _user_id) THEN
      RETURN _candidate;
    END IF;
    _n := _n + 1;
  END LOOP;

  -- 998 collisions on one stem means something is wrong with the input, not
  -- with this member. Fall back to the id rather than looping forever.
  _candidate := 'member.' || substr(replace(_user_id::text, '-', ''), 1, 8);
  IF public.custom_url_available(_candidate, _user_id) THEN
    RETURN _candidate;
  END IF;

  RAISE EXCEPTION 'generate_custom_url could not find a free URL for % (stem %)', _user_id, _stem;
END;
$$;

COMMENT ON FUNCTION public.generate_custom_url(text, uuid) IS
  'F-93. Deterministic first.last from full_name, digits appended on collision, member.<8 hex of id> when the name reduces to nothing. Every candidate passes custom_url_available(), so reserved names and released history entries are never issued.';

REVOKE ALL ON FUNCTION public.generate_custom_url(text, uuid) FROM public, anon, authenticated;
