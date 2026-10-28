-- F-94 ROLLBACK (written 2026-10-28, S8 / F-REV4-2; 0013 had none).
--
-- ⚠ THIS RESTORES A KNOWN DEFECT: the 11th signup per email DOMAIN per hour
-- fails and NO ACCOUNT is created (see 20260910_0013 header). Run only if
-- 0013 itself is proven to break something worse.
--
-- Restores the two bodies exactly as last defined before 0013:
--   rate_limit_newsletter_subscribe  — 20260402151117_4b026800-…sql
--   auto_subscribe_newsletter        — 20260405073251_1c61c495-…sql
-- Triggers are untouched (0013 did not change them). The two COMMENTs 0013
-- added are cleared.
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED — p32.lane reads %. Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.rate_limit_newsletter_subscribe()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  recent_count integer;
BEGIN
  -- Rate limit: max 10 subscriptions per email domain per hour
  SELECT COUNT(*) INTO recent_count
  FROM public.newsletter_subscribers
  WHERE split_part(email, '@', 2) = split_part(NEW.email, '@', 2)
    AND subscribed_at > now() - interval '1 hour';

  IF recent_count >= 10 THEN
    RAISE EXCEPTION 'Rate limit exceeded: too many subscription attempts';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.auto_subscribe_newsletter()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  _email text;
BEGIN
  -- Get email from auth.users
  SELECT email INTO _email FROM auth.users WHERE id = NEW.id;

  IF _email IS NOT NULL THEN
    INSERT INTO public.newsletter_subscribers (email, source, user_id, is_active)
    VALUES (lower(trim(_email)), 'registration', NEW.id, true)
    ON CONFLICT (email) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      is_active = true;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.rate_limit_newsletter_subscribe() IS NULL;
COMMENT ON FUNCTION public.auto_subscribe_newsletter() IS NULL;

COMMIT;
