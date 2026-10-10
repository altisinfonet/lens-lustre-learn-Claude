# G10 PHASE 1 — EVIDENCE FOR THE FOUR OWNER DECISIONS

**2026-08-26. Read-only throughout. Nothing deployed, merged, configured or rotated.**
No owner decision is recorded. This document is the evidence they require.

---

# 1 — HS-10: THE EXPOSED SECRET CLASS

## Identified class

**Supabase personal access token** — the account-level management/CLI token class (`sbp_`-prefixed).
No value, fragment or hash is recorded here, and none was reproduced anywhere in this session.

**Evidence — two independent project records agree:**

1. `PROJECT_MASTER_RECORD.md` §9: *"This has happened during the G-programme; rotation of at least one
   Supabase access token was requested and is **not confirmed complete**."*
2. `G10_STAGING_VERIFICATION_AND_17_CHECKLIST_2026-08-25.md` §17-3: records that secret values were
   pasted into chat on three occasions and that rotation of a specifically-named `sbp_`-class token is
   not confirmed.

## ⚠ The identification is PARTIAL, and that matters

The record says **three occasions**. It conclusively identifies the class of **one**. It does **not**
state that all three involved the same secret, and no evidence in the project resolves the other two.

**C5 field (b) — "which secret class was affected" — therefore cannot be answered completely.**
Reporting "Supabase personal access token" as the whole answer would be an inference across the other
two occurrences. Marked **PARTIALLY IDENTIFIED**, not UNKNOWN and not resolved.

## 🔴 CORRECTION — rotating this token changes NO surface in the step 0.0 inventory

The proposed inventory change *"HS-10 ROTATED → surface 10 expected to change"* **does not hold** for
this secret class. Measured today:

- GitHub environment secrets: **`SUPABASE_DB_URL`** (environment `production`) — that is all.
- GitHub repository secrets: **4 Android keystore secrets** — that is all.
- **No Supabase personal access token is stored in GitHub at all.**
- **No workflow deploys edge functions.** `grep` across `.github/workflows/` for `SUPABASE_ACCESS_TOKEN`,
  `supabase login`, `functions deploy` returns **nothing**. The seven workflows are `android-build`,
  `apply-migration`, `health`, `security`, `typecheck`, `ui-gate`, `web-build`.

A Supabase PAT lives with the owner (CLI/dashboard login) and in MCP connector configuration. Rotating
it therefore changes **surface 10: NO**, **surface 6: NO** — the database itself is untouched — and no
other listed surface.

**What it does affect:** the owner's Supabase CLI/dashboard access, and **this session's Supabase MCP
connectivity**, which may stop working the moment the token is rotated. Expect that and plan for it.

## What depends on rotation — and the coupling nobody has named

Because **no CI path deploys edge functions**, any edge-function deployment is a manual operation
performed with a Supabase access token.

> **Therefore decision 3 (G9 INCLUDED) is downstream of decision 1.** Redeploying production edge
> functions requires exactly the credential class that is exposed and pending rotation. If G9 were
> INCLUDED, the fleet redeploy would be performed with a compromised-and-unrotated token, or would
> have to wait for rotation. This coupling is not recorded anywhere in the plan or the runbook.

**Steps that depend on rotation:** Phase 10 (edge-function redeploy, only if G9 INCLUDED); step 4.11
(inventory by reading deployed sources); any CLI-driven migration application. **§17-3 gates the entire
twelve-line checklist and fails until C5 is complete.**

---

# 2 — G9: THE 71-FUNCTION DEPLOYED-VS-REPO DRIFT INVENTORY

**Method.** Every one of the 71 production functions was fetched with the Management API
(`get_edge_function`, project `jtdtehuqtinjxropkkcn`) and each returned file compared **byte-for-byte
by checksum** — never by eye — against the candidate tree exported from `staging` @ `702e5ce`
(`supabase/functions/`). Six parallel readers; no function body was carried into the main record.
Nothing was deployed and nothing was modified. **No unavailable source was ever scored as a match.**

Per instruction, the already-proven pre-G9 CORS fact was **not** re-litigated. It was, however,
independently corroborated as a by-product: deployed `_shared/secureHeaders.ts` is **byte-identical
across every function that bundles it**, md5 `58b9f45d5200a9b19f1b24011dfc3511`, versus the repo's
`9e89d6fa8d9219c7ebda4657e8c5b6e1`, and differs in exactly the known pre-G9 way and nothing else.

## Result

| Classification | Count |
|---|---|
| **MATCH** — byte-identical, nothing differs at all | **21** |
| **KNOWN_PREG9_ONLY** — only `_shared/secureHeaders.ts` differs | **21** |
| **DRIFT** — something other than secureHeaders differs | **29** |
| **UNKNOWN** — could not be compared reliably | **0** |
| | **71** |

**42 clean · 29 drifted · 0 unknown.** Two further repo functions — `backfill-media-objects` and
`media-verify-upload` — exist in the repo and are **not deployed to production**. No deployed function
is missing from the repo.

## The 29 drifted functions, by why

### 🔴 CLASS A — production is AHEAD of the repo. Redeploying would REGRESS production. (3)

| Function | v | What redeploy would destroy |
|---|---|---|
| **`send-gift-credit`** | 23 | Deployed uses the indexed RPCs `admin_lookup_user_id_by_email` / `admin_emails_for_user_ids`. **Both `main` and `staging` still contain the paginated `auth.admin.listUsers()` — the bug that breaks past 50 users.** Only PR #102 has the fix. Redeploying from the current candidate would **reintroduce the defect into production**. |
| **`detect-ai-image`** | 24 | Deployed carries an `AI_DETECTION_AI_KEY` fallback in the key chain. The repo has no such fallback. Redeploy removes it. |
| **`analyze-gallery-image`** | 24 | Deployed carries an `IMAGE_ANALYSIS_AI_KEY` fallback ahead of `AI_API_KEY`. The repo has neither. Redeploy removes it. |

This class alone disproves the premise that the repository is the source of truth for deployed state.

### CLASS B — deployed lacks the G9 storage-lane assertion (10)

`s3-delete` · `s3-presign-upload` · `s3-signed-url` · `s3-upload` · `migrate-storage` ·
`hard-delete-competition` · `purge-s3-orphans` · `detect-orphan-files` · `backfill-image-dims` ·
`media-register-upload`

The repo imports `assertStorageLane` from `_shared/s3.ts` and calls it before any request is signed.
The deployed bundles contain **no reference to it**, and in several cases `_shared/s3.ts` is absent
from the bundle entirely (deployed 7.6–7.8 KB versus the repo's 15.4 KB). **Production signs and issues
S3/R2 list and batch-delete calls with no storage-lane guard.** This is a live gap in its own right,
separate from CORS, and it is not currently recorded as a finding anywhere.

### CLASS C — deployed predates the lane-config / email-template work (8)

`seo-route-metadata` · `sitemap` · `seo-crawler-verify` · `send-transactional-email` ·
`process-email-queue` · `preview-transactional-email` · `create-payment-session` · `auth-email-hook`

Deployed copies hardcode production origins and do not contain `_shared/laneConfig.ts`; the repo
imports `siteOrigin()` / `siteUrl()`. Sixteen to seventeen template files differ on the three email
functions. **This independently confirms §8.8's "seventeen transactional email templates hardcode the
production origin" as a live production fact, not just a repository observation.**

### CLASS D — comment or cosmetic only, no behavioural difference (4)

`delete-user` · `delete-my-account` · `send-reengagement-emails` · `backfill-thumbnails`

### CLASS E — deployed is an older build of the file (4)

`measure-post-media` · `migrate-post-media` · `ask-anything` · (with `media-register-upload` also in B)

`ask-anything`'s deployed system prompt still says "Photo of the Day" and hardcodes the site address
where the repo says "The Curated Wall". `_shared/imageDims.ts` is deployed in **three different
versions** across three functions, none matching the repo — there is no single deployed source of truth
for that shared module.

### 🔴 CLASS F — a live production CORS defect the secureHeaders story does not cover (1)

**`submit-judge-decision`** v23 — the deployed copy does not use `secureHeaders` at all. It answers
with `Access-Control-Allow-Origin: "*"` from a local `corsHeaders` object. The repo version imports
`_shared/secureHeaders.ts`, and its own comment says this is what was fixed. **Production currently
serves a wildcard CORS origin from this function** — which is worse than the pre-G9 prefix-matching
issue and is not fixed by shipping `secureHeaders.ts` alone.

### Also recorded, not folded away

`process-email-queue`'s deployed `index.ts` contains **genuine double-encoded UTF-8** (`C3 A2 C2 80 C2 94`
where the repo has `—`), verified as real deployed content rather than a transport artefact because
other files in the same response round-tripped em-dashes byte-identically.

`deno.json` is present in the repo but absent from the deployed `files` array for several functions.
Whether the API omits config files or they are genuinely absent **could not be determined** and is
reported as such rather than assumed either way.

---

## Function-level rollback: does one exist?

**No credible function-level rollback mechanism exists today.** Three findings, none of them inferred:

1. **No version-restore capability is exposed.** `get_edge_function` returns only the *current*
   version's files. The available Supabase toolset offers deploy, not restore, and a documentation
   search for rollback / previous-version / version-history returned **no matching text**. (Absence in
   a doc excerpt is weak evidence on its own — what is *not* weak is that no tool available here can
   retrieve or redeploy a prior version.)
2. **The repository cannot serve as the restore source.** It does not match deployed state for **29 of
   71** functions, and for **3** of those the repo is actively *worse* than production.
3. **There is no deployment pipeline to roll back.** No workflow deploys functions; deployment is a
   manual, credentialled operation.

> **Consequence:** the currently-deployed source is the **only existing copy** of production's actual
> function state. It exists nowhere in version control. Any redeploy is therefore **irreversible in
> practice** unless that state is captured first.
>
> **A snapshot of all 71 deployed function bundles is a hard prerequisite for any redeploy, and is the
> only artefact that could function as a rollback.** It does not exist as a durable artefact today.

---

## G9 redeploy verdict

# G9 redeploy verdict: **NOT SAFE**

**A blanket all-71 redeploy is not supportable.** The functions that prevent a SAFE verdict:

**Blocking, because redeploy causes active regression:**
`send-gift-credit` · `detect-ai-image` · `analyze-gallery-image`

**Blocking, because there is no rollback if any of the other 26 behaves unexpectedly:**
the full Class B (10), Class C (8), Class E (4) and Class F (1) sets — 29 drifted functions in total,
none of which has a restore path.

**Recommendation: G9 should be a separate fast-follow release, not INCLUDED in G10.** It needs its own
freeze, its own RC, a per-function rollback plan built on a captured deployed-state snapshot, and
per-function review of the 29 drift cases — three of which must be resolved in the *opposite* direction
from the rest. Bundling that with a certificates-and-pagination promotion means a fault after
promotion cannot be attributed, and the §17-9 rollback target (a **Pages deployment ID**) does not
restore edge functions at all.

This is not "defer the defect". It is: the fix needs a release shaped to carry it, and the drift
inventory has just shown this one is not.

---

# 3 — STAGING EMAIL (decision 2 remains OPTION 1): what would actually prove it

**Measured today:** the staging project `ztzutckwdhetphwghuzj` has **~74 edge functions deployed and
ACTIVE**, including every email path — `send-transactional-email`, `process-email-queue`,
`send-reengagement-emails`, `auth-email-hook`, `preview-transactional-email`, `handle-email-suppression`,
`handle-email-unsubscribe`, `brevo-webhook`, `test-smtp`, `diagnose-brevo-key`.

**So the strongest available form of the evidence is not available.** "Staging cannot send email"
cannot rest on the functions being absent — they are present, active, and invocable.

That leaves the missing provider credential as the only standing basis, which is **exactly the
inference the decision forbids**. A missing secret proves a secret is missing; it does not prove the
code fails closed rather than falling back to another transport, another key name, or a default.

### The evidence §15 requires, and none of it exists yet

| # | Required | Status |
|---|---|---|
| 1 | The deployed staging source of each email-sending function requires the provider secret and **fails closed** without it — read from the deployed bundle, not the repo | **NOT DONE** |
| 2 | The provider secret is genuinely unset on the staging function-secrets store | **NOT DONE** |
| 3 | **A negative functional test**: invoke the staging email path and observe it fail, recording the timestamp and the literal response | **NOT DONE** |
| 4 | No message actually arrives — inspection of the provider's staging send log, or its absence | **NOT DONE** |

Items 1 and 2 together are still an inference. **Item 3 is what converts it into evidence.**
`test-smtp` and `diagnose-brevo-key` are deployed on staging and are purpose-built for exactly this.

**I did not invoke them** — that is a staging action, and the standing instruction is no staging writes.
Invoking a diagnostic is the smallest possible action that closes this, and it needs your go-ahead.

---

# 4 — SCHEMA GUARD A2: the ordering, and the self-block trap confirmed

**Where the workflow is now:** `verify-schema-dependencies.yml` exists **only on PR #102's branch**
(`7b9d707`). It is **absent from both `main` and `staging`**.

**The trap, confirmed by reading the file.** The workflow sets `environment: ${{ inputs.target }}` and
reads `SUPABASE_DB_URL` from that environment. `inputs.*` is populated **only on `workflow_dispatch`**.
Add a `pull_request` trigger without rewriting that expression and, on every PR, `inputs.target`
resolves empty → no environment binds → the secret resolves empty → the workflow's own credential
assertion fires:

> `::error::SUPABASE_DB_URL is not set on the '' environment.` → exit 1

**It fails closed rather than checking the wrong database — the design is sound.** But if that check
were *required*, **every pull request would be permanently unmergeable, including the G10 promotion PR.**

### The correct A2 ordering — enable the requirement LAST, after promotion

| # | Step | Why this position |
|---|---|---|
| 1 | Rewrite so `pull_request` binds `production` explicitly, not via `inputs`. Restrict to `on: pull_request: branches: [main]`. **Keep `workflow_dispatch` with its choice input.** | Without this the check can never pass on a PR |
| 2 | Merge to `staging` (Phase 2, step 2.2) | The candidate carries it |
| 3 | Promote to `main` (Phase 8) — **still not required** | A workflow is not registered as a check until it exists on the default branch |
| 4 | **Observe one real run reporting on a `main`-targeted PR** | Never require a check you have not watched report |
| 5 | **Only then** enable `Require status checks to pass` in ruleset 21423524 and select it | This is the surface-9 change |

⚠ **`Require status checks to pass` must NOT be enabled before step 5.** Doing it earlier blocks the
promotion PR the release depends on.

**A consequence worth deciding deliberately:** because the surface-9 change now happens **after**
promotion, it is arguably a post-release action rather than part of this release. Either flip surface 9
to EXPECTED and note it lands after the promotion merge, or record it as a separate follow-up outside
this release's ledger. **The one thing that must not happen is leaving it marked NOT-EXPECTED while
doing it inside the release window** — step 9.5 would correctly report an unexpected change.

Prerequisites verified: `.node-version` (22.22.2) is present on both `staging` and the PR branch, and
the guard's harness and script are in PR #102.

---

# DECISION READINESS REPORT

| Decision | Status | What is missing |
|---|---|---|
| **1 · HS-10** | 🔴 **NOT READY** | Class of **one** occurrence identified (Supabase personal access token). The record cites **three** occasions and does not identify the other two — C5 field (b) is incomplete. Fields (a), (c), (d), (e) require an owner rotation that **has not occurred** and that I cannot perform. |
| **2 · Staging email** | 🔴 **NOT READY** | Policy choice is settled (OPTION 1) and retained unrecorded. The **evidence** is missing: staging's email functions are deployed and ACTIVE, so absence proves nothing, and no negative functional test has been run. Needs your go-ahead to invoke a staging diagnostic. |
| **3 · G9 CORS** | 🟢 **READY** | Evidence complete, 0 UNKNOWN. **Verdict: all-71 redeploy NOT SAFE.** Recommendation: fast-follow release, not INCLUDED. Your ruling still required. |
| **4 · Schema guard** | 🟢 **READY** | A2 is workable. Exact ordering established; the self-block trap is confirmed and avoidable by enabling the requirement only after promotion. |

**Two of four are ready. Neither of the two that are not can be closed by me** — one needs an owner
rotation, the other needs permission to run one staging diagnostic.

*Read-only throughout: no deploy, no merge, no secret change, no production or staging write.
No secret value, fragment or hash was displayed or recorded.*
