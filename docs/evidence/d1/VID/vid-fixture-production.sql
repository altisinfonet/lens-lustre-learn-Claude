-- PRODUCTION SHAPE: posts' category trigger = git's B2 function (supabase/migrations/20260812090000_post_categories_enforce_minimum.sql, POST-CAT-002 active).
CREATE OR REPLACE FUNCTION public.enforce_post_categories()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $fn$
DECLARE
  _bad text;
  _n   integer;
  _client boolean := current_user IN ('authenticated', 'anon');
BEGIN
  -- ── post_kind is not the client's to decide ────────────────────────────────
  IF TG_OP = 'INSERT' THEN
    IF _client THEN NEW.post_kind := 'member'; END IF;
  ELSE
    IF _client THEN NEW.post_kind := OLD.post_kind; END IF;
  END IF;

  -- ── normalise before validating ───────────────────────────────────────────
  NEW.categories := ARRAY(
    SELECT t.slug FROM (
      SELECT DISTINCT ON (lower(btrim(u.c)))
             lower(btrim(u.c)) AS slug, u.ord
      FROM unnest(COALESCE(NEW.categories, '{}')) WITH ORDINALITY AS u(c, ord)
      WHERE btrim(u.c) <> ''
      ORDER BY lower(btrim(u.c)), u.ord
    ) t
    ORDER BY t.ord
  );
  _n := cardinality(NEW.categories);

  -- ── every slug must exist in the taxonomy AND be active ───────────────────
  SELECT string_agg(c, ', ') INTO _bad
  FROM unnest(NEW.categories) AS c
  WHERE NOT EXISTS (
    SELECT 1 FROM public.categories cat WHERE cat.slug = c AND cat.is_active
  );
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'POST-CAT-001: unknown or inactive category slug(s): %', _bad
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- ★ THE ONLY DIFFERENCE FROM B1. Everything above and below is unchanged.
    --
    -- INSERT only, and only for member posts. A system post created by
    -- create_system_post() legitimately carries none, and an UPDATE is handled
    -- by POST-CAT-003 below — applying the minimum to every UPDATE would make
    -- every uncategorised post uneditable, which is precisely why this rule
    -- lives in a trigger and not in a CHECK constraint.
    IF NEW.post_kind = 'member' AND _n < 1 THEN
      RAISE EXCEPTION 'POST-CAT-002: a member post requires between 1 and 5 categories'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW.post_kind = 'member'
       AND cardinality(COALESCE(OLD.categories, '{}')) > 0
       AND _n < 1 THEN
      RAISE EXCEPTION 'POST-CAT-003: a categorised post cannot have all its categories removed'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;
CREATE TRIGGER trg_validate_post_categories BEFORE INSERT OR UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION public.enforce_post_categories();
