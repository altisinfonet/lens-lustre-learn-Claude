# G10 — PHASE 2 COMPLETE · PHASE 3 FREEZE DECLARED

**2026-08-26 13:48 UTC.**

---

# PHASE 2 — THE CANDIDATE MERGE (step 2.1) · EXECUTED

PR #102 merged into **`staging`** via the GitHub web UI (this session cannot push: the git proxy
refuses this repository with 403 and `gh` is not installed — both measured, not assumed).

**Squash merge** — the only strategy the repository offers. Pre-merge state confirmed on screen:
target `staging`, 1 commit, **all checks passed (7 successful, 1 skipped)**, **no conflicts**.

| | Before | After |
|---|---|---|
| `staging` commit | `702e5ce` | **`b8535fe7c9f2c7f604347ba849ac579bf4946d23`** |
| `staging` tree | `30ed9e5` | **`e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca`** |
| `main` commit | `b671e1f` | **`b671e1f` — UNCHANGED** ✅ |

All nine paths verified present on `staging` after the merge: the guard workflow, both guard scripts,
one migration, four rollback SQL files, and the edge-function source.

## The harness results apply to exactly what shipped

The two harnesses were run *before* the merge on a locally-merged worktree. That is only meaningful if
the shipped tree is the same tree — so it was checked rather than assumed:

```
locally-merged tree (harnesses ran here): e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca
staging tree after squash-merge:          e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca
IDENTICAL
```

- **Schema-dependency guard harness: 41/41**, 0 failed — satisfies step **4.2** on T
- **Isolation mutation harness: 21/21** mutants held — the §17-5 measurement, on T

## Drift reduced as a side effect

PR #102's `send-gift-credit/index.ts` is **byte-identical** to the deployed production copy
(md5 `43218abad029474db5231fcd0eb0ac52`). The most serious drift case is therefore closed by this
merge: the repository no longer carries the paginated `listUsers()` defect that a redeploy would have
pushed into production.

**Drift: 29 → 28 functions. "Production ahead of repo" class: 3 → 2.**

---

# PHASE 3 — FREEZE (steps 3.2–3.5)

## 3.3 · THE CANDIDATE TREE IS DECLARED

> # T = `e2e05fbb308f74e4db2b0b6bab6c45f254a0fbca`
> Candidate commit: `b8535fe7c9f2c7f604347ba849ac579bf4946d23` (`staging`)
> Declared 2026-08-26 13:48 UTC.

**Every Phase 4 result, the §15 matrix, the Change Ledger and the §10 RC record must name this tree.
A result obtained on any other tree is evidence about that tree, not about this release.**

## 3.4 · THE FREEZE, DECLARED VERBATIM (control C1)

> **No further code merge, rebase, cherry-pick, amend or force-push is permitted after the candidate
> tree is declared. All §15, §17, QA and RC evidence is void if the candidate changes.**

## 3.5 · WHAT INVALIDATION COSTS

A change to the candidate voids **every Phase 4 result, the §15 matrix, the Change Ledger closure and
the RC record**. It does **not** void the Phase 0 baseline, which is measured against production.

Concretely, invalidating T today would discard: 41/41, 21/21, the §15 email row, and every Phase 4
result obtained from here on.

## 3.1 · Freeze announcement — OWNER

Other sessions and people must be told. This programme has already had `staging` move underneath it
mid-work (`c92d534` → `702e5ce`). **`protect-main` targets `main` only — nothing mechanically prevents
a push to `staging`**, so this freeze rests entirely on people honouring it.

---

# PHASE 4 — STATUS MAP AGAINST T

| Step | Status | Note |
|---|---|---|
| **4.1** Schema-dependency guard vs PRODUCTION | **BLOCKED** | See below — this is structural, not effort |
| **4.2** Guard harness on T | ✅ **VERIFIED — 41/41** | |
| 4.3 Arm production-lane host rules | **NOT STARTED** | Requires a PR into `main` (surface 1, §16 classified) |
| 4.4 Both lanes' CI on T, host rules armed | **BLOCKED** | Needs CI run IDs; no Actions access from this session |
| **4.5** Isolation mutants on T | ✅ **21/21 measured locally** | §17-5 wants the count from the Web build job log — the CI line stays open |
| 4.6 ACL remediation (staging only) | **NOT STARTED** | 76 anon / 52 authenticated grants; every statement needs review before it runs |
| 4.7 G8 freshness | **PARTIAL** | Bucket/CORS/public-access config verified in Phase 0; the bidirectional write-refusal re-test is not done |
| 4.8 G1 (a) Zero Trust | ✅ **NOT APPLICABLE** | Cloudflare One is not provisioned |
| 4.8 G1 (b) skipped previews | **NOT STARTED** | |
| 4.9 §15.2 refusals N7/N8 | **NOT STARTED** | |
| **4.10** G7 residual — staging robots.txt | ✅ **VERIFIED** | Body read: `User-agent: * / Disallow: /` |
| 4.11 Edge-function inventory | ✅ **NOT APPLICABLE** | G9 excluded |

## Why step 4.1 cannot be completed now — structural, and it was worth finding

Three independent blockers, each sufficient on its own:

1. **The workflow is not on the default branch.** A `workflow_dispatch` workflow is not registered
   until it reaches `main`. It is now on `staging` only. It cannot be dispatched.
2. **§17-4 asks for CI evidence — run IDs and job-level results.** The runbook states plainly that
   local execution is *not* a substitute where the checklist asks for CI. This session has no Actions
   access.
3. **The out-of-band catalog path does not rescue it.** The guard does support
   `SCHEMA_GUARD_CATALOG_TSV` for "runners with no database egress" — but it requires
   `SCHEMA_GUARD_CATALOG_MD5` *computed by the database over the same bytes*, and it recomputes and
   refuses on mismatch. That is sound design and it is exactly why a catalog relayed through this
   session is not trustworthy evidence.

**A hand-rolled approximation was considered and deliberately rejected.** The guard's own header states
that a check degrading to name-only "is not a weaker version of this guard — it is the very thing this
guard replaces." Producing a substitute and calling it 4.1 would be the precise failure the control
exists to prevent.

**Step 4.1 unblocks only after 4.3 puts the workflow on `main`** — which is itself a `main` change
requiring §16 classification and a Change Ledger entry.

---

*Phase 2 executed via browser; `main` untouched and re-verified. No secret value was displayed or
recorded. Every measurement re-taken from live systems after the merge.*
