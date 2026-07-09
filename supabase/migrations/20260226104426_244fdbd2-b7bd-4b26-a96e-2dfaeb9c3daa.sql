
-- Gift credits table to track bulk gift operations by admin
CREATE TABLE public.gift_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL,
  amount numeric NOT NULL,
  reason text NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('email', 'role', 'all', 'new_registration')),
  target_value text, -- email address, role name, date range JSON, or null for "all"
  auto_apply_future boolean NOT NULL DEFAULT false,
  recipients_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.gift_credits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage gift credits" ON public.gift_credits
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Gift announcements for individual users (tracks dismissal)
CREATE TABLE public.gift_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  gift_credit_id uuid REFERENCES public.gift_credits(id) ON DELETE CASCADE NOT NULL,
  amount numeric NOT NULL,
  reason text NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.gift_announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own announcements" ON public.gift_announcements
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can update own announcements" ON public.gift_announcements
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins can manage announcements" ON public.gift_announcements
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Site setting for auto-apply new registration gift
-- We'll store active gift config in site_settings with key 'new_registration_gift'
