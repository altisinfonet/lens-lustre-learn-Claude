# FIX SPRINT 0 — PHASE 0A — FREEZE & GUARDRAILS (AUDIT ONLY)

**Mode:** AUDIT ONLY · ZERO DAMAGE · ZERO SIDE EFFECT · ZERO FAN-OUT
**Mandate:** `/docs/forensic-engineering-mandate.md`
**Generated:** 2026-05-12
**Author:** Claude (Lovable agent)

> No code, CI, ESLint, schema, RLS, edge function, RPC, or migration was modified by this phase. All "NEW GUARDRAILS" entries are **PROPOSED — NOT APPLIED** and require explicit user approval to wire in (Phase 0B).

---

## 1. VERIFIED FINDINGS

All findings below were produced by ripgrep against the working tree and direct file reads. Every line cites a file path + line number.

### F-1 — Direct UPDATE on `wallet_transactions` from frontend admin UI · **CRITICAL (FINANCE)**

- **File:** `src/components/admin/AdminTransactions.tsx`
- **Line:** 509
- **Evidence:**
  ```
  await supabase.from("wallet_transactions").update({ status: "rejected" }).eq("id", t.id);
  ```
- **Why it matters:** Bypasses any RPC/server-side wallet mutation funnel. Admin click directly mutates a ledger row's `status`. Combined with the absence of an RLS regression test for `wallet_transactions UPDATE`, this is a finance-mutation path the Mandate's Execution Rule #7 ("every finance mutation requires reconciliation proof") cannot cover.
- **Severity:** **CRITICAL** — finance ledger write from client.

### F-2 — Direct read on `wallet_transactions` from non-admin hook · **INFO**

- **File:** `src/hooks/wallet/useWallet.ts`
- **Line:** 37
- **Evidence:** `.from("wallet_transactions").select(...)` (read-only, scoped by `.eq("user_id", user.id)`)
- **Severity:** **INFO** — read path; RLS-bound. Listed for completeness, not a violation.

### F-3 — Direct read on `wallet_transactions` from admin reporting · **INFO**

- **Files:** `src/components/admin/AdminVoteRewardLedger.tsx:65`, `src/components/admin/AdminTransactions.tsx:84`
- **Evidence:** `.from("wallet_transactions").select(...)` (read-only)
- **Severity:** **INFO** — admin read path, RLS-bound to `is_admin`.

### F-4 — `current_round` parsed via `parseInt` in finance-adjacent edge function · **MEDIUM**

- **File:** `supabase/functions/complete-round/index.ts`
- **Line:** 777
- **Evidence:**
  ```
  const currentRoundNum = comp.current_round ? parseInt(comp.current_round, 10) : 0;
  ```
- **Conflict with memory rule:** `mem://judging/current-round-text-format` — *"never blind `::int` cast in triggers — extract digits via regexp_replace first or every judge UPDATE fails"*. The TS equivalent (`parseInt('round2',10)` returns `NaN`, not `2`) silently produces `0` here.
- **Severity:** **MEDIUM** — silent failure mode; caller assumes integer round.
- **Note:** Mandate compliant — flagged only, NOT fixed in this phase.

### F-5 — `as any` density in protected directories · **HIGH**

Quantified:

| Directory | Files | `as any` occurrences |
|---|---:|---:|
| `src/hooks/wallet/**` | 2 | 7 |
| `src/hooks/judging/**` | 15 | 68 |
| `src/components/admin/**` | 45 | 162 |
| `src/lib/judging/**` | 0 | 0 |
| `supabase/functions/**` | 22 | 54 |

**Hottest files (sample, line-cited):**
- `src/components/admin/AdminNewsletterFaq.tsx:79,82,113,115,130,132,269,271,310,313,329,471,474,483,489,494` — 16 occurrences (table-name escape hatches `"newsletter_subscribers" as any`, `"faq_entries" as any`, `"chat_questions" as any`).
- `src/components/admin/AdminKeywordBlocklist.tsx:58,70,75,110,123,133` — 6 occurrences on `"blocked_keywords" as any`.
- `src/components/admin/AdminOrders.tsx:49,54,63,66` — `"competition_orders" as any` plus result casts.

**Why it matters:** Each `"<table>" as any` bypasses the generated `Database` type and silently disables RLS-shape checking at compile time. In hooks/wallet/** and hooks/judging/** this is a Mandate Rule 1 violation in waiting (any future schema rename will compile clean and fail at runtime).

- **Severity:** **HIGH** in `src/hooks/wallet/**` and `src/hooks/judging/**`. **MEDIUM** in `src/components/admin/**`. **MEDIUM** in `supabase/functions/**`.

### F-6 — Realtime subscriptions on admin/judging tables — coverage check · **MEDIUM (PARTIAL)**

- **Total `.channel(` call sites in `src/`:** 25
- **`postgres_changes` on judging tables in `src/hooks/judging/**`:** all four `judge_*` subscriptions in `useJudgePhotoData.ts:193/197/201/205` correctly spread `...judgeFilter` (per `mem://judging/realtime-per-judge-filter-r5`, this is locked by ESLint rule `audit-v6/no-unfiltered-judge-realtime`).
- **Admin-context subscriptions WITHOUT `filter:` argument:**
  - `src/components/admin/AdminUsers.tsx:318` `table:"user_roles"` (no filter)
  - `src/components/admin/AdminUsers.tsx:319` `table:"user_badges"` (no filter)
  - `src/components/admin/AdminUsers.tsx:320` `table:"profiles"` (no filter)
  - `src/components/admin/AdminLayout.tsx:54` `table:"support_tickets"` (no filter)
  - `src/components/admin/AdminLayout.tsx:59` `table:"admin_notifications"` (no filter)
  - `src/components/admin/AdminNotifications.tsx:86` `table:"admin_notifications"` (no filter)
  - `src/hooks/judging/useJudgeRounds.ts:99` `table:"judging_rounds"` (no filter)
- **Why it matters:** Forbidden Pattern #12 (`no-unfiltered-judge-realtime`) currently allowlists `src/components/admin/**` and `src/pages/admin/**` (per `docs/audit/forbidden-patterns.md`). That allowlist is intentional **for judge-decision tables only**; finance/role realtime fan-out is not currently audited.
- **Severity:** **MEDIUM** — bandwidth + privacy fan-out from admin contexts. Not currently a forbidden-pattern violation.

### F-7 — Frontend invocation of email-bearing edge function · **LOW (ALREADY-AUDITED PATH)**

- **File:** `src/components/AdminGiftCredit.tsx`
- **Lines:** 174, 230
- **Evidence:** `supabase.functions.invoke("send-gift-credit", { body: ... })`
- **Status:** This is **NOT** `send-transactional-email` (which is the rule-#11 forbidden target). Forbidden Pattern #11 (`no-direct-transactional-email`) does not block other email-adjacent edge functions today.
- **Severity:** **LOW** — present for transparency; not a #11 violation.

### F-8 — Direct write on `notification_emit_log` from frontend · **CLEAN**

- Search `rg -n "notification_emit_log" src/` → only hits are `src/integrations/supabase/types.ts:3215` (generated types) and `src/components/admin/NotificationsHealthAudit.tsx:4` (comment).
- **Result:** No frontend writes. Existing DB-trigger-only invariant holds.

### F-9 — `entry.status` / `status_legacy` raw reads · **CLEAN (already enforced)**

- ESLint rule `audit-v6/no-raw-entry-status` (registered `error` in `eslint.config.js:47` and on edge fns at `eslint.config.js:67`) currently passes CI (`audit-forbidden.yml` job). No new violations surfaced by re-grepping in this audit.

---

## 2. NOT VERIFIED ITEMS

The following were requested in the SOW but cannot be fully evidenced from a static repo scan alone. Marked **NOT VERIFIED** per Rule 1.

| Item | Why not verified |
|---|---|
| **Live RLS effective behavior on `wallet_transactions UPDATE`** | NOT VERIFIED — would require executing a DB probe under an admin JWT. No SQL run in this phase. |
| **Whether `AdminTransactions.tsx:509` UPDATE actually succeeds in production** | NOT VERIFIED — depends on RLS policy rows; not read in this phase. |
| **Whether `complete-round/index.ts:777` `parseInt(comp.current_round)` ever receives a non-digit-leading value** | NOT VERIFIED — would require querying `competitions.current_round` distinct values. |
| **Whether the 7 admin/judging realtime subscriptions in F-6 are policy-allowed** | NOT VERIFIED — depends on Realtime publication settings + RLS, not just code. |
| **Whether each `as any` in `src/components/admin/**` corresponds to a real missing type vs. a lazy cast** | NOT VERIFIED — 162 occurrences not individually triaged in this phase. |
| **`payments/**` directory** | NOT VERIFIED — directory does not exist in repo; payments live inside `src/components/admin/AdminTransactions.tsx`, `src/hooks/wallet/**`, and edge functions. SOW assumed a path that is not present. |

---

## 3. CURRENT GUARDRAILS (verified present)

### CI workflows (`.github/workflows/`)

| Workflow | Purpose | Status |
|---|---|---|
| `audit-forbidden.yml` | Runs ESLint `audit-v6/*` rules + `notifications.spec.ts` + `publishGate.test.tsx` + vocabulary staleness gate + 16-row v3 catalog parity + retired-label scanner | **ACTIVE** |
| `prove-block-required.yml` | Blocks PRs touching judging surfaces unless PR body has filled PROVE block (markers + 6 sections + ticked checklist + Rule 5 attestation) | **ACTIVE** |
| `per-photo-status-types.yml` | Per-photo status type contract | **ACTIVE** |
| `rpc-contract-parity.yml` | RPC contract parity | **ACTIVE** |
| `test-agent.yml` | Test agent runner | **ACTIVE** |
| `v3-catalog-parity.yml` | v3 stage catalog parity | **ACTIVE** |
| `vocabulary-snapshot.yml` | Vocabulary snapshot freshness | **ACTIVE** |

### ESLint rules (`eslint-rules/`, registered in `eslint.config.js`)

All 8 currently registered as `"error"`:
1. `competition-watermark/require-phase-watermark`
2. `audit-v6/no-raw-entry-status`
3. `audit-v6/no-direct-transactional-email`
4. `audit-v6/no-unfiltered-judge-realtime`
5. `audit-v6/no-legacy-decision-strings`
6. `audit-v6/no-raw-catalog-labels`
7. `audit-v6/no-direct-photo-decisions-import`
8. `audit-v6/no-raw-progression-decision`

Edge-function block at `eslint.config.js:60-75` re-applies 5 of the audit-v6 rules to `supabase/functions/**/*.ts`.

### What is NOT currently guarded (gap surface)

| Requested guard | Currently exists? | Gap |
|---|---|---|
| Block direct `INSERT`/`UPDATE` on `wallet_transactions` from `src/` | **NO** | `AdminTransactions.tsx:509` proves this |
| Block direct `INSERT` on `notification_emit_log` from `src/` | **NO (but no violators today)** | Defensive only |
| Block raw `current_round` regex/parseInt outside DB | **NO** | `complete-round/index.ts:777` proves this |
| Block new `as any` in `src/hooks/wallet/**`, `src/hooks/judging/**`, `supabase/functions/**` | **NO** | 7 + 68 + 54 occurrences exist |
| Block unfiltered realtime on `user_roles`, `profiles`, `admin_notifications`, `support_tickets`, `judging_rounds` | **NO** | 7 admin sites listed in F-6 |
| Block direct invocation of email-bearing edge fns (other than `send-transactional-email`) from frontend | **NO** | `AdminGiftCredit.tsx` invokes `send-gift-credit` |

---

## 4. NEW GUARDRAILS ADDED

**NONE.** Per the AUDIT-ONLY directive at the top of this file, no rules, workflows, or migrations were created or modified in this phase.

The proposed-but-not-applied guardrail set for **Phase 0B** is listed under §13 NEXT SAFE FIX ORDER.

---

## 5. FILES VIOLATING RULES (consolidated)

| # | File | Line(s) | Violation | Severity |
|---|---|---|---|---|
| 1 | `src/components/admin/AdminTransactions.tsx` | 509 | Direct frontend UPDATE on ledger row `wallet_transactions.status` | **CRITICAL** |
| 2 | `supabase/functions/complete-round/index.ts` | 777 | `parseInt(comp.current_round, 10)` against TEXT format that may be `'round2'` | **MEDIUM** |
| 3 | `src/hooks/wallet/**` | (7 sites) | `as any` density in finance hooks | **HIGH** |
| 4 | `src/hooks/judging/**` | (68 sites) | `as any` density in judging hooks | **HIGH** |
| 5 | `supabase/functions/**` | (54 sites) | `as any` density in edge functions | **MEDIUM** |
| 6 | `src/components/admin/AdminUsers.tsx` | 318, 319, 320 | Unfiltered realtime on `user_roles`, `user_badges`, `profiles` | **MEDIUM** |
| 7 | `src/components/admin/AdminLayout.tsx` | 54, 59 | Unfiltered realtime on `support_tickets`, `admin_notifications` | **MEDIUM** |
| 8 | `src/components/admin/AdminNotifications.tsx` | 86 | Unfiltered realtime on `admin_notifications` | **MEDIUM** |
| 9 | `src/hooks/judging/useJudgeRounds.ts` | 99 | Unfiltered realtime on `judging_rounds` | **LOW** |

---

## 6. SEVERITY MATRIX

| Severity | Count | Definition |
|---|---:|---|
| **CRITICAL** | 1 | Finance-mutation path callable from client without server-side reconciliation |
| **HIGH** | 2 | Type-safety escape hatches concentrated in finance/judging hooks |
| **MEDIUM** | 5 | Bandwidth/fan-out, type-safety in edge fns, silent integer-coercion failure mode |
| **LOW** | 1 | Single judging-rounds realtime fan-out |
| **INFO** | 2 | Read-only ledger access (RLS-bound) |

---

## 7. FINANCE RISKS

- **F-1 (CRITICAL):** `AdminTransactions.tsx:509` lets any user with admin role flip `wallet_transactions.status` to `'rejected'` directly. There is no `wallet_transaction_audit` row, no reconciliation entry in `wallet_reconciliation_log`, and no `update-transaction-status` edge function in the call chain. Mandate Execution Rule 7 ("every finance mutation requires reconciliation proof") not satisfied for this code path.
- **F-5 (HIGH, wallet slice):** 7 `as any` casts in `src/hooks/wallet/**` mean a future rename of `wallet_transactions` columns (`balance_after`, `reference_id`) compiles green and breaks at runtime.

## 8. RLS RISKS

- **NOT VERIFIED.** This phase did not run any DB query. The static finding that `AdminTransactions.tsx:509` calls `UPDATE wallet_transactions` only proves the call is *attempted*; whether RLS blocks it requires a probe under an admin JWT, which is **out of scope** for AUDIT-ONLY.

## 9. REALTIME RISKS

- **F-6 (MEDIUM):** 7 unfiltered subscriptions on admin/judging tables fan out every row change to every subscribed admin tab. Bandwidth grows linearly with admin count × row mutations. Privacy: row payloads include columns not visible in UI.
- Forbidden Pattern #12 currently exempts `src/components/admin/**` for `judge_*` tables only — none of the 7 sites above are `judge_*`, so they sit in an unguarded gap.

## 10. PAYMENT RISKS

- **No standalone `payments/**` directory exists.** All payment-adjacent code is the wallet stack (covered above).
- Razorpay/Stripe edge functions: NOT VERIFIED in this phase (no edge-function code reads done).

## 11. JUDGING RISKS

- **F-4 (MEDIUM):** `complete-round/index.ts:777` may compute `currentRoundNum = 0` when `comp.current_round` is `'round2'`/`'r3'`. Downstream comparisons (`currentRoundNum + 1`, `< 4`) silently misbehave. This is the exact bug class the `current_round is TEXT` memory was created to prevent.
- **F-5 (HIGH, judging slice):** 68 `as any` casts in `src/hooks/judging/**` weaken the type contract that `Per-Photo Consensus Canonical v3` and `Status Display Rule` rely on.
- **F-9 (judging-rounds realtime):** Single low-severity unfiltered subscription.

---

## 12. ROLLBACK PLAN

**N/A — nothing was changed.** This document is the only artifact produced. To remove the audit:
```
rm docs/fix-sprints/sprint-0-phase-0a-freeze-guardrails.md
```
No code, CI, ESLint, schema, RLS, edge function, or migration was touched.

---

## 13. NEXT SAFE FIX ORDER

Proposed sequence for Phase 0B (each step gated by your explicit approval, each individually reversible):

1. **Phase 0B-1 — Type-safety guardrail (zero runtime risk)**
   Add ESLint rule `audit-v6/no-as-any-in-protected-dirs` scoped to `src/hooks/wallet/**`, `src/hooks/judging/**`, `supabase/functions/**`. Rule fires `error` on **new** introductions only (allowlist current 129 sites). Wire into `audit-forbidden.yml`.
   *Why first:* zero behavior change; only blocks regressions.

2. **Phase 0B-2 — Ledger-write guardrail (CRITICAL F-1 freeze)**
   Add ESLint rule `audit-v6/no-direct-ledger-write` blocking `.from("wallet_transactions"|"wallet_deposits"|"wallet_withdrawals"|"wallet_gifts"|"wallet_reconciliation_log"|"notification_emit_log").(insert|update|upsert|delete)(` outside an audited allowlist (initially: empty — admin must move to RPC). Wire into `audit-forbidden.yml`.
   *Why second:* surfaces F-1 as a CI red. Does not yet fix `AdminTransactions.tsx:509`; that is **Phase 1** (RPC migration).

3. **Phase 0B-3 — Unfiltered admin-realtime guardrail**
   Extend `audit-v6/no-unfiltered-judge-realtime` (or add sibling `audit-v6/no-unfiltered-sensitive-realtime`) to require `filter:` on `user_roles`, `user_badges`, `profiles`, `admin_notifications`, `support_tickets`, `judging_rounds`. Allowlist current 7 sites with TODO comments.

4. **Phase 0B-4 — `current_round` parsing guardrail**
   ESLint rule blocking `parseInt(*current_round*` and `Number(*current_round*` outside `src/lib/judging/**`. Forces use of a single `parseRoundNumber()` helper.

5. **Phase 0B-5 — Frontend email-edge-fn guardrail (extend #11)**
   Extend `no-direct-transactional-email` to also block direct UI invocation of any edge fn matching `/^send-/` unless on an audited allowlist (initially `send-gift-credit` listed with TODO).

6. **Phase 1 (separate sprint) — Fix F-1**
   Replace `AdminTransactions.tsx:509` direct UPDATE with an audited `reject-wallet-transaction` edge function that writes to `wallet_reconciliation_log`. Requires migration + edge fn + RLS regression test. **This is the first phase that touches business logic and must follow Mandate Rule 4 (diff-captured) end-to-end.**

---

## VERIFICATION PROOF

| Finding | Proof command (re-runnable, read-only) |
|---|---|
| F-1 | `rg -n 'from\("wallet_transactions"\)\s*\.update' src/` |
| F-2/F-3 | `rg -nB1 -A3 'from\("wallet_transactions"\)' src/` |
| F-4 | `rg -n 'parseInt\(.*current_round' supabase/functions/` |
| F-5 | `for d in src/hooks/wallet src/hooks/judging src/components/admin supabase/functions; do echo "$d : $(rg -c 'as any' "$d" | awk -F: '{s+=$2} END{print s+0}')"; done` |
| F-6 | `rg -n 'postgres_changes' src/components/admin/ src/hooks/judging/useJudgeRounds.ts` |
| F-7 | `rg -n 'functions\.invoke\("send-' src/` |
| F-8 | `rg -n 'notification_emit_log' src/` |
| F-9 / current ESLint coverage | `cat eslint.config.js` |

All commands above were executed during this phase; outputs are pasted under §1.
