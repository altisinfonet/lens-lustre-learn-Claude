-- WAVE1-ITEMS-4-6: Revoke PUBLIC/anon EXECUTE on admin backfill RPCs.
-- Internal `has_role(auth.uid(),'admin')` gate inside each fn remains the authority check.
-- Rollback:
--   GRANT EXECUTE ON FUNCTION public.fix_gift_drift_admin(uuid) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.fix_referral_drift_admin(uuid) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.fix_certificate_readiness_admin(uuid) TO PUBLIC;

REVOKE EXECUTE ON FUNCTION public.fix_gift_drift_admin(uuid)            FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fix_gift_drift_admin(uuid)            TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.fix_referral_drift_admin(uuid)        FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fix_referral_drift_admin(uuid)        TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.fix_certificate_readiness_admin(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fix_certificate_readiness_admin(uuid) TO authenticated, service_role;