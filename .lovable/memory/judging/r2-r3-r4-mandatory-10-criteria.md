---
name: r2-r3-r4-mandatory-10-criteria
description: In R2, R3, R4 every judge MUST score all 10 criteria for every eligible photo before saving. Partial scoring is NOT allowed — overrides earlier "(a) treat unrated as incomplete" decision.
type: constraint
---

# All 10 Criteria Are Mandatory in R2 / R3 / R4 (User Override 2026-04-25)

## Rule

For Rounds 2, 3, and 4:

- The judge **must enter all 10 criteria** (LINE, SHAPE, FORM, TEXTURE, COLOR, SPACE, TONE, BALANCE, LIGHT, DEPTH) for every photo they evaluate.
- A photo is **not considered judged** until all 10 sliders carry a value (1–10).
- Save / next-photo / "Complete Round" must be **blocked** while any of the 10 criteria is null on a touched photo.

## Why

User explicit instruction on the annotated spec:
- *"Here Judge have to give marks, its mandatory"* (against the unrated-stays-null line)
- *"Here Judge have to give a marks on 10 criteria, its mandatory"* (answering the (a)/(b) question — picks (b))

This **overrides** the prior decision that unrated criteria could stay null.

## Wiring contract

- `useJudgeActions.handleQuickScore` must validate `criteria` has all 10 numeric values before invoking edge fn.
- `submit-judge-score` edge fn must reject payloads missing any of the 10 SOW criteria with a clear error.
- CinemaFullView R2/R3/R4 panel: per-criterion sliders must show a red "required" badge when null, and the "Save & Next" button must be disabled until all 10 have a value.
- Round-close coverage gate must additionally check `judge_scores` has all 10 columns non-null for every assigned photo.

## R1 exception

R1 is decision-only — no sliders, no criteria. This rule applies only to R2/R3/R4.

## Source

User annotation on `Judge_Panel_Acceptance_Spec.docx` (2026-04-25), yellow highlights overriding the previous "unrated stays null" line and the (a)/(b) clarification question.
