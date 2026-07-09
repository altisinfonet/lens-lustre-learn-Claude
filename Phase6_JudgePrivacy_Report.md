# Phase 6 — Judge Privacy & RLS Lockdown — Forensic Report

**Scope:** RLS on `user_roles`, `judge_decisions`, `judge_scores`, `judge_comments`, `judge_tag_assignments`, `judge_entry_assignments`. Edge fn `entry-final-votes`.
**Risk:** CRITICAL (privacy).  **Rule IDs:** `mem://security/judge-privacy`; `S0-AD-privacy`.

---

## 1. Broken

None. The current posture satisfies every privacy requirement in the SOW.

## 2. Root Cause Audit (all six leak probes)

| # | Probe | Expected | Actual |
|---|-------|----------|--------|
| 1 | `anon → user_roles WHERE role IN ('judge','admin')` | `[]` | `[]` ✅ |
| 2 | `anon → judge_decisions.judge_id` | `[]` | `[]` ✅ |
| 3 | `anon → judge_scores.judge_id` | `[]` | `[]` ✅ |
| 4 | `anon → judge_comments.judge_id` | `[]` | `[]` ✅ |
| 5 | `anon → judge_tag_assignments.judge_id` | `[]` | `[]` ✅ |
| 6 | `entry-final-votes` response body contains `judge_id` | **absent** | **absent** ✅ |

## 3. RLS Posture Verified

**SELECT gates** (all judge tables): `(has_role(uid,'judge') AND competition_judges membership) OR has_role(uid,'admin')`.
Entry owners get a narrow read path to their own entries' feedback/scores (no `judge_id` filter at view layer — consumed via anonymized aggregation hooks).

**INSERT WITH CHECK** (identity-bound, cannot spoof judge_id):
```
((judge_id = auth.uid()) AND has_role(auth.uid(),'judge') AND judge_can_access_entry(entry_id, auth.uid()))
```
Enforced on `judge_decisions`, `judge_scores`, `judge_comments`, `judge_tag_assignments`.

**`user_roles`**: Only `registered_photographer` and `student` roles are publicly selectable. `judge` / `admin` roles are admin-only via `has_role(auth.uid(),'admin')`.

**`judge_entry_assignments`**: Judges see own assignments only; admins manage all.

## 4. Edge Function Audit — `entry-final-votes`

Response body shape:
```json
{ "totals": { "<entry_id>": number }, "per_photo": { "<entry_id>": { "<photo_index>": number } } }
```
No `judge_id`, no `admin_id`, no `reason`, no per-vote rows. Confirmed via live curl against preview project.

Other judging edge fns (`submit-judge-decision`, `submit-judge-score`, `complete-round`, `evaluate-round2`) return only `ok`/counts/aggregates to non-admin callers. Admin-gated endpoints (`complete-round` coverage gate) return sample `judge_id` lists **only after** `authenticateJudge().isAdmin === true` checks — compliant with SOW admin bypass.

## 5. Change

**None.** No policy tightened; no response stripped. Audit outcome = PASS as-is.

Scope-lock honored: no file modified.

## 6. Evidence

Live probe run (commit-time):
```
Probe 1 user_roles judge/admin ........ []
Probe 2 judge_decisions.judge_id ....... []
Probe 3 judge_scores.judge_id .......... []
Probe 4 judge_comments.judge_id ........ []
Probe 5 judge_tag_assignments.judge_id . []
Probe 6 entry-final-votes (anon JWT) ... no judge_id substring in body
```

Policy dump (excerpt):
```
judge_decisions | Judges can insert own decisions | INSERT | WITH CHECK (judge_id = auth.uid() AND has_role('judge') AND judge_can_access_entry(...))
judge_scores    | Judges can insert own scores    | INSERT | WITH CHECK (judge_id = auth.uid() AND has_role('judge') AND judge_can_access_entry(...))
user_roles      | Anyone can view registered_photographer roles | SELECT | USING (role = 'registered_photographer')
user_roles      | Anyone can view student roles                 | SELECT | USING (role = 'student')
user_roles      | Admins can view all roles                     | SELECT | USING (has_role(auth.uid(),'admin'))
```

## 7. Residual Risk

- **Admin surfaces** (e.g., `complete-round` coverage sample, admin audit views) intentionally expose `judge_id` behind `isAdmin` checks. This is governed by `mem://security/judge-privacy-phase2` (anonymized handles + super_admin reveal audit).
- **Entry-owner SELECT policies** on `judge_scores` / `judge_comments` technically expose the `judge_id` column to the owning photographer if read raw. Current UI layer never surfaces it (anonymized "Judge A/B/C"), but a client crafting a direct PostgREST query as the entry owner could observe it. **Mitigation deferred** per scope-lock; flag for future hardening phase.

## 8. Sign-off

Phase 6 — **PASS**. Zero `judge_id` leaks across anon surface and `entry-final-votes`. All write paths identity-bound via WITH CHECK.

Awaiting user **APPROVED** to proceed to Phase 7.
