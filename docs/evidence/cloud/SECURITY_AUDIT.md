# SECURITY AUDIT — IN PROGRESS

Independent deep security audit (cloud auditor), started 2026-10-30.
Scope: RLS policy correctness, privilege escalation, private data, SECURITY DEFINER functions (all),
table grants, storage, auth, edge functions, exactly-once/integrity, secrets in public repo, live-only objects.

Rules: production READ-ONLY (catalog PROBEs only, counts/names). Attack PoCs on staging only, with
throwaway accounts deleted afterwards. No fixes. No personal data or secrets printed.

## Heartbeat
- 2026-10-30 — started; inspecting repo and catalog.
