# G10 — REV 2.2 CORRECTION ADDENDUM + PHASE 1 OWNER DECISION SHEET

**2026-08-26.** Runbook `G10_COMPLETION_RUNBOOK_REV2_2026-08-26.docx` is now **Revision 2.2**.
No production, staging or repository write has been made. Nothing is merged, deployed or configured.

---

# PART 1 — VISIBLE CORRECTION RECORD (Rev 2.2)

Two corrections, both produced by Phase 0 measurement, both recorded rather than silently patched.

## Correction 1 — Decision 1.4 rewritten as A1 / A2 / B

**Cause.** Step 0.7 measured that the `staging` GitHub environment holds **zero secrets**;
`SUPABASE_DB_URL` exists **only** in the `production` environment.

**Defect.** The original option (A) — derive target from `github.base_ref`, `main→production`,
`staging→staging` — binds staging-targeted PRs to environment `staging`, where the credential does not
exist. The secret resolves empty and the guard inspects nothing while still reporting a status. That
is the same mechanism §5.3 used as *proof of isolation*; here it would be a **silently useless gate**.

**Fix.** Decision 1.4 now offers **A1 / A2 / B** (full wording in Part 2 below).

## Correction 2 — Step 2.2 was stale and is now branch-mapped

**Cause.** Decision 1.4 became three-way but Phase 2 still read *"If decision 1.4 chose (A)…"*, which
no longer corresponds to any available choice.

**Fix.** Step 2.2 now maps explicitly to each branch. `workflow_dispatch` is **preserved in A1 and A2**
and is never removed.

| Branch | Step 2.2 action |
|---|---|
| **A1** | Amend `verify-schema-dependencies.yml` — add `pull_request`, derive target from `github.base_ref` (`main→production`, `staging→staging`), default `source_dir` to `src`, **KEEP `workflow_dispatch`**. The staging binding only works once the owner has added `SUPABASE_DB_URL` to the `staging` environment — **confirm that secret exists BEFORE committing this variant**. |
| **A2** | Amend the file — add `pull_request` **restricted to PRs targeting `main` only**, bind to environment `production`, default `source_dir` to `src`, **KEEP `workflow_dispatch`**. Create **no** staging database binding and add **no** staging secret. |
| **B** | Make **no change** to the workflow file. It stays `workflow_dispatch`-only and becomes a mandatory §12.4 procedural step. |

**Pass criterion, A1/A2:** the amended file is on staging, its YAML parses, the trigger set matches the
chosen variant, and `workflow_dispatch` is still present. It is **not** made a required check at this
step — that requires enabling `Require status checks to pass` in ruleset 21423524, a separate
**surface-9** change made only after the owner has flipped that row of the step 0.0 inventory.
**A1 additionally:** the staging environment secret is confirmed present first, and that secret write
is entered in the Change Ledger as a **surface-10** change.
**B:** recorded as NOT APPLICABLE, with the reason no workflow change was made.

**No other runbook language was modified.** The cover line now reads
*"Revision 2.2 · decision 1.4 and step 2.2 corrected from Phase 0 measurement"*.

### Still-open correction, not yet applied

Step 0.2 asks for "the apex→www redirect status code". Phase 0 established that **no such redirect
exists** (apex is a proxied CNAME to the same Pages project; `redirectCount = 0`; identical
`robots.txt` sha256 from both hostnames). The step should ask for *apex behaviour*. Left unapplied so
the correction stays visible and is not bundled into an unrelated edit.

---

# PART 2 — PHASE 1 OWNER DECISION SHEET

Four decisions. Each must be **written, dated, and recorded in the project**. Nothing in Phase 2 may
start until all four exist. Three of them change what gets committed; one is a live hard stop.

---

## DECISION 1 — HS-10 rotation proof · control C5

**Status: this is the only LIVE hard stop. §17-3 fails until it is answered, and §17-3 gates the
entire twelve-line checklist.**

The project record states secret values reached chat on three occasions and that rotation of the
affected token is not confirmed. **A yes/no answer does not close this.** The ruling must carry all
five fields:

| | Field | What is required |
|---|---|---|
| a | Did rotation occur? | yes / no |
| b | Which secret class was affected? | name the class, never the value |
| c | Rotation completion timestamp | UTC |
| d | Is the OLD credential invalid or revoked? | **tested, not assumed** — say how it was tested |
| e | Does any replacement value appear in the repository, logs, CI output, screenshots or release artefacts? | must be **no**, with the check described |

**Two admissible outcomes:**
- **ROTATED** — all five fields answered.
- **ACCEPTED** — an explicit written acceptance of the residual risk, with the same five fields
  answered as far as they can be.

⚠️ **Never record the secret value, a fragment of it, or a hash of it.**

**Surface impact:** if the ruling is that rotation is required, **surface 10 (GitHub environments and
secrets) changes** and must be flipped to EXPECTED in the step 0.0 inventory before Phase 2.

---

## DECISION 2 — Staging email policy · §8.8

Choose the policy for how the staging lane handles outbound email, and record it.

**The choice must be made by you** — the plan's §8.8 defines the available options and this session
has not read that section's option list in this turn, so listing them here would be inference rather
than evidence. State the §8.8 option you are selecting, by its designation in the plan.

**What it unblocks:** the Email-behaviour row of the §15 QA matrix (step 5.2), and therefore **§17-1**.

**Surface impact:** none of surfaces 9 or 10, unless the chosen policy requires a new credential.

---

## DECISION 3 — G9 / production CORS scope · control C4

§7 places G9 upstream of QA, RC and G10, and G9 is currently BLOCKED. This may **not** be deferred as
"G10 scope or follow-up?". Rule one of exactly two ways, in writing, **before the RC is created**.

**What Phase 0 established, so this is decided on evidence:**

The hardened `_shared/secureHeaders.ts` was authored **2026-08-24 11:53 UTC**. Exactly one production
edge function has been deployed since — `send-gift-credit` v23 at **2026-08-24 15:00:42Z**, whose
deployed source was read and confirmed to carry the **old prefix-matching** implementation. Every
other function was last deployed **on or before 2026-08-20 11:03:32Z**, four days before the hardened
file existed. A deployment cannot contain a file that had not yet been written.

> **Therefore: 71 of 71 production edge functions run a pre-G9 CORS implementation. Zero carry the
> hardening.** This is no longer an estimate over an unknown subset.

| Choice | What it commits you to |
|---|---|
| **(A) INCLUDED** | The hardening ships in this release. **Phase 10 becomes mandatory** (redeploying production edge functions — a production write needing its own named authorisation), and **step 4.11 becomes mandatory** (a 71-row inventory built by reading deployed sources **after** redeploy — that `main` contains the file is *not* evidence that production runs it). |
| **(B) EXCLUDED** | A written **§14 ruling** that G10 proceeds with G9 blocked, naming the residual risk — which is now known to be all 71 functions — and the date by which it will be closed. |

**Related, and deliberately NOT in scope either way:** `_headers` sets
`Access-Control-Allow-Origin: https://50mmretina.com` while `SITE_ORIGIN` is
`https://www.50mmretina.com`, and Phase 0 established there is **no redirect consolidating the two** —
both are live origins served directly. Fixing that during G10 would be an unplanned change to
surface 2. It goes to the post-G10 backlog; it is flagged here only so decision 3 is made knowing the
production CORS surface already has an apex/www mismatch independent of `secureHeaders.ts`.

**Surface impact:** (A) changes **surface 4** (edge functions and versions) — flip that inventory row
to EXPECTED. Neither choice changes surfaces 9 or 10.

---

## DECISION 4 — Schema-guard mechanism · A1 / A2 / B

**Background.** The workflow is `workflow_dispatch`-only: it reports no status on a PR, is not
registered until it reaches the default branch, and `inputs.target` / `inputs.source_dir` are
undefined outside a dispatch event — so adding `pull_request` alone loses the environment binding and
the credential. **Measured 2026-08-26:** the `staging` environment holds **zero secrets**;
`SUPABASE_DB_URL` exists only in `production`.

| Choice | What it does | Cost |
|---|---|---|
| **A1** | Add `SUPABASE_DB_URL` to the `staging` environment. Bind `main→production` and `staging→staging`. Guard required on **both** lanes. `workflow_dispatch` kept. | An owner **secret write**. Creates a second long-lived database credential with its own rotation obligation. |
| **A2** | Guard required only on PRs targeting **`main`**, bound to `production` where the credential already exists. **No** staging database binding, **no** new secret. `workflow_dispatch` kept. | Staging-targeted PRs keep only a procedural gate. |
| **B** | Leave the workflow `workflow_dispatch`-only as the mandatory §12.4 procedural step. | No mechanical enforcement on either lane. |

⚠️ **A1 and A2 both additionally require turning ON `Require status checks to pass` in ruleset
21423524** — measured **OFF** on 2026-08-26. Without it, "required check" is not actually required.

---

# SURFACE IMPACT SUMMARY — UPDATE THE STEP 0.0 INVENTORY BEFORE PHASE 2

The Phase 0 inventory currently marks surfaces 9 and 10 **NOT-EXPECTED-TO-CHANGE**. Phase 9 step 9.5
reconciles against that exact table and must end with *"Expected changes: N. Unexpected changes: 0."*
If a decision below changes a surface and the row is not flipped first, step 9.5 will **correctly**
report an unexpected change and stall the release.

| Decision | Surface 9 — GitHub rulesets | Surface 10 — GitHub environments / secrets | Other |
|---|---|---|---|
| **1 · HS-10 = ROTATED** | no | **YES — flip to EXPECTED** | — |
| **1 · HS-10 = ACCEPTED** | no | no | — |
| **2 · Email policy** | no | only if it needs a new credential | — |
| **3 · G9 = INCLUDED** | no | no | **Surface 4 (edge functions) — flip to EXPECTED** |
| **3 · G9 = EXCLUDED** | no | no | — |
| **4 · A1** | **YES — flip to EXPECTED** | **YES — flip to EXPECTED** | — |
| **4 · A2** | **YES — flip to EXPECTED** | no | — |
| **4 · B** | no | no | — |

**Also already true regardless of any decision:** runbook step **4.3** changes `main`'s CI workflow
(arming the host rules), which is a real change to the default branch. It is classified under §16 and
entered in the Change Ledger, and it happens **before** the freeze.

---

# STANDING HOLD

No merge of PR #102. No modification of `staging` or `main`. No ruleset change. No secret added.
No deployment. Nothing proceeds until all four decisions above are recorded in writing.

*Awaiting owner decisions.*
