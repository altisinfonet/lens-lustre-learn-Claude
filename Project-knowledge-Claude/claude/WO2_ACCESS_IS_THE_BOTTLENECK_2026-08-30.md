# Hand-back: what remains is ACCESS, not work

**Nothing in this document closes a §25 row.**

Stated plainly, because the distinction decides what the owner should do next: **the remaining
§25.7.2 items are not waiting on effort, scheduling, or another pass over the providers. They are
waiting on read access to the repository.** More provider reads cannot close any of them, and I
should not be tasked with more of them in the hope that they will.

## What is genuinely finished

| Item | Status |
|---|---|
| B13 15a — capture and hash all 71 production functions | **SATISFIED** |
| Staging equivalent — all 74 captured and hashed | **SATISFIED** |
| LANE-COMPARISON-2026-08-30 (deployment-to-deployment) | **MEASURED** (new measurement; closes nothing) |
| Row 2 (§1.2) staging policy state + its own negative control | **MEASURED** |
| Row 6a (§1.6a) R2 bucket existence | **MEASURED**; sizes BLOCKED on the merits |
| Findings C-1 (HIGH) and C-2 (MEDIUM) | **RAISED** |

## What is blocked, and by exactly what

| Item | Blocked on | Why no provider read can substitute |
|---|---|---|
| **B13 15b — production-vs-repo drift** | Repository read at staging @ `702e5ce` | The baseline compared deployments against **the candidate tree**. I can read what is *deployed* on both lanes; I cannot read what the repository *says should be* deployed. LANE-COMPARISON-2026-08-30 is a different measurement and is not a partial substitute |
| **The 138-file review** | Repository read at `main..a42b209e` | The 138 files are repository paths. `02a_manifest_main..a42b209e.tsv` lists them; none is reachable through the Supabase or Cloudflare APIs |
| **The independent test-suite run** | Repository checkout + ability to execute the suite | The negative control alone (deleting the `h-12` token from `ReactionSummaryTooltip.tsx`) requires the source tree. There is no deployed artifact that carries it |
| **C-1's cause** (fork vs. drift) | Repository history for `s3.ts`, `imageDims.ts` | Deployment state shows the variants are simultaneously deployed and mutually different. Whether that was intended is only answerable from history |
| **F-17(a) chronology** (which lane is truly newer) | Repository history | Staging's `updated_at` values are bulk-redeploy artifacts and cannot order the code |

## What unblocking looks like

One thing: **read access to `altisinfonet/lens-lustre-learn-Claude`**, sufficient to check out
`702e5ce` and the `main..a42b209e` range. That single grant converts every row in the blocked table
above from BLOCKED to workable. Nothing else on the critical path needs a new credential, and no
additional provider scope is being requested — I already have enough provider access to have
finished everything that provider access can finish.

## What should not be done instead

- **Do not schedule more provider sweeps.** Production and staging deployments are now captured,
  hashed, independently recomputed and provenance-bound. Re-reading them produces the same bytes.
- **Do not treat LANE-COMPARISON-2026-08-30 as progress toward 15b.** It is a new measurement of a
  different population. Citing it toward 15b would be the exact conflation F-16 caught.
- **Do not read the lane delta as an argument about PR #104.** Merging deploys no functions.

## Standing items, restated

- **Hard gate:** cleared for **this platform and this run only**. `11_mutation_control.sh` returned
  `UNDETECTED=0` with **`NO-OP-HERE=1`** on Linux — **M8c has still never executed anywhere it is a
  defect.** **BLOCKED, not coverage.** Windows figures in `BLOCKED_ITEMS_revision6.md` (B3) are
  AUDITOR-ATTESTED from an earlier round, not witnessed here. B4 (symlink resolution) remains
  untested on every platform by construction.
- **F-11:** never execute a pack file that has not hash-verified against `MANIFEST.sha256`. Applied.
- **Track R:** not started. The 138-file audit report was requested once, in writing, and has not
  been requested again. If the owner confirms it cannot be produced, it will be recorded as
  **BLOCKED with the owner named**; that confirmation has not been given either way, so it is not
  recorded as blocked yet.

**Nothing above closes a §25 row.**
