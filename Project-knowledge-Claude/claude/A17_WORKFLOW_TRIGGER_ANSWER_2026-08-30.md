# A17 — URGENT. Can the injectable jobs run on a branch other than `main`?

Date: 2026-08-30 · Read-only detached clone. No branch, commit, push, merge, tag, deploy,
migration, workflow dispatch, §5.3 probe, provider write, ledger edit or secret read.
**No secret value was seen, requested or recorded.** **Nothing here closes a §25 row (§25.4).**

Verbatim quotes: `A17_TRIGGER_TRANSCRIPT.txt`. Nothing below is paraphrased.

---

## THE ANSWER, IN THREE LINES

| Workflow | As the repository stands **TODAY** (`origin/main` `b671e1fb`) | Can its job run on a branch other than `main`? |
|---|---|---|
| **`apply-migration.yml`** | `on: workflow_dispatch:` — **no `branches:` filter, no `if:` on the job, zero `github.ref` guards** | **YES.** `workflow_dispatch` accepts any ref |
| **`verify-schema-dependencies.yml`** | **THE FILE DOES NOT EXIST ON `main`** | **NO — it cannot run at all today.** The merge is what creates it |
| **`android-build.yml`** — the only consumer of `secrets.ANDROID_*` | `on: push: branches: [main] paths: [...]` | **NO.** Push to `main` only, and only on two paths |

**But the exposure question F-29 asks does not turn on the trigger — it turns on the `environment:`
line, and today that line is commented out.** That is the finding, and it cuts both ways.

---

## 1. `apply-migration.yml` — dispatchable from any branch, and today it cannot get the credential

### 1a. The trigger, verbatim, at `b671e1fb` (today)

```yaml
on:
  workflow_dispatch:
    inputs:
      migration:
        description: "Path under supabase/migrations/ or supabase/rollback/ — e.g. …"
        required: true
        type: string
      confirm:
        description: "Type the SAME path again. A mis-click cannot fire this."
        required: true
        type: string
```

**There is no `branches:` key.** `workflow_dispatch` has no branch filter available to it: the
workflow must exist on the default branch to be *offered*, and the dispatcher then **chooses the ref**
— any branch or tag — and the file **from that ref** executes.

### 1b. The gates on the job, verbatim

```yaml
jobs:
  apply:
    name: Apply SQL to production
    runs-on: ubuntu-latest
    timeout-minutes: 15
    # Uncomment to require a human approval on every run (see the header):
    # environment: production
    env:
      DB_URL: ${{ secrets.SUPABASE_DB_URL }}
```

- **`if:` conditions on this job: NONE.** `grep -n "if:"` over the whole file returns nothing.
- **`github.ref` / `github.head_ref` / `github.base_ref` guards: ZERO.**
- **`environment:` — COMMENTED OUT at line 77.**

### 1c. Why that comment is the whole answer today

Row 1.5 established that `SUPABASE_DB_URL` is an **environment** secret on `production`, and that it
is the only database credential anywhere in this repository's Actions configuration. An environment
secret is readable **only** by a job that declares `environment:`. **This job does not.**

So `${{ secrets.SUPABASE_DB_URL }}` resolves to **empty**, and the workflow's own first step —
written for a different reason — stops it:

```yaml
- name: Refuse to start without the database credential
  run: |
    if [ -z "$DB_URL" ]; then
      echo "::error::SUPABASE_DB_URL is not set. …"
      exit 1
    fi
```

**Measured conclusion for today:** the job **can be dispatched on any branch**, and it **exits 1 at
step 1** without reaching `psql`, because the credential it needs is in an environment it never
enters. **The injection path is open; the credential behind it is not reachable through this file.**

> ⚠ **Classification.** *"The job is dispatchable on any branch"* and *"`environment:` is commented
> out at line 77"* are **VERIFIED** — read from the repository. *"`SUPABASE_DB_URL` exists only as a
> `production` environment secret"* is **RELAYED** from the owner's console capture (row 1.5); I have
> no GitHub tool and cannot see it. **The conclusion depends on that relayed fact.** If a repository
> secret of that name also exists, the conclusion inverts and the credential is reachable from any
> branch today. **That is one screen for the owner to confirm, and it should be confirmed.**

### 1d. What the merge changes — the RC uncomments it

At `a42b209e`, line 91:

```yaml
    environment: ${{ inputs.target }}
```

Merging **turns the environment gate on**. The job then *can* reach the credential — and what stops
it on a non-`main` ref is the `production` environment's **deployment-branch policy**, which row 1.5
records as `main`-only with **required reviewers off, wait timer off, administrator bypass on**.

**So the protection moves from "the credential is unreachable" to "a GitHub environment setting is
the only thing standing between a dispatch on any branch and production SQL."** That is a real gate.
It is also a *settings* gate, not a *code* gate: it is not in the 138 files, it is not reviewed in
this release, and it can be changed in the UI without a commit. **This is the sharpest form of the
compiler's "one door, one key, no guard", and it belongs in the §11 record.**

The RC also adds the file's only `github.ref` reference (1 occurrence) — but it is **not** a job-level
branch guard; the branch decision is delegated entirely to the environment policy.

---

## 2. `verify-schema-dependencies.yml` — cannot run today, at all

**`git cat-file -e b671e1fb:.github/workflows/verify-schema-dependencies.yml` → the file does not
exist.** It appears only at the RC.

`workflow_dispatch` requires the workflow to be present on the **default branch** before it can be
offered. It is not. **Therefore this workflow is not dispatchable today from any branch, and its
`${{ inputs.source_dir }}` injection is not currently reachable.**

At the RC it carries `on: workflow_dispatch:` with **no `branches:` filter, no `if:`, zero
`github.ref` guards**, and `environment: ${{ inputs.target }}` at line 59.

**Recorded plainly: this workflow's injection risk is created by the merge, not merely carried by
it.** Track R item 2 and `09_OPTION2_PATCHES/02-verify-schema-dependencies.yml.patch` address the
construct; this is the trigger analysis that sizes it.

---

## 3. `android-build.yml` and F-29 — the bound, and its honest limit

### 3a. The trigger, verbatim, identical at both refs

```yaml
on:
  push:
    branches: [main]
    paths:
      - ".github/workflows/android-build.yml"
      - "ANDROID_BUILD_TRIGGER"
```

**Push to `main` only, and only when one of two paths changes.** Its three `if:` lines are
`always()`, `${{ env.PLAY_SA != '' }}` and `failure()` — step-level, not branch gates.

### 3b. It is the ONLY workflow referencing `secrets.ANDROID_*`

Measured across **all 8 workflows at `main`** and **all 9 at the RC**: `android-build.yml`, **7
references**, and nothing else. At either ref.

### 3c. What this does and does not bound — stated precisely

**It bounds:** no *existing* workflow reads the Android signing secrets on a non-`main` branch.
None of the seven other workflows references them, and the one that does cannot be triggered off
`main`.

**It does NOT bound — and I will not let this be read as an all-clear:** F-29's mechanism is that
**repository** secrets are available to *any* workflow run on *any* branch. The constraint is on
which workflow *asks* for them, and the set of workflows is not fixed — a collaborator with write
access can push a new workflow file to a branch that reads `secrets.ANDROID_*`, and it will receive
them. **That is a property of the secrets' scope, not of these files, and no reading of these files
can close it.**

**So F-29 stands as the compiler wrote it, with its trigger question now answered:** the existing
workflows do not expose the keystore off `main`; the repository-secret scope still does. The remedy
is scope (move them to an environment, or to a restricted set), not trigger conditions.

**F-29 does not, on this evidence, outrank the promotion question.** The compiler's condition was
*"if any workflow carrying the unescaped construct is triggerable on a non-`main` branch today."*
`apply-migration.yml` **is** so triggerable — but it carries no Android secret and, today, no
reachable database credential. The two risks do not compose into the immediate live exposure the
compiler was right to test for.

---

## 4. One measurement made in passing, recorded because it was measured

Four workflows widen their branch scope in this release — `security.yml`, `typecheck.yml`,
`ui-gate.yml`, `web-build.yml` all move from `branches: [main]` to `branches: [main, staging]` at
both `push` and `pull_request`. Not a finding; recorded so it is not discovered later and mistaken
for one.

---

## 5. Summary for the compiler

| # | Question | Answer | Status |
|---|---|---|---|
| 1 | `apply-migration.yml` — runnable off `main` today? | **YES**, `workflow_dispatch`, any ref, no `if:`, no `github.ref` guard | **VERIFIED** |
| 2 | …can it reach the DB credential today? | **NO** — `environment:` commented out at line 77; the only credential is a `production` environment secret | **VERIFIED** (code) + **RELAYED** (secret location, row 1.5) |
| 3 | …after merge? | **The environment gate turns on**; the branch decision passes to the `production` deployment-branch policy — a settings gate, outside the 138 files | **VERIFIED** (code) + **RELAYED** (policy) |
| 4 | `verify-schema-dependencies.yml` — runnable off `main` today? | **NO — it does not exist on `main`.** The merge creates it | **VERIFIED** |
| 5 | `android-build.yml` — runnable off `main`? | **NO** — `push`, `branches: [main]`, two paths | **VERIFIED** |
| 6 | Any other workflow reading `secrets.ANDROID_*`? | **NO** — 1 of 8 at `main`, 1 of 9 at the RC | **VERIFIED** |
| 7 | Is the keystore therefore safe? | **NOT ESTABLISHED.** Repository-secret scope permits a *new* workflow on any branch to read them. Remedy is scope, not triggers | **OPEN** |
| 8 | Does F-29 outrank the promotion question? | **Not on this evidence** — the injectable workflow carries no Android secret and no reachable credential today | **INFERRED**, basis above |

**One question back to the owner, and it is one screen:** GitHub → Settings → Secrets and variables
→ Actions → **Repository secrets**. Confirm that `SUPABASE_DB_URL` is **not** among them. Row 1.5
says the only repository secrets are the four `ANDROID_*`. **Item 2 above depends entirely on that.**
Names only — never a value.
