---
name: Email Templates v4 — Stay Removed, Cert Revoked Added
description: The `entry-stayed-at-round` template is DELETED (no Stay outcome anymore). A new `certificate-revoked` template is added to notify participants whose R1/R2/R3 certificates were revoked under Ruleset v4.
type: feature
---

# Email Templates — Ruleset v4 (2026-04-29)

## Removed

- ❌ `entry-stayed-at-round.tsx` — deleted (no 'Stay' outcome under v4).
- ❌ Notification template registry entry `entry_stayed_at_round` — unregistered.
- ❌ DB trigger branch in `notify_entry_status_change` that fired on
  `progression_decision='stay'` — dropped.

## Added

- ✅ `certificate-revoked.tsx` — sent to every participant whose cert is
  revoked by the STEP 7 backfill. Copy explains the policy change
  ("Certificates are now issued only for Round 4 award winners") and
  thanks them for participating.
- ✅ Registered in the template registry as `certificate_revoked`.

## Unchanged

- All R1, R3, R4 lifecycle templates (qualified, shortlisted, finalist,
  winner, etc.) remain as-is.
- `process-email-queue` JIT render path unchanged.

## See also

- [mem://judging/notification-architecture] — DB triggers are the only legal
  email path; the new `certificate_revoked` send is fired from the backfill
  edge fn via `emit_notification()`.
