ALTER TABLE public.competitions ADD COLUMN IF NOT EXISTS voting_ends_at TIMESTAMP WITH TIME ZONE NULL;

UPDATE public.competitions SET voting_ends_at = ends_at WHERE voting_ends_at IS NULL;