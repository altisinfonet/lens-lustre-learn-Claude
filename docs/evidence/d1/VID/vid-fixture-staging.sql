-- STAGING SHAPE: posts' category trigger = staging's live B1 function (no 1-category minimum on INSERT).
-- staging's live enforce_post_categories() (read 2026-10-05): B1 — no minimum on INSERT.
CREATE OR REPLACE FUNCTION public.enforce_post_categories()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  _bad text;
  _n   integer;
  _client boolean := current_user IN ('authenticated', 'anon');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF _client THEN NEW.post_kind := 'member'; END IF;
  ELSE
    IF _client THEN NEW.post_kind := OLD.post_kind; END IF;
  END IF;
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
    NULL;
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
$function$;
CREATE TRIGGER trg_validate_post_categories BEFORE INSERT OR UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION public.enforce_post_categories();
