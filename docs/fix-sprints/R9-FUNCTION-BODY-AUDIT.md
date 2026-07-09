# R9 — Function Body Audit (READ-ONLY)

**Mode:** AUDIT ONLY. No migration, no `CREATE OR REPLACE`, no deploy, no probe writes.
**Method:** `pg_proc` + `pg_get_functiondef` + `information_schema.columns` + `pg_trigger` (all read-only SELECTs).
**Date:** 2026-05-22.

---

## 0. Function inventory (live)

| Function | Args | Returns | Lang | Security | Body md5 | Body len |
|---|---|---|---|---|---|---|
| `public.wallet_ledger_v2_diff_report` | `p_window interval` | `jsonb` | plpgsql | DEFINER | `3c444786d17c71de31d37cbd6e175ac2` | 5903 |
| `public.wallet_ledger_v2_diff_snapshot` | `p_window interval` | `uuid` | plpgsql | DEFINER | `e4b072b873421e2883eb2f675841df38` | 7231 |
| `public.wallet_ledger_apply_v2` | `p_op text, p_user_id uuid, p_amount numeric, p_idempotency_key text, p_description text, p_reference_id text, p_source_path text, p_dry_run boolean` | `jsonb` | plpgsql | DEFINER | `2699d1493adec808238d13530ab04bd5` | 6461 |
| `public.wallet_transaction` | `_user_id uuid, _type text, _amount numeric, _description text, _reference_id uuid, _reference_type text, _metadata jsonb` | `uuid` | plpgsql | DEFINER | `45604161981ede029f0ecd05d3e74809` | 2106 |
| `public.emit_notification` | `_kind text, _entity_id uuid, _round_number integer, _recipient_user_id uuid, _in_app_type text, _in_app_title text, _in_app_message text, _in_app_reference_id uuid, _email_template text, _email_data jsonb, _action_url text` | `uuid` | plpgsql | DEFINER | `fd462f07bd39f20827a2dd8ea495400a` | 3367 |
| `public.backfill_judging_notifications` | `_window_days integer, _dry_run boolean` | `TABLE(scanned bigint, would_emit bigint, emitted bigint)` | plpgsql | DEFINER | `39d1c018327e5e8b92522ec33d4aefdd` | 2027 |
| `public.send_notification_email` | *(none — trigger fn)* | `trigger` | plpgsql | DEFINER | `a2ca0f1d3626f786d2eb60d2470068ff` | 4700 |
| `public.current_phase` | `p_competition_id uuid` | `text` | plpgsql | DEFINER | `cf089642ed703a664a30cd4d2e241986` | 764 |
| `public.current_phase_for` | `p_status text, p_starts_at timestamptz, p_ends_at timestamptz, p_voting_ends_at timestamptz, p_judging_completed boolean, p_legacy_phase text` | `text` | plpgsql | INVOKER | `7b92a110894555fb08376468c9b7c2b4` | 1415 |

All 9 target functions exist. No `EXECUTE` dynamic SQL anywhere. No `WITH RECURSIVE`. No exception swallowing beyond what is listed per-function below.

---

## 1. `public.wallet_ledger_v2_diff_report(p_window interval)` → jsonb

**Reads:** `public.wallet_ledger_shadow_log`, `public.wallet_ledger_v2_rows`, `public.wallet_transactions`, `public.wallet_ledger_audit_log`.
**Writes:** none.
**Helpers called:** `public.has_role` (gate).
**Dynamic SQL / EXCEPTION / recursion:** none / none / none.
**Implicit casts:** **YES — `l.user_id = s.user_id`** is uuid=uuid (clean) but `l.amount = s.amount` compares `numeric=numeric` (clean). **NO `reference_id` join is used today** — the join is heuristic on `(user_id, amount, nearest captured_at)`. `reference_id` is only carried for output, never used as a predicate.
**Source-of-`s`:** `wallet_ledger_shadow_log` aliased as `s.intended_user_id AS user_id`, `s.intended_amount AS amount`, `s.id AS shadow_id`. (Source of truth, lines 47-55 of dumped body.)
**`type_mismatch` predicate (line 104 / 80):** `s_op IS DISTINCT FROM l_type` — **raw equality**, no taxonomy normalizer.
**`unmatched_live` predicate (line 136):** counts rows in `wallet_transactions` since `v_since` whose `(user_id, amount, ±?s)` did not pair into `pairs`. **No cutover exclusion.**
**v2 bridge:** `LEFT JOIN LATERAL ... wallet_ledger_v2_rows v WHERE v.idempotency_key = s.idempotency_key` — bridge is on **`idempotency_key` (text=text)**, NOT on `reference_id`, NOT on UUID cast.

**Verdict:** Body is the C.fix-3 / R2 / C.fix-5d lineage. Helpers `wallet_op_to_legacy_type` / `wallet_live_canonical_ops` are **not referenced**.

## 2. `public.wallet_ledger_v2_diff_snapshot(p_window interval)` → uuid

Same join shape, same predicates as §1. Adds writes:

**Writes:** `INSERT INTO public.wallet_ledger_v2_diff_log`, conditional `INSERT INTO public.admin_notifications` (deduped against existing OPEN alert).
**Reads:** all of §1 + `public.wallets` (for `v_checksum`) + `public.admin_notifications` (dedupe).
**`safe_for_shadow_wiring` algebra (line 120-122):** `(mismatch_count = 0) AND (error_count = 0) AND (unmatched_live = 0)` AND balance-after parity. Identical to §1 with the snapshot write side-effect.
**No dynamic SQL, no recursion, no exception block.**

## 3. `public.wallet_ledger_apply_v2(...)` → jsonb

**Path branching on `p_dry_run`:**
- `p_dry_run = true` → reads `wallets`/`wallet_ledger_idempotency`, INSERTs into `wallet_ledger_shadow_log` + `wallet_ledger_audit_log`, **never touches** `wallets` row balance and **never inserts into** `wallet_transactions`. Returns `{ok:true, dry_run:true}`.
- `p_dry_run = false` → INSERT into `wallet_ledger_v2_rows` + INSERT into `wallet_ledger_idempotency` + INSERT into `wallet_ledger_audit_log`. **Does NOT update `wallets.balance` and does NOT insert into `wallet_transactions`.** (Confirmed line 106 comment + write set scan.)

**Implication:** `wallet_ledger_v2_rows` is a parallel ledger. Live participant balance is still produced by `wallet_transaction(...)` + the legacy writers; `apply_v2` is shadow-only on the participant balance dimension. This matches Memory `Wallet Reconciliation Phase 2.2`.

**Args:** `p_reference_id text` (NOT uuid). Stored directly into `wallet_ledger_v2_rows.reference_id text`.

## 4. `public.wallet_transaction(...)` → uuid (legacy writer)

**Reads:** `wallet_transactions` (recent_count guard), `wallets`.
**Writes:** `INSERT INTO wallet_transactions`, `UPDATE wallets` (balance + total fields), `INSERT INTO wallets` for first-time users.
**Exception blocks:** 3 — used for unique-violation idempotency and balance-recompute fallback. No silent swallow of arbitrary errors.
**`_reference_id` arg type: `uuid`** — bound to `wallet_transactions.reference_id uuid`.

## 5. `public.emit_notification(...)` → uuid

**Reads:** `auth.users` (email/name), `public.profiles` (name/prefs), `public.notification_emit_log` (idempotency).
**Writes:** `INSERT INTO public.notification_emit_log`, `INSERT INTO public.user_notifications`. Calls `public.enqueue_email`.
**Exception:** one block for emit_log unique-violation race. No recursion, no dynamic SQL.

## 6. `public.backfill_judging_notifications(_window_days, _dry_run)` → table

**Reads:** `public.competition_entries`, `public.notification_emit_log`, helper `public._notification_template_for_entry`, helper `public._resolve_stage_key_from_entry`.
**Writes:** delegates to `public.emit_notification` (so writes to `notification_emit_log` + `user_notifications` when `_dry_run=false`).
**Exception:** one block (logged via emit_log). No dynamic SQL.

## 7. `public.send_notification_email()` → trigger

**Wired:** `CREATE TRIGGER trg_send_notification_email AFTER INSERT ON public.user_notifications FOR EACH ROW EXECUTE FUNCTION send_notification_email()`.
**Reads:** `auth.users`, `public.profiles`, `public.suppressed_emails`, `public.email_unsubscribe_tokens`.
**Writes:** `INSERT INTO public.email_send_log`, conditional `INSERT INTO public.email_unsubscribe_tokens`, `UPDATE public.user_notifications` (mark `email_sent=true`).
**Recursion:** none (trigger is AFTER INSERT on `user_notifications`, updates `user_notifications` but no INSERT on same table). The `UPDATE` does not re-fire AFTER INSERT.
**Implicit casts / dynamic SQL / swallowed exceptions:** none observed.

## 8. `public.current_phase(p_competition_id uuid)` → text

**Reads:** `public.competitions` only.
**Writes:** none. **Calls** `public.current_phase_for(...)` — single delegation. SECURITY DEFINER but reads only one row by id.

## 9. `public.current_phase_for(...)` → text

Pure function — no table reads, no writes, no side effects. SECURITY INVOKER. Deterministic mapping from status + timestamps + judging_completed + legacy phase.

---

## 10. Bridge type evidence (information_schema)

| Table | Column | Type |
|---|---|---|
| `wallet_transactions.reference_id` | | **`uuid`** |
| `wallet_transactions.user_id` | | uuid |
| `wallet_transactions.amount` / `balance_after` | | numeric |
| `wallet_transactions.created_at` | | timestamptz |
| `wallet_ledger_v2_rows.reference_id` | | **`text`** |
| `wallet_ledger_v2_rows.user_id` | | uuid |
| `wallet_ledger_v2_rows.amount` / `balance_after` | | numeric |
| `wallet_ledger_shadow_log` | (no `reference_id`, no `amount`, no `user_id`, no `shadow_id` columns) | uses `id`, `intended_user_id`, `intended_amount`, `op`, `idempotency_key`, `captured_at` |

---

## 11. Audit of prior-doc assumptions vs live bodies

| Prior assumption (C.fix-2 / C.fix-3 / C.fix-2b / COMBINED) | Live body says | Truth |
|---|---|---|
| `diff_report` `type_mismatch` predicate uses raw `s_op IS DISTINCT FROM l_type` | Same | **TRUE** (line 104) |
| `diff_report` heuristic match is `(user_id, amount, ±5s)` | Match is `(user_id, amount, ORDER BY abs(epoch dt) LIMIT 1)` with **NO `<= 5s` cap** | **FALSE** — the `±5s` window in COMBINED §2.3 is not in the live body |
| `diff_report` already uses `s.shadow_id` and a UUID cast `t.reference_id::uuid = s.shadow_id` | No reference_id predicate at all; v2 bridge is on `idempotency_key` text=text | **FALSE** |
| Helpers `wallet_op_to_legacy_type` / `wallet_live_canonical_ops` exist | Neither function exists in `pg_proc` | **TRUE** (still absent — matches reconciled doc §0) |
| `wallet_ledger_shadow_log` has columns `user_id`, `amount`, `reference_id`, `shadow_id` | Actual columns: `id`, `intended_user_id`, `intended_amount`, `op`, `idempotency_key`, `captured_at`, … (no `reference_id`, no `amount`, no `user_id`) | **FALSE** — COMBINED §2.3 step 2 referencing `s.shadow_id` / `s.amount` / `s.user_id` is fine only because they are CTE aliases, but any new predicate `l.reference_id::uuid = s.shadow_id` would be **type-invalid** (`s.shadow_id` is `uuid` of the shadow row id, not the live business reference) |
| `wallet_ledger_apply_v2` writes to `wallet_transactions` when `p_dry_run=false` | Body explicitly says "NO update on wallets. NO insert into wallet_transactions." — writes only to `wallet_ledger_v2_rows` + idempotency + audit | **FALSE** |
| `wallet_ledger_v2_diff_log` is a view | It is the target of `INSERT INTO public.wallet_ledger_v2_diff_log` inside snapshot — it is a **table** | **TRUE per prior Evidence-Only audit** |
| `diff_report` excludes pre-cutover rows from `unmatched_live` | Live body has no cutover predicate; counts every unpaired live row in window | **FALSE** |
| `safe_for_shadow_wiring = (mismatch_count=0) AND (error_count=0) AND (unmatched_live=0) AND balance_after_parity` | Confirmed lines 120-122 of snapshot, 144-148 of report | **TRUE** |

---

## 12. Hidden behaviors / risk surface

- **No dynamic SQL anywhere** in the 9 functions (verified by `grep -i '\bEXECUTE\b'`).
- **No exception swallowing** that masks errors except: `wallet_transaction` (3 blocks, all explicit unique_violation / balance-recompute), `emit_notification` (1 block, emit_log race), `backfill_judging_notifications` (1 block, logged). All return paths surface an outcome.
- **No recursive calls.** `send_notification_email` updates the same table it triggers on, but via UPDATE (not INSERT), so the AFTER INSERT trigger does not re-fire.
- **Implicit casts:** none in the join predicates today. The risk surface for casts only appears **if** a future predicate tries `wallet_transactions.reference_id (uuid) = wallet_ledger_v2_rows.reference_id (text)`. The live bodies do **not** attempt this.
- **`wallet_ledger_apply_v2` non-dry path** writes only to the shadow ledger plumbing (`wallet_ledger_v2_rows` + `wallet_ledger_idempotency` + `wallet_ledger_audit_log`). It **does not** mutate user wallet balances or insert into `wallet_transactions`. Any reconciler that assumes parity between `wallet_ledger_v2_rows` and `wallet_transactions` must account for the fact that `wallet_transactions` is populated by the legacy `wallet_transaction()` writer on a separate code path.

---

## 13. Files / services touched by this audit

| Path / service | Operation |
|---|---|
| `pg_proc`, `pg_namespace`, `pg_language`, `pg_trigger`, `pg_class`, `information_schema.columns` | **READ-ONLY SELECT** |
| `/tmp/r9/*.sql` (function body dumps) | local sandbox writes only, not project repo |
| `docs/fix-sprints/R9-FUNCTION-BODY-AUDIT.md` | **NEW file** (this report) |

No DB writes. No migration. No edge function deploy. No RLS / grant change. No schema change.

---

## 14. Final verdict

**HOLD_FUNCTION_SEMANTICS_UNCLEAR** for the diff-report/snapshot redesign, with cause:

1. The COMBINED package §2.3 step 2 assumes a `(user_id, amount, ±5s)` heuristic exists in the live body. It does **not** — the live join has no time-window cap, only `ORDER BY abs(dt) LIMIT 1`. Any rewrite that adds the `<= 5s` clause changes shadow-only matcher behavior.
2. The COMBINED package §2.3 step 2 also proposes `l.reference_id::uuid = s.shadow_id` for the whitelist branch. `s.shadow_id` is `wallet_ledger_shadow_log.id` (the shadow row PK, uuid), **not** the participant-facing business reference. Pairing live `wallet_transactions.reference_id` (uuid of vote/entry/etc) to the shadow row PK is **semantically wrong** and would produce 0 matches.
3. `wallet_ledger_apply_v2` does not write `wallet_transactions`. Therefore the assumed reconciliation channel "shadow row → live `wallet_transactions.reference_id`" needs an explicit mapping rule because the two ledgers are populated by different writers (legacy `wallet_transaction()` for live, `apply_v2` for shadow).

**Safe for next step:** authoring an evidence-grounded redesign of the matcher (no apply). The 9 function bodies are stable, no dynamic SQL, no recursion, no swallowed exceptions; **bodies themselves are safe to read against**, but the matcher semantics required by the COMBINED package are **not** consistent with these bodies.

> R9_REPORT_READY
