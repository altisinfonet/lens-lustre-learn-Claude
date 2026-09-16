# G10 PHASE 1 — CLOSED. ALL FOUR OWNER DECISIONS RECORDED

**2026-08-26. Owner approval given in session ("ok", 2026-08-26).**

---

## Decision 1.1 — HS-10 · control C5

| Field | Entry |
|---|---|
| a · Rotation occurred | **YES** — 2026-08-26, twice |
| b · Secret classes | **Supabase personal access token** · **Brevo API key** |
| c · Timestamp | 2026-08-26 |
| d · Old credential invalid | `50mmretinamigration` — **VERIFIED** absent from a rendered token list. `owner-cli-2026-08` — **OWNER-ATTESTED** revoked and replaced under the same name |
| e · Replacement value in repo/logs/CI/artefacts | **NO** — VERIFIED across working tree and 400 commits of history; zero matches for PAT, secret-key or Brevo key patterns; no `.env`/key files tracked |

### Owner declaration — Brevo key · **ACCEPTED**

> ACCEPTED — the only disclosure is a 9-character prefix, of which 8 are the public vendor constant
> `xkeysib-`, so roughly one character of secret material plus the key length. Not a value disclosure.
> No rotation. The two code sites — `process-email-queue` v27 (logs, every invocation) and
> `verify-email-provider` v22 (HTTP response, failure paths only) — are fixed in the G9 release, which
> must redeploy those functions anyway.

### Owner declaration — the two remaining chat occasions · **CANNOT BE IDENTIFIED**

> CANNOT BE IDENTIFIED. Not recoverable from code or project records: the 71-function scan enumerated
> the code-borne exposure surface completely (2 findings) and neither is a chat paste. Residual risk
> accepted.

### Fourth occurrence — recorded

A screenshot of Supabase's token-generation banner exposed a live token value during this session.
Detected in the same turn, never repeated or recorded anywhere, revoked within minutes, `Never used`
throughout. Cause recorded as a design trap; control is to close the banner before capturing.

**§17-3 — no §14 hard stop live: HS-10 CLOSED.**

---

## Decision 1.2 — Staging email policy · **OPTION 1**

Staging sends no email. **§15 email row VERIFIED** — both credential sources measured empty (staging
`site_settings` 0 rows; `BREVO_API_KEY` absent from staging's four custom secrets), and three of four
email functions have no send path under any credential state.

## Decision 1.3 — G9 / production CORS · **EXCLUDED**

Owner-directed. §14 ruling recorded with four named residual risks. **Phase 10 does not run; step 4.11
is NOT APPLICABLE.** No production edge function is redeployed during G10.

## Decision 1.4 — Schema-guard mechanism · **A2**

Required on PRs targeting `main`, bound to `production`. No staging binding, no new secret.
`workflow_dispatch` preserved. Implementation prepared and validated; **`Require status checks to pass`
is enabled only after promotion.**

---

## Step 0.0 inventory — corrected from measurement

Three proposed changes were **disproved** by Phase 0/1 measurement:

| Surface | Originally proposed | Measured reality |
|---|---|---|
| 10 · GitHub environments/secrets | change (HS-10 rotation) | **NO CHANGE** — the PAT is not stored in GitHub; the Brevo key is not either |
| 4 · Edge functions | change (if G9 included) | **NO CHANGE** — G9 excluded |
| 6 · Supabase database | possible change | **NO CHANGE** — rotating a PAT does not touch the database |
| 9 · GitHub rulesets | change (A2) | **CHANGES — but AFTER promotion**, not during the release window |
| 8 · Zero Trust | not expected to change | **NOT APPLICABLE** — Cloudflare One is not provisioned |
| 1 · git `main` | expected | **EXPECTED** — promotion merge, plus step 4.3's CI change before the freeze |

---

## Phase 2 readiness — verified 2026-08-26 13:37 UTC

| Check | Result |
|---|---|
| Lanes re-measured | `main` `b671e1f` / `staging` `702e5ce` — **unmoved**, freeze holding |
| PR #102 merges into staging | **CLEAN — no conflicts.** 9 files: 8 added, 1 modified |
| Schema-dependency harness on the merged tree | **41/41** |
| Isolation mutation harness on the merged tree | **21/21** |
| `send-gift-credit/index.ts` vs deployed production | **BYTE-IDENTICAL** (md5 `43218ab…`) |

**The last row matters:** merging PR #102 closes the most serious drift case. It was the one where
redeploying from the repo would have reintroduced the >50-user pagination defect into production.
After Phase 2, drift falls from 29 functions to 28 and the "production ahead of repo" class from 3 to 2.

---

## Session capability — measured, not assumed

| Capability | Result |
|---|---|
| `git push` to this repo | **REFUSED** — git proxy 403, repo not in the session's authorized set |
| `gh` CLI | **NOT INSTALLED** |
| GitHub via browser | **AVAILABLE** (owner-authenticated) |

Any repository write must therefore go through the browser.

---

*All four Phase 1 decisions are recorded. Phase 2 may begin.*
