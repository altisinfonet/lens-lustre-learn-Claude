---
name: R4 Winner-Only Mandatory Award
description: Spec v3 §4 — Round 4 closure requires Winner only; runner-ups, honourable mention, special jury are all optional
type: feature
---
Spec v3 §4 (approved 2026-04-25) — Blocker H6:

- `complete-round` edge function: `REQUIRED_AWARDS = ["winner"]` only.
- 1st Runner Up, 2nd Runner Up, Honourable Mention, Special Jury Award are OPTIONAL.
- `UNIQUE_AWARDS` still enforces uniqueness for winner / 1st RU / 2nd RU when assigned.
- Needs-Review-zero remains a hard block (entry filter).
- No admin bypass flag permitted.

Reason: competitions may legitimately conclude with a Winner only and no runner-ups.
