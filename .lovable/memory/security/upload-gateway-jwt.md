---
name: Upload Gateway JWT Pinning
description: s3-presign-upload MUST keep verify_jwt=false in config.toml + client must auto-refresh on 401/403 — depth-level guard against the "Edge Function returned a non-2xx status code" upload outage
type: constraint
---

## Rule

`supabase/config.toml` MUST contain an explicit `[functions.s3-presign-upload]` block with `verify_jwt = false`. The function authenticates the user in its own code (`req.headers.authorization` → `supabase.auth.getUser()`), so platform-level JWT verification is redundant **and dangerous** here.

## Why (root cause that already burned us once)

1. Browsers can hold a stale `session_id` (e.g. `session_not_found` / `403` on `/auth/v1/user`) — anytime the project's signing keys rotate, refresh-token chain breaks, or a tab sleeps past `exp`.
2. With `verify_jwt = true` (the platform default) the **gateway** rejects the request with `401` **before** the function runs — no logs, only `booted`/`shutdown` events, only "Edge Function returned a non-2xx status code" in the toast.
3. EVERY image upload across the whole site (competition entries, profile, journal, support attachments) flows through `s3-presign-upload` → silent total upload outage.

Removing the config block re-introduces the outage instantly. Treat the block + comment as load-bearing.

## Companion client guard

`src/lib/s3Upload.ts → invokePresignWithRetry`:
- On 401/403/`unauthorized|jwt|session` error: call `supabase.auth.refreshSession()` once and retry.
- If still failing after refresh: `supabase.auth.signOut()` + throw a clear "Your session expired" message so the user re-logs in cleanly instead of every upload looping.

Do not weaken either half. The config pin alone won't help if the browser truly has no token; the client refresh alone won't help if the gateway pre-rejects.

## How to verify after any config.toml edit

```
grep -n "s3-presign-upload" supabase/config.toml
```
Must show both the comment and `verify_jwt = false`. If missing → restore from this memory.
