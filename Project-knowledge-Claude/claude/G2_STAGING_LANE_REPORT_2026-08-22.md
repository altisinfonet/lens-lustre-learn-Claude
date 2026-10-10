# G2 — STAGING GITHUB LANE

Verified: 2026-08-22 10:22–10:24 UTC, from the server, by this session.

# G2 = **GREEN on the git lane · AMBER overall**

Everything verifiable from here is correct. Two exit criteria remain
**unconfirmed** because they need access this session does not have. Neither is
known to be wrong; both are unread.

## Verified — independently, against the remote

| Check | Result |
|---|---|
| `staging` exists | ✅ `32930e75b1d87d361f44e4b4f90dabf9deeda3e1` |
| `staging` tree == approved baseline | ✅ `a0c3f34d724867f0a10fc768f6987e21fd4ddbfa` |
| `staging` content vs `main` | ✅ **0 files differ** |
| `main` unchanged | ✅ `32930e75b1d87d361f44e4b4f90dabf9deeda3e1` |
| `refs/heads/staging/*` namespace | ✅ empty — D/F conflict cleared |
| `tool/schema-dump` preserved | ✅ `98228232b9f3a6fb8fec3916d25e9a3c46bb3e51` |
| `tool/web-isolation-guard` preserved | ✅ `a7004b205e2760140dc5aa8ee6cf0b7fb4425c64` |
| Ref count | ✅ 100 → **101** (exactly `staging` added) |

`staging` was created from the pinned commit, so it is not merely equivalent to
the approved baseline — it **is** the approved baseline.

## Production — unchanged, with one organic movement

At 10:22:07 UTC vs the 09:42:52 UTC baseline:

| Quantity | 09:42 | 10:22 |
|---|---|---|
| `public` tables | 146 | 146 ✅ |
| vault fingerprint | `b24756b6dc7da53fe1a885b25e241ed7` | identical ✅ |
| `cron.job` | 16 | 16 ✅ |
| `storage.buckets` | 11 | 11 ✅ |
| migration ledger | 32 | 32 ✅ |
| `public.posts` | 267 | 267 ✅ |
| `site_settings.s3_storage_settings` | `2026-03-07 13:48:18`, bucket `50mm` | identical ✅ |
| **`auth.users`** | **101** | **102** ⚠ |

The user count moved. Investigated rather than assumed:

- exactly **1** user created since the baseline, at **09:48:14 UTC**
- provider **google**, email confirmed, and they have since signed in

That is a live member signing up through Google OAuth on the production site —
the same class of organic drift as posts moving 262 → 265 → 267 earlier in this
workstream. Nothing in G2 touched authentication: no auth call was made to either
project, and `staging` is a git ref that has never been built or deployed.
**Not a regression, and not caused by this gate.**

R2 unchanged: `50mm`, `50mm-staging`, `agentcrm` — 3 buckets, same as before.
Production site healthy: `50mmretina.com/manifest.json` serves `"50mm Retina World"`.

## Staging Supabase — untouched

146 tables · **0 rows across all of them** · 0 `auth.users` · 0 `site_settings`
rows. The schema baseline from Gate 2 is intact and no seed has occurred.

## Unconfirmed — the two open items

1. **No Cloudflare Pages build was triggered by the new branch.** This is a core
   G2 exit criterion and it is **unread**, not verified. The Cloudflare MCP has no
   Pages tool, and the external URL probe is useless because Access now gates
   every `*.lens-lustre-learn-claude.pages.dev` subdomain — a gated deployment and
   a nonexistent one return the identical response (proved by the `00000000`
   control in G1).
   **Required evidence:** Pages → `lens-lustre-learn-claude` → Deployments must
   still read **1558**, with no deployment whose branch is `staging`.
   Containment if it did build: Preview builds publish to a gated preview URL, not
   to production. `main` did not move and the production site is verified healthy,
   so `www` cannot have been affected either way.
2. **Branch protection rules.** The GitHub REST API returns 403 from this session
   and protection settings are not exposed over git, so these can only ever be
   **owner-attested** here. No confirmation has been received that the two rules
   were saved after the 2FA prompt.
   Intended: `main` — PR required, **0 approvals**, linear history, no bypassing,
   no status checks yet, no force push, no deletion. `staging` — no bypassing, no
   force push, no deletion, **no PR requirement**.

## Standing constraint confirmed again

Both non-browser sessions can perform **additive** git operations and cannot
perform **destructive** ones (HTTP 403 on ref deletion, no delete tool in the
GitHub MCP). The deletions in this gate were done by the browser session; the
CI-based fallback workflow was written but not needed.

## Next gate

**G3 — lane-aware CI.** Not started. `web-build.yml` and `ui-gate.yml` still use a
bare `pull_request:` with no branch filter, so a PR into `staging` would today be
built with **production** credentials. That is the first thing G3 fixes.
