
-- 1. ai_chat_usage: restrict INSERT to authenticated users only
-- (edge function uses service role which bypasses RLS, so this is safe)
DROP POLICY IF EXISTS "Anon and auth can insert usage" ON public.ai_chat_usage;

CREATE POLICY "Authenticated users can insert usage"
ON public.ai_chat_usage
FOR INSERT
TO authenticated
WITH CHECK (true);

-- 2. newsletter_subscribers: replace wide-open INSERT with email validation
DROP POLICY IF EXISTS "Anyone can subscribe" ON public.newsletter_subscribers;

-- Allow anon + authenticated but validate email has @ and reasonable length
CREATE POLICY "Validated inserts allowed"
ON public.newsletter_subscribers
FOR INSERT
TO anon, authenticated
WITH CHECK (
  email IS NOT NULL
  AND length(email) BETWEEN 5 AND 255
  AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
);

-- 3. Rate-limit trigger for newsletter_subscribers to prevent spam
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

DROP TRIGGER IF EXISTS trg_rate_limit_newsletter ON public.newsletter_subscribers;
CREATE TRIGGER trg_rate_limit_newsletter
  BEFORE INSERT ON public.newsletter_subscribers
  FOR EACH ROW
  EXECUTE FUNCTION public.rate_limit_newsletter_subscribe();
