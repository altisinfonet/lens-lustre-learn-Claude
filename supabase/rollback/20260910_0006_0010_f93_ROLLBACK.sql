-- F-93 ROLLBACK.
--
-- ⚠ READ THIS BEFORE RUNNING IT. The backfilled custom_url values are NOT
-- removed. Once a URL has been published it may already have been shared, and
-- withdrawing it turns every one of those links into a 404 for a member who
-- did nothing wrong. Removing the machinery is reversible; un-publishing an
-- address is not. If the values themselves must go, that is a separate,
-- deliberate decision with its own evidence — not a side effect of rolling
-- back a migration.
--
-- This restores the previous behaviour of the surrounding machinery only.

DROP TRIGGER IF EXISTS trg_profiles_record_custom_url_history ON public.profiles;
DROP TRIGGER IF EXISTS trg_profiles_zz_assign_custom_url ON public.profiles;
DROP TRIGGER IF EXISTS trg_custom_url_reject_reserved ON public.profiles;

DROP FUNCTION IF EXISTS public.tg_profiles_record_custom_url_history();
DROP FUNCTION IF EXISTS public.tg_profiles_assign_custom_url();
DROP FUNCTION IF EXISTS public.tg_custom_url_reject_reserved();
DROP FUNCTION IF EXISTS public.generate_custom_url(text, uuid);
DROP FUNCTION IF EXISTS public.custom_url_available(text, uuid);
DROP FUNCTION IF EXISTS public.custom_url_slug(text);
DROP FUNCTION IF EXISTS public.custom_url_fold_accents(text);

-- Restore the pre-F-93 permanence trigger EXACTLY as it was, so a rollback
-- reproduces the old behaviour rather than an approximation of it — including
-- the defect that made change_custom_url() unreachable.
CREATE OR REPLACE FUNCTION public.forbid_custom_url_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.custom_url IS NOT NULL
     AND NEW.custom_url IS DISTINCT FROM OLD.custom_url THEN
    RAISE EXCEPTION 'custom_url is permanent and cannot be changed'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.username_available(candidate text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT candidate ~ '^[a-z0-9_][a-z0-9._]{1,28}[a-z0-9_]$'
     AND candidate !~ '\.\.'
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE lower(custom_url) = lower(candidate));
$$;

DROP TABLE IF EXISTS public.reserved_custom_urls;
