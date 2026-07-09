
-- Image reactions (like, love, vote) for portfolio images and competition entries
CREATE TABLE public.image_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  image_type text NOT NULL, -- 'portfolio' or 'competition_entry'
  image_id uuid NOT NULL,
  reaction_type text NOT NULL, -- 'like', 'love', 'vote'
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, image_type, image_id, reaction_type)
);

ALTER TABLE public.image_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view reactions" ON public.image_reactions FOR SELECT USING (true);
CREATE POLICY "Authenticated users can add reactions" ON public.image_reactions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can remove own reactions" ON public.image_reactions FOR DELETE USING (user_id = auth.uid());

-- Image comments with threading
CREATE TABLE public.image_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  image_type text NOT NULL, -- 'portfolio' or 'competition_entry'
  image_id uuid NOT NULL,
  parent_id uuid REFERENCES public.image_comments(id) ON DELETE CASCADE,
  content text NOT NULL DEFAULT '',
  is_flagged boolean NOT NULL DEFAULT false,
  flag_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.image_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view non-flagged comments" ON public.image_comments FOR SELECT USING (is_flagged = false OR user_id = auth.uid() OR has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated users can post comments" ON public.image_comments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own comments" ON public.image_comments FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete own comments" ON public.image_comments FOR DELETE USING (user_id = auth.uid());
CREATE POLICY "Admins can manage all comments" ON public.image_comments FOR ALL USING (has_role(auth.uid(), 'admin'));

-- Comment reports
CREATE TABLE public.comment_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL REFERENCES public.image_comments(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL,
  reason text NOT NULL DEFAULT 'inappropriate',
  details text,
  status text NOT NULL DEFAULT 'pending', -- pending, reviewed, dismissed
  reviewed_by uuid,
  admin_action text, -- 'removed_comment', 'removed_thread', 'banned_user', 'dismissed'
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.comment_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can report comments" ON public.comment_reports FOR INSERT WITH CHECK (auth.uid() = reporter_id);
CREATE POLICY "Users can view own reports" ON public.comment_reports FOR SELECT USING (reporter_id = auth.uid());
CREATE POLICY "Admins can manage reports" ON public.comment_reports FOR ALL USING (has_role(auth.uid(), 'admin'));

-- Indexes for performance
CREATE INDEX idx_image_reactions_lookup ON public.image_reactions(image_type, image_id);
CREATE INDEX idx_image_comments_lookup ON public.image_comments(image_type, image_id);
CREATE INDEX idx_comment_reports_status ON public.comment_reports(status);
