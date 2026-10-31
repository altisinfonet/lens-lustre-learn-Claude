
CREATE TABLE public.post_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL,
  reason text NOT NULL DEFAULT 'inappropriate',
  details text,
  status text NOT NULL DEFAULT 'pending',
  admin_action text,
  reviewed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(post_id, reporter_id)
);

ALTER TABLE public.post_reports ENABLE ROW LEVEL SECURITY;

-- Admins can manage all reports
CREATE POLICY "Admins can manage post reports"
  ON public.post_reports FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Users can submit reports on posts they didn't author
CREATE POLICY "Users can report posts"
  ON public.post_reports FOR INSERT
  TO authenticated
  WITH CHECK (
    reporter_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.posts WHERE id = post_id AND user_id <> auth.uid()
    )
  );

-- Users can view own reports
CREATE POLICY "Users can view own reports"
  ON public.post_reports FOR SELECT
  TO authenticated
  USING (reporter_id = auth.uid());
