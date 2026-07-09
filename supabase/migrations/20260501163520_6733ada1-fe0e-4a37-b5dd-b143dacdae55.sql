-- F-3 final

-- Step 1: drop duplicate guard
DROP TRIGGER IF EXISTS trg_protect_system_tags ON public.judging_tags;
DROP FUNCTION IF EXISTS public.protect_system_tags() CASCADE;

-- Step 2: ensure surviving guard is attached
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.judging_tags'::regclass
      AND tgname = 'trg_protect_system_tags_fn'
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER trg_protect_system_tags_fn
      BEFORE UPDATE OR DELETE ON public.judging_tags
      FOR EACH ROW EXECUTE FUNCTION public.protect_system_tags_fn();
  END IF;
END $$;

-- Step 3: rename drifted labels using the documented bypass
DO $$
BEGIN
  PERFORM set_config('app.allow_system_tag_rename', 'on', true);

  UPDATE public.judging_tags
     SET label = 'Accepted in Round 2'
   WHERE id = 'bd4bbf62-94ac-47fa-a019-2363b49a1ec9'
     AND label = 'Accept for Round 2';

  UPDATE public.judging_tags
     SET label = 'Qualified for Round 3'
   WHERE id = '67d446d4-fec6-4f45-8643-03c3ff2d462f'
     AND label = 'Shortlist for Round 3';
END $$;

-- Step 4: backfill the 3 missing judge_decisions rows directly using the
-- now-aligned canonical decision tokens. Idempotent via ON CONFLICT.
INSERT INTO public.judge_decisions (entry_id, judge_id, round_number, photo_index, decision)
SELECT
  jta.entry_id,
  jta.judge_id,
  jta.round_number,
  jta.photo_index,
  sc.decision_token
FROM public.judge_tag_assignments jta
JOIN public.judging_tags jt ON jt.id = jta.tag_id
JOIN public.v3_stage_catalog sc
  ON sc.is_active = true
 AND sc.round_number = jta.round_number
 AND lower(trim(sc.tag_label_canonical)) = lower(trim(jt.label))
WHERE jta.entry_id = '31dc23d4-55b3-4a9b-b00c-c0f315123cc5'
  AND jta.judge_id = '4c200b33-ae64-46f0-ba5d-1a97152e6a6c'
  AND jta.round_number = 2
  AND jta.photo_index IN (2, 3, 5)
ON CONFLICT (entry_id, judge_id, round_number, photo_index)
DO UPDATE SET decision = EXCLUDED.decision;

-- Step 5: drift-detection RPC for admin + CI
CREATE OR REPLACE FUNCTION public.get_system_tag_catalog_drift()
RETURNS TABLE (
  side text,
  round_number integer,
  label_or_canonical text,
  tag_id uuid,
  stage_key text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'tag_without_catalog'::text AS side,
         (jt.visible_in_round)[1]    AS round_number,
         jt.label                    AS label_or_canonical,
         jt.id                       AS tag_id,
         NULL::text                  AS stage_key
  FROM public.judging_tags jt
  WHERE jt.is_system = true
    AND jt.is_active = true
    AND NOT EXISTS (
      SELECT 1 FROM public.v3_stage_catalog sc
      WHERE sc.is_active = true
        AND lower(trim(sc.tag_label_canonical)) = lower(trim(jt.label))
    )
  UNION ALL
  SELECT 'catalog_without_tag'::text,
         sc.round_number,
         sc.tag_label_canonical,
         NULL::uuid,
         sc.stage_key
  FROM public.v3_stage_catalog sc
  WHERE sc.is_active = true
    AND sc.tag_label_canonical IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.judging_tags jt
      WHERE jt.is_system = true
        AND jt.is_active = true
        AND lower(trim(jt.label)) = lower(trim(sc.tag_label_canonical))
    );
$$;

REVOKE ALL ON FUNCTION public.get_system_tag_catalog_drift() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_system_tag_catalog_drift() TO service_role;