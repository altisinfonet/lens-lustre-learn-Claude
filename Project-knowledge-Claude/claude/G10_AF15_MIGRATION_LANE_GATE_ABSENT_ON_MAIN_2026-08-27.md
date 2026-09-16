# AF-15 — THE MIGRATION LANE GATE DOES NOT EXIST ON `main`

**Discovered 2026-08-27 while preparing B6. Read-only. Nothing dispatched, nothing merged, nothing changed.**

---

## 1. What was found

`.github/workflows/apply-migration.yml` differs materially between the two branches.

| | `main` (tree `db8df567…`) | T / `staging` (tree `e2e05fbb…`) |
|---|---|---|
| md5 | `b7a9675bc7ac068f93e8214d37c2cdc4` | `fce7d4f5143c035de6863e2e290f7b30` |
| `target` input (staging / production) | **ABSENT** | present (choice) |
| Step *"The branch must match the target"* | **ABSENT** | present |
| Step *"The credential must point at the target database"* (**the ref assertion**) | **ABSENT** | present |
| `environment:` binding | **COMMENTED OUT** — `# environment: production` | `environment: ${{ inputs.target }}` |
| Credential source | **repository-level** `secrets.SUPABASE_DB_URL` | Environment-scoped secret |
| Total steps | **6** | **8** |

Confirmed independently by the only existing run, **`32829440334`** (2026-08-25, branch `main`,
manually run by `altisinfonet`, Failure, 9s). Its step list is:

```
Set up job · Run actions/checkout@v4 · Refuse to start without the database credential ·
Validate the requested file · Show the SQL that is about to run · Install psql · Run it · Confirm
```

Neither lane gate appears. It failed with:

> `Error: SUPABASE_DB_URL is not set. See the header of this file for the one-time setup — it takes
> about a minute and only the owner can do it.`

## 2. What this means

**On `main`, the migration workflow has no lane gate of any kind.** There is no target to select, no
branch check, no ref assertion, and no Environment binding. It takes any path under
`supabase/migrations/` or `supabase/rollback/` and runs it against whatever the **repository-level**
`SUPABASE_DB_URL` points at.

The only thing currently preventing that is that the secret is **unset** — which run `32829440334`
proves. **If a repository-level `SUPABASE_DB_URL` is ever set to production, any dispatch from `main`
executes arbitrary repository SQL against production with zero gates.**

## 3. Consequences for §15.2 N1 and N2

**N1 and N2 cannot be executed on `main`. Not "have not been" — cannot.** §15.2 defines them as:

> N1 — *"Apply a migration with a production database URL while the **target input says staging**."*
> N2 — *"Apply a migration with a staging database URL while the **target input says production**."*

**`main` has no target input.** There is nothing to mismatch. The control under test does not exist on
that branch.

They **can** be evidenced on `staging`, whose workflow is T's 8-step gated version — and that is the
correct place to evidence them, because **T is the candidate and T's version is what promotion ships.**

## 4. ⚠ RETRACTION OF MY OWN EARLIER INSTRUCTION

In the owner-blocker preparation ledger I issued this N2 configuration:

> *"Temporarily set the **production** Environment's `SUPABASE_DB_URL` to the **staging** pooler URI …
> Run workflow from **`main`**: `target = production` …"*

**That instruction was wrong and is withdrawn.** I wrote it after reading T's copy of the workflow and
did not verify that `main` carried the same version. On the current `main` there is no branch gate and
no ref assertion, so with a credential present the run would have proceeded to path validation and then
**executed SQL**.

This is the same failure mode recorded as **AF-01** — accepting that a file is identical across branches
without checking. I made it again, in the same gate, on a workflow whose entire purpose is protecting
production. Recorded here rather than quietly corrected.

## 5. The corrected safe test

Dispatch from **`staging`** (T's gated version), `target = production`, with a **non-existent but
well-formed path** such as `supabase/migrations/g10-n1-substitute-nonexistent.sql`.

Four independent gates must all fail for any SQL to run:

| Order | Gate | Behaviour |
|---|---|---|
| 1 | Branch ↔ target | refuses: *"target='production' must be dispatched from 'main', but this run is on 'staging'"* |
| 2 | Credential present | production Environment has **no** `SUPABASE_DB_URL` (proven by run `32829440334`) → refuses |
| 3 | Ref assertion | no credential to parse → refuses |
| 4 | Path validation | file does not exist on the commit → refuses |

**Attempted and not completed:** the GitHub *Run workflow* branch selector offered only **`main`** in
this session, so T's gated version could not be dispatched from the UI. No dispatch was performed.

## 6. Status of the two secret-isolation probe workflows (B7)

Workflows named **"G10 secret isolation probe"** and **"Secret isolation probe"** exist in the repository.
The G10 one has **zero runs**. **B7 therefore remains unexecuted**, as previously recorded — the workflow
existing is not evidence; a run with the literal EMPTY line is.

## 7. Disposition

| Item | Status |
|---|---|
| **AF-15** | **NEW — OPEN.** `main` lacks the migration lane gate entirely |
| Is it a §14 hard stop? | **Not as worded.** HS-2 covers a guard *removed or downgraded to make a build pass*; this gate was never present on `main`. It is a **structural control gap**, and the owner should rule whether it is treated as HS-2-equivalent |
| Does promotion fix it? | **Yes** — T carries the 8-step gated version, so promoting T installs the gate on `main`. **The control protecting production migrations is itself part of the payload being promoted** |
| Effect on B6 | N1/N2 must be evidenced **on `staging`/T**, never on `main` |
| Effect on the RC | The §10 record should state that until promotion, `main` has no migration lane gate, and that the repository-level `SUPABASE_DB_URL` must remain unset until then |

---

*Nothing dispatched. Nothing merged. T unchanged at `e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca`.
`main` unchanged at `b671e1f`. No secret value seen, requested or recorded.*
