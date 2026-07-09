
-- 1. Create bank_details table
CREATE TABLE public.bank_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  bank_account_name text,
  bank_account_number text,
  bank_name text,
  bank_ifsc text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Enable RLS
ALTER TABLE public.bank_details ENABLE ROW LEVEL SECURITY;

-- 3. Strict RLS: only the user can see/manage their own bank details
CREATE POLICY "Users can view own bank details"
  ON public.bank_details FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own bank details"
  ON public.bank_details FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own bank details"
  ON public.bank_details FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Admins can manage bank details"
  ON public.bank_details FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 4. Migrate existing data from profiles
INSERT INTO public.bank_details (user_id, bank_account_name, bank_account_number, bank_name, bank_ifsc)
SELECT id, bank_account_name, bank_account_number, bank_name, bank_ifsc
FROM public.profiles
WHERE bank_account_name IS NOT NULL
   OR bank_account_number IS NOT NULL
   OR bank_name IS NOT NULL
   OR bank_ifsc IS NOT NULL;

-- 5. Drop bank columns from profiles
ALTER TABLE public.profiles DROP COLUMN IF EXISTS bank_account_name;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS bank_account_number;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS bank_name;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS bank_ifsc;
