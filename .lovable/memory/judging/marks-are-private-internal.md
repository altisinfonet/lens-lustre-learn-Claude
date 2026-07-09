---
name: marks-are-private-internal
description: Judge MARKS (the 10-criteria scores) are NEVER shown to anyone — not public, not participants, not other judges. Marks are an internal admin/judge record only. The SOW line about "marks visible to public after declaration" is OVERRIDDEN by the user.
type: constraint
---

# Marks Are Private — Internal Record Only (User Override 2026-04-25)

## Rule

The 10-criteria slider scores ("marks") that judges enter are **internal data only**.

- **Never** shown to the public, even after a round is declared.
- **Never** shown to participants on their My Submissions page or anywhere else.
- **Never** shown to other judges.
- Visible **only** to: the judge who entered them (own marks) + admins (audit / aggregation).

## Why

User explicitly overrode the SOW snippet *"any marks given by Judge will be visible to public… after final declaration"*.
Their words on the annotated spec: **"Markes Never be seen to anyone in any round. Its ONLY for Internal Record."**

## What IS shown publicly after a round is Declared (by Admin)

- The participant's per-photo **status** (Accepted / Shortlisted / Qualified / Rejected / Needs Review).
- The **tags** attached in R4 (Winner / Runner-up / Honorary / Special Jury / Top 50 / Top 100 / etc.) — those become public placement labels.
- For R4 only: aggregated **average score** may surface as a placement signal, but **per-judge per-criterion numbers stay hidden**.

## Wiring contract

- Public competition pages, EntryCard, SubmissionDetail, Winners pages, public profile galleries: must NEVER render `judge_scores.*` rows.
- Participant "My Submissions" view: status + tags only, no marks numbers.
- Admin views and the judge's own panel: marks remain visible (audit + self-edit).
- Per-judge anonymized "Judge #1, Judge #2" criterion breakdown that was previously planned for the public R4 results page: REMOVED from scope.

## Source

User annotation on `Judge_Panel_Acceptance_Spec.docx` (2026-04-25), yellow highlight on the SOW marks-visibility paragraph.
