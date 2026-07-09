---
name: participant-wording-master-plan
description: AUTHORITATIVE participant wording dictionary now derived from the 16-key v3_stage_catalog (frozen contract v3, 2026-05-01). UI must call getStageByKey().tag_label_canonical — no hardcoded labels anywhere.
type: feature
---

# Participant Wording — Master Plan (v3 Frozen Contract)

## Source of truth

The **16-key `v3_stage_catalog`** (mirrored client-side in
`src/lib/judging/stageCatalog.ts`) is now the SINGLE source for every
participant-facing stage label. The legacy 18-key (round, outcome) dictionary
is **retired**.

DB parity is enforced by:
- `src/test/stage-catalog-parity.test.ts` (build)
- `scripts/audits/v3_catalog_parity.mjs` (CI — asserts exactly 16 active rows)
- `.github/workflows/audit-forbidden.yml` (forbidden-strings gate)

## How to read the canonical label in UI

```ts
import { getStageByKey } from "@/lib/judging/stageCatalog";
const label = getStageByKey(entry.progression_decision)?.tag_label_canonical;
```

UI must NEVER:
- hardcode any participant-facing stage string
- read `entry.status` / `entry.placement` / `entry.progression_decision` raw
  (blocked by ESLint rule `audit-v6/no-raw-entry-status`)
- import or build its own label map

## 16 canonical labels (active rows)

| stage_key | round | tag_label_canonical | cert |
|---|---|---|---|
| `r1_accepted` | 1 | Accepted | ✅ |
| `r1_shortlisted_r2` | 1 | Qualified for Round 2 | ✅ |
| `r1_needs_verification` | 1 | Verification Required | — |
| `r1_rejected` | 1 | Rejected | — |
| `r2_accepted` | 2 | Accepted in Round 2 | ✅ |
| `r2_qualified_r3` | 2 | Qualified for Round 3 | ✅ |
| `r3_accepted` | 3 | Accepted in Round 3 | ✅ |
| `r3_qualified_final` | 3 | Qualified for Final Round | ✅ |
| `r4_winner` | 4 | Winner | ✅ |
| `r4_runner_up_1` | 4 | 1st Runner-Up | ✅ |
| `r4_runner_up_2` | 4 | 2nd Runner-Up | ✅ |
| `r4_honorary_mention` | 4 | Honorary Mention | ✅ |
| `r4_special_jury` | 4 | Special Jury Award | ✅ |
| `r4_top_50` | 4 | Top 50 Global Photographer | ✅ |
| `r4_top_100` | 4 | Top 100 Global Photographer | ✅ |
| `r4_finalist` | 4 | Finalist (no placement) | ✅ |

## Retired labels (forbidden in code & PRs)

The strings below MUST NOT appear in `/src` or `/supabase/functions/_shared/transactional-email-templates`.
The CI workflow `audit-forbidden.yml` greps the diff and fails the PR on match.

- `Shortlist for R2`
- `Shortlist for Round 2`
- `Shortlisted for R2`
- `Qualified for 3rd Round`
- `Not Selected for 3rd Round`
- `Not Selected for Final Round`  (use `Finalist (no placement)` or omit)
- `Top 50` (without "Global Photographer")
- `Top 100` (without "Global Photographer")
- `Needs Review` outside of R1 contexts
- legacy stage_key `r1_shortlisted_for_r2` (renamed to `r1_shortlisted_r2`)
- legacy stage_keys: `r2_not_selected_r3`, `r3_not_selected_final`, `r4_qualified_final`

## Q&A (from 2026-04-29 chat)

- **Q1 — "Not Selected" wording in R2/R3?**
  Removed entirely. The catalog has NO `r2_not_selected_r3` / `r3_not_selected_final`
  active rows. Participants whose entry doesn't progress simply see the prior
  round's status (last published canonical label).
- **Q2 — Cert vocabulary?** Pulled from `tag_label_canonical`; cert generator
  reads `getStageByKey(stage_key).cert_eligible` (no separate map).
- **Q3 — Email subject lines?** Templates resolve label via
  `getStageByKey(stage_key).tag_label_canonical` at JIT render time
  (Phase 6, see `mem://judging/notification-templates-phase2`).
- **Q4 — DB labels?** Untouched. Only UI/email wording changed.
