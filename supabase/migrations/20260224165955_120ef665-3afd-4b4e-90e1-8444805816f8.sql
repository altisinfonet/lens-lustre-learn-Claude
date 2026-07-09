
-- Journal articles table
CREATE TABLE public.journal_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  excerpt text,
  body text NOT NULL DEFAULT '',
  cover_image_url text,
  tags text[] NOT NULL DEFAULT '{}',
  photo_gallery text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft',
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.journal_articles ENABLE ROW LEVEL SECURITY;

-- Anyone can read published articles
CREATE POLICY "Anyone can view published articles"
  ON public.journal_articles FOR SELECT
  USING (status = 'published' OR author_id = auth.uid());

-- Admins can do everything
CREATE POLICY "Admins can manage articles"
  ON public.journal_articles FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- Content editors can insert
CREATE POLICY "Content editors can create articles"
  ON public.journal_articles FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'content_editor') AND author_id = auth.uid());

-- Content editors can update own articles
CREATE POLICY "Content editors can update own articles"
  ON public.journal_articles FOR UPDATE
  USING (public.has_role(auth.uid(), 'content_editor') AND author_id = auth.uid());

-- Content editors can delete own articles
CREATE POLICY "Content editors can delete own articles"
  ON public.journal_articles FOR DELETE
  USING (public.has_role(auth.uid(), 'content_editor') AND author_id = auth.uid());

-- Storage bucket for journal images
INSERT INTO storage.buckets (id, name, public) VALUES ('journal-images', 'journal-images', true);

-- Storage policies
CREATE POLICY "Anyone can view journal images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'journal-images');

CREATE POLICY "Editors can upload journal images"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'journal-images'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'content_editor'))
  );

CREATE POLICY "Editors can delete journal images"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'journal-images'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'content_editor'))
  );
