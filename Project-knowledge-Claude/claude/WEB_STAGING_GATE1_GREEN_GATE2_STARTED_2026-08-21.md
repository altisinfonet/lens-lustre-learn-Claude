# WEB STAGING — GATE 1 GREEN · GATE 2 STARTED (2026-08-21)

## GATE 1 = GREEN. Evidence.
| Condition | Evidence |
|---|---|
| PR #87 merged | `main` = **32930e75b1d87d361f44e4b4f90dabf9deeda3e1** (was c737de9) |
| Merge carried the audited content exactly | merge tree `a0c3f34d724867f0a10fc768f6987e21fd4ddbfa` == branch tree; verified from an independent session |
| `.env` removed from repo | `git cat-file -e origin/main:.env` → ABSENT ✅ |
| Guard + allowlist present on main | `scripts/verify-bundle-isolation.mjs` ✅ · `.gitleaks.toml` ✅ |
| All 6 GitHub Actions checks | GREEN on a7004b2 (web-build, ui-gate, typecheck, secret scan, security rules, dep vulns) |
| Cloudflare Pages production deploy | **SUCCESS** — deployment `19064989-ebd8-43e9-85d5-51464c31d126`, branch main, commit 32930e7, 1m25s, 2026-08-22 00:40 IST |
| Isolation guard live in the production pipeline | build log: `ISOLATION-GUARD PASS: expected <ref> present; forbidden [] absent; 264 assets scanned` — printed BEFORE publish |
| Production site healthy | www.50mmretina.com loads normally post-deploy |
| Pages env config | 3 VITE_* vars set in **Production and Preview**, byte-verified; build command = `npm run build && node scripts/verify-bundle-isolation.mjs` |

Notes recorded honestly:
- My local rebuild of merged main produced **263** assets vs the deploy's **264**; cause: sandbox lacked optional `svgo` and ran Node 22 vs Pages' Node 20. My asset-hash probe was therefore blind (404) — the deploy was fine. Not a defect; recorded so nobody re-derives it.
- ⚠ **Open item (by design, closes in Gate 2):** the production build's `ISOLATION_FORBIDDEN_REFS` is EMPTY, so the guard's leak-check (R3) is not exercising — only R2 (expected-ref present) is. Correct value could not exist until the staging ref existed. **Now it does — see Gate 2 action list.**

## GATE 2 — infrastructure created this session
| Resource | Identity | Cost |
|---|---|---|
| Staging Supabase project | **`ztzutckwdhetphwghuzj`** — "50mmretinaworld-staging", ap-northeast-2 (same region as prod), ACTIVE_HEALTHY, created 2026-08-21T15:38:26Z | ₹0 (Free plan slot 2 of 2; cost API confirmed amount=0 before creation) |
| Staging R2 bucket | **`50mm-staging`**, Standard, jurisdiction default, created 2026-08-21T19:22:35Z (location hint ENAM) | ₹0 (within free tier) |
| Staging publishable key | `sb_publishable_AFKN8ydZF8xNqqw2pqRljQ_OU1TNHCs` (also legacy anon JWT available) | — |

### Isolation proof at creation (measured, not asserted)
- Staging DB: `public_tables = 0`, `supabase_migrations` schema **absent**, `auth.users = 0` → a genuinely empty, separate instance. No production data was copied.
- Production DB untouched by any of this: posts 262 / media_objects 273 / post_media 270, newest post 2026-08-21 18:23 UTC — **live member activity, not our writes** (counts moved organically since the morning snapshot; the write path is producing media rows for real members, which is a healthy Phase-2 signal).

## NEXT ACTIONS (Gate 2 continuation)
1. **Production Pages env — one addition (owner, 30 seconds):** set `ISOLATION_FORBIDDEN_REFS = ztzutckwdhetphwghuzj` in the **Production** environment of `lens-lustre-learn-claude`. That switches the guard's leak-check on for production builds. (Staging project gets the inverse: `ISOLATION_FORBIDDEN_REFS = jtdtehuqtinjxropkkcn`.)
2. **Schema baseline (owner-run command or authorized session):** `supabase db dump --schema-only` from production → apply to staging → baseline the staging ledger. NEVER migration replay (C5/C6).
3. **Pages staging project** `50mm-staging` (owner/panel): repo, production branch = `develop`, the four env vars (staging URL/key/ref + forbidden=prod ref), build command with guard, domain `staging.50mmretina.com`.
4. Then: edge functions → staging ref, synthetic seed, full isolation verification battery, owner test drive.

Standing constraints held: no production data/infra modified, no Phase 1–5 work, no Judging Panel work, nothing promoted to production beyond the approved isolation change.
