---
name: tags-only-in-r4
description: ALL judging tags (Top 100, Top 50, Winner, Runner-up, Honorary, Special Jury) are assigned ONLY in Round 4. R1, R2, R3 have NO tag UI whatsoever (Spec v3 'Stay' tag exception is REVOKED by Ruleset v4 2026-04-29). Earlier rounds drive a pool by score/decision; R4 is where every tag is applied AND the only round that issues certificates.
type: constraint
---

> **2026-04-29 Ruleset v4 update**: The Phase 1–3 "Stay" tag exception that
> briefly allowed `Stayed at R2` / `Stayed at R3` chips in R2/R3 is **REVOKED**.
> R2/R3 are now strictly binary (advance / not selected) by score. See
> [mem://judging/ruleset-v4-r4-only-certs].

# All Tagging Lives in Round 4 (User Override 2026-04-25)

## Rule

Tag chips ("Top 100", "Top 50", "Winner", "1st Runner-Up", "2nd Runner-Up", "Honorary Mention", "Special Jury", and any future judging tag) are **only** applied during **Round 4**.

- **R1 (Initial Screening)**: decision-only buttons (Accept / Shortlist for R2 / Needs Review / Reject). NO tags.
- **R2 (Scoring)**: 10 mandatory sliders → average drives auto-tier. NO tags.
- **R3 (Scoring)**: 10 mandatory sliders → average drives auto-tier. NO tags.
- **R4 (Final + Awards)**: 10 mandatory sliders + **all tags** assigned here.

## Why

User explicit instruction on the annotated spec: tag chips next to R2 ("Top 100") and R3 ("Top 50") were highlighted with the note **"Judge will tag on R4"**.

## Implications

### Certificate eligibility (revised)

- **R1**: Accepted entries (no tag).
- **R2**: "Qualified for R2" status (no tag dependency).
- **R3**: "Qualified for R3" status (no tag dependency).
- **R4**: Any tag assigned (Winner / Runner-up / Honorary / Special Jury / Top 50 / Top 100 / Qualified Final).

### Wiring contract

- `judge_tag_assignments` writes from R1/R2/R3 contexts must be **blocked** at the UI layer.
- The CinemaFullView right-panel must hide the "Tag chips" UI section unless `roundNumber === 4`.
- The Round 4 panel surfaces the **full tag palette** (Top 100, Top 50, Winner, RU1, RU2, Honorary, Special Jury) — they are not split across rounds.
- `judging_tags.visible_in_round` must contain `[4]` for every active tag (no `[2]`, no `[3]`); admin tag editor must enforce this.
- Certificate eligibility checks must rely on `progression_decision` / status for R1-R3 and on `judge_tag_assignments` only for R4.

## Source

User annotation on `Judge_Panel_Acceptance_Spec.docx` (2026-04-25):
- "Tag chips (e.g. Top 100) … **Judge will tag on R4**" (R2 line, highlighted)
- "Tag system now offers Top 50. **(Judge will tag on R4)**" (R3 line, highlighted)
- "+ Top 100 tag **(Judge will tag on R4)**" (R2 cert eligibility, highlighted)
- "+ Top 50 tag **(Judge will tag on R4)**" (R3 cert eligibility, highlighted)
