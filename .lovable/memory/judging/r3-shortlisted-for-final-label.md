---
name: R3 Top Tier Label — Shortlisted for Final
description: Spec v3 §3 — entry status `shortlisted` renders as "Shortlisted for Final" everywhere
type: preference
---
Spec v3 §3 (Blocker M9):

- `gatedStatusLabel({ public_status: "shortlisted" })` → **"Shortlisted for Final"**.
- All UI surfaces consume this via `useGatedEntryStatus` → `gatedStatusLabel`.
- Test: `src/test/notifications.spec.ts` enforces the mapping.

How to apply: never hardcode the bare word "Shortlisted" in user-facing copy
for `shortlisted` status — always read it from `gatedStatusLabel`.
