ALTER TABLE public.featured_artists
ADD COLUMN IF NOT EXISTS author_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_featured_artists_author_profile_id
  ON public.featured_artists(author_profile_id);