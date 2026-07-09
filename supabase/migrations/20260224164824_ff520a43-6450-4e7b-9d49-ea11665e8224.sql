-- Competitions table (admin-managed)
CREATE TABLE public.competitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  cover_image_url text,
  category text NOT NULL DEFAULT 'General',
  entry_fee numeric DEFAULT 0,
  prize_info text,
  status text NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'open', 'judging', 'closed')),
  max_entries_per_user int DEFAULT 1,
  max_photos_per_entry int DEFAULT 5,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.competitions ENABLE ROW LEVEL SECURITY;

-- Anyone can browse competitions
CREATE POLICY "Anyone can view competitions"
  ON public.competitions FOR SELECT
  USING (true);

-- Only admins can manage
CREATE POLICY "Admins can manage competitions"
  ON public.competitions FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- Competition entries
CREATE TABLE public.competition_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid REFERENCES public.competitions(id) ON DELETE CASCADE NOT NULL,
  user_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  photos text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'approved', 'rejected', 'winner')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.competition_entries ENABLE ROW LEVEL SECURITY;

-- Anyone can view approved entries (or their own)
CREATE POLICY "Anyone can view approved entries"
  ON public.competition_entries FOR SELECT
  USING (status = 'approved' OR status = 'winner' OR user_id = auth.uid());

-- Authenticated users can submit entries
CREATE POLICY "Users can submit entries"
  ON public.competition_entries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update own entries
CREATE POLICY "Users can update own entries"
  ON public.competition_entries FOR UPDATE
  USING (user_id = auth.uid());

-- Admins can manage all entries
CREATE POLICY "Admins can manage entries"
  ON public.competition_entries FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- Votes table (public voting, one vote per user per entry)
CREATE TABLE public.competition_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid REFERENCES public.competition_entries(id) ON DELETE CASCADE NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entry_id, user_id)
);

ALTER TABLE public.competition_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view vote counts"
  ON public.competition_votes FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can vote"
  ON public.competition_votes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can remove own vote"
  ON public.competition_votes FOR DELETE
  USING (user_id = auth.uid());

-- Storage bucket for competition photos
INSERT INTO storage.buckets (id, name, public) VALUES ('competition-photos', 'competition-photos', true);

-- Storage RLS: authenticated users can upload
CREATE POLICY "Authenticated users can upload photos"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'competition-photos' AND auth.role() = 'authenticated');

CREATE POLICY "Anyone can view competition photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'competition-photos');

CREATE POLICY "Users can delete own uploads"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'competition-photos' AND auth.uid()::text = (storage.foldername(name))[1]);