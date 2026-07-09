# RLS-HOTFIX-1 — Forensic Classification: `wallet_transactions` (and adjacent finance tables) RLS Exposure

**Mode:** READ-ONLY FORENSIC AUDIT — no policy changes, no migrations, no runtime edits.
**Scope:** `wallet_transactions`, `wallets`, `withdrawal_requests`, `wallet_reconciliation_log`, `gift_credits`, `competition_orders`.
**Method:** Live `pg_policies`, `pg_tables`, `pg_trigger`, `information_schema` introspection on prod DB.
**Mandate:** `/docs/forensic-engineering-mandate.md` — Zero Assumption / Zero Guesswork.

---

## 1. VERIFIED FINDINGS

| # | Finding | Severity | Verified by |
|---|---------|----------|-------------|
| F-1 | `withdrawal_requests` INSERT policy `"Users can create withdrawals"` has **`qual = NULL` and `with_check = NULL`** → any authenticated user can INSERT a withdrawal request for **ANY** `user_id`, **ANY** `amount`. | **EXTREME** | `pg_policies` row dump |
| F-2 | `wallet_transactions` INSERT policy `"System can insert transactions"` has `WITH CHECK (user_id = auth.uid())` only — **no validation of `amount`, `balance_after`, `type`, `status`, `reference_id`, `metadata`**. Authenticated user can insert arbitrary self-credit rows. | **HIGH** | `pg_policies` + `information_schema.columns` |
| F-3 | `wallets` INSERT policy `"System can insert wallets"` has `WITH CHECK (user_id = auth.uid())` only — user can self-insert their wallet row with **any starting `balance`** on first insert. UPDATE is admin-only, so the cheat is one-shot at row creation. | **HIGH** (race-conditional) | `pg_policies` |
| F-4 | **Zero validation triggers** on `wallet_transactions`, `wallets`, `withdrawal_requests` — only audit-log triggers (`audit_wallet_transactions`, `audit_withdrawal_requests`). Audit triggers RECORD writes; they do not BLOCK fraudulent writes. | HIGH (compounding F-1/F-2/F-3) | `pg_trigger` dump |
| F-5 | `wallet_reconciliation_log` INSERT is gated to admin (`with_check: has_role(...,'admin')`). Safe. | — | `pg_policies` |
| F-6 | All SELECT policies are correctly scoped (`auth.uid() = user_id` or admin). No cross-user read exposure. | — | `pg_policies` |
| F-7 | `competition_orders`, `gift_credits` have NO authenticated INSERT/UPDATE/DELETE policy → only admin (via `ALL`) can write. Safe. | — | `pg_policies` |
| F-8 | No `anon` role grants on any of the 6 inspected tables. Anonymous access is fully blocked. | — | `information_schema.role_table_grants` (empty result for anon) |

---

## 2. POLICY INVENTORY

### `wallet_transactions` (RLS = ON)
| Policy | Cmd | Roles | USING | WITH CHECK |
|---|---|---|---|---|
| `Admins can manage transactions` | ALL | authenticated | `has_role(auth.uid(),'admin')` | — |
| `Users can view own transactions` | SELECT | authenticated | `user_id = auth.uid()` | — |
| **`System can insert transactions`** | **INSERT** | **authenticated** | — | **`user_id = auth.uid()`** ← ⚠ self-insert allowed |

### `wallets` (RLS = ON)
| Policy | Cmd | Roles | USING | WITH CHECK |
|---|---|---|---|---|
| `Admins can manage wallets` | ALL | authenticated | `has_role(auth.uid(),'admin')` | — |
| `Users can view own wallet` | SELECT | authenticated | `user_id = auth.uid()` | — |
| **`System can insert wallets`** | **INSERT** | **authenticated** | — | **`user_id = auth.uid()`** ← ⚠ self-insert with any starting balance |

### `withdrawal_requests` (RLS = ON)
| Policy | Cmd | Roles | USING | WITH CHECK |
|---|---|---|---|---|
| `Admins can manage withdrawals` | ALL | authenticated | `has_role(auth.uid(),'admin')` | — |
| `Users can view own withdrawals` | SELECT | authenticated | `user_id = auth.uid()` | — |
| **`Users can create withdrawals`** | **INSERT** | **authenticated** | — | **`NULL`** ← 🚨 NO CHECK — insert ANYTHING for ANY user |

### `wallet_reconciliation_log` — admin-only ✅
### `gift_credits` — admin-only ✅
### `competition_orders` — read-only for users, admin ALL ✅

### Grants
No `anon` privileges on any of these tables. Default `authenticated` grant flows through RLS only.

---

## 3. EXPLOIT REPRODUCTION

> **Status: NOT EXECUTED** — this phase is read-only forensic CLASSIFICATION only. No write tests were issued against production. The exploits below are derived deterministically from the policy SQL above; reproduction is deferred to RLS-HOTFIX-2 in a controlled test account once mitigation is staged.

### A. Authenticated user — derived attack surface

| Action | Target | Allowed by RLS? | Mechanism |
|---|---|---|---|
| SELECT own wallet rows | `wallets`, `wallet_transactions`, `withdrawal_requests` | ✅ correct | `user_id = auth.uid()` |
| SELECT other-user rows | all 3 tables | ❌ blocked | SELECT policies scoped |
| INSERT fake credit row | `wallet_transactions` | ✅ **succeeds** | `WITH CHECK (user_id=auth.uid())` permits `{type:'credit', amount:99999, balance_after:99999, status:'completed'}` |
| INSERT wallet with high balance | `wallets` | ✅ **succeeds if no row exists** | `WITH CHECK (user_id=auth.uid())` — one-shot on first insert |
| INSERT withdrawal for SELF | `withdrawal_requests` | ✅ trivially | NULL with_check |
| INSERT withdrawal for **OTHER USER** | `withdrawal_requests` | ✅ **succeeds** | `with_check = NULL` → no `user_id = auth.uid()` enforcement |
| UPDATE foreign row | any | ❌ admin-only | UPDATE locked to admin (`ALL` only matches admin role) |
| DELETE row | any | ❌ admin-only | same |

### B. Anonymous user
All three tables: SELECT/INSERT/UPDATE/DELETE → **denied** (no anon-applicable policy + no anon grant).

### C. API-direct (PostgREST)
Same RLS path as UI. F-1, F-2, F-3 are reproducible via direct REST `POST /rest/v1/withdrawal_requests` etc., bypassing UI flow entirely.

### D. Service-role
Bypasses RLS entirely (expected). All edge functions using service-role key (`submit-deposit`, `paypal-capture-order`, `razorpay-verify-payment`, `cast-photo-vote`, `approve_deposit` RPC, `submit_competition_entry` RPC, `expire-gift-credits`) are **outside** this hole — they were never RLS-gated. Their integrity depends on the function logic itself (covered by Phase 1A audit).

---

## 4. AUTHENTICATED ACCESS RESULTS

- Self read: ✅ correct (user_id-scoped)
- Self insert (any payload) on `wallet_transactions`: **policy permits** — confirmed by SQL inspection only.
- Cross-user insert on `withdrawal_requests`: **policy permits** — confirmed by SQL inspection only.
- Cross-user update / delete: blocked.

## 5. ANON ACCESS RESULTS

Fully blocked on all 6 tables. No exposure.

## 6. API-DIRECT RESULTS

Identical to authenticated UI path — RLS is the only gate, and it is the SAME hole.

## 7. SERVICE-ROLE ANALYSIS

Service-role bypasses RLS by design. Confirmed callers (from prior audits 1A-2.5 and 1A-2.6):
- `submit-deposit`, `paypal-capture-order`, `razorpay-verify-payment` (deposits)
- `approve_deposit` RPC, `submit_competition_entry` RPC (atomic balance + ledger)
- `cast-photo-vote` (vote charge + reward)
- `expire-gift-credits` (gift expiry)
- `process_referral_reward` (body NV-2 — pending `process_referral_reward` re-verify, **not blocking** this hotfix)

These paths are NOT affected by F-1/F-2/F-3 and continue to function regardless of policy patch.

---

## 8. BLAST RADIUS

| Asset | Damage if exploited |
|---|---|
| `wallet_transactions` ledger | Polluted with synthetic credits → breaks `wallet_reconciliation_log` drift checks, breaks `get_gift_drift_admin` / `get_referral_drift_admin` audits. **Does not by itself move money** because `wallets.balance` is the source of truth for payout, and UPDATE on `wallets` is admin-only. |
| `wallets.balance` | Inflatable **only** for users who do not already have a wallet row (one-shot). Existing users (179 wallet_transactions rows present → wallet rows exist) are not affected by F-3. New signups can self-mint balance until F-3 is patched. |
| `withdrawal_requests` | Attacker can flood admin queue with **fake withdrawals attributed to OTHER users**. If admin approves without out-of-band verification → real funds drained from victim's wallet. Even without approval: massive operational + reputational damage, victim impersonation, trust collapse. |
| Crons / triggers | None affected (no triggers depend on ledger sums). |
| Reports / dashboards | Admin financial dashboards become unreliable until ledger is reconciled. |
| Existing users (179 ledger rows) | Currently **no evidence of exploitation** in inspected sample, but a full forensic ledger-vs-balance reconciliation is required (deferred to RLS-HOTFIX-3). |

---

## 9. SEVERITY CLASSIFICATION

**Overall: CRITICAL** (one EXTREME + two HIGH, compounding).

- F-1 (`withdrawal_requests` open INSERT for any user_id) — **EXTREME** — direct path to fraudulent withdrawal of OTHER users' funds if admin fails to verify.
- F-2 (`wallet_transactions` arbitrary self-insert) — **HIGH** — ledger integrity breach + audit pollution.
- F-3 (`wallets` open first-insert) — **HIGH** for new signups, **LOW** for existing users (179 rows already exist; UPDATE is admin-locked).

---

## 10. EMERGENCY STATUS

- **Emergency hotfix REQUIRED.** F-1 alone qualifies — it allows impersonated withdrawals.
- **Recommended freeze window:** until hotfix migration is approved, manually pause approval of all `withdrawal_requests` whose `created_at` is in the post-discovery window OR add an admin-side cross-check (ask user to confirm via email) before any approval.
- Phase 1A wallet RPC build **MUST remain paused** until this hole is closed — building a canonical RPC on top of a leaking ledger would cement the leak.

---

## 11. SAFE HOTFIX STRATEGY (proposed only — NOT applied here)

Three-line policy correction, deployable as one migration:

```sql
-- F-1: lock withdrawal_requests INSERT to self
ALTER POLICY "Users can create withdrawals"
  ON public.withdrawal_requests
  WITH CHECK (user_id = auth.uid());

-- F-2: drop user-side INSERT on wallet_transactions; route ALL writes through RPCs / service-role
DROP POLICY "System can insert transactions" ON public.wallet_transactions;

-- F-3: drop user-side INSERT on wallets; wallets are created by trigger / service-role only
DROP POLICY "System can insert wallets" ON public.wallets;
```

Pre-deploy checklist (mandatory):
1. Confirm every legitimate user-initiated wallet/transaction insert path goes through a SECURITY DEFINER RPC or service-role edge function (audits 1A-2.5 and 1A-2.6 confirm this for: deposit, vote, entry-fee, referral, gift). Any client-side `.insert()` on these tables in the codebase MUST be removed first or it will start 401-ing.
2. Grep `src/**` for direct `.from('wallet_transactions').insert(` and `.from('wallets').insert(` and `.from('withdrawal_requests').insert(` BEFORE applying.
3. Stage in shadow with `RAISE NOTICE` logging on a duplicate test policy first if any uncertainty remains.

---

## 12. ROLLBACK RISKS

| Action | Rollback |
|---|---|
| Fix F-1 (`ALTER POLICY ... WITH CHECK ...`) | `ALTER POLICY "Users can create withdrawals" ON public.withdrawal_requests WITH CHECK (true);` (one-line revert; original was effectively `true`) |
| Drop F-2 policy | `CREATE POLICY "System can insert transactions" ON public.wallet_transactions FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());` |
| Drop F-3 policy | `CREATE POLICY "System can insert wallets" ON public.wallets FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());` |
| Risk if hotfix breaks UI | Any client-side insert path will throw `42501 / new row violates RLS`. Rollback restores prior (vulnerable) state in <5s. |
| Data risk | Zero — no rows mutated, no schema changed. |

---

## 13. WHETHER PHASE 1A MUST REMAIN PAUSED

**YES.** Phase 1A (canonical `wallet_transaction()` RPC build) MUST remain paused until:
1. F-1, F-2, F-3 policies are patched and verified.
2. A full ledger-vs-balance reconciliation pass is run on existing 179 `wallet_transactions` rows to confirm no historical exploitation occurred (RLS-HOTFIX-3).
3. Codebase grep confirms no client-side insert remains on the three tables.

Building the canonical RPC on top of a leaking ledger is unsafe — the RPC would inherit and legitimize the corrupt baseline.

---

## NEXT SAFE STEP

`GO RLS-HOTFIX-2` — read-only **codebase inventory** of every `.from('wallet_transactions' | 'wallets' | 'withdrawal_requests').insert(...)` call site (UI + edge functions), to confirm patch will not break legitimate flows. **No code changes.** Then `GO RLS-HOTFIX-3` for the patch migration with full pre-flight.

**No fix applied. Forensic classification only — complete.**
