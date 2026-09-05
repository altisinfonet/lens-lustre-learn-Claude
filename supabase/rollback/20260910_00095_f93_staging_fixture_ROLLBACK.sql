-- F-93 fixture rollback — STAGING ONLY.
-- Deletes only the fabricated fixture accounts, identified by their reserved
-- e-mail domain. profiles and custom_url_history cascade from auth.users.
-- sofia.duarte and yuki.tanabe carry real addresses and are untouched.
DELETE FROM auth.users WHERE email LIKE '%@50mm-fixture-%.invalid'
                          OR email LIKE '%@50mm-staging-fixture.invalid';
