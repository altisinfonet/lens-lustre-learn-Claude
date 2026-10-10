# ⛔ INSTALLATION GATE — ledger-guard v3 MUST NOT be installed until LG-05-DEF-1 is fixed

**Status: SPECIFIED, NOT IMPLEMENTED. The guard remains external. No fix is claimed or applied in
this session.** `ledger_guard.py` in this pack is the **unfixed** v3, sha256
`a9629fcf2d18d0ce7a3a2567e4471d261f2f963b503d3dcb6629c08274b79a42` — byte-identical to the pack
MANIFEST, defect included, deliberately.

## Why this gate exists

Against REV-16 the guard reports **8 FAILs. Three of them are false.** LG-05 attributes a table row
to a scope endpoint found **anywhere in the row, including the instrument cell**. §3.2(b)'s commit
row cites `compare/main...staging.patch` as *how it was measured*; the guard normalises `...` to `…`,
matches `main…staging`, and judges a **correctly labelled `main…fe63e944` row** against an endpoint
it never claimed.

**A row is attributed by how it was measured, not by what it measures.** That is the defect.

Installing it in this state puts a gate into CI that **goes red on a correctly-written ledger**. That
is precisely the failure `POST_PROMOTION_PLAN` C1 warns about: a gate that cries wolf is ignored,
and an ignored gate is worse than no gate. It would also train future authors to "fix" ledger rows
that were right.

**Gate condition: this defect is fixed, and the fixtures below pass, before
`.github/workflows/ledger-guard.yml`, `tools/ledger_guard.py` or its tests are committed.**

## The three faults, in severity order

1. **The instrument cell participates in endpoint matching.** Highest severity — it is what produces
   the false FAILs.
2. **Section headings are never consulted.** §3.2 declares its endpoints in its `###` headings, which
   is exactly where a human reader looks. LG-05 reads only rows.
3. **An endpoint absent from the fact source cannot be matched, and the row silently falls through**
   to whatever other endpoint-looking string appears in its text. `main…fe63e944` was never in
   `facts_rev16.json`, so the correct label could not have won even if headings were read.

## Required rule — endpoint resolution precedence

LG-05 must resolve a row's endpoint by this precedence, and **must never guess**:

| # | Source | Behaviour |
|---|---|---|
| 1 | An endpoint label in the row's **label cell** | use it |
| 2 | otherwise, the nearest enclosing **section heading** that declares one | use it |
| 3 | otherwise, an endpoint declared **earlier in the same table** | use it — existing behaviour, unchanged |
| 4 | otherwise | **`WARN — endpoint undeclared, not checked`** |

**The instrument cell is excluded from endpoint matching entirely.**

**An endpoint named in a row but absent from the fact source must produce
`WARN: endpoint '<name>' not known to this fact source; row not checked`** — never a comparison
against a different endpoint, and never a silent fall-through.

## Required fixtures — positive AND negative per rule

Each rule above needs both a firing and a silent case, in `test_ledger_guard.sh`, matching the
existing per-check coverage discipline (the suite currently reports POSITIVE/NEGATIVE per check and
must continue to).

**The mandatory regression fixture — reproduce the §3.2(b) shape exactly:**

> A row whose **instrument cell cites one endpoint** while its **enclosing heading declares another**,
> with a value that is **correct for the heading's endpoint** and **wrong for the instrument's**.

```
### (b) Total promotion scope — `main…<FROZEN_SHA>` (code + this ledger)

| Metric | Value | Instrument |
|---|---|---|
| Commits ahead of `main` | **<correct count for main…FROZEN_SHA>** | `compare/main...staging.patch` |
```

- **Under the fixed rule this row MUST be SILENT.** Heading (rule 2) wins; the instrument cell is
  never consulted.
- **Under today's code this row FAILs.** That is the regression the fixture pins.

Additional required fixtures:

| Fixture | Expected under fixed rule |
|---|---|
| Row label cell names an endpoint; instrument cell names a different one | label cell wins — silent if the value is right for it |
| No label, no heading, an endpoint declared earlier in the same table | earlier-in-table wins (rule 3 unchanged) |
| No endpoint discoverable anywhere | `WARN — endpoint undeclared, not checked`; **never FAIL, never silent pass** |
| Row names an endpoint the fact source does not know | `WARN: endpoint '<name>' not known to this fact source` |
| Endpoint declared in a heading, value genuinely wrong for it | **FAIL** — the fix must not suppress true positives |
| §5.0-shaped row: label cell itself says `main…staging`, value stale | **FAIL** — findings 4–6 must survive the fix |

That last two rows matter as much as the silencing cases: **the fix must not convert real findings
into silence.** Findings 4, 5, 6 (lines 426, 428 ×2) and 7, 8 (LG-08, lines 46 and 790) are REAL and
must still fire after the fix.

## Acceptance criteria for the fix

1. `test_ledger_guard.sh` passes with **all existing 66 assertions plus the new fixtures**, positive
   and negative per rule.
2. `test_ci_propagation.sh` still passes 14/14.
3. Re-run against REV-16 yields **`FAIL=5`**, not 8 — findings 4–8 only.
4. The instrument cell is demonstrably excluded: a fixture with an endpoint string present **only**
   in the instrument cell produces `WARN — endpoint undeclared`, not a comparison.
5. No fix is accepted on the strength of the guard's own output alone: the corrected REV-16 result
   must be corroborated by direct `git` measurement of each endpoint, as was done here.

## Corroborating measurement already available

The endpoint series in the REV-17 correction set (`04_REV17/`, C-12) was measured directly from the
live repository on 2026-08-30 and is the ground truth against which the fix should be checked:

| staging HEAD | Revision | Commits (with / without merges) | Lines |
|---|---|---|---|
| `a42b209e` | code RC | 39 / 37 | +9,060 / −1,293 |
| **`fe63e94`** | **REV-12** | **45 / 43** | **+9,494 / −1,293** |
| **`393bc55`** | **REV-13** | **46 / 44** | **+9,680 / −1,293** |
| `9ac4524` | REV-16 | 49 / 47 | +10,159 / −1,293 |

`main..fe63e944` = **45 / 43** and **+9,494 / −1,293** is the measurement that proves findings 1–3
false. Instrument: `git rev-list --count b671e1fb..fe63e944` and
`git diff --numstat b671e1fb...fe63e944`, live repository, read-only clone, 2026-08-30.

**Nothing in this document closes a §25 row. The guard is not fixed here.**
