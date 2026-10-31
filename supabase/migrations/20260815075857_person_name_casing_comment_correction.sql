-- ============================================================================
-- CORRECTION: the deployed function carried a justification that was FALSE.
--
-- 20260815075526_person_name_casing shipped format_person_name() with this
-- comment inside its body:
--     "A WORD CONTAINING A DIGIT IS LEFT EXACTLY AS TYPED. initcap() turns
--      50mm into 50Mm. The platform's own account is 50mm Retina World."
--
-- initcap() does NOT do that. Postgres counts digits as alphanumeric, so '5'
-- starts the word and the following letters are not word starts:
--     select initcap(lower('50mm'));             -> 50mm
--     select initcap(lower('50mm Retina World')); -> 50mm Retina World
-- Both verified on this database. The platform account was never at risk from
-- initcap, and the reason written beside the guard was wrong.
--
-- THE GUARD ITSELF STAYS, because it IS load-bearing — for a case the original
-- comment never mentioned. Without it:
--     '3D studio' -> lower -> '3d studio' -> initcap -> '3d Studio'
-- and the "3D" a member typed is silently demoted to "3d". With it, the word is
-- returned exactly as typed. So the code was right and the explanation was not.
--
-- WHY THIS IS A MIGRATION AND NOT A REPO EDIT: the comment lives INSIDE the
-- function body, which means it is part of the deployed artifact. Correcting
-- only the repository file would leave the database asserting something untrue
-- while the repo asserted something true — the exact drift this project treats
-- as a defect. Nothing about the function's BEHAVIOUR changes here: the body is
-- byte-identical apart from the two comment blocks.
--
-- Recorded in AI_EVIDENCE.md as a mistake of mine. It was caught by a mutation
-- test that ESCAPED: deleting the digit guard did not fail the suite, which is
-- only possible if no fixture depended on it — and no fixture depended on it
-- because the case I had written down was not the case the guard protects.
-- ============================================================================
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
  _w      text;
  _out    text[] := ARRAY[]::text[];
BEGIN
  IF _raw IS NULL THEN RETURN NULL; END IF;

  _clean := btrim(regexp_replace(_raw, '\s+', ' ', 'g'));
  IF _clean = '' THEN RETURN _clean; END IF;

  -- Split "Name - CREDENTIALS" or "Name, CREDENTIALS" at the FIRST separator.
  -- A hyphen without surrounding spaces belongs to the name (Anne-Marie).
  _parts := regexp_match(_clean, '^(.*?)(\s+-\s+.*|\s*,.*)$');
  IF _parts IS NULL THEN
    _name := _clean;
  ELSE
    _name   := btrim(_parts[1]);
    _suffix := _parts[2];
  END IF;

  FOREACH _w IN ARRAY string_to_array(_name, ' ') LOOP
    IF _w = '' THEN
      CONTINUE;
    ELSIF _w ~ '[0-9]' THEN
      -- "3D" must stay "3D": lower() makes it "3d" and initcap leaves it
      -- there, because a digit is alphanumeric so the letter after it does
      -- not start a word. NOT for "50mm" — initcap handles that correctly on
      -- its own, contrary to what the first version of this comment claimed.
      _out := _out || _w;
    ELSE
      -- initcap() capitalises after every non-alphanumeric, which is exactly
      -- right for O'Brien, D'Souza and Anne-Marie.
      _w := initcap(lower(_w));
      -- The one case initcap cannot know: Mc is a prefix, not a word.
      -- "Mac" is deliberately NOT handled — Macey, Machado and Mackenzie
      -- would all be broken by it.
      IF _w ~ '^Mc[a-z]' THEN
        _w := 'Mc' || upper(substr(_w, 3, 1)) || substr(_w, 4);
      END IF;
      _out := _out || _w;
    END IF;
  END LOOP;

  RETURN array_to_string(_out, ' ') || _suffix;
END;
$function$;
