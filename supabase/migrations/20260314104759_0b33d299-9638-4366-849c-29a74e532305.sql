
-- 1. Competition Judges assignment table
CREATE TABLE public.competition_judges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  judge_id uuid NOT NULL,
  assigned_at timestamp with time zone NOT NULL DEFAULT now(),
  assigned_by uuid NOT NULL,
  UNIQUE(competition_id, judge_id)
);

ALTER TABLE public.competition_judges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage competition judges" ON public.competition_judges
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Judges can view own assignments" ON public.competition_judges
  FOR SELECT TO authenticated
  USING (judge_id = auth.uid());

-- 2. Global judging tags (reusable)
CREATE TABLE public.judging_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  color text NOT NULL DEFAULT '#6366f1',
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.judging_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage judging tags" ON public.judging_tags
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Judges can view active tags" ON public.judging_tags
  FOR SELECT TO authenticated
  USING (is_active = true AND (public.has_role(auth.uid(), 'judge'::app_role) OR public.has_role(auth.uid(), 'admin'::app_role)));

-- 3. Per-competition tag overrides (which tags are available for each competition)
CREATE TABLE public.competition_judging_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES public.judging_tags(id) ON DELETE CASCADE,
  UNIQUE(competition_id, tag_id)
);

ALTER TABLE public.competition_judging_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage competition judging tags" ON public.competition_judging_tags
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Judges can view competition tags" ON public.competition_judging_tags
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'judge'::app_role) OR public.has_role(auth.uid(), 'admin'::app_role));

-- 4. Judge tag assignments on entries
CREATE TABLE public.judge_tag_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.competition_entries(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES public.judging_tags(id) ON DELETE CASCADE,
  judge_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(entry_id, tag_id, judge_id)
);

ALTER TABLE public.judge_tag_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage tag assignments" ON public.judge_tag_assignments
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Judges can assign tags" ON public.judge_tag_assignments
  FOR INSERT TO authenticated
  WITH CHECK (judge_id = auth.uid() AND public.has_role(auth.uid(), 'judge'::app_role));

CREATE POLICY "Judges can view tag assignments" ON public.judge_tag_assignments
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'judge'::app_role) OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Judges can remove own tag assignments" ON public.judge_tag_assignments
  FOR DELETE TO authenticated
  USING (judge_id = auth.uid() AND public.has_role(auth.uid(), 'judge'::app_role));

-- 5. Judging rounds
CREATE TABLE public.judging_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  round_number integer NOT NULL DEFAULT 1,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(competition_id, round_number)
);

ALTER TABLE public.judging_rounds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage judging rounds" ON public.judging_rounds
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Judges can view rounds" ON public.judging_rounds
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'judge'::app_role) OR public.has_role(auth.uid(), 'admin'::app_role));

-- 6. Judge private comments on entries
CREATE TABLE public.judge_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.competition_entries(id) ON DELETE CASCADE,
  judge_id uuid NOT NULL,
  comment text NOT NULL,
  round_id uuid REFERENCES public.judging_rounds(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.judge_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage judge comments" ON public.judge_comments
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Judges can create own comments" ON public.judge_comments
  FOR INSERT TO authenticated
  WITH CHECK (judge_id = auth.uid() AND public.has_role(auth.uid(), 'judge'::app_role));

CREATE POLICY "Judges can view own comments" ON public.judge_comments
  FOR SELECT TO authenticated
  USING (judge_id = auth.uid());

CREATE POLICY "Judges can update own comments" ON public.judge_comments
  FOR UPDATE TO authenticated
  USING (judge_id = auth.uid() AND public.has_role(auth.uid(), 'judge'::app_role));

CREATE POLICY "Judges can delete own comments" ON public.judge_comments
  FOR DELETE TO authenticated
  USING (judge_id = auth.uid());

-- Insert default judging tags
INSERT INTO public.judging_tags (label, color, sort_order, created_by) VALUES
  ('Accept', '#22c55e', 1, '00000000-0000-0000-0000-000000000000'),
  ('Reject', '#ef4444', 2, '00000000-0000-0000-0000-000000000000'),
  ('Top 100 Global Photographer', '#3b82f6', 3, '00000000-0000-0000-0000-000000000000'),
  ('Top 50 Finalist', '#8b5cf6', 4, '00000000-0000-0000-0000-000000000000'),
  ('Top 10 Global Photographer', '#f59e0b', 5, '00000000-0000-0000-0000-000000000000'),
  ('Winner', '#eab308', 6, '00000000-0000-0000-0000-000000000000'),
  ('1st Runner Up', '#a1a1aa', 7, '00000000-0000-0000-0000-000000000000'),
  ('2nd Runner Up', '#d97706', 8, '00000000-0000-0000-0000-000000000000'),
  ('Honorable Mention', '#06b6d4', 9, '00000000-0000-0000-0000-000000000000'),
  ('Special Jury Award', '#ec4899', 10, '00000000-0000-0000-0000-000000000000');
