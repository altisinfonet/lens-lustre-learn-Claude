
-- Track who shared which post (Facebook-style)
CREATE TABLE public.post_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(post_id, user_id)
);

-- Enable RLS
ALTER TABLE public.post_shares ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can see shares
CREATE POLICY "Authenticated users can view shares"
  ON public.post_shares FOR SELECT
  TO authenticated
  USING (true);

-- Users can insert their own shares
CREATE POLICY "Users can share posts"
  ON public.post_shares FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own shares
CREATE POLICY "Users can unshare"
  ON public.post_shares FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Index for fast lookups
CREATE INDEX idx_post_shares_post_id ON public.post_shares(post_id);
CREATE INDEX idx_post_shares_user_id ON public.post_shares(user_id);
