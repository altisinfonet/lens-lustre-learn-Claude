
-- Blocked keywords table for admin-managed content moderation
CREATE TABLE public.blocked_keywords (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  keyword TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'profanity',
  severity TEXT NOT NULL DEFAULT 'auto_hide',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Unique constraint on keyword (case-insensitive)
CREATE UNIQUE INDEX blocked_keywords_keyword_unique ON public.blocked_keywords (lower(keyword));

-- Enable RLS
ALTER TABLE public.blocked_keywords ENABLE ROW LEVEL SECURITY;

-- Admins can manage blocked keywords
CREATE POLICY "Admins can manage blocked keywords"
  ON public.blocked_keywords
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Anyone authenticated can read active keywords (needed for client-side preview)
CREATE POLICY "Authenticated users can read active keywords"
  ON public.blocked_keywords
  FOR SELECT
  TO authenticated
  USING (is_active = true);
