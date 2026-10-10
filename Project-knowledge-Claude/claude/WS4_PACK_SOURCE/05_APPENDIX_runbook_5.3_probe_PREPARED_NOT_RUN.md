# APPENDIX — RUNBOOK §5.3 SECRET-ISOLATION PROBE · **EXECUTABLE. PREPARED, NOT RUN.**

> # 🔴 DO NOT RUN THIS NOW.
> Runbook §5.3.6 requires the probe **immediately before promotion**. Run early, it goes stale and
> must be repeated. Prerequisite **3 of 3**, **outside round 5's scope**. All result cells stay empty.

> ## ⚠ EXECUTION PROVENANCE
> **The YAML in §A.3 is `STATIC-VALIDATED`** — PyYAML 6.0.3 / Python 3.11.15 parsed it, both jobs are
> present and bound (`staging-lane → staging`, `production-lane → production`), all three `env` keys
> present in each. Evidence: `yaml-static-validation.txt` in this pack.
> **Everything else here — the run itself, the `gh api` calls, the cleanup — is `SPECIFIED, NOT
> EXECUTED`.**
>
> ⚠ **Parsing is not running.** Revision 1's probe also parsed perfectly and was **untriggerable**.
> `STATIC-VALIDATED` must never be reported as `SMOKE-TESTED` or `EXECUTED`.

**Naming:** "§5.3" means §5.3 of the migration/execution runbook. This ledger's own §5.3 is a file
manifest (corrected at ledger REV-16, C-11).

---

## A.0 · The revision-1 design was **BLOCKED — NOT EXECUTABLE**. Preserved, not deleted.

| # | Defect | Consequence |
|---|---|---|
| 1 | `workflow_dispatch` requires the workflow on the **default branch** | the probe was **untriggerable** |
| 2 | `PRESENT`/`ABSENT` cannot separate same-named secrets in two Environments | a pass and a **leak** printed the same word |

Revision 2 fixed both (push trigger, distinct sentinels) but left placeholders. **Revision 3 makes it
complete and executable.**

## A.1 · What it proves

That a job bound to one lane's Environment **cannot read the other lane's Environment secrets** — the
boundary is enforced, not merely configured.

## A.1a · ⚠ THIS PROBE HAS IRREVERSIBLE SIDE EFFECTS — authorise them before running

> **Added at revision 4. Revisions 2–3 claimed the probe could be cleanly reverted. That was wrong.**

**An `environment:`-bound job causes GitHub to create a DEPLOYMENT and deployment statuses for that
Environment.** Deleting the branch and the sentinel secrets **does not remove them**, and:

- the deployment records **persist in the repository's deployment history**;
- GitHub may **auto-inactivate the previous deployment** for that Environment when a new one is
  created, so the *prior* recorded state can change;
- the workflow run, its logs and its job records also persist.

**Therefore, before running:**

1. **Snapshot the pre-state** of deployments and statuses for both Environments:
   ```bash
   gh api --paginate '/repos/:owner/:repo/deployments?environment=staging&per_page=100'    > pre-deploy-staging.json
   gh api --paginate '/repos/:owner/:repo/deployments?environment=production&per_page=100' > pre-deploy-production.json
   jq 'length' pre-deploy-staging.json pre-deploy-production.json
   # and, for the most recent deployment in each, its statuses:
   gh api --paginate '/repos/:owner/:repo/deployments/<id>/statuses?per_page=100' > pre-status-<id>.json
   ```
2. **Determine this repository's auto-inactivation behaviour** — whether creating a new deployment
   marks the previous one `inactive` — and **record the answer before running**, not after.
3. **Obtain explicit owner authorisation** for a permanent addition to deployment history. This is a
   repository state change, not a neutral read.
4. **After the run, snapshot again**, diff, and **record every residual artifact**: run id, job ids,
   deployment ids created, and any prior deployment whose status changed.

> **Do not claim "exact restoration" from secret-name diffs alone.** Secret names can be restored.
> **Deployment history cannot.** The honest post-run statement is: *"secrets and branch restored;
> deployment and run records remain, listed here."*

## A.2 · Step 1 — prove both sentinel names are ABSENT before creating anything

**Never create a secret whose name might already exist** — you would silently overwrite a real
setting and change the release boundary.

**Capture the PRE-STATE inventory of secret NAMES only (never values), for both Environments and for
the repository:**

```bash
# NAMES ONLY - these endpoints never return values.
# --paginate + per_page=100, because a repo can exceed the 30-item default page and a
# missed page is exactly how a same-named secret stays invisible. (revision 4)
list_names () { gh api --paginate "$1?per_page=100" --jq '.secrets[].name' | sort; }

list_names '/repos/:owner/:repo/environments/staging/secrets'      > pre-staging.txt
list_names '/repos/:owner/:repo/environments/production/secrets'   > pre-production.txt
list_names '/repos/:owner/:repo/actions/secrets'                   > pre-repo.txt
# ORGANIZATION secrets shared with this repository - a same-named org secret is visible to
# every job and would invalidate the sentinel test entirely. (revision 4)
list_names '/repos/:owner/:repo/actions/organization-secrets'      > pre-org.txt

# RECONCILE returned rows against total_count for every list - a silently short page is a
# false ABSENT.
for ep in '/repos/:owner/:repo/environments/staging/secrets' \
          '/repos/:owner/:repo/environments/production/secrets' \
          '/repos/:owner/:repo/actions/secrets' \
          '/repos/:owner/:repo/actions/organization-secrets'; do
  tc=$(gh api "$ep?per_page=1" --jq '.total_count')
  got=$(gh api --paginate "$ep?per_page=100" --jq '.secrets[].name' | wc -l)
  echo "$ep total_count=$tc returned=$got"
  [ "$tc" = "$got" ] || echo "!! PAGINATION MISMATCH on $ep - STOP"
done

# the gate: all three sentinel names MUST be absent in ALL FOUR scopes
! grep -qx 'PROBE_SENTINEL_STAGING'     pre-staging.txt pre-production.txt pre-repo.txt pre-org.txt
! grep -qx 'PROBE_SENTINEL_PRODUCTION'  pre-staging.txt pre-production.txt pre-repo.txt pre-org.txt
! grep -qx 'PROBE_SENTINEL_NONEXISTENT' pre-staging.txt pre-production.txt pre-repo.txt pre-org.txt
```

**If any name is already present, STOP.** Choose a suffixed name, re-run the gate, and record the
substitution. Then create:

| Environment | Secret name | Value |
|---|---|---|
| `staging` | `PROBE_SENTINEL_STAGING` | an inert literal, e.g. `sentinel-staging-YYYYMMDD` |
| `production` | `PROBE_SENTINEL_PRODUCTION` | an inert literal, e.g. `sentinel-production-YYYYMMDD` |

**`PROBE_SENTINEL_NONEXISTENT` is never created.** It is the negative control.

> ⚠ **Environment secrets, not repository secrets — and not organization secrets.** A repository
> **or organization** secret is visible to every job regardless of environment and would reproduce
> defect 2 exactly. That is why `pre-org.txt` is part of the gate.
> ⚠ **No real secret is referenced anywhere in this probe.** The sentinels are inert strings.

## A.3 · Step 2 — the workflow, complete

Branch `probe/secret-isolation-YYYYMMDD`, one file,
`.github/workflows/probe-secret-isolation.yml`:

```yaml
name: probe-secret-isolation

on:
  push:
    branches: ['probe/secret-isolation-**']   # cannot fire on main, staging, or the PR head

permissions:
  contents: read                              # no write scope at all

jobs:
  staging-lane:
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - name: report and enforce sentinel visibility
        env:
          OWN:     ${{ secrets.PROBE_SENTINEL_STAGING }}
          FOREIGN: ${{ secrets.PROBE_SENTINEL_PRODUCTION }}
          CONTROL: ${{ secrets.PROBE_SENTINEL_NONEXISTENT }}
        run: |
          set -u
          own=ABSENT;     [ -n "${OWN:-}" ]     && own=VISIBLE
          foreign=ABSENT; [ -n "${FOREIGN:-}" ] && foreign=VISIBLE
          control=ABSENT; [ -n "${CONTROL:-}" ] && control=VISIBLE
          echo "LANE=staging"
          echo "OWN_SENTINEL=$own"
          echo "FOREIGN_SENTINEL=$foreign"
          echo "CONTROL_SENTINEL=$control"
          echo "RUN_ID=${{ github.run_id }} REF=${{ github.ref }} SHA=${{ github.sha }}"
          rc=0
          [ "$own"     = VISIBLE ] || { echo "::error::binding failed - own sentinel not visible"; rc=1; }
          [ "$foreign" = ABSENT  ] || { echo "::error::ISOLATION BREACH - foreign sentinel visible"; rc=1; }
          [ "$control" = ABSENT  ] || { echo "::error::instrument invalid - control sentinel visible"; rc=1; }
          exit $rc

  production-lane:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - name: report and enforce sentinel visibility
        env:
          OWN:     ${{ secrets.PROBE_SENTINEL_PRODUCTION }}
          FOREIGN: ${{ secrets.PROBE_SENTINEL_STAGING }}
          CONTROL: ${{ secrets.PROBE_SENTINEL_NONEXISTENT }}
        run: |
          set -u
          own=ABSENT;     [ -n "${OWN:-}" ]     && own=VISIBLE
          foreign=ABSENT; [ -n "${FOREIGN:-}" ] && foreign=VISIBLE
          control=ABSENT; [ -n "${CONTROL:-}" ] && control=VISIBLE
          echo "LANE=production"
          echo "OWN_SENTINEL=$own"
          echo "FOREIGN_SENTINEL=$foreign"
          echo "CONTROL_SENTINEL=$control"
          echo "RUN_ID=${{ github.run_id }} REF=${{ github.ref }} SHA=${{ github.sha }}"
          rc=0
          [ "$own"     = VISIBLE ] || { echo "::error::binding failed - own sentinel not visible"; rc=1; }
          [ "$foreign" = ABSENT  ] || { echo "::error::ISOLATION BREACH - foreign sentinel visible"; rc=1; }
          [ "$control" = ABSENT  ] || { echo "::error::instrument invalid - control sentinel visible"; rc=1; }
          exit $rc
```

**Both jobs are written out in full.** No "identical but mirrored" placeholder — a mirrored job that
someone has to write by hand is where the `OWN`/`FOREIGN` swap gets missed.

**Only the words `VISIBLE` / `ABSENT` are printed.** Never a value, never `${#OWN}`, never a prefix.
GitHub's log masking is a backstop, **not** the control — the control is that no value is referenced.

**The control is read through `env:` exactly like the other two**, so it exercises the same
resolution path. A control evaluated differently from the thing it controls proves nothing.

## A.4 · Pass / fail

| Job | Field | Required discriminating result | If not |
|---|---|---|---|
| `staging-lane` | `OWN_SENTINEL` | **VISIBLE** | Environment not bound — probe proves nothing until fixed |
| `staging-lane` | `FOREIGN_SENTINEL` | **ABSENT** | 🔴 **STOP. Lanes are not isolated. Do not promote.** |
| `production-lane` | `OWN_SENTINEL` | **VISIBLE** | as above |
| `production-lane` | `FOREIGN_SENTINEL` | **ABSENT** | 🔴 **STOP.** |
| **both** | `CONTROL_SENTINEL` (**negative control**) | **ABSENT** | the instrument reports VISIBLE for a secret that does not exist — **both lanes' results are void** |

**Each job exits non-zero if any of its three assertions is unmet**, so a mismatch is a red run, not
a green run somebody has to read carefully.

## A.5 · Identity and completeness

- **Environment binding must be evidenced twice**, not assumed: (a) the **workflow source** at the
  run's `github.sha` showing `environment: staging` / `environment: production`; and (b) **GitHub's
  own job/deployment metadata** — the run's job list showing the environment, and
  `gh api repos/:owner/:repo/deployments` / the run's `deployment` entry. Record both.
- **Identity.** Record `run_id`, `ref`, `sha`, job name, and environment per job.
- **Completeness.** **Both** jobs must appear and must have run. A skipped or environment-gated job
  is `BLOCKED`, never `ABSENT`.
- **Protection rules.** If an Environment requires a reviewer, the job **waits**. Record
  `BLOCKED (awaiting approval)`.

## A.6 · Cleanup, and proving it

```bash
# after recording results
git push origin --delete probe/secret-isolation-YYYYMMDD

list_names '/repos/:owner/:repo/environments/staging/secrets'    > post-staging.txt
list_names '/repos/:owner/:repo/environments/production/secrets' > post-production.txt
list_names '/repos/:owner/:repo/actions/secrets'                 > post-repo.txt
list_names '/repos/:owner/:repo/actions/organization-secrets'    > post-org.txt

diff pre-staging.txt post-staging.txt && diff pre-production.txt post-production.txt \
  && diff pre-repo.txt post-repo.txt && diff pre-org.txt post-org.txt      # all four must be empty

git ls-remote --heads origin | grep -c 'probe/secret-isolation'   # must be 0
git ls-remote --tags  origin                                       # must be empty
git rev-parse origin/main origin/staging                           # must equal the pre-run values

# RESIDUE - what CANNOT be removed. Snapshot and diff, then LIST it.
gh api --paginate '/repos/:owner/:repo/deployments?environment=staging&per_page=100'    > post-deploy-staging.json
gh api --paginate '/repos/:owner/:repo/deployments?environment=production&per_page=100' > post-deploy-production.json
jq 'length' post-deploy-staging.json post-deploy-production.json
```

**The four empty diffs prove only that the SECRET-NAME and BRANCH state was restored.**

> ⚠ **They do not prove restoration of the repository.** **Deployment records, deployment statuses,
> the workflow run and its job records persist and cannot be removed**, and a previously-active
> deployment may now read `inactive`. **State this explicitly**: *"secrets and branch restored;
> deployment ids X, Y and run id Z remain; prior deployment W changed from active to inactive."*
> Record it under ledger §21 as a known, authorised, **partially irreversible** repository event.

## A.7 · Wiring check first (NOT a §5.3 result)

Push the branch with **both `environment:` lines removed**. Both jobs should report all three
sentinels `ABSENT` and exit non-zero on the `OWN` assertion.

### ⚠ What this environment-free push does and does NOT do (corrected at revision 6)

| It DOES | It does NOT |
|---|---|
| prove the **branch trigger** fires (`on: push` from a non-default branch) | test Environment **binding** — there is no `environment:` key |
| prove the **`env:` wiring** resolves and the **assertions bite** | test **secret isolation** between the lanes |
| avoid creating **deployment records** — a job without `environment:` is not a deployment | avoid **all** residue: the **workflow run, its logs and job records still persist** |
| — | **close, satisfy, or partially satisfy runbook §5.3** |

> **It is a wiring check, nothing more.** Do not record it as evidence for §5.3, and do not let a
> green tick on it be read as isolation having been tested. Revision 5 called this a "smoke test",
> which invited exactly that misreading.
>
> **The authorised, Environment-bound probe remains REQUIRED and must be run immediately before
> promotion** — §A.1a (authorisation and deployment snapshot), §A.3 (workflow), §A.4 (pass/fail),
> §A.6 (residue). Restore the `environment:` lines for that run.

## A.8 · Absolute constraints

- **No secret value in any output, log, screenshot, chat or file** — not masked, not partial, not
  hashed. §14 HS-10: a hard stop requiring rotation. **This project has had one already** (G9
  BLOCKER-2).
- **Never commit this workflow to `main` or `staging`.** That would change the promotion boundary —
  the exact thing the probe protects.
- Run **immediately before** the §11 signature and tag. Not before. Not after.
