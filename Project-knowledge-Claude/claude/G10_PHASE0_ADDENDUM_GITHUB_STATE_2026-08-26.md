# G10 PHASE 0 ADDENDUM — GITHUB STATE (step 0.7)

**Captured 2026-08-26, ~11:05–11:12 UTC. Read-only.**
Completes step 0.7 of `G10_PHASE0_BASELINE_2026-08-26.md`, which recorded it as NOT YET CAPTURED.
Bundle item 15 (baseline) and an input to §17-7 and to owner decision 1.4.

---

## `protect-main` — ruleset 21423524 — VERIFIED

- Enforcement: **Active** · Target: **1 branch, `main`** (Default criteria)
- **Bypass list: EMPTY** — no role, team, app or user is exempt

### Rules ENABLED (3 of 13)

| Rule | State |
|---|---|
| Restrict deletions | ✅ **ON** |
| Require a pull request before merging | ✅ **ON** |
| Block force pushes | ✅ **ON** |

### Rules NOT enabled (10)

Restrict creations · Restrict updates · Require linear history · Require deployments to succeed ·
Require signed commits · **Require status checks to pass** · Require code scanning results ·
Require code quality results · Restrict code coverage · Automatically request Copilot code review

> **Method note.** The accessibility tree reported *all* checkboxes as unchecked. That was wrong.
> Visual inspection of the rendered page shows three checked. The three above were read from
> screenshots, not from the tree. Recorded because it is a reusable lesson: on this dashboard the
> a11y tree does not reflect the React checkbox state, and any future re-attestation must be done
> visually or via the API — never from extracted text.

### Consequences

- **C1 and C3 are partly mechanical on `main`.** "Block force pushes" is ON, so the no-force-push
  prohibition after freeze and after RC is enforced by GitHub for `main`, not only by agreement.
- **The freeze on `staging` is purely procedural.** The ruleset targets exactly one branch, `main`.
  Nothing prevents a push, force-push or deletion on `staging`. The Phase 3 freeze therefore rests
  entirely on people honouring the freeze notice. This is not a defect to fix during G10 — adding a
  ruleset now would itself be an unplanned change to surface 9 — but the runbook's step 3.1 should be
  read knowing that no mechanism backs it.
- **§17-7 remains OWNER-ATTESTED.** Reading the ruleset on screen does not change its evidence class;
  it must be re-attested by the owner on promotion day at step 8.3.
- **PR #101's bypass was not a ruleset bypass.** With an empty bypass list and "require a pull request"
  ON, #101 did go through a pull request. What it lacked was the §12.4 controls — freeze, approved tag,
  RC record, approval, §5.3 — none of which GitHub enforces. The record should say that precisely
  rather than implying branch protection was circumvented.

---

## Environments and secrets — names only, no values — VERIFIED

| Environment | Protection rules | Secrets |
|---|---|---|
| `staging` | 1 | **none** |
| `production` | 1 | **1** |

**Environment secrets:** `SUPABASE_DB_URL` → environment **`production`** (one row, the only one).

**Repository secrets (4):** `ANDROID_KEYSTORE_BASE64` · `ANDROID_KEYSTORE_PASSWORD` ·
`ANDROID_KEY_ALIAS` · `ANDROID_KEY_PASSWORD`

No value, fragment or hash of any secret was read, displayed or recorded.

---

## 🔴 FINDING — OWNER DECISION 1.4 OPTION (A) DOES NOT WORK AS THE RUNBOOK WRITES IT

Two independent instruments agree that the **`staging` environment holds zero secrets**: the Actions
secrets page lists exactly one environment secret and scopes it to `production`, and the environments
list shows a secret count for `production` only.

The runbook's decision 1.4 option **(A)** says to rewrite the schema-dependency guard to
*"derive target from `github.base_ref` (main→production, staging→staging)"* and make it a required
check. On a PR targeting `staging`, that binds the job to environment `staging` — **which has no
`SUPABASE_DB_URL`**. The secret resolves empty and the guard cannot connect to the staging lane.

This is the same mechanism §5.3 deliberately exercised: a job with no matching environment binding
gets an empty secret. There it was the *proof of isolation*; here it would be a *silently useless
gate* — the worst kind, because it reports a status check that never actually inspected anything.

### The choice this forces, before decision 1.4 can be answered

| Option | What it requires | Cost |
|---|---|---|
| **A1** — add `SUPABASE_DB_URL` to the `staging` environment | An owner secret write. **This changes production surface 10** in the Phase 0 inventory and needs its own Change Ledger entry and a §16 classification. It also creates a second long-lived database credential. | New secret, new rotation obligation |
| **A2** — make the guard required only on PRs targeting `main` | The guard binds to `production` only, where the secret exists. Staging-targeted PRs get no mechanical gate. | Staging lane keeps a procedural gate |
| **B** — keep it `workflow_dispatch`-only as a mandatory §12.4 step | No secret change, no ruleset change. Entirely procedural. | No mechanical enforcement at all |

Note that **A1 and A2 both additionally require turning ON "Require status checks to pass"** in
`protect-main`, which is currently OFF. That is a change to surface 9, which the Phase 0 inventory
marks NOT-EXPECTED-TO-CHANGE. Whichever way decision 1.4 goes, if it goes mechanical, **the inventory
row for surface 9 (and for surface 10 under A1) must be flipped to EXPECTED before Phase 2**, or
Phase 9's reconciliation will correctly report an unexpected change.

**Runbook step 1.4 should be reissued to present A1 / A2 / B rather than A / B.** Recorded here rather
than silently corrected in the DOCX, so the change is visible.

---

## Phase 0 status after this addendum

| Step | Result |
|---|---|
| 0.0 ten-surface inventory | DRAFTED — owner confirmation needed, and rows 9 and 10 now depend on decision 1.4 |
| 0.1 Pages config and variables | VERIFIED |
| 0.2 robots.txt, `_headers` | VERIFIED (bodies) · sha256, sitemap.xml, apex redirect **BLOCKED** |
| 0.3 schema fingerprints | VERIFIED |
| 0.4 error-rate baseline | VERIFIED |
| 0.5 deployment ID, commit, tree | VERIFIED |
| 0.6 71-row edge function baseline | VERIFIED |
| **0.7 GitHub ruleset, environments, secret names** | **VERIFIED (this document)** |
| 0.8 DNS + Zero Trust | PARTIAL — domains only |
| 0.9 R2 | PARTIAL — buckets only |

Remaining Phase 0 work is three dashboard reads and one byte-exact fetch. None of it blocks Phase 1,
which is entirely owner decisions and is now the critical path.

---

*Read-only throughout. No repository, production or staging write. No secret value observed or recorded.*
