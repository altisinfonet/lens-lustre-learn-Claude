---
name: Stage-key immutability (B1.5)
description: competition_entries.stage_key cannot move backwards except via admin_rewind_stage(); enforced by trg_guard_stage_key_immutability + audited to db_audit_logs
type: feature
---
**Column:** `competition_entries.stage_key text REFERENCES v3_stage_catalog(stage_key)` (added by v6.1 Correction 2). Backfilled from `progression_decision` + `current_round` digits; no drift on 2026-05-04.

**Ordering fn:** `public.progression_order(stage_key) → int = round_number*100 + family_rank`. Family ranks against the REAL catalog: needs_review=1, verification=2, progression_pass=5, progression_fail=8, rejection=9, award=10. (Initial draft used wrong family names — fixed 2026-05-04 before Stage 3.)

**Guard:** `BEFORE UPDATE OF stage_key` trigger `trg_guard_stage_key_immutability` → `guard_stage_key_immutability()`.
- NULL → anything: allowed (first-write / cleanup).
- anything → same value: noop.
- Forward (`new_order >= old_order`): allowed.
- Backward: `RAISE check_violation` UNLESS session GUC `app.allow_stage_rewind = 'on'`.
- Allowed rewinds are logged to `db_audit_logs` (table_name='competition_entries', operation='stage_key_rewind').

**Admin override:** `public.admin_rewind_stage(_entry_id uuid, _to_stage_key text, _reason text)`.
- SECURITY DEFINER, EXECUTE granted to `authenticated` only.
- Hard-checks `has_role(auth.uid(), 'admin')`, requires reason ≥5 chars, target must be active in `v3_stage_catalog`.
- Flips GUC for the txn, performs UPDATE, logs to `db_audit_logs` (operation='admin_rewind_stage').

**Live proof (2026-05-04):** `UPDATE … SET stage_key='r1_pending' WHERE stage_key='r2_qualified_r3'` → `ERROR 23514: stage_key rewind blocked: r2_qualified_r3 (200) -> r1_pending (0). Use admin_rewind_stage().` Test row reset to NULL.

**Why:** Closing the judging system requires a single forward-only progression. Prevents accidental client/admin/migration writes from silently downgrading entries; every legit rewind is auditable.
