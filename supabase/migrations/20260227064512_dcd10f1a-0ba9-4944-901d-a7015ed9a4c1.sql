
CREATE TABLE public.featured_artists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  excerpt text,
  body text NOT NULL DEFAULT '',
  cover_image_url text,
  photo_gallery text[] NOT NULL DEFAULT '{}',
  artist_name text,
  artist_bio text,
  artist_avatar_url text,
  tags text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  published_at timestamp with time zone DEFAULT now(),
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.featured_artists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage featured artists"
  ON public.featured_artists FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Anyone can view active featured artists"
  ON public.featured_artists FOR SELECT
  TO anon, authenticated
  USING (is_active = true);
