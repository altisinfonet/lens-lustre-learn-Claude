
-- 1. Create comments table with threading
CREATE TABLE public.comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  content text NOT NULL DEFAULT '',
  parent_id uuid REFERENCES public.comments(id) ON DELETE CASCADE,
  article_id uuid REFERENCES public.journal_articles(id) ON DELETE CASCADE,
  entry_id uuid REFERENCES public.competition_entries(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comments_target_check CHECK (
    (article_id IS NOT NULL AND entry_id IS NULL) OR
    (article_id IS NULL AND entry_id IS NOT NULL)
  )
);

ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

-- Anyone can view comments
CREATE POLICY "Anyone can view comments"
ON public.comments FOR SELECT
USING (true);

-- Authenticated users can create comments
CREATE POLICY "Authenticated users can create comments"
ON public.comments FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Users can update own comments
CREATE POLICY "Users can update own comments"
ON public.comments FOR UPDATE
TO authenticated
USING (user_id = auth.uid());

-- Users can delete own comments
CREATE POLICY "Users can delete own comments"
ON public.comments FOR DELETE
TO authenticated
USING (user_id = auth.uid());

-- Admins can manage all comments
CREATE POLICY "Admins can manage comments"
ON public.comments FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- 2. Add student to app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'student';

-- 3. Add payment_details to competitions
ALTER TABLE public.competitions
  ADD COLUMN IF NOT EXISTS payment_details jsonb DEFAULT NULL;
