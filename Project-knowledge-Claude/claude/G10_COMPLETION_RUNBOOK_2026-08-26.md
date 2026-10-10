# G10 COMPLETION RUNBOOK — 2026-08-26 (Revision 1)

Companion record for the delivered DOCX `G10_COMPLETION_RUNBOOK_2026-08-26.docx` (19 pages).
Governed by `50mm_Master_Execution_Plan_v3.docx` (Rev 3.0). Where this and Rev 3.0 disagree, **Rev 3.0 wins**.

---

## THE INVARIANT

> **Land every intended change FIRST. Freeze SECOND. Measure the frozen tree THIRD.
> Everything after that names that one tree and nothing else.**

### Why the ordering was corrected

The earlier next-steps plan had "merge PR #102" as item 7 and "write the §10 RC record naming
tree `30ed9e585c13d493ad253adc3de1d9e9152405e7`" as item 17. Verified with `git merge-tree`:
PR #102 is a strict fast-forward (`0 1`), so merging it **moves staging's tree** to
`e2e05fbb…`. Recording `30ed9e58…` as the candidate tree after that merge would have named a
tree that no longer exists at the branch tip — a direct violation of **§17-11 / HS-7**
(promotion must assert tree equality between the approved candidate and what is promoted).

The candidate tree is therefore **deliberately left undefined** in the runbook until
**Phase 3, step 3.3**, after the freeze.

---

## RESULT VOCABULARY (only these four)

| Word | Meaning |
|---|---|
| VERIFIED | Executed or inspected **in that session**, instrument and timestamp recorded |
| OWNER-ATTESTED | A human states a configuration no session can read back. Never written as verified |
| BLOCKED | Could not be executed. State exactly what access is missing |
| NOT APPLICABLE | The condition cannot arise. State why |

Anything else — "done", "should work", "assumed", "inherited", "probably", "looks good" — is
not a result and must not appear in the record.

---

## PHASE SEQUENCE

| Phase | Title | Gate to the next phase |
|---|---|---|
| **0** | Baseline capture — §17-8 and §18 baselines taken **before anything changes** | Baselines recorded |
| **1** | Four owner decisions | All four answered in writing |
| **2** | Land the code (merge PR #102 and any other intended change) | Nothing further to land |
| **3** | **FREEZE**, then declare candidate tree **T** | T measured and written down |
| **4** | Ten checks, every one against **T** | All ten green or explicitly waived |
| **5** | §15 QA matrix + Change Ledger | Matrix complete |
| **6** | §10 RC record (8 steps) | RC record written |
| **7** | §11 approval | Owner approves |
| **8** | Tag, then promote (§12.4 ordering, HS-7 tree-equality assertion) | Tree equality asserted |
| **9** | §18 post-production | Deltas vs Phase 0 baselines |
| **10** | Edge-function redeploy — **a separate action, not part of promotion** | CORS hardening reaches production |

### Phase 1 — the four owner decisions

1. **HS-10** — re-checked on the day, not carried forward from an earlier check.
2. **Email policy** — the gift-by-email lookup surface.
3. **G9 / CORS scope** — must be issued as a **written §14 ruling**, not treated casually.
   The hardened `secureHeaders.ts` (authored 2026-08-24 11:53 UTC, commit `9f3d20a`) is on
   staging's function (deployed 13:30:40 UTC) but **not on production's** (deployed 15:00:42 UTC
   from a pre-G9 branch). The hardening has never reached production.
4. **Schema-guard mechanism** — the guard **cannot be a required check as written**:
   `workflow_dispatch` only; not registered until it is on the default branch; and
   `inputs.target` / `inputs.source_dir` are undefined outside dispatch, so adding
   `pull_request` alone breaks the environment binding.

### Phase 4 — the ten checks (all against T)

1. Schema guard vs production
2. Schema-dependency harness (41 cases)
3. **Arm the host rules** — `main`'s `web-build.yml` sets `ISOLATION_FORBIDDEN_REFS: ""` and no
   host variables, so production-lane host rules are **disarmed in CI** (though armed on
   Cloudflare Pages). §17-4 requires "with host rules active"; it is not satisfied until this is fixed.
4. Both-lane CI green
5. Mutant count (21 cases / 12 mutants)
6. **ACL remediation** — hard boundary: **read production, write staging only**
7. G8 freshness (§17 requires the evidence be fresh, not merely once-green)
8. G1 — **both halves**, not one
9. N7 / N8 refusals
10. G7 residual

### Phase 6 — §10 RC record

Eight steps, including an **honest record of the PR #101 bypass** rather than omitting it.

---

## FOUR ADDITIONS THE REVIEWER'S SEQUENCE DID NOT HAVE

1. **Phase 0 baseline timing** — §17-8 and §18 baselines must be taken *before* anything
   changes, otherwise the post-production delta in Phase 9 has nothing to compare against.
2. **An enforced freeze** — Phase 3 is a freeze, not an intention. Without it the tree moves
   under the measurement again.
3. **Phase 10 edge-function redeploy as a separate action** — promoting the repo does not
   redeploy edge functions. The CORS hardening reaches production only through its own deploy.
4. **HS-10 re-checked on the day**, not inherited from an earlier session's check.

---

## STOP CONDITIONS

All twelve hard stops HS-1 … HS-12 are reproduced in the DOCX with each one's status as of
2026-08-26. Any mismatch = STOP and investigate. Any unexpected production change = STOP.

---

## EXPLICITLY NOT IN SCOPE (post-G10 backlog)

- Node 20 upgrade
- bun / npm migration
- svgo
- branch aliases
- the stale `Main` rule
- the health task
- the 24 NULL-`proacl` extension functions on production (cosmetic ACL divergence; recorded as
  technical debt — the two full ACL fingerprints will not become byte-equal because of them, so
  the correct post-remediation assertion is the **explicit-ACL** fingerprint)
- five orphan refs awaiting owner deletion:
  `scratch/g10-53-secret-isolation-20260826`, `tool/pushcheck-1787718423`,
  `scratch/lane-check-g3`, `scratch/secret-isolation-20260822`, `scratch/secret-isolation-retest`

---

## OPEN ITEMS CARRIED INTO THE RUNBOOK

- **Why deployment `9c0c1201-41b4-4abf-9b5f-18598b5189d7` was built twice** (superseded first
  build `19064989-ebd8-43e9-85d5-51464c31d126`) — OPEN.
- **§5.3 literal log line** — the success conclusion is independently decisive (the workflow
  `exit 1`s on NON-EMPTY), but the log line itself could not be re-read under browser
  automation. Recorded as reported, not independently re-read.
- **The 23 production certificate deletions are OWNER-ATTESTED** (the owner deleted them
  intentionally). The push session still carries them as open and must be told.

---

*Written 2026-08-26. Derived from the delivered DOCX runbook, which is the authoritative copy.*
