BEGIN;
ALTER TABLE public.competition_entries DISABLE TRIGGER USER;
ALTER TABLE public.judge_scores DISABLE TRIGGER USER;

DELETE FROM public.judge_decisions WHERE entry_id IN (SELECT id FROM public.competition_entries WHERE competition_id='00000000-0000-0000-0000-00000000a10c');
DELETE FROM public.judge_scores WHERE entry_id IN (SELECT id FROM public.competition_entries WHERE competition_id='00000000-0000-0000-0000-00000000a10c');
DELETE FROM public.judge_comments WHERE entry_id IN (SELECT id FROM public.competition_entries WHERE competition_id='00000000-0000-0000-0000-00000000a10c');
DELETE FROM public.entry_score_cache WHERE entry_id IN (SELECT id FROM public.competition_entries WHERE competition_id='00000000-0000-0000-0000-00000000a10c');
DELETE FROM public.competition_entries WHERE competition_id='00000000-0000-0000-0000-00000000a10c';
DELETE FROM public.competition_judges WHERE competition_id='00000000-0000-0000-0000-00000000a10c';
DELETE FROM public.judging_rounds WHERE competition_id='00000000-0000-0000-0000-00000000a10c';
DELETE FROM public.competitions WHERE id='00000000-0000-0000-0000-00000000a10c';

ALTER TABLE public.competition_entries ENABLE TRIGGER USER;
ALTER TABLE public.judge_scores ENABLE TRIGGER USER;
COMMIT;

SELECT
  (SELECT count(*) FROM public.competitions WHERE id='00000000-0000-0000-0000-00000000a10c') AS comp_remaining,
  (SELECT count(*) FROM public.competition_entries WHERE competition_id='00000000-0000-0000-0000-00000000a10c') AS entries_remaining,
  (SELECT count(*) FROM public.judging_rounds WHERE competition_id='00000000-0000-0000-0000-00000000a10c') AS rounds_remaining;