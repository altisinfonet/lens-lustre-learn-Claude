-- Reusable updated_at helper (idempotent)
CREATE OR REPLACE FUNCTION public.set_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.photo_verification_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entry_id UUID NOT NULL REFERENCES public.competition_entries(id) ON DELETE CASCADE,
  competition_id UUID NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  photo_index INTEGER NOT NULL DEFAULT 0,
  round_number INTEGER NOT NULL,
  participant_id UUID NOT NULL,
  requested_by_judge_id UUID NOT NULL,
  tag_id UUID REFERENCES public.judging_tags(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'submitted', 'verified', 'rejected', 'cancelled')),
  original_file_url TEXT,
  original_file_name TEXT,
  original_file_size_bytes BIGINT,
  participant_note TEXT,
  submitted_at TIMESTAMPTZ,
  reviewed_by_admin_id UUID,
  reviewed_at TIMESTAMPTZ,
  admin_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pvr_unique_per_round UNIQUE (entry_id, photo_index, round_number)
);

CREATE INDEX IF NOT EXISTS idx_pvr_entry ON public.photo_verification_requests(entry_id);
CREATE INDEX IF NOT EXISTS idx_pvr_participant ON public.photo_verification_requests(participant_id);
CREATE INDEX IF NOT EXISTS idx_pvr_competition_status ON public.photo_verification_requests(competition_id, status);
CREATE INDEX IF NOT EXISTS idx_pvr_status ON public.photo_verification_requests(status);

DROP TRIGGER IF EXISTS trg_pvr_updated ON public.photo_verification_requests;
CREATE TRIGGER trg_pvr_updated
  BEFORE UPDATE ON public.photo_verification_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_column();

ALTER TABLE public.photo_verification_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants view own pvr" ON public.photo_verification_requests;
CREATE POLICY "Participants view own pvr"
  ON public.photo_verification_requests FOR SELECT TO authenticated
  USING (auth.uid() = participant_id);

DROP POLICY IF EXISTS "Participants update own pvr submission" ON public.photo_verification_requests;
CREATE POLICY "Participants update own pvr submission"
  ON public.photo_verification_requests FOR UPDATE TO authenticated
  USING (auth.uid() = participant_id AND status IN ('pending', 'submitted'))
  WITH CHECK (auth.uid() = participant_id AND status IN ('pending', 'submitted'));

DROP POLICY IF EXISTS "Admins view all pvr" ON public.photo_verification_requests;
CREATE POLICY "Admins view all pvr"
  ON public.photo_verification_requests FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins update pvr" ON public.photo_verification_requests;
CREATE POLICY "Admins update pvr"
  ON public.photo_verification_requests FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins insert pvr" ON public.photo_verification_requests;
CREATE POLICY "Admins insert pvr"
  ON public.photo_verification_requests FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins delete pvr" ON public.photo_verification_requests;
CREATE POLICY "Admins delete pvr"
  ON public.photo_verification_requests FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Assigned judges view pvr" ON public.photo_verification_requests;
CREATE POLICY "Assigned judges view pvr"
  ON public.photo_verification_requests FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.competition_judges cj
      WHERE cj.competition_id = photo_verification_requests.competition_id
        AND cj.judge_id = auth.uid()
    )
  );

INSERT INTO storage.buckets (id, name, public)
VALUES ('entry-originals', 'entry-originals', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Participants upload own originals" ON storage.objects;
CREATE POLICY "Participants upload own originals"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'entry-originals' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Participants read own originals" ON storage.objects;
CREATE POLICY "Participants read own originals"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'entry-originals' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Participants update own originals" ON storage.objects;
CREATE POLICY "Participants update own originals"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'entry-originals' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Participants delete own originals" ON storage.objects;
CREATE POLICY "Participants delete own originals"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'entry-originals' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Admins read all originals" ON storage.objects;
CREATE POLICY "Admins read all originals"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'entry-originals' AND public.has_role(auth.uid(), 'admin'));