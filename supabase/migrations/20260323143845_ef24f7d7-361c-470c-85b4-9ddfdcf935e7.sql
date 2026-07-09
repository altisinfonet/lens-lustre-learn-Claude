
-- Add is_pinned to comments table
ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false;

-- Create comment_reactions table for journal/competition comments
CREATE TABLE IF NOT EXISTS public.comment_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL REFERENCES public.comments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  reaction_type text NOT NULL DEFAULT 'like',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(comment_id, user_id)
);

ALTER TABLE public.comment_reactions ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Anyone can view comment reactions" ON public.comment_reactions FOR SELECT TO public USING (true);
CREATE POLICY "Authenticated users can react" ON public.comment_reactions FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can remove own reactions" ON public.comment_reactions FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Admins can manage comment reactions" ON public.comment_reactions FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
