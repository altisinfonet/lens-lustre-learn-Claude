# PHASE 0 KICKOFF — Baseline and instruments

**Issued by the Auditor · 2026-09-02 · binding on D1 and D2**
**Phase 0 changes no behaviour. It ships measurement and CI only.**

---

## 0 · Why this phase exists, in one paragraph

Every unit in Addendum A is quantified — 66.7 %, 50.9 %, 580,000 requests, 64.2 % dead rows. **Those numbers were taken in a single 38-minute window on 2026-09-01.** If work begins before the same numbers are re-taken by our own instruments and committed, then in three weeks nobody can prove any improvement, and every "after" figure is an argument instead of a measurement. Phase 0 is what makes the rest provable.

**Nothing in this phase changes what a member sees.** If a Phase 0 PR changes application behaviour, it is out of scope and will be closed.

---

## 1 · Read before you write anything

Both sessions, first action, every session:

1. `docs/ADDENDUM_A_EXECUTION_MASTER.md` — roles, ownership map, branch discipline, the nine-step promotion checklist.
2. `docs/gates/GATE_REGISTER.md` — the 35 gate sentences and the five standing holds.
3. `git log --oneline -20 origin/staging` — what has actually landed. **Not what you remember landing.**

**You cannot see the other developer's session.** Do not assume what they have done. Open the branch and look.

---

## 2 · Unit list and owner

| # | Deliverable | Owner | Path | Gate |
|---|---|---|---|---|
| 0.1 | `scripts/db-baseline.mjs` — read-only snapshot: `pg_stat_statements`, table sizes, dead-row ratios, index usage, publication list, policy counts, definer-function classification | **D1** | `scripts/db-*.mjs` | JSON committed under `docs/evidence/d1/baseline/` with a UTC measurement timestamp on every line |
| 0.2 | Addendum re-measurement — re-run the addendum's own queries and record whether each 2026-09-01 figure still holds | **D1** | `docs/evidence/d1/baseline/` | **Disagreements are recorded, not resolved.** A figure that moved is a finding, not an error to tidy |
| 0.3 | 1-million-row staging seeder — deterministic, re-runnable, staging only, with a hard guard that refuses to run against the production project ref | **D1** | `scripts/db-*.mjs` | The guard is demonstrated **failing** against the production ref before the seeder is accepted |
| 0.4 | `scripts/web-baseline.mjs` — entry-bundle and per-chunk byte sizes, per-language chunk sizes, LCP/INP/CLS on a mid-range Android profile | **D2** | `scripts/web-*.mjs` | JSON committed under `docs/evidence/d2/baseline/` with a UTC timestamp on every line |
| 0.5 | Web-Vitals harness in **report-only** mode | **D2** | `tools/uishot/**`, `d2-*.yml` | It runs on every PR and **must not fail a build**. Making it blocking is P13, in Phase 5 — not now |
| 0.6 | Gate Register and this kickoff | **Auditor** | `docs/gates/**` | Published before either developer starts |

**Objects reserved: none.** Phase 0 is read-only against both databases. **No SQL apply in this phase.**

---

## 3 · Ownership, for this phase specifically

| | D1 | D2 |
|---|---|---|
| **Writes** | `scripts/db-*.mjs`, `docs/evidence/d1/**`, `d1-*.yml` | `scripts/web-*.mjs`, `docs/evidence/d2/**`, `tools/uishot/**`, `d2-*.yml` |
| **Never touches** | anything under `src/`, `public/`, `functions/`, `tools/`, D2's workflows or evidence | anything under `supabase/`, D1's scripts, workflows or evidence |
| **Frozen** | `scripts/lane-config.mjs` · `scripts/lane-config.d.mts` — Auditor approval **and** both sign-offs required | same |
| **Dependency window** | **not open** — see §4 | **not open** — see §4 |

`docs/PROMOTION_LEDGER.md` and `docs/gates/**` are the Auditor's. Nobody else commits to them, ever.

**A session never edits a file it does not own, even to fix an obvious typo.** Report it. One-line courtesy edits are exactly how two-author conflicts start.

---

## 4 · Dependency window

**Closed for Phase 0.** Neither developer may touch `package.json` or `package-lock.json`.

Both baseline scripts are to be written against what is already installed, or with Node built-ins. This is deliberate: the security gate `scripts/security-audit.mjs` uses only built-ins precisely so a broken dependency cannot stop it running, which is exactly when a gate matters most. The baselines inherit that property.

If a baseline genuinely cannot be written without a new package, **stop and request the window** — do not add it and mention it in the PR.

---

## 5 · Branch and PR discipline for this phase

- Branch off `staging` only: `d1/P0-db-baseline-20260902`, `d2/P0-web-baseline-20260902`.
- Every PR targets `staging`. **Never `main`.**
- One deliverable per PR. Six deliverables above, so up to six PRs — not one.
- Every PR body carries: the deliverable number from §2, its gate sentence from §2, the paths touched, and the evidence artefact path.
- Every PR is exercised by its own checks. A baseline script proves itself by running in CI on its own PR and committing its output.

---

## 6 · Standing holds in force from today

| # | Hold | What it means this phase |
|---|---|---|
| **H-1** | C-2 — four unreconciled unused-index counts | **No index is dropped by anyone.** The baseline *records* index usage; it proposes nothing |
| **H-2** | X1 / X2 not yet scheduled | P34's gate cannot close later; the baseline should capture policy counts now so the improvement is provable |
| **H-3** | D-002 public-bucket privacy gap | `PrivacyGapNotice` stays shipped; its test stays green |
| **H-4** | Staging credential untested since 2026-08-31 | **Owner action.** Should be settled before Phase 1, not during it |
| **H-5** | No required reviewer on the production Environment | **Owner action.** Two developers now dispatch work |

---

## 7 · Definition of done for Phase 0

1. Every unit in Addendum A that claims a number has a committed baseline, with the measurement timestamp on every line.
2. The seeder's production-ref guard has been demonstrated failing.
3. The Web-Vitals harness runs on every PR and blocks nothing.
4. The Gate Register carries a baseline evidence path for every one of the 35 rows.
5. **Promotion P-0** — CI and scripts only — runs the full nine-step checklist, and `compare/main..staging` reads `0 changed files, 0 additions, 0 deletions` afterwards.

Phase 0 is **about a week**, not two days. The seeder is the reason, and it is worth it: P20 and P34 are unprovable at 106 rows, and every measurement taken in Phases 2–4 is more honest against seeded data. Building it first means we never have to say *"green at 106, unknown at scale"*.

---

## 8 · The two habits this phase is here to establish

**Measure before and after, and name the instrument.** "Should be faster" is not a result. A number taken twice, with the instrument named, is.

**Seek the boring explanation first.** Three findings in the source measurement were reduced or withdrawn by that discipline, and it says so. A report that only grows is not a measurement.

---

*Issued by the Auditor. This kickoff assigns and constrains; it approves nothing and closes nothing.*
