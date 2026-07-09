# VERIFY — HOTFIX-F PRECHECK (`public.judge_decisions` privacy)

**Mode:** READ-ONLY. Live-verified via `information_schema.columns`, `pg_policy`, and exhaustive `rg` across `src/` + `supabase/functions/`. No writes.

## 1. Live schema (9 columns)

| # | Column | Type | Nullable | Class |
|---|---|---|---|---|
| 1 | id | uuid | NO | internal |
| 2 | entry_id | uuid | NO | owner-safe |
| 3 | judge_id | uuid | NO | **PRIVATE — judge identity** |
| 4 | round_number | integer | NO | public-safe |
| 5 | decision | text | NO | public-safe |
| 6 | created_at | timestamptz | NO | metadata |
| 7 | updated_at | timestamptz | NO | metadata |
| 8 | photo_index | integer | NO | public-safe |
| 9 | stage_key | text | YES | public-safe |

**Score / criteria / notes / feedback columns: NONE on this table.** Scores live in `judge_scores`. The "private score columns leak on judge_decisions" framing is factually inaccurate; the actual leak surface is `judge_id`.

## 2. Live RLS policies

| Policy | Cmd | Roles | USING / CHECK |
|---|---|---|---|
| Admins can manage judge decisions | ALL | authenticated | USING `has_role(uid,'admin')` |
| **Entry owners can view own photo decisions** | SELECT | authenticated | USING `EXISTS(competition_entries WHERE id=entry_id AND user_id=auth.uid())` → returns full row **incl. `judge_id`** |
| Judges can view decisions | SELECT | authenticated | judge + assigned, OR admin |
| Judges can insert own decisions | INSERT | authenticated | CHECK `judge_id=uid AND has_role('judge') AND judge_can_access_entry(...)` |
| Judges can update own decisions | UPDATE | authenticated | same as insert check |

**Concrete leak:** entry owner can `SELECT *` and read every `judge_id` that judged them → violates `mem://security/judge-privacy-phase2`.

## 3. Participant-reachable frontend callers (`rg` exhaustive)

Single hit:

- `src/pages/SubmissionDetail.tsx:359`
  ```ts
  supabase.from("judge_decisions")
    .select("entry_id, photo_index, decision, round_number")
    .in("entry_id", entryIds).eq("round_number", 1)
  ```
  Selects only the 4 safe columns. Does **not** request `judge_id`.
  Score/private columns requested: **none** (none exist on this table).

## 4. Judge / admin / edge callers (must keep working)

All require `judge_id` and/or full row; all judge-/admin-/service-role gated:

- `src/hooks/judging/useJudgePhotoData.ts`
- `src/hooks/judging/useMultiJudgeProgress.ts`
- `src/hooks/judging/useJudgeAggregateStats.ts`
- `src/hooks/judging/decisionParityProbe.ts`
- `src/components/judge/CinemaFullView.tsx`
- `src/components/admin/JudgingInvariantsAudit.tsx`, `JudgingForensicDriftAudit.tsx`
- Edge fns: `complete-round`, `submit-judge-decision`, `hard-delete-competition` (service role, RLS-exempt)

All covered by "Judges can view decisions" / "Admins can manage…" — independent of the entry-owner SELECT policy. **Masking the participant path does not break them.**

## 5. Score/private columns exposed?

- On `judge_decisions`: no score/criteria columns exist; **only `judge_id` is the private leak**.
- On `judge_scores` (separate table): out of scope of HOTFIX-F.

## 6. Safest fix option

**Option A — projected safe view** (`public.judge_decisions_owner_safe` with `security_invoker=on`, 4 safe cols; drop "Entry owners can view own photo decisions" SELECT policy; repoint `SubmissionDetail.tsx` to the view).

Reasons:
- 1-line frontend change.
- View physically cannot return `judge_id`.
- No column-ACL fragility.
- Matches existing project patterns (`entry_public_status`, `profiles_public`).

## 7. Frontend change required?

**Yes — 1 line in `src/pages/SubmissionDetail.tsx`** (`.from("judge_decisions")` → `.from("judge_decisions_owner_safe")`).

## 8. Status

**HOTFIX_F_SAFE_TO_DRAFT** — pre-check holds; awaiting explicit go before any migration/code write.
