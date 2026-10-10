# G10 §17-4 — WHY THE PRODUCTION-LANE-ON-T RUN CANNOT BE GENERATED AT PHASE 4

**2026-08-26. `main` unchanged (`b671e1f`). T frozen at `e2e05fb`. PR #103 open, unmerged.**
No action taken. This is an analysis of the exact dependency.

---

## What §17-4 still needs

The **production-lane** isolation guard running against **candidate tree T**, with host rules armed,
named by CI run ID.

Already held: the **staging** lane on T — run **`32976271438`**, `Staging lane build`, 54s, Success.

---

## What can trigger that job — read from the candidate workflow, verbatim

```yaml
on:
  push:
    branches: [main, staging]
  pull_request:
    branches: [main, staging]
```

```yaml
build-production:
  if: github.base_ref == 'main' || (github.event_name != 'pull_request' && github.ref_name == 'main')
```

**There is no `workflow_dispatch`.** The job cannot be triggered manually, at all.

It fires under exactly two conditions:

| | Condition | What it means in practice |
|---|---|---|
| **A** | `github.base_ref == 'main'` | a **pull request whose base is `main`** |
| **B** | non-PR event and `ref_name == 'main'` | a **push to `main`** — i.e. the promotion itself |

**Condition B is the promotion.** Using it to obtain pre-promotion evidence is circular, and it changes
`main`. Excluded.

**So the only legitimate route is condition A: a pull request into `main` whose merged content is T.**

---

## 🔴 And that route is currently blocked — by the promotion conflict

For a `pull_request` event, GitHub evaluates the workflow against the **merge ref**
(`refs/pull/N/merge`). When a PR has conflicts, that ref cannot be computed, so `pull_request`-triggered
workflows do not run — the checks simply never appear.

The staging → `main` merge **conflicts today**, measured locally:

| | Conflicts | |
|---|---|---|
| Now | `src/lib/generateCertificatePdf.ts` | 6 hunks |
| After PR #103 merges | the above **+ `.github/workflows/web-build.yml`** | both sides changed it |

**Therefore no PR into `main` carrying T's content can currently produce a `build-production` run** —
neither the promotion PR nor a scratch branch at T.

### Why this cannot be worked around at Phase 4

| Candidate workaround | Why it fails |
|---|---|
| Resolve the conflict on `staging` | **Changes T. Voids the freeze** and every Phase 4 result — 41/41, 21/21, the §15 email row. Forbidden by C1 |
| Merge PR #103 to manufacture a run | Explicitly excluded; and it *adds* a second conflict, making the situation worse |
| Bring T's `generateCertificatePdf.ts` to `main` in another PR | Pre-ships release source to `main` outside the promotion gate, and is not a runbook step. Rejected |
| `workflow_dispatch` the job | **Does not exist** in the workflow |
| Push a scratch branch at T | `push` on a scratch ref: `ref_name` is not `main`, so `build-production` is **skipped** — the same reason it skipped on the staging push |

---

## The legitimate path — and it is not a defect

The **promotion PR at Phase 8 is itself the instrument.** Sequenced correctly:

1. Open the promotion PR (`staging` → `main`) at the point the runbook calls for it.
2. Resolve the two conflicts **on the PR branch** using the pre-agreed resolution — take the
   candidate's version — which was verified to yield a tree **exactly equal to T**.
3. GitHub can then compute the merge ref. `build-production` fires, because `base_ref == 'main'`.
4. **Read the run before pressing merge.** That is the §17-4 evidence, and §17 is checked
   *immediately before promotion* — so this satisfies the checklist in the right order.
5. Only then merge.

**§17-4 is satisfiable at Phase 8, before the merge button — not at Phase 4.**

## 🔴 RUNBOOK FINDING AF-02

**Step 4.4 places "re-run BOTH lanes' CI on T with host rules armed" in Phase 4. That is impossible
for the production lane.**

The production-lane job is gated on `main`, and `main` does not carry T's content until promotion. No
Phase 4 action can produce that run without either changing T (voiding the freeze) or pushing to `main`
(performing the promotion). **The step as written cannot be executed in the phase it sits in.**

The step should be split:

- **4.4a — staging lane on T.** ✅ Already satisfied: run `32976271438`.
- **4.4b — production lane on T.** Moves to **Phase 8**, performed on the promotion PR *before* the
  merge, and named in the RC record as a pre-merge gate.

Recorded as AF-02, alongside AF-01. Neither is rewritten.

---

## Status — unchanged as instructed

| Item | Status |
|---|---|
| **§17-5** mutants held on this tree | **VERIFIED** — `Mutations detected/held: 21/21`, read from CI run `32982588154` |
| **§17-4** both lanes armed on T | **OPEN** — staging lane held; production lane blocked until Phase 8 |
| **PR #103** | **OPEN / merge-ready** — not merged |
| **`main`** | **`b671e1f` — unchanged** |
| **T** | **`e2e05fb` — frozen, untouched** |
| **AF-01** | retained, unmodified |

---

## THE EXACT DEPENDENCY FOR CLOSING §17-4

> **§17-4 closure depends on a pull request into `main` whose merged content equals T, which requires
> GitHub to compute a merge ref, which requires the two staging→`main` conflicts to be resolved on the
> PR branch — and that resolution is a Phase 8 action, because doing it earlier means editing either
> the frozen candidate or `main` outside the promotion gate.**

**Blocking chain, shortest form:**

`§17-4` ← production-lane run on T ← PR based on `main` with T's content ← computable merge ref ←
conflicts resolved on the PR branch ← **Phase 8 promotion procedure**

**Nothing in Phase 4, 5, 6 or 7 can close it.** It is not waiting on evidence-gathering; it is waiting
on the promotion PR existing.

*No action taken. Nothing merged, pushed, or changed.*
