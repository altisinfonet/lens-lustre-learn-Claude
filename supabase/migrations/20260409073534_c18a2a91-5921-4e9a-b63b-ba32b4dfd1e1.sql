
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'competition_entries'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.competition_entries;
  END IF;
END $$;
