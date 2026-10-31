# S8 — Live debt: edge-function inventory and deploy path (F-REV4-1, send-push)

**Gate (plan, verbatim):** "every live function == git; 0 missing migrations; each fix verified on live"

**State of this unit: code only.** Nothing here was deployed or applied. The
builder session had no access to the live function list; the supervisor
produces it with the workflow below.

## What git holds (measured 2026-10-28, origin/staging 1344433)

- `supabase/functions/`: **73** functions (+ `_shared`).
- `supabase/config.toml`: **25** `[functions.*]` blocks after this PR (24 + `send-push`).
  The other 48 have no pinned `verify_jwt`; a CLI deploy of one of them would
  default to `verify_jwt = true`. The deploy workflow therefore refuses any
  function without a block — pin it from the live value first.
- No workflow deployed edge functions before this PR (`grep -rn "functions deploy" .github` → nothing).

## The path: `.github/workflows/d1-deploy-functions.yml` (manual dispatch only)

1. `mode=list`, `target=staging` (from `staging`), then `target=production`
   (from `main`). Read-only. The job summary is the inventory table: slug,
   live version, live verify_jwt, config.toml verify_jwt, updated_at, in git;
   plus "live, not in git" and "in git, not live". This replaces the
   unavailable 13/17 Oct snapshot and is the evidence for "every live
   function == git".
2. For each "live, not in git" (plan: ~10): the supervisor/Owner supplies the
   live source (dashboard → Edge Functions → download). The builder does **not**
   invent it. Each lands as its own PR with its `[functions.<name>]` block.
   Old-app names are never deleted by this workflow.
3. For each "in git, live version older": `mode=deploy`, functions named
   explicitly, `confirm` repeated. Staging first, verify, then production.

## send-push

- Git: `supabase/functions/send-push/index.ts` (last change #443, iOS money-type skip).
  Auth: `x-internal-secret` (trigger path) or a JWT whose user is admin.
- Caller: `public.notify_push_on_notification` (20260731100000) posts with
  `x-internal-secret` and **no** Authorization header → live must be
  `verify_jwt = false`. Pinned in config.toml by this PR. **Check in `list`
  output that live verify_jwt is `false` before deploying**; if it is `true`,
  stop — pushes are already failing and that needs its own look.
- Deploy: `mode=deploy functions=send-push confirm=send-push`, staging then production.
- Secrets (`PUSH_INTERNAL_SECRET`, `FCM_SERVICE_ACCOUNT`, push_config row):
  Owner click list only — not in this PR.

## Owner one-time setup

`SUPABASE_ACCESS_TOKEN` (Supabase personal access token) as an **environment**
secret on GitHub environments `staging` and `production`.
