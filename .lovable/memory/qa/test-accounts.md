---
name: QA Test Accounts
description: Admin + participant credentials for browser--* end-to-end verification on the published host
type: reference
---
# QA Test Accounts (use on https://fiftymmretinaworld.lovable.app)

**Admin (super_admin)**
- Email: `mr.neilbasu@gmail.com`
- Password: `Passw0rd@123`

**Participant / Standard User**
- Email: `sendipannita2@gmail.com`
- Password: `Passw0rd@123`

## Usage rules
- ALWAYS sign in via the published host (`fiftymmretinaworld.lovable.app`), never the `id-preview--*` host (412 auth gate).
- Use admin to reach `/admin/*` panels, judge UI, and competition admin actions.
- Use participant to verify gated views (Submission Detail, EntryCard, Profile, certificates, public competition page).
- After every code/migration/edge-fn change, run a 2-account walk: admin first (to set up / change state), then participant (to verify the gated user-facing result).
- Never paste these creds into screenshots, logs, or PR descriptions. Memory only.
