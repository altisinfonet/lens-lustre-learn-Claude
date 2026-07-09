---
name: Notification Backfill Phase 4
description: Idempotent drift audit + backfill RPCs for judging notifications & verification requests; admin widget at /admin/notifications_health
type: feature
---

Phase 4 closes the notification gap by detecting status changes that didn't emit and re-emitting idempotently.

**RPCs (all SECURITY DEFINER + admin-gated)**:
- `get_notification_drift_admin(_window_days int)` → per-template missing-emit counts
- `get_stuck_verifications_admin()` → pending verifications >24h with no email log
- `get_notification_health_stats_admin()` → emits today, total, distinct templates, failures today, DLQ count
- `backfill_judging_notifications(_window_days, _dry_run)` → idempotent re-emit (skips entries already in `notification_emit_log`)
- `backfill_stuck_verifications(_dry_run)` → same pattern for `verification_request_created` kind

**Idempotency**: backfill skips any entry that already has a row in `notification_emit_log` matching `(entity_id, email_template, recipient_user_id)` for entries OR `(entity_id, kind='verification_request_created')` for verifications. Calls `emit_notification()` which itself dedupes via the audit log.

**UI**: `NotificationsHealthAudit` (compact + full mode) at `/admin/notifications_health`. Compact card surfaces on `/admin/health`. Tab key: `notifications_health` (super_admin only).

**Status template mapping** (mirrors backbone trigger 20260424093600):
- placement winner/runner_up/special_jury → `competition_winner`
- status finalist → `entry_finalist`
- status round%qualified or qualified → `entry_qualified`
- status %shortlist% → `entry_shortlisted`
- status rejected → `entry_rejected`
- status approved → `entry_approved`

**Window default**: 90 days (configurable 1–365). Verification threshold: pending >24h.
