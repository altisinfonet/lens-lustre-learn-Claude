
-- ═══════════════════════════════════════════════════════
-- 1. Newsletter Subscribers
-- ═══════════════════════════════════════════════════════
CREATE TABLE public.newsletter_subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'website',
  user_id UUID DEFAULT NULL,
  subscribed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT newsletter_subscribers_email_unique UNIQUE (email)
);

ALTER TABLE public.newsletter_subscribers ENABLE ROW LEVEL SECURITY;

-- Anyone can subscribe (insert their own email)
CREATE POLICY "Anyone can subscribe"
  ON public.newsletter_subscribers FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Admins can view all subscribers
CREATE POLICY "Admins can view all subscribers"
  ON public.newsletter_subscribers FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Admins can update subscribers
CREATE POLICY "Admins can update subscribers"
  ON public.newsletter_subscribers FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Admins can delete subscribers
CREATE POLICY "Admins can delete subscribers"
  ON public.newsletter_subscribers FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ═══════════════════════════════════════════════════════
-- 2. FAQ Entries (Admin-managed, publicly readable)
-- ═══════════════════════════════════════════════════════
CREATE TABLE public.faq_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  keywords TEXT[] NOT NULL DEFAULT '{}',
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.faq_entries ENABLE ROW LEVEL SECURITY;

-- Anyone can read active FAQs (for chat cache)
CREATE POLICY "Anyone can read active FAQs"
  ON public.faq_entries FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

-- Admins full CRUD
CREATE POLICY "Admins can insert FAQs"
  ON public.faq_entries FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update FAQs"
  ON public.faq_entries FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete FAQs"
  ON public.faq_entries FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Admin select all (including inactive)
CREATE POLICY "Admins can view all FAQs"
  ON public.faq_entries FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ═══════════════════════════════════════════════════════
-- 3. AI Chat Usage Tracking
-- ═══════════════════════════════════════════════════════
CREATE TABLE public.ai_chat_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID DEFAULT NULL,
  device_id TEXT NOT NULL,
  session_date DATE NOT NULL DEFAULT CURRENT_DATE,
  question_count INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ai_chat_usage_user_device_date UNIQUE (user_id, device_id, session_date)
);

ALTER TABLE public.ai_chat_usage ENABLE ROW LEVEL SECURITY;

-- Authenticated users can see their own usage
CREATE POLICY "Users can view own chat usage"
  ON public.ai_chat_usage FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Insert allowed for tracking (service role handles upsert in edge function)
CREATE POLICY "Anon and auth can insert usage"
  ON public.ai_chat_usage FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Update own rows only
CREATE POLICY "Users can update own usage"
  ON public.ai_chat_usage FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

-- Admins can view all usage
CREATE POLICY "Admins can view all chat usage"
  ON public.ai_chat_usage FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
