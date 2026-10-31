-- Enable realtime broadcasting for judging tables so the Admin panel can
-- watch judge markings live (Judge Monitoring / Funnel views).
-- Idempotent: safe to re-run. RLS still applies to every delivered event —
-- admins receive rows because they hold SELECT via has_role(admin) policies;
-- other users only receive what their own policies allow.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND tablename = 'judge_scores') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.judge_scores;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND tablename = 'judge_activity_logs') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.judge_activity_logs;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND tablename = 'judge_decisions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.judge_decisions;
  END IF;
END $$;
