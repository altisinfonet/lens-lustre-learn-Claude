# Fresh Full Audit — CRITICAL Reclassification Closeout

**Mode:** READ-ONLY / DOCUMENTATION ONLY. No code, DB, migration, deploy, or policy changes performed by this note.
**Source report:** `Fresh-Full-Audit-Report.docx` (original: 3 CRITICAL, plus HIGH/MEDIUM items).
**Method:** Live re-proof prechecks executed in prior `GO 1.1`, `GO 1.2`, `GO 1.3` read-only audits this session. Every status below is backed by live grant / policy / file evidence — no memory-only claims.

---

## 1. C-1 — `wallet_transactions` write hole

**Original claim:** Authenticated users can INSERT arbitrary rows into `public.wallet_transactions` via PostgREST.

**Live re-proof (GO 1.1):**

- `information_schema.role_table_grants` for `wallet_transactions` filtered by grantee in (`anon`,`authenticated`) → **zero rows**. No table-level write grants exist.
- `pg_policies` shows only:
  - `Admins can manage transactions` (ALL, `has_role(auth.uid(),'admin')`)
  - `Users can view own transactions` (SELECT, `user_id = auth.uid()`)
- The previously-cited `"System can insert transactions"` INSERT policy is **absent** — dropped by migration `20260514132040_ca5326f2-…sql`.
- `rg "from\('wallet_transactions'\)\.(insert|update|delete|upsert)" src supabase/functions` → **zero matches**.
- `AdminTransactions.tsx` reject path calls `supabase.rpc("admin_reject_wallet_transaction", …)` — SECURITY DEFINER RPC, admin-JWT-gated. No direct table DML.

**Status:** **STALE / ALREADY FIXED.** Finding inherited from `docs/security-hotfixes/wallet-transactions-rls-hole-classification.md` + stale `scripts/audits/baselines/wallet-write-baseline.json` entry F-1 (entry is no longer accurate; live file uses `.rpc()`).

---

## 2. C-2 — Privileged edge functions on `SUPABASE_ANON_KEY`

**Original claim:** 7 edge functions (incl. `approve-deposit`, `expire-gift-credits`) execute privileged writes using the anon key.

**Live re-proof (GO 1.2):**

- 6 of 7 functions exist as edge functions; **`approve-deposit` is NOT an edge function** — only exists as SECURITY DEFINER RPC `public.approve_deposit(uuid,uuid)` with explicit REVOKE on `anon` (migration `20260519074844`). Finding misattributed.
- All 6 real edge functions follow the canonical Lovable pattern:
  - Anon client is used **solely** for `supabase.auth.getClaims(token)` JWT verification.
  - All privileged DB writes go through a **separate `SERVICE_ROLE` client**.
- Every function returns 401 on missing `Bearer` or failed `getClaims()`. No anonymous privileged execution path exists.
- `expire-gift-credits` is additionally protected by `x-cron-secret` header check before any work.

**Status:** **STALE / ALREADY FIXED.** Pattern is the documented Lovable secure-edge-function pattern; not a vulnerability.

---

## 3. C-3 — `manage-notifications` role gate

**Original claim:** `manage-notifications` edge function allows non-admin callers to perform admin actions.

**Live re-proof (GO 1.3):**

- File `supabase/functions/manage-notifications/index.ts` (123 LOC) inspected.
- 401 gate at L13–16 + L22–25 blocks missing Bearer / forged JWT.
- Every privileged action gated by server-side `has_role(uid,'admin')`:
  - `dismiss_admin` (L53–56) → 403 if not admin
  - `mark_all_read` admin branch (L86–91) → 403 if not admin
  - `insert_user_notification` (L99–102) → 403 if not admin
- Self-scoped actions (`dismiss_user`, `dismiss_gift`) are correctly scoped to `auth.uid()`.
- `insert_admin_notification` is intentionally callable by any authenticated user (documented product requirement: deposit requests, role applications, etc. — `docs/rebuild-blueprint/step-2g-email-notification-system.md §2.4`).
- No `SUPABASE_SERVICE_ROLE_KEY` import → cannot bypass RLS.

**Status:** **STALE / ALREADY FIXED.**

---

## 4. Revised Severity Table

| Severity | Count | Items |
|---|---|---|
| **CRITICAL (verified live)** | **0** | — |
| **HIGH (live-unverified, pending precheck)** | open | R-OPEN-1 `public.wallet_transaction` fn executable by `authenticated`; R-OPEN-3 `judge_decisions.judge_id` leak to entry owners; R-OPEN-4 173/202 SECURITY DEFINER fns executable by anon/PUBLIC (prior snapshot, needs live re-count); R-OPEN-8 191 `authenticated`-executable DEFINER fns (linter WARN 0029) |
| **MEDIUM (live-unverified, pending precheck)** | open | R-OPEN-2 `backfill_judging_notifications` executable by `authenticated`; R-OPEN-5 2 DEFINER views without `security_invoker=on` (`entry_public_status`, `v_judging_drift`); R-OPEN-6 alias-mirror drift CI not enforced; R-OPEN-7 `photo_verification_requests` table-vs-cron mismatch; R-OPEN-9 12 memory-only claims not re-verified live |
| **STALE (reclassified this pass)** | **3** | **C-1**, **C-2**, **C-3** |

Source of HIGH/MEDIUM list: `docs/fix-sprints/VERIFY-OPEN-RISKS-AFTER-HOTFIXES.md` (already collected this session).

---

## 5. System Classification

**STABILIZING** — 0 verified CRITICAL remaining. HIGH/MEDIUM items still require their own live prechecks before any fix is staged. Not promoted to STABLE; not promoted to READY FOR SCALE.

---

## 6. Out of scope for this note

- No app code modified.
- No DB modified.
- No scanner findings flipped (no scanner `internal_id`/`scanner_name` pairs attached to C-1/C-2/C-3 in this audit run).
- Baseline file `scripts/audits/baselines/wallet-write-baseline.json` entry F-1 is flagged stale here but **not** rewritten — requires its own `GO BASELINE UPDATE` token.

---

**DONE — RECLASSIFICATION ONLY**
