-- F-93 · unit 4 of 5 — a profile acquires a URL when it is created, and no
-- write path anywhere can land on a reserved name.
--
-- WHY AT THE DATABASE AND NOT IN THE SIGNUP FORM. The gap exists because
-- claiming a username was optional in OnboardingModal, so members who skipped
-- it never got one — 14 of them on production. A rule enforced only in one
-- signup form lasts until the next signup path is added (OAuth, an admin
-- create, a seeder, an import). Enforced here it holds for all of them.

-- ---------------------------------------------------------------------------
-- GUARD: no reserved value may be written, by anyone, ever.
-- This is separate from the generator on purpose. The generator avoids
-- reserved names by construction; this refuses them even when the value
-- arrives from somewhere else entirely — an RPC, a manual UPDATE, a future
-- code path nobody has written yet. A member sitting on a route name is
-- invisible with nothing appearing broken, so it is worth refusing twice.
CREATE OR REPLACE FUNCTION public.tg_custom_url_reject_reserved()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.custom_url IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.reserved_custom_urls r
                  WHERE r.value = lower(NEW.custom_url))
  THEN
    RAISE EXCEPTION
      'custom_url "%" is reserved: the site already serves that top-level path, so a member holding it would be unreachable behind it with nothing appearing broken.',
      NEW.custom_url
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_custom_url_reject_reserved ON public.profiles;
CREATE TRIGGER trg_custom_url_reject_reserved
  BEFORE INSERT OR UPDATE OF custom_url ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_custom_url_reject_reserved();

-- ---------------------------------------------------------------------------
-- ASSIGN ON CREATE.
CREATE OR REPLACE FUNCTION public.tg_profiles_assign_custom_url()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.custom_url IS NULL THEN
    NEW.custom_url := public.generate_custom_url(NEW.full_name, NEW.id);
    -- custom_url_changed_at is deliberately LEFT NULL. This is an assignment,
    -- not a change; stamping it here would silently spend the member's one
    -- change per 12 months on a name they never chose.
  END IF;
  RETURN NEW;
END;
$$;

-- Ordering matters: this must run AFTER trg_profiles_normalise_name, which
-- rewrites full_name, so the slug is derived from the stored name rather than
-- the submitted one. Trigger order within a timing class is alphabetical by
-- name, and 'trg_profiles_zz_assign_custom_url' sorts after
-- 'trg_profiles_normalise_name'. The name is ugly and load-bearing; do not
-- tidy it without re-checking the order.
DROP TRIGGER IF EXISTS trg_profiles_zz_assign_custom_url ON public.profiles;
CREATE TRIGGER trg_profiles_zz_assign_custom_url
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_profiles_assign_custom_url();

-- ---------------------------------------------------------------------------
-- RECORD IT IN HISTORY, the same as a member-initiated claim would.
-- custom_url_history.user_id references profiles(id), so this cannot run
-- BEFORE INSERT — the profile row does not exist yet.
CREATE OR REPLACE FUNCTION public.tg_profiles_record_custom_url_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.custom_url IS NOT NULL THEN
    INSERT INTO public.custom_url_history (user_id, custom_url, is_current)
    VALUES (NEW.id, lower(NEW.custom_url), true)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_record_custom_url_history ON public.profiles;
CREATE TRIGGER trg_profiles_record_custom_url_history
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_profiles_record_custom_url_history();

COMMENT ON FUNCTION public.tg_profiles_assign_custom_url() IS
  'F-93. Gives every new profile a custom_url derived from its name, so the gap that left 14 production members unreachable by name cannot reopen through any signup path. Leaves custom_url_changed_at NULL: an assignment is not a change.';
