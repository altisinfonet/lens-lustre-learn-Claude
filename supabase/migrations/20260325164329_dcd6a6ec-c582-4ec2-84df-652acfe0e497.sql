-- 1. Unique constraint on post_reactions(post_id, user_id) to prevent duplicate likes
ALTER TABLE public.post_reactions
  ADD CONSTRAINT post_reactions_post_id_user_id_unique UNIQUE (post_id, user_id);

-- 2. Index on post_comments(post_id) for faster lookups
CREATE INDEX IF NOT EXISTS idx_post_comments_post_id ON public.post_comments (post_id);