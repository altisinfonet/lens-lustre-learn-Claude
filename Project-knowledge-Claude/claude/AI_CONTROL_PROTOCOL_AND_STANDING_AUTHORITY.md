# CONTROL protocol + standing authority — 50mm Retina

**Owner instruction, 2026-08-14:** *"take all control… I won't even touch the laptop, just will give you command from phone."*

This is the private half of the protocol. The public half is `AI_CONTROL.md` in the repo.
**Anything describing an unfixed vulnerability belongs here, not there — the repo is public.**

---

## What I run without asking

Read production · `EXPLAIN` · write code, migrations, rollbacks, tests, docs · run the full gate
(`tsc -b`, `vitest`, `npm run build`, `security-audit.mjs`) · commit locally · create and use
Supabase **branches** freely · write to this project · measure anything.

## What still needs one word from the phone

**Any production write.** One per CONTROL cycle, bound to a `git hash-object`.
**Any publish to the public GitHub repo.**

## What cannot be delegated, by structure not by preference

| # | Thing | Why |
|---|---|---|
| 1 | **GitHub push authorisation** | `GH_TOKEN=proxy-injected`; the proxy injects a credential only for repos in this session's authorised set. It is a desktop-app setting. If the laptop is never touched, push stays 403 — but note **nothing in Phase 0/1 needs it**, because database work reaches production through the Supabase connector. |
| 2 | **Play Store upload** | Owner-only standing rule, and the keystore is involved. I will never do this. |
| 3 | **Publishing public content** | Irreversible and world-readable. Needs an explicit yes per batch. |
| 4 | **Destructive production operations** | `DROP TABLE`, data deletion, credential rotation. Ceiling stays regardless of authorisation. |

## Open findings — detail withheld from the public evidence file

| id | Finding | State |
|---|---|---|
| **SEC-01** | `ALTER DEFAULT PRIVILEGES` grants EXECUTE on every `public` function to `anon` and `authenticated`. Root cause of the whole population; **246** SECURITY DEFINER functions remain anon-executable after M1. Fix is M2, branch-tested. | OPEN |
| **SEC-02** | `scripts/audits/baselines/rls-authority-baseline.json` — 2026-05-12 frozen baseline holding **259 HIGH** findings (258 `SECDEF_NO_AUTH_GUARD`). No owner, no expiry. `security-audit.mjs` reports 0/0 because it is a different scanner that does not read this file. | OPEN |
| **SEC-03** | Post media is publicly readable on the CDN regardless of `posts.privacy`. Harmless today only because 100% of production posts are `privacy='public'` — verified. Becomes a real disclosure the first time a friends-only photograph is posted. Fix lands inside Phase 2. | OPEN |
| **SEC-04** | 4 advisor ERROR `security_definer_view`; 8 `function_search_path_mutable`; leaked-password protection OFF; 1 critical + 19 high npm advisories. | OPEN |
| SEC-00 | Email queue RPCs anon-executable with no auth check. | **CLOSED** — M1, version `20260814042609` |

## Do not publish to GitHub as-is

These local files describe open findings and must be redacted or withheld:
`POST_REMEDIATION_FORENSIC_AUDIT_2026-08-13.md` · `PHASE_0_DESIGN_REVIEW.md` ·
`ENGINEERING_PLAN_V2_APPROVED_ARCHITECTURE.md` · `ENGINEERING_PLAN_TO_PRODUCTION_GRADE.md` ·
`supabase/rollback/20260814042609_…_ROLLBACK.sql` (a working script to re-open SEC-00).

Safe to publish: the M1 migration itself, `.gitignore`, and the three CONTROL files.

## Session drift log — why the protocol exists

`origin/main` moved **twice** while this session was running:
`8259c5b` → `86afb8d` (Android 1.2.4 cut) → `f8c1985` (+ Create button, badges with the post).
Every audit measurement was taken against `8259c5b`. I re-verified the two workflow findings
against the newer HEAD and both still hold — but the general lesson stands: **a stale base
silently invalidates everything measured downstream of it**, which is why `git fetch` is check
#1 in `scripts/ai-control.mjs`.

## Next action

`M2_PREFLIGHT` — enumerate every client-called RPC, build the allow-list, apply the default-
privileges change **to a Supabase branch only**. No production write. Report, then wait for `GO`.
