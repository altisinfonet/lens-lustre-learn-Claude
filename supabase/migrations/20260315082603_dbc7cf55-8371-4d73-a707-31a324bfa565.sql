-- Per-image judging support: persist scores/tags/comments by photo index
ALTER TABLE public.judge_scores
  ADD COLUMN IF NOT EXISTS photo_index integer NOT NULL DEFAULT 0;

ALTER TABLE public.judge_tag_assignments
  ADD COLUMN IF NOT EXISTS photo_index integer NOT NULL DEFAULT 0;

ALTER TABLE public.judge_comments
  ADD COLUMN IF NOT EXISTS photo_index integer NOT NULL DEFAULT 0;

-- Allow reject score = 0 (UI uses 0 as reject)
ALTER TABLE public.judge_scores
  DROP CONSTRAINT IF EXISTS judge_scores_score_check;

ALTER TABLE public.judge_scores
  ADD CONSTRAINT judge_scores_score_check CHECK (score >= 0 AND score <= 10);

-- Update uniqueness from entry-level to photo-level
ALTER TABLE public.judge_scores
  DROP CONSTRAINT IF EXISTS judge_scores_entry_id_judge_id_key;

ALTER TABLE public.judge_scores
  ADD CONSTRAINT judge_scores_entry_judge_photo_key UNIQUE (entry_id, judge_id, photo_index);

ALTER TABLE public.judge_tag_assignments
  DROP CONSTRAINT IF EXISTS judge_tag_assignments_entry_id_tag_id_judge_id_key;

ALTER TABLE public.judge_tag_assignments
  ADD CONSTRAINT judge_tag_assignments_entry_tag_judge_photo_key UNIQUE (entry_id, tag_id, judge_id, photo_index);

-- Guard photo index integrity
ALTER TABLE public.judge_scores
  DROP CONSTRAINT IF EXISTS judge_scores_photo_index_check;
ALTER TABLE public.judge_scores
  ADD CONSTRAINT judge_scores_photo_index_check CHECK (photo_index >= 0);

ALTER TABLE public.judge_tag_assignments
  DROP CONSTRAINT IF EXISTS judge_tag_assignments_photo_index_check;
ALTER TABLE public.judge_tag_assignments
  ADD CONSTRAINT judge_tag_assignments_photo_index_check CHECK (photo_index >= 0);

ALTER TABLE public.judge_comments
  DROP CONSTRAINT IF EXISTS judge_comments_photo_index_check;
ALTER TABLE public.judge_comments
  ADD CONSTRAINT judge_comments_photo_index_check CHECK (photo_index >= 0);

-- Query performance for photo-specific judging reads
CREATE INDEX IF NOT EXISTS idx_judge_scores_entry_photo ON public.judge_scores(entry_id, photo_index);
CREATE INDEX IF NOT EXISTS idx_judge_tag_assignments_entry_photo ON public.judge_tag_assignments(entry_id, photo_index);
CREATE INDEX IF NOT EXISTS idx_judge_comments_entry_photo_judge ON public.judge_comments(entry_id, photo_index, judge_id);