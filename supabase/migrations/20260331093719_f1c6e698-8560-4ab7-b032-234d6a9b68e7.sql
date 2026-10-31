
-- Table to track all user questions with a normalized fingerprint for dedup
CREATE TABLE public.chat_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_text TEXT NOT NULL,
  question_fingerprint TEXT NOT NULL,
  ai_answer TEXT,
  ask_count INTEGER NOT NULL DEFAULT 1,
  last_asked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  promoted_to_faq BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_questions_fingerprint ON public.chat_questions(question_fingerprint);
CREATE INDEX idx_chat_questions_ask_count ON public.chat_questions(ask_count DESC);

ALTER TABLE public.chat_questions ENABLE ROW LEVEL SECURITY;

-- Only service role (edge function) can insert/update
CREATE POLICY "Service role can manage chat questions"
  ON public.chat_questions FOR ALL
  TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Admins can view chat questions
CREATE POLICY "Admins can view chat questions"
  ON public.chat_questions FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Function to auto-promote repeated questions to draft FAQ entries
CREATE OR REPLACE FUNCTION public.auto_promote_chat_to_faq()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If question asked 3+ times and not yet promoted, create a draft FAQ entry
  IF NEW.ask_count >= 3 AND NEW.promoted_to_faq = false AND NEW.ai_answer IS NOT NULL THEN
    INSERT INTO public.faq_entries (question, answer, keywords, is_active, sort_order)
    VALUES (
      NEW.question_text,
      NEW.ai_answer,
      ARRAY[]::text[],
      false,  -- draft: admin must activate
      999     -- low priority sort
    );
    -- Mark as promoted
    NEW.promoted_to_faq := true;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_promote_faq
  BEFORE UPDATE ON public.chat_questions
  FOR EACH ROW
  WHEN (NEW.ask_count >= 3 AND OLD.promoted_to_faq = false)
  EXECUTE FUNCTION public.auto_promote_chat_to_faq();
