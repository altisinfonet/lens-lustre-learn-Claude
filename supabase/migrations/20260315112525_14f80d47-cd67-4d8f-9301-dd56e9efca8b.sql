-- Enable realtime for judge_scores and judge_comments (judge_tag_assignments already enabled)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'judge_scores') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.judge_scores;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'judge_comments') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.judge_comments;
  END IF;
END $$;