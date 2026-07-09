-- 1) Wallet reconciliation log (admin-only)
CREATE TABLE IF NOT EXISTS public.wallet_reconciliation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid,
  user_id uuid,
  finding_type text NOT NULL,
  amount numeric,
  reference_id uuid,
  reference_type text,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  reconciled_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.wallet_reconciliation_log IS
  'Forensic audit trail for wallet_transactions reconciliation (Phase 2.2). Admin-only.';

CREATE INDEX IF NOT EXISTS idx_wallet_recon_finding_type
  ON public.wallet_reconciliation_log (finding_type);
CREATE INDEX IF NOT EXISTS idx_wallet_recon_user_id
  ON public.wallet_reconciliation_log (user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_recon_transaction_id
  ON public.wallet_reconciliation_log (transaction_id);

ALTER TABLE public.wallet_reconciliation_log ENABLE ROW LEVEL SECURITY;

-- Admin-only read/insert (uses existing has_role)
DROP POLICY IF EXISTS "Admins can view reconciliation log" ON public.wallet_reconciliation_log;
CREATE POLICY "Admins can view reconciliation log"
  ON public.wallet_reconciliation_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can insert reconciliation log" ON public.wallet_reconciliation_log;
CREATE POLICY "Admins can insert reconciliation log"
  ON public.wallet_reconciliation_log
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 2) Log 64 orphan vote_reward rows (refs that no longer exist in competition_votes)
INSERT INTO public.wallet_reconciliation_log
  (transaction_id, user_id, finding_type, amount, reference_id, reference_type, notes, metadata)
SELECT
  wt.id,
  wt.user_id,
  'orphan_vote_reward',
  wt.amount,
  wt.reference_id,
  wt.reference_type,
  'Vote reward references a competition_vote that no longer exists. Left as historical per Phase 2.2 decision F1.',
  jsonb_build_object(
    'phase', '2.2',
    'decision', 'leave_historical',
    'detected_at', now()
  )
FROM public.wallet_transactions wt
WHERE wt.type = 'vote_reward'
  AND wt.reference_type = 'competition_vote'
  AND wt.reference_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.competition_votes cv WHERE cv.id = wt.reference_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.wallet_reconciliation_log wrl
    WHERE wrl.transaction_id = wt.id
      AND wrl.finding_type = 'orphan_vote_reward'
  );

-- 3) Quarantine 11 untraceable legacy rows (vote_reward / unvote_penalty with NULL reference_id)
WITH targets AS (
  SELECT id, description, COALESCE(metadata, '{}'::jsonb) AS md
  FROM public.wallet_transactions
  WHERE type IN ('vote_reward', 'unvote_penalty')
    AND reference_id IS NULL
    AND (metadata IS NULL OR NOT (metadata ? 'legacy_untraceable'))
)
UPDATE public.wallet_transactions wt
SET
  metadata = t.md || jsonb_build_object(
    'legacy_untraceable', true,
    'quarantined_at', now(),
    'phase', '2.2'
  ),
  description = CASE
    WHEN t.description IS NULL OR t.description = '' THEN '[legacy/untraceable]'
    WHEN position('[legacy/untraceable]' in t.description) > 0 THEN t.description
    ELSE t.description || ' [legacy/untraceable]'
  END
FROM targets t
WHERE wt.id = t.id;

-- Mirror quarantined rows into reconciliation log
INSERT INTO public.wallet_reconciliation_log
  (transaction_id, user_id, finding_type, amount, reference_id, reference_type, notes, metadata)
SELECT
  wt.id, wt.user_id, 'legacy_untraceable',
  wt.amount, wt.reference_id, wt.reference_type,
  'Legacy vote_reward/unvote_penalty with NULL reference_id. Quarantined per Phase 2.2 decision F2.',
  jsonb_build_object('phase', '2.2', 'decision', 'quarantine', 'detected_at', now())
FROM public.wallet_transactions wt
WHERE wt.type IN ('vote_reward', 'unvote_penalty')
  AND wt.reference_id IS NULL
  AND (wt.metadata ? 'legacy_untraceable')
  AND NOT EXISTS (
    SELECT 1 FROM public.wallet_reconciliation_log wrl
    WHERE wrl.transaction_id = wt.id AND wrl.finding_type = 'legacy_untraceable'
  );