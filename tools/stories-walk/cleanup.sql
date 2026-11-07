-- Stories staging walk — remove the two throwaway members and everything they made.
-- STAGING ONLY (the workflow checks the database before running this).
\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE walk_users ON COMMIT DROP AS
  SELECT id FROM auth.users WHERE email LIKE 'stories-walk-%@example.com';
SELECT count(*) AS walk_members FROM walk_users;
DELETE FROM public.stories WHERE user_id IN (SELECT id FROM walk_users);
DELETE FROM public.posts   WHERE user_id IN (SELECT id FROM walk_users);
DELETE FROM auth.users     WHERE id      IN (SELECT id FROM walk_users);
SELECT count(*) AS left_after FROM auth.users WHERE email LIKE 'stories-walk-%@example.com';
COMMIT;
