# Judge Panel — Blocker List vs Spec v3

**Date:** 2026-04-25
**Method:** Code + DB walk-through against the approved Spec v3.
**Reading order:** highest impact first. Each item: WHAT live app does → WHAT spec says → SEVERITY.

---

## 🔴 BLOCKER 1 — R1 has NO 4 buttons; it uses tags instead

- **Spec v3 §1:** R1 right panel must show four big buttons only: **Accept / Shortlist for R2 / Needs Review / Reject**. No tags, no sliders, no comments.
- **Live app:** R1 has been collapsed into a single **`TagDecisionPanel`** (`src/components/judge/TagDecisionPanel.tsx`). The judge clicks *tags* to decide, not the four spec buttons. Code comment in `useJudgeActions.ts`: *"Judging v5: Scores are PRIVATE marks ... Decisions are made exclusively via tag clicks."*
- **Severity:** BLOCKER. Whole R1 UX is wrong.

## 🔴 BLOCKER 2 — Tags exist in R1/R2/R3 (they should exist ONLY in R4)

- **Spec v3 Golden Rule #3:** Tag chips are **Round 4 only**. R1/R2/R3 have **no tag UI**.
- **Live app:** `TagDecisionPanel` filters tags by `visible_in_round` — and admin tag config still allows R1/R2/R3 visibility. The whole judging engine is tag-driven across all four rounds.
- **Required:** `judging_tags.visible_in_round` must be locked to `[4]` for every active tag, and the R1/R2/R3 panels must hide the component entirely.
- **Severity:** BLOCKER.

## 🔴 BLOCKER 3 — R2/R3 do NOT enforce all 10 criteria

- **Spec v3 Golden Rule #4:** All 10 criteria mandatory. Save/Next/Complete blocked while any is empty.
- **Live app:** `useJudgeActions.handleQuickScore` accepts a partial `criteria` object and even saves a single overall `score` with no criteria at all. The edge fn `submit-judge-score` does not validate "all 10 present". No UI red-required badges.
- **Severity:** BLOCKER. Round-close coverage gate currently passes incomplete photos.

## 🔴 BLOCKER 4 — Auto-tier from average is NOT wired

- **Spec v3 §2/§3/§4:** Once 10 criteria are scored, the system writes the per-photo decision automatically (0 → Needs Review, 1–6.9 → Qualified-this-round, 7–10 → next round / award-eligible).
- **Live app:** Score → decision derivation was explicitly removed (`useJudgeActions.ts` comment: *"the legacy score→decision shim is removed"*). Decisions today come ONLY from tag clicks.
- **Severity:** BLOCKER. Without this, R2/R3 cannot function as the spec describes.

## 🔴 BLOCKER 5 — No two-step Lock vs Declare for R1/R2/R3

- **Spec v3 Golden Rule #1:** Judge "Complete Round" = LOCK. Admin "Declare Round N" = PUBLISH (emails + status + certificates).
- **Live app:** Only one publish endpoint exists (`publish-round`) and it directly flips `published_at` (which the participant view reads). `complete-round` writes lock state but there is **no separate Admin "Declare" gate** between the two for R1/R2/R3 — `publish-round` is the only switch and it acts as both. There is no enforcement that "lock first, then admin declare second" actually waits.
- **Severity:** BLOCKER. Admin can publish without judge having locked, or judge locking can be mistaken for declaration depending on UI wiring.

## 🟠 HIGH 6 — R4 Award rules don't match spec

- **Spec v3 §4:** Mandatory = **Winner only** (exactly one). Runner-Ups are optional.
- **Live app:** `complete-round/index.ts` line 23 — `REQUIRED_AWARDS = ["winner", "1st runner up", "2nd runner up"]`. **Both runner-ups are forced.**
- **Severity:** HIGH. Will block R4 closure for competitions that legitimately have only a Winner.

## 🟠 HIGH 7 — Marks-private rule not visibly enforced for participants

- **Spec v3 Golden Rule #2:** Marks NEVER visible to participants. Status only.
- **Live app:** `useGatedEntryStatus` does gate status, but per-photo views in `SubmissionDetail.tsx` and `PublicProfile.tsx` reference tag/score data paths that need re-audit. Memory file `marks-are-private-internal.md` exists but no test enforces it.
- **Severity:** HIGH. Need an automated invariant test (e.g. `judging-invariants.test.ts`) that asserts no mark/criterion field leaves the API for a non-admin/non-judge caller.

## 🟠 HIGH 8 — R2 "Total Average Score" not surfaced

- **Spec v3 §2.3:** Live total-average read-out for judge + admin.
- **Live app:** `CinemaFullView.tsx` shows individual sliders but no live average computation in the right panel for R2.
- **Severity:** HIGH (UX gap, not data integrity).

## 🟡 MEDIUM 9 — R3 wording

- **Spec v3 §3:** Top tier in R3 reads **"Shortlisted for Final"**.
- **Live app:** Status labels still read "Qualified for R3 / Move to R4" in places (`gatedStatusLabel`).
- **Severity:** MEDIUM (copy fix).

## 🟡 MEDIUM 10 — Certificate eligibility still tag-dependent for R2/R3

- **Spec v3 §5:** R2/R3 cert eligibility = STATUS only, no tag dependency (because tags are R4-only).
- **Live app:** Certificate gates in `useGatedEntryStatus` and certificate edge functions still inspect tag assignments for R2/R3.
- **Severity:** MEDIUM. Will silently block participants from requesting certificates after BLOCKER 2 is fixed.

---

## Summary table

| # | Area | Severity | Effort |
|---|------|----------|--------|
| 1 | R1 four-button UI | 🔴 Blocker | M |
| 2 | Remove tags from R1/R2/R3 | 🔴 Blocker | S (DB + UI hide) |
| 3 | Mandatory 10 criteria | 🔴 Blocker | M (UI + edge validate) |
| 4 | Auto-tier from average | 🔴 Blocker | M |
| 5 | Two-step Lock vs Declare | 🔴 Blocker | M (split endpoints) |
| 6 | R4 awards: only Winner mandatory | 🟠 High | S |
| 7 | Marks-private invariant test | 🟠 High | S |
| 8 | R2 live total average | 🟠 High | S |
| 9 | "Shortlisted for Final" copy | 🟡 Medium | XS |
| 10 | R2/R3 cert eligibility = status | 🟡 Medium | S |

---

## Recommended fix order

1. **Blocker 5** (Lock vs Declare) — foundational; everything else publishes through this gate.
2. **Blocker 2** (kill tag UI in R1/R2/R3) — one DB update + one component guard.
3. **Blocker 1** (R1 four-button panel) — replaces `TagDecisionPanel` for R1 only.
4. **Blocker 3 + 4** (mandatory 10 + auto-tier) — same code path; do them together.
5. **High 6** (R4 awards) — one constant change in `complete-round`.
6. **High 7 / 8** (marks-private test, R2 average) — hardening + UX polish.
7. **Medium 9 / 10** (copy + cert eligibility cleanup) — finishing pass.

No code changes will be made until you approve this list (or amend it).
