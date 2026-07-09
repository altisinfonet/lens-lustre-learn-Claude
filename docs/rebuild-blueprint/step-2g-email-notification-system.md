# STEP 2G — EMAIL & NOTIFICATION SYSTEM (Forensic Blueprint)

> **Scope**: In-app notifications, transactional email pipeline, auth email pipeline, queue/dispatch, suppression/unsubscribe, judging-lifecycle notification backbone, user preferences.
> **Mode**: Read-only audit. No assumptions, no fixes.

---

## 1. ARCHITECTURE OVERVIEW

```
                ┌─────────────────────────────────────────────┐
                │   DB TRIGGERS (judging / verification /     │
                │   round publish / friendships / gifts)      │
                └─────────────────────┬───────────────────────┘
                                      │ public.emit_notification(...)
                                      ▼
        ┌──────────────────────────────────────────────────┐
        │  user_notifications (in-app)                     │
        │  notification_emit_log (idempotency + email gate) │
        └─────────────────────┬────────────────────────────┘
                              │ pgmq enqueue (auth_emails | transactional_emails)
                              ▼
                ┌────────────────────────────────────┐
                │  process-email-queue (pg_cron 5s)  │
                └─────────────────────┬──────────────┘
                                      │ JIT render (React Email) when payload.html missing
                                      ▼
                ┌────────────────────────────────────┐
                │  Lovable Email Provider (Mailgun)  │
                └─────────────────────┬──────────────┘
                                      ▼
              email_send_log  •  suppressed_emails  •  email_unsubscribe_tokens
```

Two strictly separate streams:

| Stream | Source | Target table | Renderer |
|--------|--------|--------------|----------|
| Auth emails | `auth-email-hook` (Supabase Auth webhook) | `auth_emails` pgmq | `_shared/email-templates/*.tsx` |
| Transactional / lifecycle | DB triggers → `emit_notification` → enqueue, OR `send-transactional-email` | `transactional_emails` pgmq | `_shared/transactional-email-templates/*.tsx` |

---

## 2. EDGE FUNCTIONS

### 2.1 `send-transactional-email` (352 LOC)
- **Auth**: `verify_jwt = true` (default) — gateway enforces caller JWT.
- **Inputs**: `templateName`, `recipientEmail` (or template-level `to`), `idempotencyKey`, optional `templateData`.
- **Constants baked at scaffold**:
  - `SITE_NAME = "50mm Retina World"`
  - `SENDER_DOMAIN = "notify.www.50mmretina.com"`
  - `FROM_DOMAIN = "www.50mmretina.com"`
- **Flow**: Lookup template in `TEMPLATES` registry → resolve recipient (template `to` overrides arg) → suppression check → unsubscribe token (one per email address) → render React Email → enqueue to `transactional_emails` pgmq with `enqueue_email` RPC.
- **Idempotency**: `idempotencyKey` derived from event id + template name; duplicate enqueues skipped.

### 2.2 `process-email-queue` (428 LOC)
- **Trigger**: `pg_cron` every 5s (`process-email-queue` job), authenticated via Vault secret `email_queue_service_role_key`.
- **Priorities**: drains `auth_emails` first, then `transactional_emails`.
- **Behavior**:
  - JIT renders templates when `payload.html` is missing (requires JSX `deno.json` → `auth-email-hook/deno.json` shows `jsxImportSource: npm:react@18.3.1`).
  - Honors provider `Retry-After` on 429.
  - 5xx → message stays invisible for visibility-timeout (30s), retried.
  - 5 failures → moved to DLQ, logged to `email_send_log` with `status='dlq'`.
  - TTL: auth 15 min, transactional 60 min (configurable via `email_send_state`).
  - Throughput: default ~120 emails/min (batch=10, delay=200ms, cron 5s).

### 2.3 `auth-email-hook` (317 LOC)
- **Purpose**: Supabase Auth webhook that intercepts every auth email, renders branded React Email template, and enqueues to `auth_emails` pgmq.
- **Templates used**: `signup.tsx`, `recovery.tsx`, `magic-link.tsx`, `email-change.tsx`, `invite.tsx`, `reauthentication.tsx`.
- **Includes**: scanner-safe recovery_token (referenced in Step 2D).
- **Memory rule (Notification Architecture Phase 5)**: DB triggers are the ONLY legal way to send judging emails — UI never calls `send-transactional-email`. Locked by `src/test/notifications.spec.ts` + CI workflow `audit-forbidden.yml`.

### 2.4 `manage-notifications` (128 LOC)
- Server-side dismissal proxy (avoids RLS round-trips from clients).
- Actions verified:
  - `dismiss_user` → updates `user_notifications.is_read` (scoped to caller `user_id`).
  - `dismiss_admin` → requires `has_role(user, 'admin')`, updates `admin_notifications.is_read`.
  - `dismiss_gift` → marks `gift_announcements.is_read`.
- Auth: `Authorization: Bearer <jwt>` + `auth.getClaims(token)` extraction.

### 2.5 `preview-transactional-email` (100 LOC)
- Admin-only renderer for the in-app template preview UI.
- Iterates the same `TEMPLATES` registry, hydrates with `previewData`.

### 2.6 `handle-email-unsubscribe` (130 LOC)
- JSON API for `/unsubscribe` page.
- GET → validates token → returns `valid|already_used|invalid`.
- POST → marks token used, inserts into `suppressed_emails`.

### 2.7 `handle-email-suppression` (162 LOC)
- Webhook handler for Mailgun bounce/complaint events forwarded by the Lovable Email API.
- Upserts into `suppressed_emails` (append-only).

---

## 3. DB BACKBONE — `emit_notification` & `notification_emit_log`

Verified in migrations `20260502090928`, `20260508134357`, `20260424093707`, `20260424093600`, `20260429144636`, `20260501132819`.

### 3.1 `emit_notification(p_user_id uuid, p_template text, p_payload jsonb, p_idempotency_key text)`
- Single sanctioned path for all judging lifecycle notifications.
- Writes to:
  1. `user_notifications` (in-app row)
  2. `notification_emit_log` (idempotency record + `email_sent` flag)
  3. `transactional_emails` pgmq (when user prefs allow + not suppressed)
- Memory rule (Phase 1 Notification Backbone): triggers on `competition_entries`, `verification_*`, `round-publish` are the ONLY producers.

### 3.2 Templates registered (9 active)
```
notification-alert
entry-shortlisted
entry-qualified-round
entry-rejected
entry-finalist
entry-winner
round-published-summary
needs-review-submit-raw
certificate-revoked
```
+ `BrandHeader.tsx` shared component (logo from `email-assets/logo.png`, link to `https://www.50mmretina.com`).

### 3.3 Status → template map (Phase 4 backfill)
- `shortlisted_r2` → `entry-shortlisted`
- `qualified_r3` → `entry-qualified-round`
- `shortlisted_for_final` → `entry-qualified-round`
- `rejected` (R1/R2/R3) → `entry-rejected`
- `finalist` → `entry-finalist`
- `winner` / `runner_up` / `honorary` / `special_jury` → `entry-winner`
- `round_published` → `round-published-summary` (digest, one per recipient per round)
- `needs_review` → `needs-review-submit-raw`
- `certificate_revoked` → `certificate-revoked`

### 3.4 Drift / backfill RPCs
- `get_notification_drift_admin()` — finds status changes without matching emit-log row.
- `backfill_judging_notifications()` — idempotent re-emit using `notification_emit_log` UNIQUE constraint on `(user_id, template, idempotency_key)`.
- Surfaced at `/admin/notifications_health` (component `NotificationsHealthAudit`) + compact card on `/admin/health`.

---

## 4. CLIENT-SIDE NOTIFICATIONS

### 4.1 `useNotificationsQuery` (347 LOC)
- Fetches in parallel:
  - `friendships` where `addressee_id=user, status='pending'` (limit 10)
  - `gift_announcements` where `is_read=false, is_expired=false` (limit 10)
  - `user_notifications` where `is_read=false` (limit 30)
  - `admin_notifications` (only if `isAdmin`, limit 10)
- Hydrates requester / actor profiles via `profilesPublic()` + `resolveName(adminIds)` for admin masking.
- **Refetch interval**: 60 s.
- **Realtime**: subscribes via `useNotificationRealtime` to:
  - `user_notifications` INSERT
  - `friendships` INSERT/UPDATE
  - `gift_announcements` INSERT
  - `admin_notifications` INSERT (admin only)
- Cache mutations are batched through `queueCacheUpdate` (150 ms window) to coalesce realtime bursts.

### 4.2 `useNotificationPreferences` (121 LOC)
- Reads/writes `notification_preferences` row per user.
- 13 toggles total: 9 email + 4 in-app.
- Defaults: ALL true on first read (no row).
- Mutation pattern: lookup existing → insert if missing else update.

### 4.3 `NotificationSettings.tsx` (page)
- 5 sections: Account & Security (3 locked rows), Email (9 toggles), In-App (4 toggles), Sound (`useNotificationSound` localStorage flag).
- Locked-always-on rows (memory rule, Notification Prefs):
  - Support ticket replies
  - Role application decisions
  - Friend request accepted

### 4.4 Sound: `useNotificationSound`
- Plays a chime on new notification arrival; persists `soundEnabled` in localStorage.

---

## 5. TABLE INVENTORY

| Table | Purpose | Created by |
|-------|---------|-----------|
| `user_notifications` | In-app feed for end users | App migrations |
| `admin_notifications` | Admin-targeted alerts | App migrations |
| `gift_announcements` | Gift credit popups | App migrations |
| `notification_preferences` | Per-user email/in-app prefs | App migrations |
| `notification_emit_log` | Idempotency + email_sent gate | Phase 1 backbone |
| `email_send_log` | Append-only send history (`pending|sent|failed|dlq|bounced|complained`) | `setup_email_infra` |
| `email_send_state` | Single-row throughput config | `setup_email_infra` |
| `suppressed_emails` | Block list (bounces, complaints, unsubscribes) | `setup_email_infra` |
| `email_unsubscribe_tokens` | One token per email address | `setup_email_infra` |
| `auth_emails` (pgmq) | Auth email queue (HIGH priority) | `setup_email_infra` |
| `transactional_emails` (pgmq) | Lifecycle email queue | `setup_email_infra` |

---

## 6. RLS / ACCESS

- `user_notifications`: select own (`user_id = auth.uid()`); update own (read flag) — server proxy via `manage-notifications`.
- `admin_notifications`: select/update gated by `has_role(auth.uid(), 'admin')`.
- `gift_announcements`: select own; update own (`is_read`).
- `notification_preferences`: select/insert/update own.
- `notification_emit_log`, `email_send_log`, `suppressed_emails`, `email_unsubscribe_tokens`: service-role only (no client SELECT).

---

## 7. SECURITY GUARDRAILS

1. **`audit-forbidden.yml` CI** — fails build if UI imports `send-transactional-email` for judging templates.
2. **ESLint rule `no-direct-transactional-email`** (`eslint-rules/no-direct-transactional-email.js`).
3. **`src/test/notifications.spec.ts`** — locks Phase 5 architecture.
4. **`notifications-stage-key-payload.spec.ts`** — every emit must carry `stageKey` for downstream rendering.
5. **Suppression bypass = forbidden** — send fn always queries `suppressed_emails` before enqueue.

---

## 8. AUTH EMAIL TEMPLATES

`supabase/functions/_shared/email-templates/`:
- `signup.tsx`, `recovery.tsx`, `magic-link.tsx`, `email-change.tsx`, `invite.tsx`, `reauthentication.tsx`.
- All share `BrandHeader.tsx`.
- Logo: `https://isywidnfnjhtydmdfgtk.supabase.co/storage/v1/object/public/email-assets/logo.png` (verified 200/image-png 2026-05-02).
- `recovery.tsx` includes the scanner-safe `recovery_token` button referenced in Step 2D.

---

## 9. RISKS & TECH DEBT (forensic only)

| # | Finding | Evidence |
|---|---------|----------|
| R1 | `useNotificationPreferences` uses raw `as` casts on `notification_preferences` rows, indicating types are not regenerated after schema additions | `useNotificationPreferences.ts` query block returns hand-mapped fields |
| R2 | `useNotificationsQuery` hard-caps `user_notifications` to 30 unread; users with >30 will silently miss the rest in the bell dropdown until older are dismissed | Limit literal `30` in fetcher |
| R3 | `manage-notifications` uses `SUPABASE_ANON_KEY` + per-request `getClaims(token)` rather than service role — every dismissal hits Auth API | top of `index.ts` |
| R4 | Sound preference (`useNotificationSound`) lives in localStorage only, not synced across devices | confirmed in NotificationSettings render |
| R5 | `process-email-queue` JIT-render path requires JSX `deno.json` — only `auth-email-hook/deno.json` is present; if the dispatcher ever needs JSX itself, no config exists | folder scan shows only auth-email-hook has deno.json |
| R6 | Per-photo verification template hand-off relies on idempotency keys derived from event id; duplicate-event vendors (e.g., admin re-saves) could collide if key formula changes | Phase G memory entry `verification-workflow-phase-g` |
| R7 | `admin_notifications` realtime is gated client-side by `isAdmin` flag, but the channel is still opened for all users (no server-side filter) | `useNotificationsQuery` realtimeHandlers |
| R8 | `email_send_log` is append-only — every state change inserts a new row; no rollup view documented for dashboards | `setup_email_infra` contract |
| R9 | Bounce/complaint per-email status not surfaced to UI (only in `suppressed_emails`); deliverability dashboards rely on raw table reads | matches infra guide note |
| R10 | DB-trigger fan-out is the only legal email path for judging — any future feature outside that pattern must be added to triggers + templates registry, otherwise CI blocks the PR | `audit-forbidden.yml` + memory `notification-architecture` |

---

## 10. APPENDIX — TEMPLATE REGISTRY

```ts
// supabase/functions/_shared/transactional-email-templates/registry.ts
export const TEMPLATES: Record<string, TemplateEntry> = {
  'notification-alert':         notificationAlert,
  'entry-shortlisted':          entryShortlisted,
  'entry-qualified-round':      entryQualifiedRound,
  'entry-rejected':             entryRejected,
  'entry-finalist':             entryFinalist,
  'entry-winner':               entryWinner,
  'round-published-summary':    roundPublishedSummary,
  'needs-review-submit-raw':    needsReviewSubmitRaw,
  'certificate-revoked':        certificateRevoked,
}
```

---

**END STEP 2G** — next: Step 2H (DB / RLS Blueprint).
