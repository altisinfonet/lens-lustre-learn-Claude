# Phase 1 — Step 1.1 — Grants Snapshot (Read-Only)

**Mode:** AUDIT ONLY. No DDL, no DML, no migrations, no edge-fn changes.
**Source of truth:** `50mm-fix-plan-v12-status-report.docx` + `docs/forensic-engineering-mandate.md`.
**Predecessor:** Phase 0 — Freeze & Guardrails (closed; see `phase-0-completion-report.docx`, `phase-0-rollback-runbook.md`).
**Successor:** Step 1.2 — Writer Inventory Delta.

---

## 1. METHOD

Live `psql` SELECT against `information_schema.role_table_grants` and `pg_proc` / `pg_namespace` / `pg_proc.proacl`. Zero writes. Captured 2026-05-19.

```sql
-- Table grants (read-only)
SELECT table_schema, table_name, privilege_type, grantee
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('wallets','wallet_transactions','withdrawal_requests',
                     'gift_credits','gift_announcements','wallet_reconciliation_log');

-- RPC ACLs (read-only)
SELECT proname, proacl
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('wallet_transaction','wallet_ledger_apply_v2','admin_wallet_credit',
                    'create_pending_deposit','approve_deposit');
```

---

## 2. TABLE GRANTS — `public` SCHEMA (VERIFIED)

| Table | INSERT | SELECT | UPDATE | DELETE |
|---|---|---|---|---|
| `wallets` | sandbox_exec only | sandbox_exec only | — | — |
| `wallet_transactions` | sandbox_exec only | sandbox_exec only | — | — |
| `withdrawal_requests` | sandbox_exec only | sandbox_exec only | — | — |
| `gift_credits` | sandbox_exec only | sandbox_exec only | — | — |
| `gift_announcements` | sandbox_exec only | sandbox_exec only | — | — |
| `wallet_reconciliation_log` | sandbox_exec only | sandbox_exec only | — | — |

**Interpretation:** No `authenticated` / `anon` direct DML grants. All client writes therefore traverse **RLS policies on the tables** (not table grants). UPDATE/DELETE on protected tables is **NOT GRANTED** to any role at the SQL grant layer — meaning UPDATE/DELETE today is reachable only via `service_role` or via `SECURITY DEFINER` RPCs (or via legacy RLS policies allowing it).

**`sandbox_exec`** is the read-only audit role used by this probe; it does not represent application traffic.

> ⚠ NOT VERIFIED in this snapshot: the RLS **policy** rows (i.e. `pg_policies`). This snapshot covers SQL grants only. Policy-level reachability will be covered in Step 1.2 cross-check, and the legacy `"System can insert transactions"` / `"System can insert wallets"` policies remain pending HOTFIX-6 closure.

---

## 3. RPC ACL SNAPSHOT (VERIFIED)

| RPC | `SECURITY DEFINER` | EXECUTE granted to |
|---|---|---|
| `wallet_transaction` | ✅ | anon, authenticated, service_role, public (=X/postgres) |
| `wallet_ledger_apply_v2` | ✅ | service_role + sandbox/postgres ONLY (NOT anon/auth) |
| `admin_wallet_credit` | ✅ | anon, authenticated, service_role, public |
| `create_pending_deposit` | ✅ | anon, authenticated, service_role |
| `approve_deposit` | ✅ | anon, authenticated, service_role, public |

**Notable:** `wallet_ledger_apply_v2` is correctly restricted to `service_role` — confirms the "shadow ledger probe permission denial" memo (`phase-1a-wallet-authority-backlog.md` §7).

**Notable risk:** `admin_wallet_credit` and `approve_deposit` are EXECUTE-granted to `anon`/`authenticated`. Authority is therefore enforced **inside** the RPC body (admin-role check) rather than at the GRANT layer. This is functional but is a P2 hardening candidate (REVOKE EXECUTE FROM anon/authenticated).

---

## 4. CANONICAL WALLET RPCs PRESENT (VERIFIED)

```
public.wallet_transaction(_user_id, _type, _amount, _description, _reference_id, _reference_type, _metadata)        SD
public.wallet_ledger_apply_v2(p_op, p_user_id, p_amount, p_idempotency_key, p_description, p_reference_id,
                              p_source_path, p_dry_run)                                                              SD
public.admin_wallet_credit(_admin_id, _target_user_id, _amount, _type, _description, _reference_id,
                           _reference_type, _metadata)                                                               SD
public.create_pending_deposit(_user_id, _amount, _gateway, _reference, _metadata, _idempotency_key)                 SD
public.approve_deposit(_admin_id, _txn_id)                                                                          SD
public.wallet_ledger_v2_diff_snapshot(p_window)                                                                     SD
public.wallet_ledger_v2_diff_report(p_window)                                                                       SD
public.wallet_ledger_v2_drift_report(p_window)                                                                      SD
public.get_gift_drift_admin(), public.fix_gift_drift_admin(_announcement_id)                                        SD
```

All five money-moving RPCs (`wallet_transaction`, `wallet_ledger_apply_v2`, `admin_wallet_credit`, `create_pending_deposit`, `approve_deposit`) are live.

---

## 5. APPENDIX — PENDING vs PHASE 0 (inline; no separate doc)

Cross-checked against `phase-0-completion-report.docx`:

| Item | Phase 0 status | Phase 1 status |
|---|---|---|
| CI guardrails (`audit-forbidden.yml` wallet+RLS globs) | ✅ closed | n/a |
| ESLint `no-as-any-in-protected-dirs` for `src/hooks/wallet/**` | ✅ closed | n/a |
| Baseline tag `v-pre-hardening` | ✅ documented (manual) | n/a |
| Rollback runbook | ✅ `phase-0-rollback-runbook.md` | n/a |
| `wallet_transaction()` RPC live | ✅ verified §3 | — |
| `wallet_ledger_apply_v2` shadow live + service-role-locked | ✅ verified §3 | — |
| `status_legacy` dropped | ✅ (per memo) | — |
| **`current_round_int` column add** | ❌ pending | Step 1.6 (HOLD) |
| **Cutover all writers → `wallet_transaction()`** | ❌ partial | Step 1.3 plan (this batch) |
| **REVOKE direct DML from anon/authenticated** | ❌ pending | Step 1.4 (HOLD) |
| **REVOKE EXECUTE on `admin_wallet_credit`/`approve_deposit` from anon/auth** | ❌ pending | Step 1.4 (HOLD) |
| **Retire shadow v2 infra (`wallet_ledger_apply_v2`, diff reports)** | ❌ pending | Step 1.5 (HOLD) |
| **HOTFIX-6 — drop legacy `"System can insert *"` policies** | ❌ pending | Gate before Step 1.4 |

**Verdict:** Phase 0 guardrails fully landed. Phase 1 DB-touching steps remain HOLD until per-step explicit GO.

---

## 6. VERIFIED FINDINGS / NOT VERIFIED / RISKS / ROLLBACK / NEXT STEP

**VERIFIED:** Sections 2, 3, 4 above (live probe output retained in chat transcript).
**NOT VERIFIED in this doc:** `pg_policies` rows (RLS policy text); shadow-ledger drift counts; per-RPC call counts in last 24h.
**FILES TOUCHED:** This doc only. Zero code/DB changes.
**RISKS:** None — read-only probe.
**DIFF SUMMARY:** +1 markdown file under `docs/fix-sprints/`.
**VERIFICATION PROOF:** `psql -At` output from §2 and §3 probes; exit code 0; row counts match.
**ROLLBACK:** `rm docs/fix-sprints/phase-1-step-1.1-grants-snapshot.md` (doc-only).
**NEXT RECOMMENDED STEP:** Step 1.2 — Writer Inventory Delta (this batch).
