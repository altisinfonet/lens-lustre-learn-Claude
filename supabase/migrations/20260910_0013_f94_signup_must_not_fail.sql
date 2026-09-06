-- F-94 — a shared email domain could stop someone joining at all.
--
-- ═══ WHAT ACTUALLY HAPPENED, MEASURED NOT DESCRIBED ═══
-- Eleven signups from one domain, run through the real chain
-- (auth.users -> on_auth_user_created -> handle_new_user -> profiles):
--     signups that succeeded : 10 of 11
--     the 11th person        : REFUSED — P0001 Rate limit exceeded
--     auth.users row for #11 : 0
-- Zero. NOT a missed newsletter — NO ACCOUNT. And the member cannot get past
-- it: a retry inside the hour fails identically, nothing tells them why, and
-- the only remedies are to wait an hour or use a different email domain.
--
-- ═══ WHY IT IS THE WRONG KEY ═══
-- rate_limit_newsletter_subscribe() counted subscriptions per email DOMAIN per
-- hour. A shared domain is not evidence of abuse. A company, a college or a
-- photography club legitimately has fifty members; gmail.com is one domain for
-- most of the internet. The heuristic cannot tell a club from an attacker,
-- and it charges the cost to the eleventh real person.
--
-- ═══ TWO CHANGES, AND THE FIRST ONE MATTERS MOST ═══
--
-- 1. THE SIGNUP PATH CAN NO LONGER FAIL ON A NEWSLETTER ROW. Whatever the
--    limiter decides, auto_subscribe_newsletter now swallows it and returns.
--    A newsletter subscription is a side effect of joining; it must never be
--    able to prevent joining. This is the same rule F-93 already imposed on
--    the custom_url assignment — a member is never blocked from joining
--    because a non-essential step failed — and it is applied here for the
--    same reason.
--
-- 2. THE LIMITER STOPS KEYING ON THE DOMAIN.
--    * source='registration' is EXEMPT. Reaching this path requires creating
--      an account, which has already passed GoTrue's captcha and its own rate
--      limits. A second, weaker heuristic behind a real control adds nothing
--      and costs real members.
--    * For every other source — the public newsletter form, which anyone can
--      POST to unauthenticated — the limit now counts the SAME EMAIL rather
--      than the same domain. That is what the table can actually observe
--      about repeat submission.
--
-- ⚠ WHAT THIS DOES NOT PROTECT AGAINST, SAID PLAINLY RATHER THAN GLOSSED.
-- If the concern is one actor registering fifty throwaway addresses, THIS
-- FUNCTION CANNOT SEE THAT and neither could the old one. newsletter_subscribers
-- records id, email, source, user_id, subscribed_at, is_active — no IP, no
-- device, nothing tying two addresses to one person. The domain was a proxy
-- for that and it was a bad one: it caught colleagues and missed anyone using
-- ten different free providers. Real protection against that actor belongs at
-- the edge, on IP or on the captcha, where the signal exists. I am not
-- pretending a database trigger can do it.

CREATE OR REPLACE FUNCTION public.auto_subscribe_newsletter()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _email text;
BEGIN
  SELECT email INTO _email FROM auth.users WHERE id = NEW.id;

  IF _email IS NOT NULL THEN
    -- ⚠ THIS BLOCK MUST NEVER PROPAGATE. It runs inside the signup
    -- transaction, so an exception here does not skip a newsletter row — it
    -- destroys the account. RAISE WARNING reaches the Postgres log for
    -- diagnosis while the member gets in.
    BEGIN
      INSERT INTO public.newsletter_subscribers (email, source, user_id, is_active)
      VALUES (lower(trim(_email)), 'registration', NEW.id, true)
      ON CONFLICT (email) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        is_active = true;
    EXCEPTION WHEN others THEN
      RAISE WARNING 'F-94: newsletter subscribe skipped for % (%): % — the signup continues',
        NEW.id, SQLSTATE, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.auto_subscribe_newsletter() IS
  'F-94. Subscribes a new member to the newsletter, and CANNOT fail the signup: the insert is wrapped so any error is logged as a warning and swallowed. It runs inside the auth signup transaction, where a raise does not skip a row but destroys the account.';

CREATE OR REPLACE FUNCTION public.rate_limit_newsletter_subscribe()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  recent_count integer;
BEGIN
  -- Registration-sourced rows come from handle_new_user, which is only
  -- reachable by creating an account — already behind captcha and GoTrue's
  -- own rate limiting. Nothing useful is added by limiting them again, and
  -- the cost was a real member unable to join.
  IF NEW.source = 'registration' THEN
    RETURN NEW;
  END IF;

  -- Public sources: count the SAME EMAIL, not the same domain. A shared
  -- domain is not evidence of abuse; a repeated address is at least evidence
  -- of a repeated submission.
  SELECT count(*) INTO recent_count
    FROM public.newsletter_subscribers
   WHERE lower(email) = lower(NEW.email)
     AND subscribed_at > now() - interval '1 hour';

  IF recent_count >= 10 THEN
    RAISE EXCEPTION 'Rate limit exceeded: too many subscription attempts';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.rate_limit_newsletter_subscribe() IS
  'F-94. Rate limits PUBLIC newsletter submissions per email address per hour. Registration-sourced rows are exempt: they require an account, which already passed captcha. Previously keyed on the email DOMAIN, which blocked the eleventh member of any company, college or club from creating an account at all. Does NOT defend against one actor using many addresses — this table records no IP or device, so that control belongs at the edge.';
