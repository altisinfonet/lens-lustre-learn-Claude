
-- Backfill competition_round_publish.closed_at for rounds judges already completed
-- before the lockRound() upsert existed in complete-round. Without this, the admin
-- Declare button in RoundPublishPanel is permanently disabled ("Awaiting judge lock"),
-- so participants never see results because entry_public_status falls through to
-- 'judging_in_progress'. Idempotent. Does NOT set published_at — admin must still
-- explicitly Declare each round. Lock != Declare invariant preserved.

INSERT INTO public.competition_round_publish (competition_id, round_number, closed_at, closed_by)
SELECT
  jr.competition_id,
  jr.round_number,
  now() AS closed_at,
  NULL::uuid AS closed_by
FROM public.judging_rounds jr
WHERE jr.status = 'completed'
ON CONFLICT (competition_id, round_number) DO UPDATE
  SET closed_at = COALESCE(public.competition_round_publish.closed_at, EXCLUDED.closed_at);
