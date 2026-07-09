---
name: r2-r3-no-needs-review
description: R2/R3 have NO 'Needs Review', NO 'Stay', NO 'Reject'/'Shortlist' labels. Allowed labels per v3_stage_catalog (16-key frozen contract): R2='Accepted in Round 2' (r2_accepted) OR 'Qualified for Round 3' (r2_qualified_r3). R3='Accepted in Round 3' (r3_accepted) OR 'Qualified for Final Round' (r3_qualified_final). Submit gated to 10/10. Ruleset v4 + v3 catalog (2026-05-01).
type: constraint
---

# R2 / R3 Vocabulary — v3 Catalog Frozen Contract

## Rule

R2 and R3 expose **two outcomes per round only**, both rendering canonical
labels from `v3_stage_catalog` via `getStageByKey().tag_label_canonical`.
Tier is derived from the average of the 10 mandatory SOW criteria.

| Round | avg ≥ 7 ⇒ stage_key (label) | avg < 7 ⇒ stage_key (label) |
|---|---|---|
| **R2** | `r2_qualified_r3` ("Qualified for Round 3") OR `r2_accepted` ("Accepted in Round 2") | _no active not-selected stage_ — entry retains last canonical label |
| **R3** | `r3_qualified_final` ("Qualified for Final Round") OR `r3_accepted` ("Accepted in Round 3") | _no active not-selected stage_ — entry retains last canonical label |

Both `r2_accepted` and `r3_accepted` are **cert_eligible** (see catalog
`cert_eligible: true`). The "Accepted in Round N" label is the canonical
participant wording for in-round acceptance without further progression.

## Forbidden in R2/R3

- ❌ "Needs Review" (R1-only — enforced by `trg_guard_needs_review_round1_only`)
- ❌ "Stay" / "Stayed at RN" (revoked by Ruleset v4)
- ❌ "Reject" / "Shortlist" labels (R1 vocabulary)
- ❌ "Not Selected for 3rd Round" / "Not Selected for Final Round" (retired)
- ❌ Any tag chip UI (tags are R4-only — see `mem://judging/tags-only-in-r4`)
- ❌ Hardcoded label strings (use `getStageByKey()`)

## Submit gate

All 10 criteria must carry a value (1–10) before save / next / round-close.
Score=0 is not a valid input in R2/R3.

## Source

- User chat 2026-04-25 (mandatory 10 criteria)
- User chat 2026-04-29 (Ruleset v4: remove Stay, certs are R4-only)
- Phase 1 catalog resync 2026-05-01 (`r2_accepted` / `r3_accepted` added,
  `*_not_selected_*` retired — see `src/lib/judging/stageCatalog.ts`)
