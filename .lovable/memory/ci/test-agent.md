---
name: Test Agent CI
description: Continuous CI test agent runs every push + every 5 min cron, logs to GitHub Actions + .lovable/test-reports/ + test_agent_runs DB table + admin widget
type: feature
---

# Test Agent

**Trigger:** push (any branch), pull_request, schedule `*/5 * * * *`, workflow_dispatch.

**Workflow:** `.github/workflows/test-agent.yml` runs `scripts/test-agent/run-checks.mjs`.

**Checks performed every run:**
1. `tsc --noEmit` (full type check)
2. `vitest run` (skipped if no vitest config)
3. `eslint . --max-warnings=0` (catches the no-raw-entry-status rule + others)
4. **Live DB health snapshot** via anon-callable RPC `public.get_test_agent_health_admin()`:
   - Phase 1 dual-emit RPC parity (sample 50 newest entries, asserts both `status` + `status_legacy` non-null)
   - NR drift count (5-min + 24h windows from `db_audit_logs.NR_DRIFT_R2_PLUS`)

**Where the report lives (4 sources of truth):**
1. `.lovable/test-reports/latest.md` (+ `history/<ts>.md`) — committed back to repo on every non-PR run
2. `test_agent_runs` table — written via `record_test_agent_run(token, ...)` SECURITY DEFINER RPC, token in vault
3. `/admin/test-agent` admin page — last 50 runs + live health snapshot
4. GitHub Actions tab — Job Summary (Markdown) + downloadable JSON artifact (90-day retention)

**On failure:**
- GitHub issue auto-opened with title `🚨 Test Agent failed [<errHash>]`, deduped by md5 hash of failed-check names
- Brevo email via `send-transactional-email` to first admin role's email (template `test-agent-alert` — must be created separately if missing)
- Auto-closes issue on next green run with comment `✅ Resolved at <commit>`

**Auth model:**
- Health RPC: anon-callable read-only (no PII leaked beyond admin email)
- Write RPC: requires shared token from vault (`test_agent_ingest_token`), passed as GitHub Actions secret `TEST_AGENT_INGEST_TOKEN`
- `test_agent_runs` RLS: only `admin` role can SELECT; no INSERT/UPDATE/DELETE policies (write is fn-only)

**Known constraints:**
- App role enum has `admin` (no `super_admin`) — alerts go to first admin alphabetically
- `vitest` step skipped silently if no config exists; reported as `pass=true, skipped=true`
- Reports committed with `[skip ci]` to avoid recursive CI triggers
