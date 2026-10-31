# R11 — Hotfix Package DRAFT (NO APPLY)

**Mode:** PLAN / DRAFT ONLY. No SQL executed. No migration filed. No deploy.
**Predecessors:** `R10-RLS-GRANTS-AUDIT.md` (HOLD_PERMISSION_RISK) + `R11-CRITICAL-CONTAINMENT-AUDIT.md` (SAFE_CONTAINMENT_PLAN_READY).
**Date:** 2026-05-22 UTC.
**Scope:** Five "apply-ready" hotfixes (A–E) + one design-only draft (F).

All SQL below is a **draft to be filed via `supabase--migration` in a future, separately approved step**. None has been submitted to the migration tool. None will run until the user explicitly says GO.

---

## HOTFIX-A — `wallet_transaction` (CRITICAL, R10-F2)

### Objects affected
- `public.wallet_transaction(_user_id uuid, _type text, _amount numeric, _description text, _reference_id uuid, _reference_type text, _metadata jsonb)` — DEFINER, owner=`postgres`.

### Grants — before (live, verified §R10 §4)
```
EXECUTE: PUBLIC, anon, authenticated, service_role, postgres
```

### Grants — after
```
EXECUTE: authenticated, service_role, postgres
```

### Forward SQL (draft)
```sql
REVOKE EXECUTE ON FUNCTION public.wallet_transaction(
  uuid, text, numeric, text, uuid, text, jsonb
) FROM PUBLIC, anon;
```

### Rollback SQL
```sql
GRANT EXECUTE ON FUNCTION public.wallet_transaction(
  uuid, text, numeric, text, uuid, text, jsonb
) TO PUBLIC, anon;
```

### Caller impact proof (R11 §A.1)
| Caller | Auth context | Still works? |
|---|---|---|
| `src/hooks/wallet/useWallet.ts:66,79` (addFunds/deductFunds) | authenticated JWT | ✅ |
| `cast-photo-vote`, `razorpay-verify-payment`, `paypal-capture-order`, `admin-process-withdrawal`, `expire-gift-credits` | service_role | ✅ |
| Anon PostgREST `POST /rest/v1/rpc/wallet_transaction` | anon JWT | ❌ blocked (intended) |

### Risk profile
| Property | Value |
|---|---|
| Breakage risk | LOW — no authenticated/service caller loses access |
| Transactional | Yes — single DDL, autocommit-safe |
| Lock risk | Brief AccessExclusiveLock on the function object only; no table lock |
| Frontend redeploy required | NO |
| Reversible | YES — rollback SQL above restores prior ACL byte-for-byte |
| Why safe | Anon JWT has `auth.uid()=NULL`, which short-circuits the in-body self-vs-other guard; PostgREST is the only entry path; revoke kills that path without touching authenticated/service callers |

---

## HOTFIX-B — `competition_votes` user-DELETE policy (HIGH, R10-F5)

### Objects affected
- Policy `"Users can remove own vote"` on `public.competition_votes` (cmd=DELETE, role=public, USING `user_id = auth.uid()`).

### Policy set — before (verified §R10 §2.4)
```
SELECT  "View vote counts (phase-gated)"
INSERT  "no_self_vote"
DELETE  "Users can remove own vote"   ← target
```

### Policy set — after
```
SELECT  "View vote counts (phase-gated)"
INSERT  "no_self_vote"
DELETE  (none — all DELETE traffic blocked by RLS unless caller is service_role/owner)
```

### Forward SQL (draft)
```sql
DROP POLICY "Users can remove own vote" ON public.competition_votes;
```

### Rollback SQL
```sql
CREATE POLICY "Users can remove own vote"
  ON public.competition_votes
  FOR DELETE
  TO public
  USING (user_id = auth.uid());
```

### Caller impact proof (R11 §A.2)
- Frontend has **zero** `.from("competition_votes").delete()` calls (grep across entire `src/`).
- `cast-photo-vote/index.ts:198` performs the unvote via `admin` service-role client → bypasses RLS by role; unaffected.

### Risk profile
| Property | Value |
|---|---|
| Breakage risk | LOW |
| Transactional | Yes |
| Lock risk | ShareUpdateExclusiveLock on `competition_votes` for policy DDL; brief |
| Frontend redeploy required | NO |
| Reversible | YES |
| Why safe | UI never deletes vote rows; penalty-bearing unvote remains via service_role edge fn (preserves "Unvote Penalty UX" memory rule) |

---

## HOTFIX-C — `emit_notification` (MED, R10-F3)

### Objects affected
- `public.emit_notification(_kind text, _entity_id uuid, _round_number int, _recipient_user_id uuid, _in_app_type text, _in_app_title text, _in_app_message text, _in_app_reference_id uuid, _email_template text, _email_data jsonb, _action_url text)` — DEFINER.

### Grants — before
```
EXECUTE: PUBLIC, anon, authenticated, service_role, postgres
```

### Grants — after
```
EXECUTE: service_role, postgres
```

### Forward SQL (draft)
```sql
REVOKE EXECUTE ON FUNCTION public.emit_notification(
  text, uuid, integer, uuid, text, text, text, uuid, text, jsonb, text
) FROM PUBLIC, anon, authenticated;
```

### Rollback SQL
```sql
GRANT EXECUTE ON FUNCTION public.emit_notification(
  text, uuid, integer, uuid, text, text, text, uuid, text, jsonb, text
) TO PUBLIC, anon, authenticated;
```

### Caller impact proof (R11 §A.4)
- Edge fn `publish-round/index.ts` calls it via service_role → ✅.
- DB triggers on `entries` / `verification` / round-publish run as table owner (`postgres`), which bypasses ACL → ✅.
- No frontend caller (`rg "emit_notification" src/` returns only test/types files).

### Risk profile
| Property | Value |
|---|---|
| Breakage risk | LOW |
| Transactional | Yes |
| Lock risk | Function-object lock only |
| Frontend redeploy required | NO |
| Reversible | YES |
| Why safe | Pure defence-in-depth; only DEFINER trigger context + service_role need EXECUTE |

---

## HOTFIX-D — `send_notification_email` (MED, R10-F3)

### Objects affected
- `public.send_notification_email()` — DEFINER, no-arg.

### Grants — before
```
EXECUTE: PUBLIC, anon, authenticated, service_role, postgres
```

### Grants — after
```
EXECUTE: service_role, postgres
```

### Forward SQL (draft)
```sql
REVOKE EXECUTE ON FUNCTION public.send_notification_email() FROM PUBLIC, anon, authenticated;
```

### Rollback SQL
```sql
GRANT EXECUTE ON FUNCTION public.send_notification_email() TO PUBLIC, anon, authenticated;
```

### Caller impact proof
- Zero callers in `src/` or `supabase/functions/` (verified via `rg`).
- Used only by internal trigger chain owned by `postgres`.

### Risk profile
| Property | Value |
|---|---|
| Breakage risk | LOW |
| Transactional | Yes |
| Lock risk | Function-object lock only |
| Frontend redeploy required | NO |
| Reversible | YES |
| Why safe | No external caller; trigger path runs as owner |

---

## HOTFIX-E — `backfill_judging_notifications` (MED, R10-F4)

### Objects affected
- `public.backfill_judging_notifications(_window_days integer, _dry_run boolean)` — DEFINER, internal admin guard already present (`IF NOT has_role(auth.uid(),'admin') THEN RAISE 'admin_only'`).

### Grants — before
```
EXECUTE: PUBLIC, anon, authenticated, service_role, postgres
```

### Grants — after
```
EXECUTE: authenticated, service_role, postgres
```

### Forward SQL (draft)
```sql
REVOKE EXECUTE ON FUNCTION public.backfill_judging_notifications(integer, boolean)
  FROM PUBLIC, anon;
```

### Rollback SQL
```sql
GRANT EXECUTE ON FUNCTION public.backfill_judging_notifications(integer, boolean)
  TO PUBLIC, anon;
```

### Caller impact proof
- `src/components/admin/NotificationsHealthAudit.tsx:57` calls it via `supabase.rpc(...)` using the admin user's authenticated JWT → preserved.
- Internal `has_role` guard already rejects non-admins, so authenticated EXECUTE is intentionally retained.

### Risk profile
| Property | Value |
|---|---|
| Breakage risk | LOW |
| Transactional | Yes |
| Lock risk | Function-object lock only |
| Frontend redeploy required | NO |
| Reversible | YES |
| Why safe | Defence-in-depth; admin UI keeps working because authenticated grant is preserved |

---

## HOTFIX-F — `judge_decisions` participant exposure (DRAFT-ONLY, NO APPLY)

**Status:** DESIGN DRAFT. **NOT** included in the apply sequence. Decision requested from user before any code/SQL is filed.

### Problem (verified §R10 §2.5)
Policy `"Entry owners can view own photo decisions"` grants `SELECT` on the **whole row** of `judge_decisions` to entry owners. This contradicts memory rule *"Marks Are Private — Internal Only"* because the 10-criteria score columns are part of the row even if today's UI never SELECTs them.

### Participant UI usage (verified §R11 §A.3)
- `src/pages/SubmissionDetail.tsx:359` — selects only `entry_id, photo_index, decision, round_number`. **Zero** participant-side hooks read criteria columns today.

### Option (a) — Projected SECURITY INVOKER view
Create:
```sql
-- DRAFT — NOT FOR APPLY
CREATE OR REPLACE VIEW public.judge_decisions_participant_v
  WITH (security_invoker = true) AS
SELECT entry_id, photo_index, decision, round_number
  FROM public.judge_decisions;
```
Then drop the entry-owner policy, replace it with a policy on the view, and update `SubmissionDetail.tsx` to `.from("judge_decisions_participant_v")`.

| Pros | Cons |
|---|---|
| Hard exclusion of score columns at SQL layer | New view + types regen required |
| Lowest leakage surface | 1 frontend file edit |
| Single source of truth | View is SECURITY INVOKER → still depends on RLS on base table; need a SELECT policy on the view itself |

### Option (b) — New, column-aware SELECT policy
Keep the row-level policy but rely on `GRANT SELECT (col1, col2, ...) ON judge_decisions TO authenticated`:
```sql
-- DRAFT — NOT FOR APPLY
DROP POLICY "Entry owners can view own photo decisions" ON public.judge_decisions;
-- (no replacement row policy for entry owners; restrict via column grant)
REVOKE SELECT ON public.judge_decisions FROM authenticated;
GRANT SELECT (entry_id, photo_index, decision, round_number, judge_id)
  ON public.judge_decisions TO authenticated;
-- Restore judge + admin row policies separately
```

| Pros | Cons |
|---|---|
| No frontend change | Column-level GRANTs interact awkwardly with `SELECT *` queries elsewhere; would also affect judge hooks that read scores (BREAKS R2/R3 mandatory 10-criteria UI for judges) |
| No new schema object | High blast radius — breaks judge tooling |

### Option (c) — API-layer masking (RPC wrapper)
Create a SECURITY DEFINER RPC `get_participant_decision_for_entry(entry_id uuid)` returning only the 4 safe columns. Drop the entry-owner policy.

| Pros | Cons |
|---|---|
| Surgical, single new function | Frontend must switch from table read to RPC; adds round-trip per entry |
| Future-proof for new participant-facing fields | Slightly more boilerplate |

### Blast-radius comparison
| Option | SQL changes | Frontend changes | Risk to judge tooling | Risk to admin tooling |
|---|---|---|---|---|
| (a) Projected view | 1 view + 1 policy swap | 1 file (`SubmissionDetail.tsx`) | none | none |
| (b) Column GRANT trick | 1 policy drop + grant rewrite | possibly many (any `SELECT *`) | **HIGH** | MEDIUM |
| (c) RPC wrapper | 1 new fn + 1 policy drop | 1 file | none | none |

### Recommendation (not applied)
**Option (a) — projected view.** Mirrors the existing pattern for participant-vs-judge separation, requires only one frontend file edit, and leaves judge tooling untouched. Option (c) is acceptable but adds an RPC round-trip with no real gain. Option (b) is rejected as too invasive.

**Action required from user:** choose (a) / (b) / (c) before HOTFIX-F is drafted as apply-ready SQL.

---

## SAFE_HOTFIX_SEQUENCE

Apply in strict order. Each step is independently committable + reversible. Stop and re-check after each.

| # | Hotfix | Apply mechanism | Expected duration | Stop-and-verify check |
|---|---|---|---|---|
| 1 | **HOTFIX-D** `send_notification_email` REVOKE | `supabase--migration` | <1 s | `pg_proc.proacl` no longer lists `anon/authenticated`; admin/judge notifications still arrive |
| 2 | **HOTFIX-C** `emit_notification` REVOKE | `supabase--migration` | <1 s | Same probe + spot-check `notification_emit_log` row appears for a fresh trigger event |
| 3 | **HOTFIX-E** `backfill_judging_notifications` REVOKE | `supabase--migration` | <1 s | Admin `NotificationsHealthAudit` still runs; anon RPC returns 403 (or `admin_only` if still allowed) |
| 4 | **HOTFIX-B** `competition_votes` DROP POLICY | `supabase--migration` | <1 s | `pg_policies` shows no DELETE policy; `cast-photo-vote` edge fn unvote still succeeds (smoke test as test user); raw user DELETE returns 0 rows affected |
| 5 | **HOTFIX-A** `wallet_transaction` REVOKE | `supabase--migration` | <1 s | `useWallet.addFunds` still works (smoke); anon PostgREST RPC returns 401/403 |
| 6 | **HOTFIX-F** | **NOT APPLIED** — awaits option (a)/(b)/(c) decision | — | — |

### Properties of the sequence
- **No bulk operations.** Five independent one-line DDL statements, each in its own migration.
- **No fan-out.** Each affects exactly one DB object.
- **No frontend redeploy.** Zero UI files change in steps 1–5.
- **No edge-fn redeploy.** Zero edge fns touched.
- **No data writes.** Pure ACL / policy changes.
- **Full rollback path** documented above for each step.

---

## EXECUTION CONTRACT

This document is a **draft**. No SQL has been submitted to `supabase--migration`. No GRANT/REVOKE/DROP POLICY has been issued. Nothing was deployed. Nothing in the frontend or edge functions was edited.

To proceed, the user must explicitly say e.g. `GO HOTFIX-D`, after which that single hotfix will be filed via `supabase--migration` for approval — still without auto-applying anything else in the sequence.

---

**R11_HOTFIX_PACKAGE_READY**
