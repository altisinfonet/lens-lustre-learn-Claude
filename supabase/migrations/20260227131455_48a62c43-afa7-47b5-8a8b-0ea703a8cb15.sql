
-- Posts table
CREATE TABLE public.posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  content text NOT NULL DEFAULT '',
  image_url text,
  privacy text NOT NULL DEFAULT 'public' CHECK (privacy IN ('private', 'friends', 'public')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

-- Post reactions (likes)
CREATE TABLE public.post_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  reaction_type text NOT NULL DEFAULT 'like',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(post_id, user_id, reaction_type)
);

ALTER TABLE public.post_reactions ENABLE ROW LEVEL SECURITY;

-- Post comments
CREATE TABLE public.post_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  content text NOT NULL DEFAULT '',
  parent_id uuid REFERENCES public.post_comments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;

-- Helper function: check if two users are friends
CREATE OR REPLACE FUNCTION public.are_friends(_user_a uuid, _user_b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.friendships
    WHERE status = 'accepted'
      AND (
        (requester_id = _user_a AND addressee_id = _user_b)
        OR (requester_id = _user_b AND addressee_id = _user_a)
      )
  );
$$;

-- Helper function: can user see a post?
CREATE OR REPLACE FUNCTION public.can_view_post(_viewer_id uuid, _post_user_id uuid, _privacy text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN _viewer_id = _post_user_id THEN true
      WHEN _privacy = 'public' THEN true
      WHEN _privacy = 'friends' AND _viewer_id IS NOT NULL THEN public.are_friends(_viewer_id, _post_user_id)
      ELSE false
    END;
$$;

-- RLS for posts
CREATE POLICY "Users can insert own posts" ON public.posts
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own posts" ON public.posts
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "Users can delete own posts" ON public.posts
  FOR DELETE USING (user_id = auth.uid());

CREATE POLICY "Users can view posts based on privacy" ON public.posts
  FOR SELECT USING (
    public.can_view_post(auth.uid(), user_id, privacy)
  );

CREATE POLICY "Admins can manage posts" ON public.posts
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- RLS for post_reactions
CREATE POLICY "Users can view reactions on visible posts" ON public.post_reactions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.posts WHERE id = post_id AND public.can_view_post(auth.uid(), user_id, privacy))
  );

CREATE POLICY "Authenticated users can react" ON public.post_reactions
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can remove own reactions" ON public.post_reactions
  FOR DELETE USING (user_id = auth.uid());

-- RLS for post_comments
CREATE POLICY "Users can view comments on visible posts" ON public.post_comments
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.posts WHERE id = post_id AND public.can_view_post(auth.uid(), user_id, privacy))
  );

CREATE POLICY "Authenticated users can comment on visible posts" ON public.post_comments
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.posts WHERE id = post_id AND public.can_view_post(auth.uid(), user_id, privacy))
  );

CREATE POLICY "Users can update own comments" ON public.post_comments
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "Users can delete own comments" ON public.post_comments
  FOR DELETE USING (user_id = auth.uid());

CREATE POLICY "Admins can manage post reactions" ON public.post_reactions
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage post comments" ON public.post_comments
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));
