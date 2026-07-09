-- B-2a: Tighten custom_url_history SELECT + add 2 resolver RPCs

-- 1. Drop wide-open SELECT policy
DROP POLICY IF EXISTS "Anyone can view URL history" ON public.custom_url_history;

-- 2. Narrow SELECT to owner + admin only
CREATE POLICY "Users read own URL history"
ON public.custom_url_history
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Admins read all URL history"
ON public.custom_url_history
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- 3. Public resolver RPC for /<custom_url> redirects (returns minimal fields)
CREATE OR REPLACE FUNCTION public.resolve_custom_url(_url text)
RETURNS TABLE(user_id uuid, is_current boolean, released_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT h.user_id, h.is_current, h.released_at
  FROM public.custom_url_history h
  WHERE lower(h.custom_url) = lower(_url)
  ORDER BY h.created_at DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_custom_url(text) TO anon, authenticated;

-- 4. Batch availability RPC (returns only taken URL strings)
CREATE OR REPLACE FUNCTION public.check_custom_urls_taken(_urls text[])
RETURNS TABLE(custom_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT h.custom_url
  FROM public.custom_url_history h
  WHERE h.is_current = true
    AND lower(h.custom_url) = ANY (SELECT lower(u) FROM unnest(_urls) AS u);
$$;

GRANT EXECUTE ON FUNCTION public.check_custom_urls_taken(text[]) TO anon, authenticated;