---
name: complete-round service-role bearer bypass (JP-C-3 / AP-C-3)
description: Stage 1 instrumentation live in complete-round; Stage 2 removal gated on 6-point ordered checklist
type: constraint
---
`supabase/functions/complete-round/index.ts` accepts the raw `SUPABASE_SERVICE_ROLE_KEY` as a bearer token (`isServiceRole` branch). Stage 1 instrumentation is deployed (2026-07-01): every hit writes `db_audit_logs.operation = 'SERVICE_ROLE_BEARER_INVOCATION'` + `console.warn`.

**Do NOT remove the `isServiceRole` branch until ALL SIX gates pass, in order.**
An empty observation window ≠ a passing window: both positive evidence (supported path works) AND negative evidence (bypass unused) are required.

### Ordered Stage 2 checklist

1. **Stage 1 instrumentation deployed** — done 2026-07-01.

2. **Admin-JWT path proven end-to-end in production (or a production-representative environment).**
   A real admin performs at least one `complete-round` invocation via the UI, and ALL of the following are verified:
   - HTTP 200 response from the edge function
   - Expected `competition_entries` mutations for the round (status / current_round / placement as applicable)
   - `db_audit_logs` row with `changed_by = <admin uuid>` (NOT null and NOT the zero-uuid)
   - Expected participant side effects (notification_emit_log rows, email queue entries)
   - Zero auth / authz errors in `complete-round` edge function logs during the invocation
   The test MUST run in an environment representative of production so verification reflects real deployment conditions, not a local/dev-only path.

3. **Full 7-day observation window elapsed** from Stage 1 deploy date (≥ 2026-07-08).

4. **Zero bypass invocations across the window:**
   `SELECT count(*) FROM db_audit_logs WHERE operation = 'SERVICE_ROLE_BEARER_INVOCATION' AND created_at >= '<stage1_deploy_ts>'` = 0.

5. **No external references to `complete-round` + service-role.** Re-verify:
   - `SELECT jobname, command FROM cron.job WHERE command ILIKE '%complete-round%'` → empty
   - Repo grep across `*.md`, `*.sh`, `*.yml`, `*.yaml`, GitHub Actions, n8n/Zapier exports → no runbook invoking with the service-role key
   - Prior verification on 2026-07-02: ✅ clean.

6. **Team explicitly confirms no undocumented usage** (human step; posted in team channel, positive confirmation, not silence).

Only when all six are green: Stage 2 removes the `isServiceRole` block in `supabase/functions/complete-round/index.ts` and adds a CI grep rule preventing reintroduction. Not before.

**Why:** Bypass = hidden master-key login with NULL actor attribution. Removing prematurely — without proving the admin-JWT path works — risks breaking production round closure at the worst possible moment.

**How to apply:** When user says "run Stage 2 gates", execute all six checks and report per-gate PASS / FAIL / UNPROVEN before touching code. Any UNPROVEN gate = HOLD.
