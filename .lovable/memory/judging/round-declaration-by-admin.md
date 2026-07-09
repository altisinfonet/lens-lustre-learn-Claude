---
name: round-declaration-by-admin
description: Two-step gate per round — Lock (judge → closed_at) then Declare (admin → published_at). Participant-visible state, certificates, and emails fire ONLY on Declare. Lock is judge/admin-only audit.
type: feature
---

# Locking ≠ Declaring (Spec v3 / 2026-04-25)

Every competition round has TWO independent close events stored on
`competition_round_publish (competition_id, round_number)`:

| Action | Column written | Performed by | Edge fn | Side effects |
|--------|----------------|--------------|---------|--------------|
| **Lock** | `closed_at`, `closed_by` | judge (or admin) | `complete-round` | sets `judging_rounds.status='completed'`, runs decision aggregation, mutates `competition_entries.status / progression_decision / certificate_ready`, auto-activates next round. **Hidden from participants.** |
| **Declare** | `published_at`, `published_by` | admin only | `publish-round` | flips participant visibility via `useGatedEntryStatus` / `entry_public_status`, makes certificates eligible (`Certificates.tsx`), DB triggers fire participant emails. |

## Hard rules

1. **`publish-round` REJECTS** an attempt to declare a round that is not yet locked
   (`closed_at IS NULL` → 409 `round_not_locked`).
2. **All four rounds** follow the same gate. R1, R2, R3, R4 — no exceptions.
3. Participant-facing UI MUST key off `published_at` (declared), NEVER `closed_at`
   (locked) and NEVER `judging_rounds.status='completed'`.
4. Email triggers MUST key off `published_at`.
5. The admin Lock state is visible inside the admin panel only
   (`RoundPublishPanel.tsx`) — it shows three states: `Not locked` →
   `Locked · awaiting declaration` → `Declared`.

## Why

Admin must be able to:
- Review consensus / drift before publishing.
- Hold a round if a Needs-Review photo is unresolved across judges.
- Coordinate the public announcement timing (social, newsletter).

## Why we don't gate judge-side mutations on `closed_at`

The participant-publish-gate (memory `participant-publish-gate.md`) already
hides `competition_entries.status / progression_decision / placement /
certificate_ready` until `published_at` is set. So the judge-side writes done
inside `complete-round` are safe even though they happen at lock time —
participants cannot see them.

## Source

User annotation on `Judge_Panel_Acceptance_Spec.docx` (2026-04-25),
yellow highlight on "(By Admin)" against the round results-publish line,
generalized in Spec v3 as the Golden Rule.
