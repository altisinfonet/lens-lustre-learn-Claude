-- DB-2: Hard-delete the single orphan revoked test certificate identified in audit.
-- Cert id: a76f3734-e429-4313-9f84-c27b6f735af8 (legacy "Test — Winner Certificate", revoked 2026-04-29)
-- Already revoked + reference_id orphaned by R4-only ruleset. Safe to remove.
DELETE FROM public.certificates
WHERE id = 'a76f3734-e429-4313-9f84-c27b6f735af8'
  AND is_revoked = true;