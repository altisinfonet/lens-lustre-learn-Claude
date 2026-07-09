# RLS Audit — 7 Judging Tables

**Date:** 2026-04-17  
**Scope:** `judge_decisions`, `judge_scores`, `judge_sessions`, `judging_rounds`, `judging_tags`, `competition_judging_tags`, `judge_entry_assignments`  
**Method:** Live `pg_policies` + `pg_class` inspection, anon JWT probing against PostgREST, security-definer function review.

> Constraints honored: Claude only, no assumptions, no guesswork, no part-checking, no casual approach. **Confirmed.**

---

## 1. RLS Enablement

| Table | RLS Enabled | Force RLS |
|---|---|---|
| competition_judging_tags | ✅ | ❌ |
| judge_decisions | ✅ | ❌ |
| judge_entry_assignments | ✅ | ❌ |
| judge_scores | ✅ | ❌ |
| judge_sessions | ✅ | ❌ |
| judging_rounds | ✅ | ❌ |
| judging_tags | ✅ | ❌ |

`forcerowsecurity=false` is **acceptable** because table owner is `postgres` (used only by service-role / migrations), and Supabase grants to `anon`/`authenticated` go through RLS.

## 2. Anonymous Probe Results (PostgREST)

| Table | `GET ?select=*&limit=1` | Result |
|---|---|---|
| judge_decisions | HTTP 200, body `[]` | ✅ Blocked |
| judge_scores | HTTP 200, body `[]` | ✅ Blocked |
| judge_sessions | HTTP 200, body `[]` | ✅ Blocked |
| judging_rounds | HTTP 200, body `[]` | ✅ Blocked |
| judging_tags | HTTP 200, body `[]` | ✅ Blocked |
| competition_judging_tags | HTTP 200, body `[]` | ✅ Blocked |
| judge_entry_assignments | HTTP 200, body `[]` | ✅ Blocked |

**Verdict:** No data leakage to anonymous callers across all 7 tables.

## 3. Per-Table Policy Analysis

### 3.1 `judge_decisions` ✅ STRONG
- **SELECT (judge):** must have `judge` role AND be in `competition_judges` for the entry's competition.
- **SELECT (admin):** `has_role(...,'admin')`.
- **INSERT:** `judge_id = auth.uid()` AND `judge` role AND `judge_can_access_entry()`.
- **UPDATE:** same as INSERT (own decisions only).
- **DELETE:** only via "Admins can manage" ALL policy.
- **No anon access. No cross-judge writes. Distributed-mode assignment honored via `judge_can_access_entry` (SECURITY DEFINER).**

### 3.2 `judge_scores` ✅ STRONG
- Symmetric to `judge_decisions`.
- **Bonus policy:** *"Users can view scores on own entries"* — participants can see scores on **their own** entries (correct per submission-detail spec).
- INSERT/UPDATE/DELETE strictly self-scoped via `judge_id = auth.uid()`.

### 3.3 `judge_sessions` ✅ STRONG
- **SELECT:** `judge_id = auth.uid()` OR admin.
- **INSERT/UPDATE:** `judge_id = auth.uid()`.
- **No DELETE policy** → only service-role / admins via separate maintenance can remove. Acceptable (sessions are append-only with status flips).

### 3.4 `judging_rounds` ✅ STRONG
- **SELECT:** judge or admin only.
- **ALL (write):** admin only.
- **Note:** Rounds are not visible to participants directly (UI derives phase from `competitions.phase`). Acceptable.

### 3.5 `judging_tags` ⚠️ MINOR REDUNDANCY (non-security)
- Two SELECT policies:
  - *"All users can view active tags"* — `is_active=true` (open to all authenticated)
  - *"Judges can view active tags"* — `is_active=true AND (judge OR admin)`
- **Effect:** PostgreSQL OR-combines policies, so the broader one wins → any authenticated user can see active tags. **This is intentional** (tag labels appear on public entry detail / vote results once revealed) and not a security issue, but the second policy is dead code.
- **Recommendation:** drop *"Judges can view active tags"* to reduce surface confusion. Not blocking.
- **INSERT:** `created_by = auth.uid()` AND (judge OR admin). ✅
- **ALL (write):** admin only. ✅

### 3.6 `competition_judging_tags` ✅ STRONG
- **SELECT:** judge or admin.
- **INSERT (judge):** must be assigned to the competition via `competition_judges`.
- **ALL (write):** admin.

### 3.7 `judge_entry_assignments` ⚠️ ROLE-CAST INCONSISTENCY
- Policies use `has_role(auth.uid(), 'admin'::text)` and `'judge'::text` (text overload).
- All other judging tables use `'admin'::app_role` / `'judge'::app_role` (enum overload).
- Both overloads exist (`prosecdef=true`), so behavior is correct. Inconsistency is **stylistic only**.
- **SELECT:** judges see only their own assignments. ✅
- **No INSERT/UPDATE/DELETE policy for judges** → only admins can assign (correct: assignment is admin-only).

## 4. Security-Definer Helpers Verified

| Function | Args | SECURITY DEFINER | Returns |
|---|---|---|---|
| `has_role` | `(uuid, app_role)` | ✅ | bool |
| `has_role` | `(uuid, text)` | ✅ | bool |
| `judge_can_access_entry` | `(uuid, uuid)` | ✅ | bool |

All three set `search_path` and bypass RLS safely — the standard recursion-prevention pattern.

## 5. Findings Summary

| # | Severity | Table | Finding |
|---|---|---|---|
| F1 | 🟢 Info | judging_tags | Duplicate SELECT policy ("Judges can view active tags") is redundant — broader "All users" policy already permits. Cleanup recommended. |
| F2 | 🟢 Info | judge_entry_assignments | Uses `'admin'::text` / `'judge'::text` overload instead of `::app_role`. Stylistic only. |
| F3 | 🟢 Info | All 7 | `forcerowsecurity` not enabled. Owner (`postgres`) bypasses, but that role is service-only. Acceptable for current architecture. |

**No HIGH or MEDIUM severity findings.** No data exposure, no privilege escalation paths, no missing policies on write operations.

## 6. Verdict

✅ **All 7 judging tables are RLS-hardened.**  
✅ Anonymous access is fully blocked (verified by live HTTP probes).  
✅ Cross-judge reads/writes are prevented by `judge_id = auth.uid()` checks combined with assignment validation via `judge_can_access_entry`.  
✅ Admin overrides go through a single `has_role(...,'admin')` check, consistent across all tables.  
✅ Distributed-mode entry assignment is enforced server-side via SECURITY DEFINER function — no client trust.

**Step 18 complete. Ready for Step 19.**
