
-- 1. Create admin-only competition_payment_details table
CREATE TABLE public.competition_payment_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL UNIQUE,
  paypal_email text,
  bank_details text,
  upi_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Enable RLS
ALTER TABLE public.competition_payment_details ENABLE ROW LEVEL SECURITY;

-- 3. Admin-only access
CREATE POLICY "Admins can manage competition payment details"
  ON public.competition_payment_details FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 4. Migrate existing data
INSERT INTO public.competition_payment_details (competition_id, paypal_email, bank_details, upi_id)
SELECT id,
  payment_details->>'paypal_email',
  payment_details->>'bank_details',
  payment_details->>'upi_id'
FROM public.competitions
WHERE payment_details IS NOT NULL;

-- 5. Drop column from competitions
ALTER TABLE public.competitions DROP COLUMN IF EXISTS payment_details;
