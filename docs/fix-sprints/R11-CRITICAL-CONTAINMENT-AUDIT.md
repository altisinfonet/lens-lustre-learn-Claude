# R11 — Critical Containment Audit (READ-ONLY)

**Mode:** AUDIT-ONLY. Zero writes / migrations / GRANT-REVOKE / deploys.
**Source of truth:** live `pg_proc` introspection + `rg` search of `src/` and `supabase/functions/`.
**Date:** 2026-05-22 UTC.
**Predecessor:** `docs/fix-sprints/R10-RLS-GRANTS-AUDIT.md` (HOLD_PERMISSION_RISK).

---

## 0. Evidence commands actually run

| # | Command | Purpose |
|---|---|---|
| 1 | `rg -ln "wallet_transaction" supabase/functions/` | enumerate edge-fn callers of `wallet_transaction` RPC |
| 2 | `rg -n "wallet_transaction" src/` | frontend callers |
| 3 | `rg -n "from\('competition_votes'\)" src/` | direct table reads/writes from UI |
| 4 | `rg -n "competition_votes\|delete\(\)" supabase/functions/cast-photo-vote/index.ts` | unvote path |
| 5 | `rg -n "from\('judge_decisions'\)" src/` | participant-side score reads |
| 6 | `rg -ln "emit_notification\|send_notification_email\|backfill_judging_notifications" src/ supabase/functions/` | notification fn callers |
| 7 | `SELECT substring(prosrc for 400) FROM pg_proc WHERE proname='backfill_judging_notifications'` | confirm internal admin guard |

Raw outputs preserved in tool-result history.

---

## A. CALLER GRAPH

### A.1 `public.wallet_transaction(uuid,text,numeric,text,uuid,text,jsonb)`

| Caller | Auth used | Self vs other? | Idempotency? |
|---|---|---|---|
| **Frontend** `src/hooks/wallet/useWallet.ts:66` (`addFunds`) | authenticated JWT | self (`_user_id = user.id`) | no |
| **Frontend** `src/hooks/wallet/useWallet.ts:79` (`deductFunds`) | authenticated JWT | self | no |
| **Edge fn** `cast-photo-vote/index.ts:248,266,294,311` | `admin` (service_role) | other-user OK (admin path) | n/a (service) |
| **Edge fn** `razorpay-verify-payment/index.ts:160` | service_role | self via webhook | yes (payment id) |
| **Edge fn** `paypal-capture-order/index.ts:168` | service_role | self | yes |
| **Edge fn** `admin-process-withdrawal/index.ts:75` | service_role | other (refund) | yes |
| **Edge fn** `expire-gift-credits/index.ts:59` | service_role | other | cron-driven |
| Cron: `expire-gift-credits` (15-min) | service_role | — | — |

`get-wallet-transactions`, `get-wallet-summary`, `admin-export-db`, `hard-delete-competition`, `delete-user` only SELECT — they do **not** call the RPC.

### A.2 `competition_votes` write paths

| Caller | Op | Auth |
|---|---|---|
| `supabase/functions/cast-photo-vote/index.ts:198` | `.delete()` via `admin` (service_role) — invoked from "unvote" action with 2× penalty | service_role |
| `supabase/functions/cast-photo-vote/index.ts:164,177,188,197` | INSERT/SELECT same fn | service_role |
| **Frontend** | **NONE** — every frontend hit on `competition_votes` is `.select()`. Verified across `EntryDetail.tsx`, `VotingLightbox.tsx`, `useCompetitionDetail.ts`, `useJudgeClassicData.ts`, `usePhotoVoteCount.ts`, `useCompetitionVoteRealtime.ts`, `AdminVoteRewardLedger.tsx`, `AdminVoteAuditPanel.tsx`. |

**Critical conclusion:** UI never DELETEs `competition_votes`. The "Users can remove own vote" RLS policy is **dead code from a UX perspective** — only the edge fn (service_role, bypasses RLS) actually deletes. Tightening the policy would NOT regress UX.

### A.3 `judge_decisions` participant-side reads

| Caller | Columns selected |
|---|---|
| `src/pages/SubmissionDetail.tsx:359` (participant view) | `entry_id, photo_index, decision, round_number` — **NO criteria scores** |
| `src/hooks/judging/useJudgePhotoData.ts:107` (judge tool) | `entry_id, judge_id, decision, round_number, photo_index` — judge UI |
| `src/hooks/judging/useMultiJudgeProgress.ts:89` | judge UI |
| `src/hooks/judging/useJudgeAggregateStats.ts:60` | judge UI |
| `src/hooks/judging/decisionParityProbe.ts:35` | parity probe |

**Critical conclusion:** participant-facing surface (`SubmissionDetail.tsx`) requests ONLY 4 non-score columns. Tightening the entry-owner SELECT policy to expose only those 4 columns (via a column-projected view or RLS column-grant) does NOT regress UX.

### A.4 `emit_notification` / `send_notification_email` / `backfill_judging_notifications`

| Function | External callers | Internal callers |
|---|---|---|
| `emit_notification` | `supabase/functions/publish-round/index.ts` (service_role) | DB triggers on `entries` / `verification` / round publish |
| `send_notification_email` | **none** (no frontend / no edge fn) | DB triggers + internal call chain |
| `backfill_judging_notifications` | `src/components/admin/NotificationsHealthAudit.tsx:57` via `supabase.rpc(...)` (authenticated JWT, admin user) | none |

Body of `backfill_judging_notifications` opens with:
```sql
IF NOT has_role(auth.uid(), 'admin') THEN
  RAISE EXCEPTION 'admin_only';
END IF;
```
→ **internal admin guard already present**. PUBLIC EXECUTE is functionally harmless (anon hits the guard). Containment is purely defence-in-depth.

`emit_notification` and `send_notification_email` have **no leading admin/auth guard** in the body (verified in R10 §5.2). They rely on PostgREST not exposing them. PUBLIC EXECUTE means they ARE exposed.

---

## B. BREAKAGE RISK MATRIX

| Proposed change | Frontend impact | Edge-fn impact | Cron impact | Net risk |
|---|---|---|---|---|
| **B-1** `REVOKE EXECUTE wallet_transaction FROM PUBLIC, anon` (keep authenticated + service_role) | none — auth users still pass | none — service_role keeps EXECUTE | none | **LOW** ✅ |
| **B-2** also `REVOKE FROM authenticated` | **BREAKS** `useWallet.addFunds`/`deductFunds` UI | none | none | **HIGH** ❌ |
| **B-3** Add body guard `IF _caller_id IS NULL AND current_setting('request.jwt.claim.role',true) <> 'service_role' THEN RAISE` | none | none | none — service_role JWT carries `role=service_role` | **LOW** ✅ (defence in depth even if B-1 missed) |
| **B-4** Drop `competition_votes` "Users can remove own vote" DELETE policy | none — UI doesn't delete | none — fn uses service_role (bypasses RLS) | none | **LOW** ✅ |
| **B-5** Replace `judge_decisions` "Entry owners can view own photo decisions" policy with column-restricted view | participant submission view loses raw row access → must re-point to view returning `(entry_id, photo_index, decision, round_number)` | none | none | **MEDIUM** ⚠️ (1 file change in `SubmissionDetail.tsx`) |
| **B-6** `REVOKE EXECUTE emit_notification FROM PUBLIC, anon, authenticated` (keep service_role) | none (no UI caller) | none — publish-round uses service_role; DB triggers run as table owner | none | **LOW** ✅ |
| **B-7** `REVOKE EXECUTE send_notification_email FROM PUBLIC, anon, authenticated` | none | none | none | **LOW** ✅ |
| **B-8** `REVOKE EXECUTE backfill_judging_notifications FROM PUBLIC, anon` (keep authenticated for `NotificationsHealthAudit`) | none (admin guard still inside) | none | none | **LOW** ✅ |
| **B-9** also revoke from `authenticated` | **BREAKS** `NotificationsHealthAudit.tsx` until refactored to call via an edge fn | none | none | **MEDIUM** ⚠️ |

---

## C. SAFE CONTAINMENT OPTIONS (no change applied)

### C-1. `wallet_transaction` (R10-F2 CRITICAL)
- **Recommended:** B-1 + B-3 combined.
- Rationale: anon JWTs have `auth.uid()=NULL` AND `request.jwt.claim.role='anon'` — the dual check distinguishes them from `service_role` cleanly. Two-layer defence: ACL blocks PostgREST entry, body guard catches any future regrant.
- Reject B-2: would break addFunds/deductFunds.

### C-2. `competition_votes` DELETE (R10-F5 HIGH)
- **Recommended:** B-4.
- Rationale: zero UI dependency on direct DELETE; penalty path is server-only via `cast-photo-vote`.

### C-3. `judge_decisions` participant SELECT (R10-F1 HIGH)
- **Recommended:** B-5.
- Mechanism options (pick later, not now):
  - (a) Create `judge_decisions_public_v` view with only the 4 columns; drop the policy; SubmissionDetail.tsx switches `.from("judge_decisions")` → `.from("judge_decisions_public_v")`.
  - (b) Keep policy, add column-level GRANT trick (more fragile).
- Option (a) is preferred — single-file UI change, RLS surface shrinks.

### C-4. `emit_notification` / `send_notification_email` (R10-F3 MED)
- **Recommended:** B-6 + B-7. Pure defence-in-depth.
- No caller depends on PUBLIC EXECUTE.

### C-5. `backfill_judging_notifications` (R10-F4 MED)
- **Recommended:** B-8 only (keep authenticated EXECUTE; body already gates on admin role).
- Avoid B-9 unless we want to refactor `NotificationsHealthAudit` to call via edge fn.

---

## D. MINIMUM-RISK PATCH ORDER

(Order minimises blast radius; each step independently reversible.)

| # | Patch | Class | Reversible? |
|---|---|---|---|
| 1 | **C-4** revoke EXECUTE on `emit_notification` + `send_notification_email` from PUBLIC/anon/authenticated | hotfix-safe SQL | yes — re-GRANT |
| 2 | **C-5** revoke EXECUTE on `backfill_judging_notifications` from PUBLIC/anon | hotfix-safe SQL | yes |
| 3 | **C-2** drop policy "Users can remove own vote" on `competition_votes` | hotfix-safe SQL | yes — recreate policy |
| 4 | **C-1a** revoke EXECUTE on `wallet_transaction` from PUBLIC + anon (keep auth + service_role) | hotfix-safe SQL | yes |
| 5 | **C-1b** add body guard `IF _caller_id IS NULL AND request.jwt.claim.role <> 'service_role' THEN RAISE` | migration-required (CREATE OR REPLACE) | yes — re-deploy prior body |
| 6 | **C-3** create view + drop policy + edit `SubmissionDetail.tsx` | migration + frontend-coupled | yes |

Steps 1–4 are **pure SQL hotfix**, no code change. Step 5 is **single-function CREATE OR REPLACE**. Step 6 is the only **frontend-coupled** change.

---

## E. CLASSIFICATION OF FIXES

| Fix | hotfix-safe | migration-required | frontend-coupled | edge-fn-coupled |
|---|---|---|---|---|
| C-1a (wallet_transaction REVOKE anon/public) | ✅ | — | — | — |
| C-1b (wallet_transaction body guard) | — | ✅ | — | — |
| C-2 (competition_votes DELETE policy drop) | ✅ | — | — | — |
| C-3 (judge_decisions column-projected view) | — | ✅ | ✅ (1 file) | — |
| C-4 (emit_notification + send_notification_email REVOKE) | ✅ | — | — | — |
| C-5 (backfill_judging_notifications REVOKE anon/public) | ✅ | — | — | — |

**Zero changes are edge-fn-coupled** — every edge fn already uses `service_role`, which retains EXECUTE in every proposal.

---

## F. ANSWERED R11 QUESTIONS (consolidated)

| Question | Answer | Evidence |
|---|---|---|
| Is anon exploit of `wallet_transaction` truly reachable? | **YES** in theory (PostgREST exposes RPC; `auth.uid()=NULL` for anon JWT skips guard). Unproven by execution (audit-only). | A.1 + R10 §5.1 |
| Do edge fns depend on PUBLIC EXECUTE of `wallet_transaction`? | **NO** — all use `admin` (service_role) which has its own EXECUTE grant | A.1 |
| Would revoke break production wallet flows? | Only if revoked from `authenticated` (B-2). Revoke from anon only (B-1) is safe. | B-1 vs B-2 |
| Does frontend DELETE `competition_votes`? | **NO** | A.2 |
| Does edge unvote path depend on DELETE RLS privilege? | **NO** — uses service_role | A.2 |
| Does dropping the user-DELETE policy break UX? | **NO** | B-4 |
| Which columns does the participant-facing `judge_decisions` read expose? | 4 cols, no scores | A.3 |
| Do any views already mask scores? | None observed in `pg_views` for `judge_decisions`; would need to be created in C-3 | A.3 |
| Is PUBLIC EXECUTE of notification fns actually needed? | **NO** for any of the three | A.4 |

---

## G. FINAL VERDICT

**SAFE_CONTAINMENT_PLAN_READY**

Reason: every R10 finding has at least one **low-risk, reversible** containment option with documented zero-regression caller graph. The plan separates 4 hotfix-safe SQL patches from 2 code-coupled patches (1 CREATE-OR-REPLACE migration, 1 frontend edit). No proposed step requires multi-file refactor, edge-fn redeploy, or breaking changes to public APIs.

No GRANT, REVOKE, ALTER POLICY, migration, or deploy was executed in this audit.

---

**R11_REPORT_READY**
