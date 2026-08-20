-- FOLLOW-UP to 20260820180836_classf_repoint_originals.
--
-- The newTableGrants gate caught that the executed repair created
-- public.media_repair_audit with REVOKEs but WITHOUT enabling row level
-- security. The revokes already deny anon/authenticated all DML, but RLS is
-- the repo's mandatory second layer: without it, a future accidental GRANT
-- would expose the table with nothing behind it, and TRUNCATE/REFERENCES/
-- TRIGGER are never covered by policies at all — which is exactly why the
-- gate also demands the revoke.
--
-- No policies are created ON PURPOSE: enabled RLS with zero policies is
-- deny-all for every non-owner role. service_role bypasses RLS and keeps
-- reading the audit trail; nothing else ever could, and now nothing else
-- ever can, even under grant drift.

alter table public.media_repair_audit enable row level security;
