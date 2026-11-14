-- ═══════════════════════════════════════════════════════════════════════════
-- 20261114_0900 · remaining DB security-audit items (Owner "go 1", 13 Nov 2026)
--
-- Measured on BOTH lanes by PROBE 0900 (staging run 43614242593, production
-- run 43616132644) before writing this file:
--   S2a  get_ad_analytics           — anyone (signed out) reads ad totals.
--        Caller in app/functions: NONE.
--   S2c  get_needs_review_recipients_for_round — anyone (signed out) lists
--        member ids + entry ids needing review. Caller: publish-round only,
--        with the service-role key.
--   S1b  get_public_role_user_ids('judge') — signed-out visitors list judge ids.
--        Callers: Discover (signed-in page) for 'judge'; adminBrand (every
--        page, signed out too) for 'admin' — so 'admin' stays open.
--   S4   ai_chat_usage — policy "x1_merged_update" lets a member rewrite their
--        own counter (question_count = 0 → unlimited AI questions). Writer:
--        ask-anything only, with the service-role key.
--   S5   anon/authenticated hold TRUNCATE, TRIGGER, REFERENCES on 5 tables,
--        handed out by the postgres default privileges for new tables.
--
-- NOT CHANGED, on purpose:
--   has_role — 120 policies that signed-out visitors evaluate call it;
--   taking anon EXECUTE away would break public pages. It answers yes/no for
--   one given id only.
--   Storage buckets — separate file (20261114_0901).
--
-- Rollback: supabase/rollback/20261114_0900_sec_audit_rest_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261114_0901_sec_audit_rest.sql
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'APPLY REFUSED — p32.lane is not asserted as staging or production. Dispatch apply-migration.yml.';
  END IF;
END
$lane_guard$;

-- ── S2: server-only functions — only the service role may run them ─────────
REVOKE EXECUTE ON FUNCTION public.get_ad_analytics(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_ad_analytics(timestamptz) TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_needs_review_recipients_for_round(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_needs_review_recipients_for_round(uuid, integer) TO service_role;

-- ── S1: judge ids only for a signed-in caller (admin ids stay public) ──────
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
  -- 20261114_0900: judges are listed only to a signed-in member (Discover hides
  -- them); a signed-out visitor gets an empty list. Admin ids stay public: the
  -- brand name/badge on public pages needs them.
  IF _role = 'judge' AND auth.uid() IS NULL AND coalesce(auth.role(), '') <> 'service_role' THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT ur.user_id
    FROM public.user_roles ur
    WHERE ur.role::text = _role;
END;
$$;
-- Same callers as measured live: signed-out (admin badge), members, server.
REVOKE ALL ON FUNCTION public.get_public_role_user_ids(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_role_user_ids(text) TO anon, authenticated, service_role;

-- ── S4: the AI question counter is written by ask-anything only ────────────
DROP POLICY IF EXISTS "x1_merged_update" ON public.ai_chat_usage;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.ai_chat_usage FROM anon, authenticated;

-- ── S5: no TRUNCATE / TRIGGER / REFERENCES for app roles, now or later ─────
REVOKE TRUNCATE, TRIGGER, REFERENCES ON
  public.hashtags, public.name_part_spellings, public.post_hashtags,
  public.reserved_custom_urls, public.transliteration_map
  FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM anon, authenticated;

COMMIT;
