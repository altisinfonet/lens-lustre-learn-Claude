-- Add is_pinned to post_comments
ALTER TABLE public.post_comments ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false;

-- Comment reactions table (likes on comments)
CREATE TABLE IF NOT EXISTS public.post_comment_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL REFERENCES public.post_comments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  reaction_type text NOT NULL DEFAULT 'like',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(comment_id, user_id)
);

ALTER TABLE public.post_comment_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view comment reactions" ON public.post_comment_reactions FOR SELECT USING (true);
CREATE POLICY "Authenticated users can react to comments" ON public.post_comment_reactions FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can remove own reactions" ON public.post_comment_reactions FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Admins can manage comment reactions" ON public.post_comment_reactions FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Add post_comment_id to comment_reports for reporting post comments
ALTER TABLE public.comment_reports ADD COLUMN IF NOT EXISTS post_comment_id uuid REFERENCES public.post_comments(id) ON DELETE CASCADE;