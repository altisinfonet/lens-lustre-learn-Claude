# G10 — browser-verified evidence, 2026-08-26

Session: Claude Desktop (Cowork). Read-only git clone + Claude-in-Chrome bridge to the
owner's Chrome + Supabase MCP. **No push in this session.** Nothing was written, saved,
merged, deployed or deleted. The only click on a settings page was a disclosure toggle;
"Save changes" was never pressed. Every Supabase query was read-only.

Everything below was executed or read on screen IN THIS TURN. Reconciled against
`CERTIFICATE_AND_PAGINATION_WORK.md` (owner-supplied, updated 2026-08-26).

---

## 1. STATE, RE-MEASURED

| Ref | Commit | Note |
|---|---|---|
| `main` | `b671e1fb0c5bcf145d442076c229eca888afd674` | unchanged since 2026-08-25 |
| `staging` | `702e5ceb6d40b6f487cedf2378aae835bd18621f` | moved this morning |

`staging` advanced through four consecutive commits, every one titled **"Add files via
upload"**, authored `Altis Infonet Private limited <mail@altisinfonet.com>`, pushed straight
to the branch with no pull request:

```
c92d534 → b277729 → 98ff951 → 7642c28 → 702e5ce
```

`CERTIFICATE_AND_PAGINATION_WORK.md` §E explains the mechanism: the other session's `git
push` is proxy-blocked, so every file goes through the GitHub web UI. The commits are that
session's work, not a stray manual edit.

`staging` vs `main` = **98 files** — matches the record's split (2 certificate-colour files +
96 unrelated lane-isolation/SEO/CORS/storage/email files).

Production Supabase `jtdtehuqtinjxropkkcn`, latest migration **20260825115208
`certificate_custom_heading`** — all three certificate migrations applied, as recorded.

---

## 2. §17-4 CI EVIDENCE — **VERIFIED, both lanes, job level**

### Production lane — `main` @ `b671e1f` (tree `db8df567`)

| Workflow | Run ID | Run # | Status | Jobs (job-level) |
|---|---|---|---|---|
| Typecheck | `32849585803` | #1189 | **Success** (1m 6s) | `typecheck` 1m 02s |
| Web build | `32849585819` | #269 | **Success** (55s) | `build` 50s |
| UI gate | `32849585838` | #109 | **Success** (7m 46s) | `Every control reachable, nothing regressed` 7m 44s |
| Security | `32849585871` | #677 | **Success** (37s) | `This project's own security rules` 18s · `Secret scan (full history)` 7s — *No leaks detected* · `Dependency vulnerabilities (production only)` 32s |

All triggered via push, on `main`, on commit `b671e1f`. **6 jobs, 6 green** — matches the
record's "6/6 CI checks green".

### Staging lane — `staging` @ `702e5ce`

| Workflow | Run ID | Run # | Status | Jobs (job-level) |
|---|---|---|---|---|
| Typecheck | `32934607941` | #1193 | **Success** (1m 6s) | `typecheck` 1m 02s |
| Web build | `32934607922` | #273 | **Success** (43s) | `The lane resolves to exactly one of main or staging` 2s · `Production lane build` 0s (skipped, correct) · `Staging lane build` 39s |
| UI gate | `32934607909` | #113 | **Success** (7m 55s) | `Every control reachable, nothing regressed` 7m 52s |
| Security | `32934607873` | #681 | **Success** (28s) | `This project's own security rules` 9s · `Secret scan (full history)` 10s — *No leaks detected* · `Dependency vulnerabilities (production only)` 24s |

The Web build lane assertion firing correctly on staging (production job skipped) is direct
evidence for the G5b/G7 lane split on this exact tree.

### ⚠ FINDING — the unit test suite has never run in CI

Read from `origin/staging:package.json` and the workflow files this turn:

- Workflows present: `android-build`, `apply-migration`, `health`, `security`, `typecheck`,
  `ui-gate`, `web-build`. **None invokes `npm run test`.**
- `ui:gate` runs `node tools/uishot/gate.mjs` — a Playwright screenshot sweep, not vitest.
- `typecheck` runs `npx tsc --noEmit -p tsconfig.app.json` only.
- `package.json` defines `"gate": "npm run typecheck && npm run test && npm run build"` —
  **no workflow calls it.**

So the 2,345 / 2,409 passing-test figures in the project record are **local runs only**.
§17-4 states local runs are not a CI substitute. The vitest suite has never gated a merge.
This is a genuine §17-4 gap and it is not the same thing as "CI is green".

---

## 3. §17-7 / HS-12 BRANCH PROTECTION — **UPGRADED: OWNER-ATTESTED → VERIFIED**

Read at `/settings/rules/21423524`. Prior records state "no session can read the setting";
with the browser bridge this session read the ruleset page itself.

Ruleset `protect-main`, id **21423524** — Enforcement **Active**, **bypass list empty**,
Target Default → 1 target `main`.

| Rule | State |
|---|---|
| Restrict deletions | **ON** |
| Require a pull request before merging | **ON** — Required approvals **0**, dismiss-stale OFF |
| Block force pushes | **ON** |
| Restrict creations / Restrict updates | OFF |
| Require linear history / deployments / signed commits | OFF |
| **Require status checks to pass** | **OFF** |
| Code scanning / code quality / code coverage / Copilot review | OFF |

Matches the owner attestation in every respect it covered.

**New material fact: `main` has ZERO required status checks.** G10 step 2 says "wire the
workflow as a required status check" — that rule must be switched ON first. Today nothing,
including the four green workflows above, can block a merge to `main`.

---

## 4. CLOUDFLARE PAGES — **VERIFIED**

Account `a7810011a99de537a210130f86306785`. Project **`lens-lustre-learn-claude`**.

| Field | Measured |
|---|---|
| Domains | 50mmretina.com · www.50mmretina.com · lens-lustre-learn-claude.pages.dev |
| Current Production deployment | `main` @ **b671e1f** |
| Deployment URL | https://6a383d3b.lens-lustre-learn-claude.pages.dev |
| Age / status | 17 hours, green |
| Automatic deployments | enabled |
| Total deployments | 1641 |

Production untouched by today's activity — every deployment since is a `Preview` marked
"No deployment available" (skipped).

**Lane note for G7/G8:** the PRODUCTION Pages project subscribes to non-production branches
— it has preview entries for `staging`, `certificates-to-production`,
`cert-live-preview-staging` and the scratch ref `tool/pushcheck-1787718423`. Skipped today,
but the subscription exists.

**§17-9 Cloudflare deployment ID for rollback target `32930e7` — NOT YET VERIFIED.** 1641
deployments across 110 pages, no commit filter, and the page-number input would not accept a
typed jump. Still open.

---

## 5. PRODUCTION CERTIFICATES — the ⛔ STOP is RESOLVED, with one loose end

Measured read-only against production this turn:

| Metric | Value |
|---|---|
| `certificates` rows | **0** |
| `profiles` rows | 103 |
| `user_notifications` rows | 3432 |
| `db_audit_logs` rows, table `certificates`, operation `DELETE` | **25** |
| First / last such delete | 2026-07-19 08:50:27 UTC / **2026-08-25 12:58:35 UTC** |
| Distinct actors across all of them | **1** |

The other session flagged 23 deletions in 61.9 s on 2026-08-25 (12:57:33–12:58:35 UTC) by a
single `has_role(admin)` actor as an unexplained production change. Cross-read against
`CERTIFICATE_AND_PAGINATION_WORK.md` **PART C1**, that is the *intended* purge of the 23 test
certificates — the record even states production had zero competitions, so 16 of them pointed
at competitions that no longer existed. The record's C1 status ("still in production, waiting
on you") is simply **stale**; the purge was carried out through the admin screen, at the pace
of clicking, before the record was last updated.

**Loose end — step 2 of the purge was not run.** C1 warns that the `audit_certificates`
trigger writes a full JSON copy of every deleted row, so a plain `DELETE` leaves *more* data
behind than it removes. There are now **25** `DELETE` audit rows carrying complete
`old_data` copies of the deleted certificates. `PRODUCTION_CERTIFICATE_PURGE.sql`'s second
step, which clears them, has not been executed. The certificates are gone from the table and
still fully reconstructable from `db_audit_logs`.

This still needs the owner's word before it is treated as closed — it is a production data
deletion and no session should mark it authorised on inference alone.

---

## 6. STEPS 1 AND 2 — STILL NOT IN THE REPOSITORY

Searched every remote branch (120+), not just main and staging:

| Expected file | Branches containing it |
|---|---|
| `supabase/rollback/*certificate*` | **0** |
| `supabase/rollback/*custom_heading*` | **0** |
| `scripts/verify-schema-dependencies.mjs` | **0** |
| `scripts/test-schema-dependencies.mjs` | **0** |
| `.github/workflows/verify-schema-dependencies.yml` | **0** |

`supabase/rollback/` on staging holds 30 files, newest `20260824`. The schema-guard harness
was proven 41/41 by the push session but the files were never committed.

---

## 7. WHAT REMAINS FOR G10, AND WHO CAN DO IT

**Needs the push-enabled cloud session:**

1. Step 1 — commit the 3 certificate rollback SQL files to `supabase/rollback/` via PR into
   staging. Must re-fetch first: its base moved to `702e5ce`.
2. Step 2 — commit the 3 schema-guard files via PR into staging.
3. Step 3 — §5.3 secret-isolation negative test, fresh. **Known constraint: that session
   cannot delete branches (HTTP 403 through its git proxy), so the "delete the throwaway
   branch" clause will need the owner or this session.**

**Can be done here (browser / read-only / Supabase):**

4. §17-4 CI evidence — **DONE, §2 above.**
5. §17-7 branch protection — **DONE and upgraded to VERIFIED, §3 above.**
6. §17-9 Cloudflare deployment ID — in progress, §4.
7. §10 Release Candidate record for PR #101 — writable from the evidence now held.
8. §17 twelve-line checklist re-run.

**Needs the owner:**

- Confirm the 23-certificate purge (§5).
- Decide on turning "Require status checks to pass" ON for `main` (§3) — prerequisite for
  step 2's required-check wiring.
- Delete the scratch ref `tool/pushcheck-1787718423`.
- `C2` build marker `__APP_BUILD` still reads `2026-08-20-2`.
- The Pages build command question in the record's B2 — if production's Cloudflare build
  command is bare `vite build` rather than `npm run build`, the generated `_headers` ships
  the literal `https://__CDN_HOST__` and every CDN image is blocked site-wide. **This session
  can read that setting in the Cloudflare dashboard.**
