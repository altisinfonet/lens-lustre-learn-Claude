ALTER TABLE public.competition_round_publish REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.competition_round_publish;