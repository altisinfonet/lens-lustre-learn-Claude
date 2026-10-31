BEGIN;
ALTER TABLE public.competition_entries DISABLE TRIGGER USER;

DO $$
DECLARE
  v_comp_id uuid := '00000000-0000-0000-0000-00000000a10c';
  v_admin uuid := '4c200b33-ae64-46f0-ba5d-1a97152e6a6c';
  v_judge1 uuid := '5745a9c9-55ec-4f0b-8a75-3a55ab3064d8';
  v_judge2 uuid := 'a2742a5c-f573-4674-84f0-a17e29425cf4';
  v_img text := 'https://picsum.photos/seed/audit/1920/1280';
BEGIN
  INSERT INTO public.competitions (id, title, description, category, status, phase, starts_at, ends_at, created_by, slug, judge_assignment_mode, current_round, max_entries_per_user)
  VALUES (v_comp_id, '[AUDIT] Forensic 10K Demo', 'Synthetic demo for forensic audit. Auto-removed.', 'photography', 'judging', 'judging', now() - interval '30 days', now() + interval '30 days', v_admin, 'forensic-audit-10k-demo', 'all', '1', NULL)
  ON CONFLICT (id) DO UPDATE SET max_entries_per_user = NULL;

  INSERT INTO public.judging_rounds (competition_id, round_number, name, status) VALUES
    (v_comp_id, 1, 'Initial Screening', 'active'),
    (v_comp_id, 2, 'Round 2', 'pending'),
    (v_comp_id, 3, 'Round 3', 'pending'),
    (v_comp_id, 4, 'Final Round', 'pending')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.competition_judges (competition_id, judge_id, assigned_by) VALUES
    (v_comp_id, v_judge1, v_admin),
    (v_comp_id, v_judge2, v_admin)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.competition_entries (competition_id, user_id, title, photos, status, current_round)
  SELECT v_comp_id, v_admin, '[AUDIT] Entry ' || g, ARRAY[v_img], 'submitted', '1'
  FROM generate_series(1, 10000) g;
END $$;

ALTER TABLE public.competition_entries ENABLE TRIGGER USER;
COMMIT;

SELECT count(*) AS total_entries FROM public.competition_entries WHERE competition_id = '00000000-0000-0000-0000-00000000a10c';