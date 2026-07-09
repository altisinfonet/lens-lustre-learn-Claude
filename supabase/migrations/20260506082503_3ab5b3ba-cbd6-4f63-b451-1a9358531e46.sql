-- B2.5b Part A: GUC setter for write_path instrumentation
CREATE OR REPLACE FUNCTION public.set_write_path(p text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p IS NULL OR length(p) = 0 OR length(p) > 64 THEN
    RAISE EXCEPTION 'set_write_path: value must be 1..64 chars (got %)', coalesce(length(p)::text, 'NULL');
  END IF;
  IF p !~ '^[a-z0-9_-]+$' THEN
    RAISE EXCEPTION 'set_write_path: value must match ^[a-z0-9_-]+$ (got %)', p;
  END IF;
  -- LOCAL = transaction-scoped, auto-clears at COMMIT/ROLLBACK
  PERFORM set_config('app.write_path', p, true);
END;
$$;

REVOKE ALL ON FUNCTION public.set_write_path(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_write_path(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_write_path(text) TO service_role;

COMMENT ON FUNCTION public.set_write_path(text) IS
  'B2.5b: Sanctioned edge fns call this as their first DB action to stamp app.write_path on every v3_mirror_log row written in the same transaction. Service-role only.';