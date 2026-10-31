-- ROLLBACK for 20260815041256_atomic_publish_with_media.sql
--
-- Drops the atomic publish path. Safe at the time of writing: nothing calls
-- the function yet (the client switch is later in B5) and post_media holds
-- zero production rows. If that has changed, dropping this re-opens the
-- half-published-post window the function exists to close.
--
-- The idempotency_key COLUMN is deliberately NOT dropped: if any post has
-- been published through this path, its key is the only record that the
-- retry was already served, and dropping it could allow a duplicate post.
-- Drop it by hand only after confirming no post carries one.

DROP FUNCTION IF EXISTS public.post_publish_with_media(uuid[], text, text, text[], boolean, text);
DROP INDEX IF EXISTS public.posts_user_idempotency_key;
-- ALTER TABLE public.posts DROP COLUMN idempotency_key;  -- see note above
