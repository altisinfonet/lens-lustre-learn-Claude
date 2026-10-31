
DROP TRIGGER IF EXISTS trg_notify_verification_request_created ON public.photo_verification_requests;
DROP TRIGGER IF EXISTS trg_notify_verification_request_submitted ON public.photo_verification_requests;
DROP TRIGGER IF EXISTS trg_notify_verification_decided ON public.photo_verification_requests;

DROP FUNCTION IF EXISTS public.notify_verification_request_created() CASCADE;
DROP FUNCTION IF EXISTS public.notify_verification_request_submitted() CASCADE;
DROP FUNCTION IF EXISTS public.notify_verification_decided() CASCADE;
DROP FUNCTION IF EXISTS public.get_stuck_verifications_admin() CASCADE;
DROP FUNCTION IF EXISTS public.backfill_stuck_verifications(boolean) CASCADE;
DROP FUNCTION IF EXISTS public.backfill_stuck_verifications() CASCADE;

DROP TABLE IF EXISTS public.photo_verification_requests CASCADE;
DROP TABLE IF EXISTS public.verification_requests CASCADE;

-- Disable user triggers on judging_tags so we can purge the four
-- legacy "Verification Required" system tags that the v3 spec no longer uses.
ALTER TABLE public.judging_tags DISABLE TRIGGER USER;

DELETE FROM public.judge_tag_assignments
WHERE tag_id IN (SELECT id FROM public.judging_tags WHERE label ILIKE 'Verification Required%');
DELETE FROM public.judging_tags WHERE label ILIKE 'Verification Required%';

ALTER TABLE public.judging_tags ENABLE TRIGGER USER;

CREATE OR REPLACE FUNCTION public.get_gated_entry_status(p_entry_ids uuid[])
RETURNS TABLE(
  entry_id uuid, competition_id uuid, public_status text, public_round text,
  public_placement text, public_progression_note text, public_r4_tags text[],
  has_pending_verification boolean, verification_overrides_status boolean,
  is_published_any_round boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT eps.entry_id, eps.competition_id, eps.public_status, eps.public_round,
           eps.public_placement, eps.public_progression_note, eps.public_r4_tags
    FROM public.entry_public_status eps
    WHERE eps.entry_id = ANY(p_entry_ids)
  ),
  any_pub AS (
    SELECT competition_id, bool_or(published_at IS NOT NULL) AS pub
    FROM public.competition_round_publish
    WHERE competition_id IN (SELECT competition_id FROM base)
    GROUP BY competition_id
  )
  SELECT b.entry_id, b.competition_id, b.public_status, b.public_round,
         b.public_placement, b.public_progression_note, b.public_r4_tags,
         FALSE, FALSE, COALESCE(ap.pub, FALSE)
  FROM base b LEFT JOIN any_pub ap USING (competition_id);
$function$;

CREATE OR REPLACE FUNCTION public.get_needs_review_recipients_for_round(
  p_competition_id uuid, p_round_number int
)
RETURNS TABLE(entry_id uuid, user_id uuid, competition_title text, photo_indices int[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH nr AS (
    SELECT DISTINCT jd.entry_id, jd.photo_index
    FROM public.judge_decisions jd
    WHERE jd.round_number = p_round_number
      AND jd.decision = 'needs_review'
      AND jd.entry_id IN (SELECT id FROM public.competition_entries WHERE competition_id = p_competition_id)
  )
  SELECT e.id, e.user_id, c.title,
         array_agg(DISTINCT nr.photo_index ORDER BY nr.photo_index)
  FROM nr
  JOIN public.competition_entries e ON e.id = nr.entry_id
  JOIN public.competitions c ON c.id = e.competition_id
  GROUP BY e.id, e.user_id, c.title;
$function$;
