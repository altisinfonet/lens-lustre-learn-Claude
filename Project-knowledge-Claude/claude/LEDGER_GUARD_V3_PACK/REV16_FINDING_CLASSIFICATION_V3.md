# v3 against the real REV-16 ledger — every finding classified

Run: `python3 ledger_guard.py --facts facts_rev16.json --ledger PROMOTION_LEDGER.md`
Ledger: 182,502 bytes · sha256 `f00f612a057477146f4047f5af9235337f857d31887bb10e5bb56c98a9cd5943`
Result: **FATAL=0 FAIL=8 WARN=3 INFO=4** · exit 1
Fact class: **ATTESTED** — see `BLOCKED_ITEMS_V3.md` B-2.

v2 reported FAIL=8 WARN=1 INFO=4. v3 adds the two LG-03 abbreviation WARNs required by FIX 5.
**No v2 finding was removed and no new FAIL appeared** — the five fixes changed how the guard
decides, not what the ledger says.

## The 8 FAILs

| # | Line | Finding | Classification |
|---|---|---|---|
| 1 | 120 | claims 43 commits for `main…staging`; endpoint value 49 | **REAL** |
| 2 | 120 | claims 45 commits for `main…staging`; endpoint value 49 | **REAL** |
| 3 | 122 | claims +9,494/−1,293 for `main…staging`; endpoint value +10,159/−1,293 | **REAL** |
| 4 | 426 | claims +9,680/−1,293 for `main…staging`; endpoint value +10,159/−1,293 | **REAL** |
| 5 | 428 | claims 44 commits for `main…staging`; endpoint value 49 | **REAL** |
| 6 | 428 | claims 46 commits for `main…staging`; endpoint value 49 | **REAL** |
| 7 | 46 | `§16.4` does not resolve to that exact subsection | **REAL** |
| 8 | 790 | `§8.6` does not resolve to that exact subsection | **REAL** |

**False positives: 0.**

### Findings 1–6 are one structural defect, not six typos

Every one of these rows states a figure and labels its endpoint **`main…staging`**. `staging`
moves every time the ledger is saved. So the figure is correct at the instant it is written and
stale one commit later — §3.1 Layer 2, "historical by construction", applied to numbers instead
of SHAs. The three different line totals (+9,494 · +9,680 · +10,159) and the four different
commit counts (43 · 44 · 45 · 46 · vs 49) are snapshots of the same repository at four different
save points.

**The fix is not to re-measure them again.** It is to restate them against the frozen endpoint
`main…a42b209e`, which does not move: 138 files, +9,060/−1,293, 45 commits (43 excluding merges).
The ledger already carries that row at line 427 — correctly, and the guard does not flag it.
Any figure that must be quoted against `main…staging` should carry the head SHA it was measured
at, so the guard can compare like with like instead of against a moved target.

### Findings 7–8 are ordinary cross-reference rot

`§16.4` and `§8.6` are cited in active prose but no heading of that number exists. Either the
subsection was renumbered or the reference was written for a planned section. Both are one-line
edits — and both are exactly what §28 froze the document to stop accumulating.

## The 3 WARNs

| Line | Finding | Classification |
|---|---|---|
| 21 | code-RC field holds 4 live SHAs; only the first is treated as the RC | **REAL, low severity** — the field mixes the RC with commentary SHAs. Correct behaviour is to warn, not to guess. |
| 21 | `9faf5a17` attested only as an abbreviation | **CORRECT BEHAVIOUR (new in v3)** — the guard says "I cannot type-check this", which is the truth. With `--repo` this WARN disappears. |
| 21 | `fe4505aa` attested only as an abbreviation | as above |

## The 4 INFOs

LG-02 code-frozen claim holds (only `docs/` after `a42b209e`) · LG-04 one void SHA recognised ·
LG-06 header `REV-16` matches the newest table row · LG-09 no-tags claim confirmed local and
remote. All four are the ledger being *right*, recorded so the report is not only a list of
complaints.

## What this means for promotion

**Nothing in this report blocks the merge.** All 8 FAILs are in ledger *prose and figures*, not
in code, and the ledger is frozen under §28 — §28.3 already lists post-promotion tidy items.
Findings 1–6 argue for one §3.5 amendment (state figures against the frozen RC, or carry the head
SHA); findings 7–8 are two reference fixes. None of them changes what is deployed.
