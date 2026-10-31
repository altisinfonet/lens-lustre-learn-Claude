---
name: Verification Workflow Phase H
description: Auto-expire sweeper for photo verification requests — 72h deadline, auto-reject, notify participant/judge/admin via cron every 15 min
type: feature
---
**Phase H — auto-expire & escalation** for photo verification requests.

## Schema additions (`photo_verification_requests`)
- `expires_at timestamptz` — defaults to `now() + interval '72 hours'` on new inserts. Existing rows backfilled to `created_at + 72h`.
- `expired_at timestamptz` — set when the sweeper auto-rejects.
- `auto_expired boolean` — `true` only when the sweeper rejected (not an admin).
- Partial index `idx_pvr_expires_at_pending` on `(expires_at) WHERE status='pending'` for cheap sweeps.

## Edge function `expire-photo-verifications`
- `verify_jwt = false`. Idempotent. Service-role only via `SUPABASE_SERVICE_ROLE_KEY`.
- Selects `status='pending' AND expires_at <= now()` (limit 200 per run).
- For each row, atomically: `UPDATE ... WHERE status='pending'` → flips to `rejected`, `auto_expired=true`, `expired_at=now`, fixed `admin_note` ("Auto-rejected: deadline missed"). The status guard prevents racing with a late participant submission.
- Sets `competition_entries.progression_decision = 'rejected'` only when entry is still on `pending_verification` (never overwrites a stronger manual decision).
- Side-effects (each in isolated try/catch):
  - Email participant via existing `verification-decision` template, `decision='rejected'`. Idempotency key: `verify-autoexpire-${requestId}`.
  - Insert participant `user_notifications` (`type=verification_rejected`).
  - Insert judge `user_notifications` (`type=verification_judge_rejected`) only if judge ≠ participant.
  - Insert `admin_notifications` (`type=verification_auto_expired`) — escalation surface in admin bell.
  - Append `judge_activity_logs` (`action_type=verification_auto_expired`).
- Body `{ dryRun: true }` returns count without writing — useful for admin debugging.

## Cron schedule
- `expire-photo-verifications-every-15min` cron job runs every 15 minutes via `net.http_post` with anon JWT (function has `verify_jwt=false`).
- Mirrors the `expire-gift-credits` pattern (no vault secret needed).