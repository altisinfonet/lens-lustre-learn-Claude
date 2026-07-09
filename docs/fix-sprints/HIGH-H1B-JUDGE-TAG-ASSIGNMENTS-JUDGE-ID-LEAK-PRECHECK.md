# HIGH-H1b — `judge_tag_assignments.judge_id` Public Leak Precheck

**Mode:** READ-ONLY. Live-verified via `pg_policies`, `information_schema.columns`,
`pg_get_viewdef`, `pg_get_functiondef`, and exhaustive `rg` across `src/` +
`supabase/functions/`. No writes, no migrations, no policy changes, no deploys.

Date: 2026-05-29 UTC
Project: `isywidnfnjhtydmdfgtk`
Scope: `public.judge_tag_assignments` and its participant-reachable surfaces.

---

## 1. Live RLS policies on `public.judge_tag_assignments`

Source: `pg_policies WHERE schemaname='public' AND tablename='judge_tag_assignments'`.

| Policy | Cmd | Roles | USING / WITH CHECK |
|---|---|---|---|
| Admins can manage tag assignments | ALL | authenticated | USING `has_role(auth.uid(),'admin')` |
| Judges can assign tags | INSERT | authenticated | CHECK `judge_id = auth.uid() AND has_role(uid,'judge') AND judge_can_access_entry(entry_id,uid)` |
| Judges can remove own tag assignments | DELETE | authenticated | USING `judge_id = auth.uid() AND has_role(uid,'judge') AND judge_can_access_entry(entry_id,uid)` |
| Judges can view tag assignments | SELECT | authenticated | USING `(has_role('judge') AND assigned-to-comp) OR has_role('admin')` |
| **Public can read R4 award tag assignments on published rounds** | **SELECT** | **anon, authenticated** | USING `tag_id ∈ R4 award labels AND EXISTS published_at IS NOT NULL on round 4` |

## 2. Exact text of the public R4 policy

```sql
-- Policy: "Public can read R4 award tag assignments on published rounds"
-- Cmd: SELECT   Roles: {anon, authenticated}
USING (
  (EXISTS (
    SELECT 1 FROM judging_tags jt
    WHERE jt.id = judge_tag_assignments.tag_id
      AND jt.label = ANY (ARRAY[
        'Top 100','Top 50','Winner',
        '1st Runner-Up','2nd Runner-Up',
        'Honorary Mention','Special Jury'
      ])
  ))
  AND (EXISTS (
    SELECT 1
    FROM competition_entries ce
    JOIN competition_round_publish crp
      ON crp.competition_id = ce.competition_id
    WHERE ce.id = judge_tag_assignments.entry_id
      AND crp.round_number = 4
      AND crp.published_at IS NOT NULL
  ))
)
```

There is **no column filter** in this policy. RLS in Postgres is row-level only.

## 3. Base-table columns exposed under this policy

Source: `information_schema.columns`.

| # | Column | Type | Exposure under R4 public policy |
|---|---|---|---|
| 1 | id | uuid | public-safe |
| 2 | entry_id | uuid | public-safe |
| 3 | tag_id | uuid | public-safe |
| 4 | **judge_id** | **uuid** | **LEAKED — judge identity** |
| 5 | created_at | timestamptz | metadata |
| 6 | photo_index | integer | public-safe |
| 7 | round_number | integer | public-safe |

Violates `mem://security/judge-privacy-phase2` — judge identity must never be
exposed to anon/participants.

## 4. Proof: can `judge_id` be selected under the R4 public policy?

**SQL inspection: YES.** The policy gates rows, not columns. Any client
holding the anon key may issue
`GET /rest/v1/judge_tag_assignments?select=judge_id,entry_id,tag_id` and Postgres
returns `judge_id` for every row matching the USING clause.

**Live exploit rows today (count):**

```sql
SELECT
  (SELECT count(*)
     FROM competition_round_publish
     WHERE round_number=4 AND published_at IS NOT NULL)         AS published_r4,
  (SELECT count(*)
     FROM judge_tag_assignments jta
     JOIN judging_tags jt ON jt.id = jta.tag_id
     JOIN competition_entries ce ON ce.id = jta.entry_id
     JOIN competition_round_publish crp
       ON crp.competition_id = ce.competition_id
     WHERE crp.round_number = 4
       AND crp.published_at IS NOT NULL
       AND jt.label = ANY(ARRAY[
         'Top 100','Top 50','Winner','1st Runner-Up','2nd Runner-Up',
         'Honorary Mention','Special Jury'])
  ) AS exposed_rows;
```

Result: `published_r4 = 0`, `exposed_rows = 0`.

→ Surface is **LATENT**. First R4 publication will expose `judge_id` to anon.

## 5. Caller inventory

### 5a. `judge_tag_assignments` (raw base table)

Source: `rg "judge_tag_assignments" src/ supabase/functions/`.

**Server-side / privileged (service-role or admin/judge-gated — out of scope):**

- `supabase/functions/complete-round/index.ts:884, 1335` — admin client
- `supabase/functions/submit-judge-decision/index.ts:222` — judge JWT, RLS-checked
- `supabase/functions/publish-round/index.ts:174` — admin client
- `supabase/functions/delete-user/index.ts:68` — admin client
- `supabase/functions/hard-delete-competition/index.ts:346,356` — admin client
- `supabase/functions/evaluate-round2/index.ts` — comment only, no read

**Frontend — judge/admin contexts (require `judge_id`, gated by judge SELECT policy):**

- `src/hooks/judging/useJudgePhotoData.ts:105, 197`
- `src/hooks/judging/useJudgeActions.ts:293, 338, 362, 372`
- `src/components/admin/JudgingInvariantsAudit.tsx` (referenced)

**Frontend — participant-reachable surfaces hitting the BASE TABLE:**

- `src/pages/judging/PlacementBoard.tsx:79`
  ```ts
  supabase.from("judge_tag_assignments")
    .select("entry_id, tag_id")
    .in("entry_id", entryIds)
  ```
  Does NOT request `judge_id`, but reads the base table. Because PostgREST is
  the only barrier and the underlying public R4 policy permits anon row reads,
  this caller is the canonical example of why H-1b matters: a sibling request
  asking for `judge_id` against the same policy would succeed.

### 5b. `judge_tag_assignments_owner_safe` (HOTFIX-G view)

`pg_get_viewdef`:

```sql
SELECT id, entry_id, tag_id, photo_index, round_number, created_at
FROM judge_tag_assignments jta
WHERE EXISTS (
  SELECT 1 FROM competition_entries ce
  JOIN competition_round_publish crp ON crp.competition_id = ce.competition_id
  WHERE ce.id = jta.entry_id
    AND ce.user_id = auth.uid()
    AND crp.published_at IS NOT NULL
);
```

`judge_id` is physically not projected. Owner-scoped, publish-gated.

Callers (all participant-safe, all using only safe columns):

- `src/components/EntryTagStamps.tsx:39`
- `src/pages/SubmissionDetail.tsx:351`
- `src/pages/PublicProfile.tsx:318`
- `src/hooks/competition/useCompetitionDetail.ts:174`
- `src/hooks/dashboard/useDashboardData.ts:181`

### 5c. `public.get_photo_r4_awards(p_entry_ids uuid[])`

`pg_get_functiondef`: `STABLE SECURITY DEFINER`, reads from
`public.judge_award_tags` (R4-only sibling table — NOT `judge_tag_assignments`).
Returns `(entry_id, photo_index, stage_key, all_stage_keys[])`. **No `judge_id`
in signature or body.** Out of scope for H-1b.

### 5d. `src/pages/judging/PlacementBoard.tsx` — routing status

`rg "PlacementBoard" src/` returns matches only inside the file itself:

```
src/pages/judging/PlacementBoard.tsx:2,21,36,212
```

**No `import` of `PlacementBoard` exists anywhere in `src/`.** Not referenced in
`src/App.tsx` routes nor in any page/component. **Dead code today.**

This downgrades the practical risk: the base-table caller at line 79 is
unreachable via UI navigation. However the **DB policy** remains the exploit
surface; an attacker does not need PlacementBoard — they can curl the REST
endpoint with the anon key directly.

## 6. Is `PlacementBoard.tsx` routed?

**NO — dead code.** Not imported by `App.tsx` or any other module. Confirmed by
`rg "PlacementBoard" src/`. Safe to delete OR safe to repoint without UX impact.

## 7. Proposed fix (DRAFT ONLY — not applied)

### 7a. Safe view + column-scoped grants

```sql
-- Migration draft (NOT EXECUTED)
CREATE OR REPLACE VIEW public.judge_tag_assignments_public_r4
WITH (security_invoker = on) AS
SELECT
  jta.id,
  jta.entry_id,
  jta.tag_id,
  jta.photo_index,
  jta.round_number,
  jta.created_at
FROM public.judge_tag_assignments jta
WHERE EXISTS (
  SELECT 1 FROM public.judging_tags jt
  WHERE jt.id = jta.tag_id
    AND jt.label = ANY (ARRAY[
      'Top 100','Top 50','Winner',
      '1st Runner-Up','2nd Runner-Up',
      'Honorary Mention','Special Jury'])
)
AND EXISTS (
  SELECT 1
  FROM public.competition_entries ce
  JOIN public.competition_round_publish crp
    ON crp.competition_id = ce.competition_id
  WHERE ce.id = jta.entry_id
    AND crp.round_number = 4
    AND crp.published_at IS NOT NULL
);

GRANT SELECT ON public.judge_tag_assignments_public_r4 TO anon, authenticated;

-- Then drop the leaky base-table policy
DROP POLICY "Public can read R4 award tag assignments on published rounds"
  ON public.judge_tag_assignments;
```

### 7b. Frontend diff target

Single edit:

- `src/pages/judging/PlacementBoard.tsx:79`
  ```diff
  - .from("judge_tag_assignments")
  + .from("judge_tag_assignments_public_r4" as any)
  ```

Alternative (recommended given dead-code status): **delete
`src/pages/judging/PlacementBoard.tsx`** outright in the same patch.

### 7c. Rollback SQL

```sql
-- Rollback (revert to current live state)
DROP VIEW IF EXISTS public.judge_tag_assignments_public_r4;

CREATE POLICY "Public can read R4 award tag assignments on published rounds"
ON public.judge_tag_assignments
FOR SELECT
TO anon, authenticated
USING (
  (EXISTS (
    SELECT 1 FROM judging_tags jt
    WHERE jt.id = judge_tag_assignments.tag_id
      AND jt.label = ANY (ARRAY[
        'Top 100','Top 50','Winner',
        '1st Runner-Up','2nd Runner-Up',
        'Honorary Mention','Special Jury'])
  ))
  AND (EXISTS (
    SELECT 1
    FROM competition_entries ce
    JOIN competition_round_publish crp
      ON crp.competition_id = ce.competition_id
    WHERE ce.id = judge_tag_assignments.entry_id
      AND crp.round_number = 4
      AND crp.published_at IS NOT NULL
  ))
);
```

Frontend rollback: `git revert` of the one-line `.from(...)` edit (or restore
`PlacementBoard.tsx` if deleted).

## 8. Final verdict

**REAL ISSUE — LATENT.**

- The public R4 SELECT policy on `public.judge_tag_assignments` permits anon
  reads with **no column filter**, so `judge_id` IS selectable via the REST API
  whenever `competition_round_publish.round_number=4` has `published_at NOT NULL`.
- Today: `published_r4 = 0` → `exposed_rows = 0`. No active leak in production.
- First R4 publication will expose `judge_id` to anon globally.
- The frontend base-table caller (`PlacementBoard.tsx:79`) is **dead code**,
  reducing practical UI risk to zero — but the REST-level exposure is
  independent of the UI and remains the real H-1b surface.

Classification per Fresh-Audit taxonomy:
- **H-1a** (`judge_decisions.judge_id`) → **FIXED** (already proven in GO 2.1).
- **H-1b** (`judge_tag_assignments.judge_id` via R4 public policy) → **OPEN, LATENT**.

NO MIGRATION, NO CODE CHANGE, NO POLICY CHANGE, NO DEPLOY, NO SCANNER MARKING
performed. Awaiting explicit GO token to apply Option A (safe view + policy drop
+ 1-line frontend edit or PlacementBoard.tsx deletion).
