-- ============================================================================
-- A NAME IS STORED THE WAY IT IS WRITTEN, NOT THE WAY IT WAS TYPED.
--
-- OWNER INSTRUCTION, 2026-08-15: "Any name can not be ALL CAPS. User may write,
-- type or fetch from Google All Caps but it will Show in DB and UI Like
-- Sentence Case. AVIJIT SHEEL will be Avijit Sheel, SHIV SANKAR das will be
-- Shiv Sankar Das not Shiv sankar Das."
--
-- MEASURED ON PRODUCTION BEFORE WRITING THIS (94 profiles):
--     9 ALL CAPS   — ATASHI DUTTA, AVIJIT SHEEL, DEBASIS SEN, DEBRAJ BISWAS,
--                    PRABAL BANERJEE, RITAM DEY, SHARMISTHA DE, SOMNATH PAL,
--                    SUVRAJIT SARKAR
--     5 all lower  — arghya chowdhury, manideep naskar, sushanta das,
--                    susomon ghosal, yashpal singh
--     0 apostrophes, 0 hyphens, 0 Mc-names, 0 double spaces
--     1 containing a digit — "50mm Retina World", the platform account
--
-- THE DATA DECIDED THREE DESIGN POINTS. Each was a real choice, and the live
-- names are why it went the way it did:
--
-- 1. NO LOWERCASED PARTICLES. The usual title-case libraries lowercase "das",
--    "de", "van", "bin" as name particles — "Maria das Dores". This member base
--    is Bengali: `sushanta das` must become `Sushanta Das`, and `SHARMISTHA DE`
--    must become `Sharmistha De`. Those are surnames, not particles. Applying
--    the fashionable rule would have got both members' names wrong, and the
--    owner's own example says `Das`. So every word is capitalised, full stop.
--
-- 2. A WORD CONTAINING A DIGIT IS LEFT EXACTLY AS TYPED, e.g. "3D Studio"
--    and the platform's own account "50mm Retina World".
--    ⚠ CORRECTED — the justification first written here said `initcap()` turns
--    "50mm" into "50Mm". IT DOES NOT: Postgres counts digits as alphanumeric,
--    so initcap('50mm') is '50mm', verified on production. The guard is still
--    load-bearing, for a different case — without it "3D" lowercases to "3d"
--    and initcap leaves it there. See migration 20260815075857, which replaced
--    the deployed function so the database stopped carrying the false claim.
--
-- 3. A CREDENTIALS SUFFIX IS NEVER TOUCHED. `featured_artists` holds
--    "SOMNATH PAL - AFIAP, AFIP, EFIP". AFIAP and EFIP are FIAP photographic
--    distinctions — they are acronyms a photographer earned. Title-casing them
--    into "Afiap, Afip, Efip" is not a formatting improvement, it is a
--    demotion. So anything from the first " - " or "," onward is preserved
--    verbatim, and only the name in front of it is normalised.
--
-- WHY A TRIGGER AND NOT A ONE-OFF UPDATE: the value arrives from three places
-- — sign-up, the profile editor, and Google OAuth, which supplies whatever the
-- member set on their Google account and is frequently ALL CAPS. A backfill
-- fixes today; only a trigger keeps it fixed. The client gets the same rule in
-- TypeScript so the field looks right while it is being typed, but the database
-- is the one that decides.
--
-- SCOPE — deliberately `profiles.full_name` ONLY:
--   * `featured_artists.artist_name` is an EDITORIAL string maintained by an
--     admin and carries the credentials above. Not a typed member name.
--   * `office_staff.full_name` holds "Somnath Pal" and is already correct;
--     one admin-maintained row is not worth a trigger.
--   * `profiles_public` and `profiles_public_data` are VIEWS over `profiles`,
--     so they inherit this with no change of their own.
-- ============================================================================

-- ── The rule, as one function both a trigger and a backfill can call ──
CREATE OR REPLACE FUNCTION public.format_person_name(_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  _clean  text;
  _parts  text[];
  _name   text;
  _suffix text := '';
  _words  text[];
  _w      text;
  _out    text[] := ARRAY[]::text[];
BEGIN
  IF _raw IS NULL THEN RETURN NULL; END IF;

  -- Runs of whitespace are always a typo, never a style.
  _clean := btrim(regexp_replace(_raw, '\s+', ' ', 'g'));
  IF _clean = '' THEN RETURN _clean; END IF;

  -- Split "Name - CREDENTIALS" or "Name, CREDENTIALS" at the FIRST separator.
  -- A hyphen without surrounding spaces is part of a name (Anne-Marie) and is
  -- deliberately not a separator.
  _parts := regexp_match(_clean, '^(.*?)(\s+-\s+.*|\s*,.*)$');
  IF _parts IS NULL THEN
    _name := _clean;
  ELSE
    _name   := btrim(_parts[1]);
    _suffix := _parts[2];          -- kept byte for byte, credentials and all
  END IF;

  FOREACH _w IN ARRAY string_to_array(_name, ' ') LOOP
    IF _w = '' THEN
      CONTINUE;
    ELSIF _w ~ '[0-9]' THEN
      -- "3D" must stay "3D": lower() would make it "3d" and initcap
      -- would leave it there.
      _out := _out || _w;
    ELSE
      -- initcap() capitalises after every non-alphanumeric, which is exactly
      -- right for O'Brien, D'Souza and Anne-Marie, and is why it is used
      -- rather than hand-rolled string surgery.
      _w := initcap(lower(_w));
      -- The one case initcap cannot know: Mc is a prefix, not a word.
      -- McDonald, McKenzie, McCarthy. "Mac" is deliberately NOT handled —
      -- Macey, Machado and Mackenzie would all be broken by it, and no member
      -- has a Mac name today.
      IF _w ~ '^Mc[a-z]' THEN
        _w := 'Mc' || upper(substr(_w, 3, 1)) || substr(_w, 4);
      END IF;
      _out := _out || _w;
    END IF;
  END LOOP;

  RETURN array_to_string(_out, ' ') || _suffix;
END;
$function$;

COMMENT ON FUNCTION public.format_person_name(text) IS
  'Normalises a typed person name for storage and display: every word capitalised, digits-containing words left alone, and any " - "/"," credentials suffix preserved verbatim. Owner rule of 2026-08-15. Mirrored in src/lib/formatPersonName.ts, and personNameCasing.test.ts asserts the two agree on a shared fixture list.';

-- ── Enforcement: the value is normalised on the way in, from every source ──
CREATE OR REPLACE FUNCTION public.tg_profiles_normalise_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.full_name := public.format_person_name(NEW.full_name);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_profiles_normalise_name ON public.profiles;
CREATE TRIGGER trg_profiles_normalise_name
  BEFORE INSERT OR UPDATE OF full_name ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_profiles_normalise_name();

-- ── Backfill. Touches ONLY rows the rule would actually change, so the
--    updated_at of every other profile is left alone and the row count in the
--    verification below is the real number of corrections. ──
UPDATE public.profiles
   SET full_name = public.format_person_name(full_name)
 WHERE full_name IS DISTINCT FROM public.format_person_name(full_name);
