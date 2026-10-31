
-- 1. Profile intro fields (pronouns, current_city, workplace, education)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pronouns text,
  ADD COLUMN IF NOT EXISTS current_city text,
  ADD COLUMN IF NOT EXISTS workplace text,
  ADD COLUMN IF NOT EXISTS education text,
  ADD COLUMN IF NOT EXISTS cover_video_url text;

-- 2. Verification applications table
CREATE TABLE IF NOT EXISTS public.verification_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  reason text,
  portfolio_url text,
  admin_message text,
  reviewed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, status)
);
ALTER TABLE public.verification_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own verification requests" ON public.verification_requests
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users can create verification requests" ON public.verification_requests
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Admins can manage verification requests" ON public.verification_requests
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 3. Stories table (24h ephemeral)
CREATE TABLE IF NOT EXISTS public.stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  image_url text NOT NULL,
  caption text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);
ALTER TABLE public.stories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view non-expired stories" ON public.stories
  FOR SELECT USING (expires_at > now());
CREATE POLICY "Users can create own stories" ON public.stories
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can delete own stories" ON public.stories
  FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Admins can manage stories" ON public.stories
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 4. Highlights table (permanent story collections)
CREATE TABLE IF NOT EXISTS public.highlights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL DEFAULT 'Highlight',
  cover_url text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.highlights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view highlights" ON public.highlights
  FOR SELECT USING (true);
CREATE POLICY "Users can manage own highlights" ON public.highlights
  FOR ALL TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Admins can manage highlights" ON public.highlights
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.highlight_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  highlight_id uuid NOT NULL REFERENCES public.highlights(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  caption text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.highlight_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view highlight items" ON public.highlight_items
  FOR SELECT USING (true);
CREATE POLICY "Users can manage own highlight items" ON public.highlight_items
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.highlights WHERE id = highlight_id AND user_id = auth.uid())
  );
CREATE POLICY "Users can delete own highlight items" ON public.highlight_items
  FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.highlights WHERE id = highlight_id AND user_id = auth.uid())
  );
CREATE POLICY "Admins can manage highlight items" ON public.highlight_items
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 5. Featured/pinned photos table
CREATE TABLE IF NOT EXISTS public.featured_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  image_url text NOT NULL,
  title text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.featured_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view featured photos" ON public.featured_photos
  FOR SELECT USING (true);
CREATE POLICY "Users can manage own featured photos" ON public.featured_photos
  FOR ALL TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Admins can manage featured photos" ON public.featured_photos
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 6. Profile views tracking
CREATE TABLE IF NOT EXISTS public.profile_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  viewer_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profile_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert profile views" ON public.profile_views
  FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can view own profile views" ON public.profile_views
  FOR SELECT TO authenticated USING (profile_id = auth.uid());
CREATE POLICY "Admins can manage profile views" ON public.profile_views
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 7. Update profiles_public view with new fields
DROP VIEW IF EXISTS public.profiles_public;
CREATE VIEW public.profiles_public AS
SELECT
  id, full_name, avatar_url, cover_url, bio, portfolio_url,
  photography_interests, facebook_url, instagram_url, twitter_url,
  youtube_url, website_url, preferred_language, is_suspended,
  created_at, updated_at, privacy_settings, cover_position,
  custom_url, pronouns, current_city, workplace, education,
  cover_video_url
FROM public.profiles;
