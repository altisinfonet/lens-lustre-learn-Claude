# P32 Session A — Evidence & Handoff

**Session:** MASTER EXECUTION — SESSION A (P32 Security/ACL Remediation Owner)
**Date:** 2026-09-21
**Repo:** altisinfonet/lens-lustre-learn-Claude
**Base branch:** `main` @ `96c9d91dd5e8506c0294241b1e67ee562d789e78` (post Rule-20 reconciliation, PR #271)
**Working branch (local only — no push access):** `d1/P32-session-a-complete-20260921`
**DB read access:** Supabase MCP, read-only SELECT, project `fpszggreishhuvdpkmdr` ("Staging - 50mm Retina World"). No production project is reachable from this session. **No DDL was ever run against staging or production from this session** — every REVOKE/GRANT below was validated only against a disposable local PostgreSQL 16.13 fixture, per `apply-migration.yml`'s own stated rule that applying migrations to a real lane is Owner-only (GitHub Actions + `SUPABASE_DB_URL` secret).

---

## 1. Forensic re-check — what changed since the last written record

- **75 non-trigger anon-executable VOLATILE functions** on live staging as of this session (measured before this unit's own work; re-derived independently of the Addendum's original "8", the frozen list's "33", and PR #256's own 2026-09-17 count of "88" — the true figure keeps shrinking as P32 units land, which is expected, not a discrepancy).
- **P32 mail-group (delete_email / emit_notification / move_to_dlq) is merged into the tree (`20260910_0024-0026`) but NOT dispatched.** Confirmed by direct query: all three are still anon/authenticated-executable on live staging today. `list_migrations` (the DB's own migration-history table) shows only 8 applied migrations total, none from any P32 unit, none from media-pipeline either — the sanctioned dispatch path (`apply-migration.yml`, Owner-only, one file at a time, GitHub-secret-gated) has evidently not been run for most of the P32 tree yet, even where files are merged. This is a **dispatch gap**, not a code gap, and it is outside this session's authority to close (no session has the `SUPABASE_DB_URL` secret or push access) — recorded here for the Owner.
- **Media pipeline (8 functions) is the one group actually closed live** — confirmed absent from the 75-function list. It is not reflected in `list_migrations` either, meaning it was most likely applied out-of-band (direct SQL) rather than through the tracked migration flow. Also recorded for the Owner, not something this session can reconcile further without dispatch-log access it doesn't have.
- **Identity #1 (`claim_username`/`change_custom_url`/`clear_custom_url`)** confirmed closed live, consistent with the prior session's dispatch record.
- **`increment_managed_page_view`'s P31-era client-side blocker is already fixed** in `src/pages/ManagedPageView.tsx` (two-argument `.then(onSuccess, onError)`, with a comment citing the fix). The function itself remains anon-executable at the grant layer; whether to close it or retain it as an intentional public-page counter is a product judgment call the Owner should make, not something this session decided unilaterally — see §3.

## 2. Migration ordinal collision — found, and resolved

PR #256 (`20260910_0024_p32_money_account_control_revoke.sql`) and PR #259 (originally also targeting a `_0024`, later self-corrected to `_0027`) were both branched from the same pre-mail-group commit (`c424285`), each picking the "first free" Phase-1 ordinal independently. Neither is wrong on its own branch; the collision only appears against today's `main`, where the mail-group's `_0024`/`_0025`/`_0026` already occupy that range.

**Resolution:** both PRs' *content* was validated (§4) and adopted, renumbered onto the first genuinely free ordinals on today's `main` (`_0027`, `_0028`), plus one new unit at `_0029` for two findings from this session's own re-check (§5). No file in this branch reuses an ordinal already present on `main`.

| Ordinal | Origin | Functions | Status |
|---|---|---|---|
| `_0024`–`_0026` | already on `main` (mail-group) | delete_email, emit_notification, move_to_dlq | merged, **not dispatched** (§1) |
| `_0027` | **this branch**, adopted from PR #256, renumbered `_0024→_0027` | 11 money/account-control functions | authored + fixture-validated, not dispatched |
| `_0028` | **this branch**, adopted from PR #259, renumbered `_0027→_0028` | 5 identity-group-2 functions | authored + fixture-validated, not dispatched |
| `_0029` | **this branch**, new, authored by Session A | password_verification_hook, get_public_role_user_ids | authored + fixture-validated, not dispatched |

## 3. Special findings — Owner/Auditor decision required, NOT acted on

Per the session's own instruction ("stop only that item and record it precisely while continuing all independent work"), these are flagged, not closed:

- **`verify_staff_id`** — STABLE, SECURITY DEFINER, PUBLIC/anon/authenticated all EXECUTE. Withdrawn from revocation once already (C-60: the Auditor's blood_group concern was an Owner-corrected false positive). The gate itself still says "placed behind a session or a rate limit" — that is a design/product decision (what limit, what session requirement), not a grant-only fix, and this session did not touch it.
- **`entry_vote_counts`** (materialized view, not a function) — `anon SELECT=true, authenticated SELECT=true, PUBLIC SELECT=false`. PUBLIC is already closed; the open question (per P1-revocation-list.md §2.3) is whether anon should see vote counts at all or whether the column itself should be redesigned — a product decision, not touched here.
- **`record_test_agent_run`** — investigated, not a gap: its only caller is `scripts/test-agent/run-checks.mjs`, which posts CI test-agent results over `rest/v1/rpc/record_test_agent_run` using the **anon key by design** (`SUPABASE_ANON_KEY`, confirmed in the script). Anon EXECUTE here is intentional, matching the existing `log_app_event`/`log_client_error` pattern. **Recommend: RETAIN with justification**, not revoke — but this session did not independently audit the function body for injection/abuse-safety (e.g. rate limiting on the write), so that audit is listed as follow-up in §6 rather than asserted as clear.

## 4. PR #256 and #259 content validation

Both PRs' new migration + PROBE files were read in full (not just diffed at the file-list level) and are high quality: every function's callers were grep-inventoried against `src/`, `supabase/functions/`, and `functions/` before being placed in the file; both follow the F-62 PUBLIC-before-anon order; neither touches a function body; both are wrapped for idempotent re-run; both carry per-function `COMMENT ON FUNCTION` provenance. **Adopted with no functional changes** — only the ordinal rename (§2) and, for the money-group file, an updated FILENAME-rationale paragraph documenting the rename itself.

## 5. New findings from this session's own re-check (`_0029`)

- **`password_verification_hook` (NEW, elevated severity).** This is GoTrue's Password-Verification Auth Hook, meant to run only as `supabase_auth_admin`. Live: PUBLIC/anon/authenticated *and* `supabase_auth_admin` all hold EXECUTE. Its body trusts `event->>'user_id'` and `event->>'valid'` with no check that the caller is GoTrue or that `user_id` is the caller's own id. Concretely, over `rpc/password_verification_hook`, any anon/authenticated caller can today (a) lock an **arbitrary** account by replaying `{"user_id":"<victim>","valid":false}` past the 10-strike threshold with zero real sign-in attempts, or (b) clear another account's failed-attempt counters via `{"user_id":"<any>","valid":true}`. This is a grant-layer fix only (REVOKE ALL FROM public/anon/authenticated; `supabase_auth_admin`'s existing grant is untouched) — no body change, no behaviour change for GoTrue. This finding does not appear in any prior P32 document; it is new as of this session and should be surfaced to the Auditor even though the fix itself required no ruling to author.
- **`get_public_role_user_ids`** — STABLE, body-guarded (`_role NOT IN ('admin','judge')` → `RAISE 42501`), confirmed not a real gap (matches P1-revocation-list.md §2.4's prior read, re-verified independently). Standard defense-in-depth closure applied: PUBLIC/anon revoked, authenticated/service_role retained.

## 6. Fixture validation (C-34: a test that could not have failed is not evidence)

All three new files (`_0027`, `_0028`, `_0029`) and their paired `PROBE_*` files were run end-to-end against a disposable local **PostgreSQL 16.13** instance (matching the repo's own convention), reproducing the measured live starting ACL for all 18 functions:

1. PROBEs run against the open (pre-revoke) fixture — **all correctly FAILED**, each on the specific assertion the gate is meant to catch.
2. All three migrations applied — clean, zero errors.
3. PROBEs re-run — **all PASSED**.
4. All three migrations re-applied a second time — clean, idempotent, zero errors.
5. One function's grant manually restored per file (simulating a rollback) — PROBEs **failed again**, confirming the probes are not vacuously green.

One fixture-setup defect was caught and corrected in the process: the first fixture pass didn't give `service_role` its own named ACL entry on the money-group functions (only PUBLIC-inherited), which made the money-group PROBE's "no over-revoke" assertion correctly fail after the REVOKE — this was **a bug in the test fixture, not in the migration**, since PR #256's own header already documented `service_role` holding an explicit named grant on live staging. Corrected and re-verified. Full transcript: `P32-session-a-fixture-transcript.txt` (same directory).

## 7. What is NOT done in this pass (honest accounting)

- 18 of the ~75 anon-executable functions are closed by this branch's three files. The remaining ~57 (of which roughly 30 were read and roughly classified in this session's earlier recheck: `pj_handle_*`/queue-worker functions, `log_push_outcome`/`prune_*`/`rollup_*` cron-style functions, `get_broadcast_feed` ×3 overloads, `log_app_event`/`log_client_error`, `recompute_entry_from_tag_assignments`, judging-lock functions with a genuine body-level identity-check gap, and others) are **not yet turned into migration files** in this pass. This branch is an honest partial delivery, not a claim of P32 completion.
- The judging-lock functions (`acquire_judge_lock`, `heartbeat_judge_lock`, `release_judge_lock`, `judge_apply_single_tag`) need a **body fix**, not a grant fix (`_judge_id` is caller-supplied and never checked against `auth.uid()`) — flagged, not attempted here, since it's a behaviour change outside a pure ACL-closure unit and deserves its own reviewed migration.
- `record_test_agent_run`'s body was not audited for abuse-safety beyond confirming its anon exposure is intentional (§3).
- Mail-group dispatch and media-pipeline's out-of-band application (§1) are Owner-facing operational gaps, not something an AI session can close (no `SUPABASE_DB_URL` secret, no push access).

## 8. Handoff

No AI session in this project has GitHub push or API access (`git push --dry-run` → 403, "not in this session's authorized repository set"; confirmed again this session). Work is committed locally to `d1/P32-session-a-complete-20260921` and exported as a patch bundle for the Owner to apply and push. See the accompanying `.patch` file and this session's final chat report for the exact commands.
