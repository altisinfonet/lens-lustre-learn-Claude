
-- Photo Albums table
CREATE TABLE public.photo_albums (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  album_type text NOT NULL DEFAULT 'custom',
  cover_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valid_album_type CHECK (album_type IN ('profile_pictures', 'cover_photos', 'custom'))
);

-- Album Photos table
CREATE TABLE public.album_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id uuid NOT NULL REFERENCES public.photo_albums(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  caption text,
  post_id uuid REFERENCES public.posts(id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_photo_albums_user ON public.photo_albums(user_id);
CREATE INDEX idx_photo_albums_type ON public.photo_albums(user_id, album_type);
CREATE INDEX idx_album_photos_album ON public.album_photos(album_id);

-- Unique constraint: one auto-album per type per user
CREATE UNIQUE INDEX idx_unique_auto_album ON public.photo_albums(user_id, album_type) WHERE album_type IN ('profile_pictures', 'cover_photos');

-- RLS
ALTER TABLE public.photo_albums ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.album_photos ENABLE ROW LEVEL SECURITY;

-- Photo Albums policies
CREATE POLICY "Anyone can view photo albums" ON public.photo_albums FOR SELECT USING (true);
CREATE POLICY "Users can create own albums" ON public.photo_albums FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own albums" ON public.photo_albums FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users can delete own custom albums" ON public.photo_albums FOR DELETE TO authenticated USING (user_id = auth.uid() AND album_type = 'custom');
CREATE POLICY "Admins can manage all albums" ON public.photo_albums FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- Album Photos policies
CREATE POLICY "Anyone can view album photos" ON public.album_photos FOR SELECT USING (true);
CREATE POLICY "Users can add photos to own albums" ON public.album_photos FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.photo_albums WHERE id = album_id AND user_id = auth.uid()));
CREATE POLICY "Users can update own album photos" ON public.album_photos FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.photo_albums WHERE id = album_id AND user_id = auth.uid()));
CREATE POLICY "Users can delete own album photos" ON public.album_photos FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.photo_albums WHERE id = album_id AND user_id = auth.uid()));
CREATE POLICY "Admins can manage all album photos" ON public.album_photos FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
