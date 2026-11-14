-- ROLLBACK of 20261114_0900_sec_audit_rest.sql — restores the state measured
-- by PROBE 0900 on 2026-11-14 (both lanes identical).
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'APPLY REFUSED — p32.lane is not asserted as staging or production. Dispatch apply-migration.yml.';
  END IF;
END
$lane_guard$;

GRANT EXECUTE ON FUNCTION public.get_ad_analytics(timestamptz) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_needs_review_recipients_for_round(uuid, integer) TO PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_public_role_user_ids(_role text)
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only expose roles that are safe to enumerate app-wide.
  IF _role NOT IN ('admin', 'judge') THEN
    RAISE EXCEPTION 'role % is not enumerable', _role USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT ur.user_id
    FROM public.user_roles ur
    WHERE ur.role::text = _role;
END;
$$;
REVOKE ALL ON FUNCTION public.get_public_role_user_ids(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_role_user_ids(text) TO anon, authenticated, service_role;

CREATE POLICY "x1_merged_update" ON public.ai_chat_usage
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
GRANT INSERT, UPDATE, DELETE ON public.ai_chat_usage TO anon, authenticated;

GRANT TRUNCATE, TRIGGER, REFERENCES ON
  public.hashtags, public.name_part_spellings, public.post_hashtags,
  public.reserved_custom_urls, public.transliteration_map
  TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT TRUNCATE, TRIGGER, REFERENCES ON TABLES TO anon, authenticated;

COMMIT;
