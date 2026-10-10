# LG-05-DEF-1 — ledger-guard v3 misattributes scope endpoints, and my REV-16 classification was wrong

**Recorded 2026-08-30. Written by the compiler against its own instrument. Prior conclusions are
preserved, not overwritten (§14).**

## The prior conclusion, preserved

`REV16_FINDING_CLASSIFICATION_V3.md` states, of ledger-guard v3's eight FAIL findings against
REV-16:

> **False positives: 0.**

and classifies findings 1–3 (lines 120 and 122) as:

> claims 43 / 45 commits for `main…staging`; endpoint value is 49 (47 no-merges)
> claims +9,494/−1,293 for `main…staging`; endpoint value is +10,159/−1,293
> … **REAL** … one structural defect: figures labelled `main…staging`, an endpoint that moves.

**That classification is wrong.** It is preserved above and struck below, not deleted.

## What the ledger actually says

Read from `docs/PROMOTION_LEDGER.md` at REV-16, lines 106–124:

```
### (a) Application scope — `main…a42b209e` (what actually changes behaviour)
| Files changed | 138 — 31 added, 107 modified, 0 deleted |
| Lines | +9,060 / −1,293 |
                      ← NO COMMIT COUNT IS RECORDED IN (a)

### (b) Total promotion scope — `main…fe63e944` (code + this ledger)
| Commits ahead of `main` | 45 counting merge commits · 43 excluding them |
| Lines | +9,494 / −1,293 |
```

`fe63e944` is a **frozen** endpoint, not a moving one. **45 / 43 and +9,494 / −1,293 are correct
for `main…fe63e944`.** The ledger labelled its figures properly. Findings 1–3 are **FALSE
POSITIVES**.

## The defect that produced them

`ledger_guard.py`, LG-05:

```python
rowtext = ' | '.join(r.cells).replace('...', '…')
for name, (a, b) in endpoints.items():
    if name in rowtext:
        ep = (name, a, b); break
```

Three faults, in order of severity:

1. **The endpoint is taken from anywhere in the row, including the INSTRUMENT cell.** The §3.2(b)
   commit row cites `compare/main...staging.patch` as its instrument. LG-05 normalises `...` to `…`,
   finds `main…staging` in that citation, and attributes the row to an endpoint the row does not
   claim. **A row is attributed by how it was measured, not by what it measures.**
2. **Section headings are never consulted.** §3.2 declares its endpoints in its `###` headings —
   exactly where a reader looks. LG-05 reads only rows.
3. **An endpoint absent from the facts file cannot be matched at all**, so a row correctly labelled
   with an unknown endpoint silently falls through to whatever other label appears in its text.
   `main…fe63e944` was never in `facts_rev16.json`.

## Corrected classification of the REV-16 run

| # | Line | Finding | Prior class | **Corrected class** |
|---|---|---|---|---|
| 1 | 120 | claims 43 commits for `main…staging` | REAL | **FALSE POSITIVE** — row is `main…fe63e944`, where 43 is correct |
| 2 | 120 | claims 45 commits for `main…staging` | REAL | **FALSE POSITIVE** — same |
| 3 | 122 | claims +9,494/−1,293 for `main…staging` | REAL | **FALSE POSITIVE** — same |
| 4 | 426 | claims +9,680/−1,293 for `main…staging` | REAL | **REAL** — §5.0's row carries the label `main…staging` itself |
| 5 | 428 | claims 44 commits for `main…staging` | REAL | **REAL** — same |
| 6 | 428 | claims 46 commits for `main…staging` | REAL | **REAL** — same |
| 7 | 46 | `§16.4` does not resolve | REAL | **REAL** — unchanged |
| 8 | 790 | `§8.6` does not resolve | REAL | **REAL** — unchanged |

**Corrected totals: 5 REAL, 3 FALSE POSITIVES.** The claim "zero false positives" is withdrawn.

## Consequences

- **My C-12 draft was built on this false positive** and would have written a false correction into
  the correction register. The executing session refused it and was right to. A correction register
  whose corrections cannot be trusted is worse than no register.
- **`facts_rev16.json` separately records `commits: 45, commits_no_merges: 43` for the
  `main…a42b209e` range, where measured is 39/37.** That is a real defect, in the fact file, not in
  the ledger — recorded as **C-17**. Its cause is the same act: a figure copied from §3.2 into the
  fact file without checking which endpoint §3.2 attached it to.
- **Neither guard mode could have caught C-17.** `--facts` because it was circular; `--repo`
  because no ledger row claims a commit count for `main…a42b209e`, so LG-05 correctly stays silent.
  It was findable only by direct measurement.
- **Installation gate:** LG-05-DEF-1 must be fixed before ledger-guard is installed. As it stands
  the guard produces false red on a correctly-written ledger, which is the failure mode
  `POST_PROMOTION_PLAN` C1 warns about — a gate that cries wolf gets ignored, which is worse than
  no gate.

## Required fix, specified not implemented

LG-05 must resolve a row's endpoint in this precedence, and must never guess:

1. an endpoint label in the row's **label cell**;
2. otherwise, the nearest enclosing **section heading** that declares one;
3. otherwise, an endpoint declared **earlier in the same table** (existing behaviour, unchanged);
4. otherwise **WARN — endpoint undeclared, not checked**.

The **instrument cell is excluded from endpoint matching entirely.** An endpoint named in the row
but absent from the fact source must produce `WARN: endpoint '<name>' not known to this fact
source; row not checked` — never a comparison against a different endpoint.

Positive and negative tests are required for each rule, including one fixture that reproduces the
§3.2(b) shape exactly: a row whose instrument cell cites one endpoint while its heading declares
another. Under the fixed rule that row must be **silent**; under today's code it FAILs.

**The guard remains external. This defect is not repaired in this session and no fix is claimed.**
