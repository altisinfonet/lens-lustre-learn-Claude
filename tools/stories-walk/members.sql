-- Stories staging walk — two throwaway members, created the way the sign-up
-- trigger expects (auth.users + auth.identities; handle_new_user makes the
-- profile), marked onboarded so the onboarding window does not cover the walk.
-- STAGING ONLY: the workflow refuses any database that is not fpszggreishhuvdpkmdr.
-- psql variables: email_a, email_b, pw (never printed).
\set ON_ERROR_STOP on

BEGIN;
-- leftovers of an earlier run that died before its clean-up
DELETE FROM public.posts WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'stories-walk-%@example.com');
DELETE FROM auth.users WHERE email LIKE 'stories-walk-%@example.com';

WITH v(email, name) AS (VALUES (:'email_a', 'Walk Tester A'), (:'email_b', 'Walk Tester B')),
u AS (
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, email_change, email_change_token_new, recovery_token)
  SELECT '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', v.email,
         extensions.crypt(:'pw', extensions.gen_salt('bf')), now(),
         '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', v.name),
         now(), now(), '', '', '', ''
    FROM v
  RETURNING id, email
)
INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
SELECT gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now()
  FROM u;

UPDATE public.profiles p
   SET onboarding_completed = true, user_type = 'normal'
  FROM auth.users a
 WHERE a.id = p.id AND a.email IN (:'email_a', :'email_b');

SELECT a.email, p.full_name, p.custom_url IS NOT NULL AS has_handle, p.onboarding_completed
  FROM auth.users a JOIN public.profiles p ON p.id = a.id
 WHERE a.email IN (:'email_a', :'email_b')
 ORDER BY a.email;
COMMIT;
