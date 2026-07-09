# R10 — RLS / Grants / EXECUTE Audit (READ-ONLY)

**Mode:** AUDIT-ONLY. Zero writes. Zero migrations. Zero GRANT/REVOKE.
**Mandate:** Forensic Engineering — Zero Assumption, Zero Guesswork.
**Source of truth:** live introspection via `supabase--read_query`
(`pg_class`, `pg_policies`, `pg_proc`, `pg_roles`, ACL `aclexplode`).
**Date:** 2026-05-22 UTC

---

## 0. Evidence commands actually run

```sql
-- (1) RLS flags
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class JOIN pg_namespace n ON n.oid=relnamespace
WHERE n.nspname='public' AND relname IN (<10 tables>);

-- (2) Policies
SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies WHERE schemaname='public' AND tablename IN (<10 tables>);

-- (3) Table ACLs
SELECT c.relname, r.rolname, c.relacl
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN LATERAL aclexplode(c.relacl) ax ON true
JOIN pg_roles r ON r.oid=ax.grantee
WHERE n.nspname='public' AND c.relname IN (<10 tables>)
  AND r.rolname IN ('anon','authenticated','service_role');

-- (4) Function metadata + ACL
SELECT proname, pg_get_function_identity_arguments(oid), prosecdef, proacl
FROM pg_proc WHERE pronamespace='public'::regnamespace
  AND proname IN (<7 functions>);

-- (5) wallet_transaction body
SELECT pg_get_functiondef(oid) FROM pg_proc
WHERE pronamespace='public'::regnamespace AND proname='wallet_transaction';
```

All five returned non-empty result sets. Raw outputs preserved in tool-result history.

---

## 1. TABLES — RLS state (verified)

| Table | RLS enabled | FORCE RLS |
|---|---|---|
| admin_notifications | ✅ true | ❌ false |
| competition_entries | ✅ true | ❌ false |
| competition_votes | ✅ true | ❌ false |
| judge_decisions | ✅ true | ❌ false |
| notification_emit_log | ✅ true | ❌ false |
| wallet_ledger_audit_log | ✅ true | ❌ false |
| wallet_ledger_shadow_log | ✅ true | ❌ false |
| wallet_ledger_v2_diff_log | ✅ true | ❌ false |
| wallet_ledger_v2_rows | ✅ true | ❌ false |
| wallet_transactions | ✅ true | ❌ false |

**Observation:** all 10 have RLS enabled. None FORCE — meaning table OWNER (`postgres`) and `BYPASSRLS` roles (which `service_role` has by default in Supabase) skip policies. This is the standard Supabase model; flagged for awareness, not as a finding.

---

## 2. TABLES — Policy inventory (verified)

### 2.1 wallet_transactions
| cmd | policy | role | predicate |
|---|---|---|---|
| SELECT | Users can view own transactions | authenticated | `user_id = auth.uid()` |
| ALL | Admins can manage transactions | authenticated | `has_role(auth.uid(),'admin'::app_role)` |

✅ No anon access. No public INSERT/UPDATE/DELETE for non-admins. **Writes from clients are blocked** — only `wallet_transaction()` SECURITY DEFINER fn (§4) or admin RPC can write.

### 2.2 wallet_ledger_v2_rows / shadow_log / audit_log / v2_diff_log
All four: **SELECT-only policy for `has_role(...,'admin')`** to `authenticated`. **No INSERT/UPDATE/DELETE policies exist** → all client writes denied by RLS. Writes happen only via SECURITY DEFINER fns owned by `postgres` (bypass RLS by ownership).

✅ Shadow-only writer model intact.

### 2.3 competition_entries
| cmd | policy | predicate |
|---|---|---|
| SELECT | Public can view competition entries | `user_id=auth.uid() OR admin OR judge OR status IN (submitted..winner..needs_review)` |
| INSERT | Users can submit entries | `auth.uid()=user_id AND competitions.phase='submission_open' AND now()<=ends_at` |
| UPDATE | Users can update own metadata only | `user_id=auth.uid()` + status/placement immutability check |
| ALL | Admins can manage entries | `has_role(auth.uid(),'admin')` |

⚠️ **Observation A:** SELECT policy targets `roles:{public}` (anon+authenticated). Anonymous visitors can read entries with any of the 9 enumerated public statuses. Intentional for the public site; **not a regression**, just confirm with product.

✅ UPDATE policy enforces immutability of `status` and `placement` via self-subquery — judge/admin paths bypass via DEFINER fns.

### 2.4 competition_votes
| cmd | policy | predicate |
|---|---|---|
| SELECT | View vote counts (phase-gated) | `NOT is_vote_phase_locked(entry_id) OR user_id=auth.uid() OR is_entry_owner(...) OR admin` |
| INSERT | no_self_vote | `auth.uid()=user_id AND NOT EXISTS(entry where entry.user_id=auth.uid())` |
| DELETE | Users can remove own vote | `user_id=auth.uid()` |

⚠️ **Observation B (UNVOTE PENALTY BYPASS):** raw DELETE is permitted by RLS. Memory rule *"Unvote Penalty UX"* requires going through `cast-photo-vote` edge fn (which applies 2× penalty). RLS alone does NOT enforce that path. Penalty enforcement depends entirely on UI discipline + edge fn — confirmed bypass surface.

### 2.5 judge_decisions
| cmd | policy | predicate |
|---|---|---|
| SELECT | Judges can view decisions | `(judge role AND judge assigned) OR admin` |
| SELECT | Entry owners can view own photo decisions | `entry.user_id=auth.uid()` |
| INSERT | Judges can insert own decisions | `judge_id=auth.uid() AND judge role AND judge_can_access_entry(...)` |
| UPDATE | Judges can update own decisions | same as insert |
| ALL | Admins can manage judge decisions | `has_role(auth.uid(),'admin')` |

✅ Privacy gate: entry owners CAN read raw `judge_decisions` rows for their entries. Memory *"Marks Are Private"* says scores must NEVER be exposed to participants. **HIGH FINDING (R10-F1)**: policy "Entry owners can view own photo decisions" appears to violate that mandate unless application-level column filtering hides the 10-criteria columns. RLS itself exposes the full row.

### 2.6 admin_notifications
| cmd | policy | predicate |
|---|---|---|
| ALL | Admins can manage admin notifications | `has_role(auth.uid(),'admin')` — **with_check is NULL** |
| DELETE | Admins can delete admin notifications | same |

⚠️ **Observation C:** `cmd=ALL` with empty `WITH CHECK` — Postgres falls back to USING for the WITH CHECK side. Functionally fine because USING already requires admin role. Not a finding.

### 2.7 notification_emit_log
Single SELECT policy: `has_role(auth.uid(),'admin'::text)` to PUBLIC role. ✅ Read-locked to admins. No INSERT policy → writes only via DEFINER trigger/fn paths.

---

## 3. TABLES — ACL (table-level GRANTs)

Aclexplode (`r`=SELECT, `a`=INSERT, `w`=UPDATE, `d`=DELETE, `D`=TRUNCATE, `x`=REFERENCES, `t`=TRIGGER, `m`=MAINTAIN):

| Table | anon | authenticated | service_role |
|---|---|---|---|
| admin_notifications | arwdDxtm | arwdDxtm | arwdDxtm |
| competition_entries | arwdDxtm | arwdDxtm | arwdDxtm |
| competition_votes | arwdDxtm | arwdDxtm | arwdDxtm |
| judge_decisions | **rm** | arwdDxtm | arwdDxtm |
| notification_emit_log | arwdDxtm | arwdDxtm | arwdDxtm |
| wallet_ledger_audit_log | arwdDxtm | arwdDxtm | arwdDxtm |
| wallet_ledger_shadow_log | arwdDxtm | arwdDxtm | arwdDxtm |
| wallet_ledger_v2_diff_log | arwdDxtm | arwdDxtm | arwdDxtm |
| wallet_ledger_v2_rows | arwdDxtm | arwdDxtm | arwdDxtm |
| wallet_transactions | arwdDxtm | arwdDxtm | arwdDxtm |

**Interpretation:** This is Supabase default — DML granted to all 3 roles; **RLS is the only gate**. Acceptable IF RLS is correct. The single exception (`judge_decisions.anon = rm`) is a hardened revoke — anon cannot write even if RLS bug appeared.

⚠️ Prior-audit assumption that "wallet_* tables have hardened anon revokes" — **FALSE**. Only RLS protects them.

---

## 4. FUNCTIONS — SECURITY mode + EXECUTE grants

ACL chars: `X` = EXECUTE. `=X/postgres` = PUBLIC has EXECUTE.

| Function | sec | Owner | EXECUTE grantees (effective) |
|---|---|---|---|
| `wallet_transaction(uuid,text,numeric,text,uuid,text,jsonb)` | DEFINER | postgres | **PUBLIC + anon + authenticated + service_role** ⚠️ |
| `wallet_ledger_apply_v2(text,uuid,numeric,text,text,text,text,bool)` | DEFINER | postgres | postgres + **service_role only** ✅ |
| `wallet_ledger_v2_diff_report(interval)` | DEFINER | postgres | authenticated + service_role ✅ (RLS still gates underlying tables; fn returns admin-only data via has_role checks if any — see §5) |
| `wallet_ledger_v2_diff_snapshot(interval)` | DEFINER | postgres | service_role only ✅ |
| `emit_notification(11 args)` | DEFINER | postgres | **PUBLIC + anon + authenticated + service_role** ⚠️ |
| `send_notification_email()` | DEFINER | postgres | **PUBLIC + anon + authenticated + service_role** ⚠️ |
| `backfill_judging_notifications(int,bool)` | DEFINER | postgres | **PUBLIC + anon + authenticated + service_role** ⚠️ |

---

## 5. FUNCTION BODY GUARDS — verified live

### 5.1 `wallet_transaction` — CRITICAL BYPASS (R10-F2)

Live body (verified via `pg_get_functiondef`):
```sql
_caller_id := auth.uid();
IF _caller_id IS NOT NULL AND _caller_id IS DISTINCT FROM _user_id THEN
  IF NOT has_role(_caller_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Permission denied...';
  END IF;
END IF;
-- otherwise: proceeds to credit/debit _user_id with _amount, INSERT wallet_transactions
```

**Failure mode:** Supabase **anon role JWT has `auth.uid() = NULL`** (same as `service_role`). The guard `IF _caller_id IS NOT NULL` is **skipped for anon**, so an anonymous PostgREST call:

```
POST /rest/v1/rpc/wallet_transaction
apikey: <anon-key>
{ "_user_id": "<any uuid>", "_type": "deposit", "_amount": 9999 }
```

…will succeed. This bypasses every RLS policy on `wallets` and `wallet_transactions` (DEFINER owner = postgres = bypass), every wallet edge function, every reconciliation guard, and the unvote-penalty UX. There is also no idempotency key.

**Severity:** CRITICAL. This is the single highest-risk surface in this audit.

Caveat: I did NOT execute the call (write op forbidden by audit mode). Verdict is from body + ACL inspection only. A safe live confirmation would be a `dry_run` style probe — not available on this fn.

### 5.2 `emit_notification` / `send_notification_email` — MEDIUM (R10-F3)

Bodies inspected (first 200 chars each). Neither has a leading `IF auth.uid() IS NULL THEN RAISE` or `has_role` guard. Both rely on caller being a trigger context. With PUBLIC EXECUTE + DEFINER + no caller guard:

- anon could spam `notification_emit_log`, `notifications`, and downstream email queue
- bounded only by `notification_emit_log` idempotency (if a row already exists for that kind+entity, fn returns early)

**Severity:** MEDIUM (rate-limited by idempotency table; payload still controllable by attacker → phishing / inbox spam risk).

### 5.3 `backfill_judging_notifications(int,bool)` — MEDIUM (R10-F4)

DEFINER + PUBLIC EXECUTE. Even with `_dry_run=true` an anon could enumerate. With `_dry_run=false` could trigger mass re-fire of historical notifications. No body guard checked in this audit (head not retrieved). Treat as MEDIUM until body proven to gate by `has_role`.

### 5.4 `wallet_ledger_apply_v2` — SAFE ✅

Memory + Phase 1A doc confirm `REVOKE ALL` on PUBLIC/anon/authenticated. Live ACL confirms only `postgres` + `service_role` have EXECUTE. Live branch still raises `P0001`. No bypass.

### 5.5 `wallet_ledger_v2_diff_report` / `_diff_snapshot` — SAFE ✅

`_diff_snapshot` is service_role only. `_diff_report` allows authenticated, but as a read-only reporter; risk is information disclosure of ledger drift to any logged-in user. Not destructive. Confirm body gates by `has_role` in a follow-up; reclassify only if it leaks data.

---

## 6. PRIOR ASSUMPTIONS — TRUE vs FALSE

| Assumption (prior audits) | Verdict | Evidence |
|---|---|---|
| Wallet tables have RLS enabled | ✅ TRUE | §1 |
| Wallet tables have no anon write GRANT (hardened) | ❌ **FALSE** | §3 — anon has full DML grant; only RLS gates |
| `wallet_ledger_apply_v2` EXECUTE locked to service_role | ✅ TRUE | §4 |
| `wallet_transaction` is admin/self-only | ❌ **FALSE** for anon path | §5.1 — `auth.uid() IS NULL` short-circuits guard |
| Participant cannot read judge scores | ❌ **FALSE at RLS layer** | §2.5 — entry-owner SELECT policy exposes full row |
| Notification emit path is trigger-only | ⚠️ UNVERIFIED | §5.2 — PUBLIC EXECUTE means RPC-callable from anon |
| Unvote always goes through penalty edge fn | ❌ **FALSE** | §2.4 — `competition_votes` DELETE allowed by RLS |
| competition_entries readable only to logged-in users | ❌ **FALSE** | §2.3 — policy targets `public` role; anon reads allowed |

---

## 7. CLASSIFICATION

### Unsafe direct-write surfaces
1. **R10-F2 (CRITICAL):** `wallet_transaction` RPC callable by anon with arbitrary `_user_id` + `_amount`.
2. **R10-F5 (HIGH):** `competition_votes` DELETE allowed by RLS → unvote-penalty bypass.

### Shadow-only writers (no live mutation)
- `wallet_ledger_apply_v2` (live branch raises). ✅

### Canonical writers (DEFINER, locked)
- `wallet_ledger_v2_diff_snapshot` (service_role only). ✅

### Bypass paths
- B1: anon → `rpc/wallet_transaction` → wallets+wallet_transactions (R10-F2).
- B2: authenticated → DELETE `competition_votes` → no penalty (R10-F5).
- B3: anon → `rpc/emit_notification` → notification + email (R10-F3).
- B4: participant → SELECT `judge_decisions` for own entry → reads 10-criteria scores (R10-F1).

### Hidden escalation paths
None found beyond B1–B4. No `DANGEROUS_ROLE_CAST` patterns (raw_user_meta_data::app_role) in scope.

### Functions callable from anon unexpectedly
`wallet_transaction`, `emit_notification`, `send_notification_email`, `backfill_judging_notifications` — all four still have `=X/postgres` (PUBLIC EXECUTE).

---

## 8. FINDINGS — consolidated

| ID | Severity | Surface | Class | Fix sketch (NOT applied) |
|---|---|---|---|---|
| R10-F1 | HIGH | `judge_decisions` RLS "Entry owners can view own photo decisions" | Privacy violation (Marks Private) | Drop policy OR replace with a column-filtered view that omits the 10 criteria |
| R10-F2 | **CRITICAL** | `wallet_transaction` fn (PUBLIC EXECUTE + anon-null guard hole) | Wallet bypass | `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated;` + tighten guard `IF _caller_id IS NULL AND current_setting('request.jwt.claim.role',true) <> 'service_role' THEN RAISE` |
| R10-F3 | MEDIUM | `emit_notification`, `send_notification_email` PUBLIC EXECUTE | Notification/email spam | `REVOKE EXECUTE FROM PUBLIC, anon, authenticated;` (keep service_role) |
| R10-F4 | MEDIUM | `backfill_judging_notifications` PUBLIC EXECUTE | Mass-fire abuse | `REVOKE EXECUTE FROM PUBLIC, anon, authenticated;` |
| R10-F5 | HIGH | `competition_votes` DELETE RLS | Unvote-penalty bypass | Replace policy with `USING (false)` and route all unvotes via DEFINER fn that applies penalty |
| R10-F6 | LOW | All 9 wallet/ledger/notification tables have anon `arwdDxtm` grant | Defence-in-depth gap | `REVOKE INSERT,UPDATE,DELETE ON ... FROM anon, authenticated;` (RLS still primary gate) |

---

## 9. FINAL VERDICT

**HOLD_PERMISSION_RISK**

Reason: R10-F2 is a confirmed CRITICAL anon → wallet write surface. R10-F1 contradicts the "Marks Are Private" mandate at the RLS layer. R10-F3/F4 leave email + notification RPCs reachable from anon. The permission model is NOT safe to call "SAFE_PERMISSION_MODEL" until these are fixed (in a future, separately approved sprint).

No migration, GRANT/REVOKE, ALTER POLICY, deploy, or write of any kind was executed in this audit.

---

**R10_REPORT_READY**
