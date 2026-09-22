# ledger-guard v3 — external pack

**Status:** EXTERNAL. Nothing in this pack is installed, committed, pushed, or connected to any
provider. The ledger `docs/PROMOTION_LEDGER.md` is not modified by this pack.

## Why this pack is NOT committed before promotion

The frozen application/code RC is **`a42b209e4f70a6efed4f3dcdb654e0f994416594`**.
Every commit on `staging` after `a42b209e` touches **`docs/PROMOTION_LEDGER.md` only**; that is
what makes the §3.1 Layer-1 identity "frozen" and what §3.5 clause 2 requires.

Committing **`tools/ledger_guard.py`**, **`tools/test_ledger_guard.sh`**,
**`tools/test_ci_propagation.sh`**, or **`.github/workflows/ledger-guard.yml`** before promotion
would place **non-`docs/` paths after `a42b209e`**. The consequences are not cosmetic:

| What breaks | Why |
|---|---|
| §3.1 Layer-1 code RC | `a42b209e` would no longer be the last non-docs commit; a NEW code RC is created |
| §3.2 / §5.0 scope counts | files-changed, lines and commit counts all move |
| §25 evidence rows | every row measured against `main…a42b209e` is re-based |
| PR #104 title and body | they state the frozen RC and the counts |
| §11 signature | signed against an RC that no longer exists |
| LG-02 in this very guard | it would report the code-frozen claim FALSE — correctly |

**Install after the promotion tag exists, as a separate PR.** That PR's own diff is then the
first change against the new baseline, and it is reviewed on its own merits.

## Contents

| File | What it is |
|---|---|
| `ledger_guard.py` | the guard, v3 |
| `test_ledger_guard.sh` | 66 assertions: positive + negative per check, adversarial, exit codes |
| `test_ci_propagation.sh` | 14 assertions: exit status must survive the pipe to `tee` |
| `ledger-guard.yml` | the workflow, for review only |
| `facts_rev16.json` | ATTESTED facts, used because the guard has no git access here |
| `REV16_REPORT_V3.txt` | the v3 run against the real REV-16 ledger |
| `REV16_FINDING_CLASSIFICATION_V3.md` | every finding classified real / false positive |
| `V3_FIX_EVIDENCE.md` | each of the 5 fixes → the tests that prove it |
| `TRANSCRIPT_selftest_linux.txt`, `TRANSCRIPT_ci_linux.txt` | measured, this host |
| `BLOCKED_ITEMS_V3.md` | what could NOT be measured, and why |
| `MANIFEST.sha256` | byte identity of everything above |

## Running it

```
python3 ledger_guard.py --repo /path/to/checkout --ledger docs/PROMOTION_LEDGER.md --base origin/main
python3 ledger_guard.py --facts facts_rev16.json --ledger docs/PROMOTION_LEDGER.md
```

Exit codes: `0` clean · `1` FAIL findings · `2` usage/environment error ·
**`3` BLOCKED — a check could not be performed. 3 is not a pass and not an ordinary failure.**
# v3 — the five required fixes, and the tests that prove each one

Every row names the test IDs in `test_ledger_guard.sh`. All 66 assertions passed on this host
(`TRANSCRIPT_selftest_linux.txt`).

## FIX 1 — a 32-hex value in a field typed commit/tree must FAIL

v2 downgraded it to WARN on the theory that it "looks like an md5 or a token id". That reasoning
was backwards: the *field* declares the type, so a value that is not a Git object of that type is
wrong, whatever it resembles. Fields that legitimately hold non-Git identifiers (Cloudflare
account id, token ids) are now declared `opaque` in `CANONICAL_FIELDS` and are not type-checked
at all.

| Test | Assertion |
|---|---|
| `V1-P` | 32-hex in `Merge base` (typed commit) → **LG-03 FAIL = 1** |
| `V1-P2` | the message says "typed commit", i.e. it names the reason |
| `V1-N` | 32-hex in `Cloudflare account id` (typed `opaque`) → **FAIL = 0** |

## FIX 2 — void identity compared across full and abbreviated SHAs; ambiguity is BLOCKED

v2 compared SHA *strings*. A void full SHA reused as an 8-char abbreviation slipped through.
LG-04 now resolves both sides to a full object id before comparing.

| Test | Assertion |
|---|---|
| `V2-P` | full void SHA reused as an abbreviation → **LG-04 FAIL** |
| `V2-P2` | abbreviated void SHA reused in full form → **LG-04 FAIL** |
| `V2-N` | a genuinely different commit → **silent** |
| `V2-A` | an ambiguous abbreviation → **LG-04 FATAL**, never resolved |
| `V2-A2` | the message says "ambiguous abbreviation" |
| `V2-A3` | the run exits **3** (BLOCKED), not 0 and not 1 |

*Scope note:* `V2-A` is exercised through the attested fact source, not a live repo. The guard
only reads 7–40 hex as a SHA, and two real Git objects sharing a 7-hex prefix cannot be
synthesised cheaply (a 2^28 birthday search). The ambiguity *path* is identical for both fact
sources — `GitFacts.resolve()` raises the same `Ambiguous` exception on git's own
"short SHA1 … is ambiguous" — but the live-git branch of that path is **SPECIFIED, NOT EXECUTED**.

## FIX 3 — `ls-remote` failure is not an empty result

v2 returned `[]` both when the remote had no tags and when the command failed. A ledger claiming
"zero tags exist" was therefore *confirmed* by an unreachable origin. `tags_remote()` now returns
`(list, ok)`.

| Test | Assertion |
|---|---|
| `V3-N` | origin reachable → no FATAL |
| `V3-P` | origin URL points at a nonexistent repo → **LG-09 FATAL** |
| `V3-P2` | the text says "BLOCKED, not confirmed" |
| `V3-P3` | exit **3** |
| `V3-P4` | the report does **not** contain "no-tags claim confirmed" |
| `V3-N2` | restoring origin clears the FATAL (proves the test is not stuck) |

## FIX 4 — endpoint and basis inheritance reset at every Markdown table boundary

v2 inherited within a *section*. Two tables in one section could therefore hand a scope endpoint,
or a measurement basis, to a table that never declared one. Rows now carry a `table` id; any
non-table line closes the table.

| Test | Assertion |
|---|---|
| `V4-N` | one table: the second row inherits the endpoint → no "declares no endpoint pair" |
| `V4-N2` | one table: a row whose basis cell says `same` inherits → **LG-07 FAIL = 0** |
| `V4-P` | a sentence between the tables → the endpoint is **not** inherited → WARN raised |
| `V4-P2` | same split → the basis is **not** inherited → **LG-07 FAIL = 1** |

The `joined`/`split` fixtures differ by exactly one line — a sentence between the two tables —
so the pair isolates the boundary and nothing else.

## FIX 5 — attested SHA matching

A short input is accepted only as an **unambiguous prefix of a known full SHA**. A longer value is
never accepted merely because a known short entry prefixes it. `facts_rev16.json` now keeps full
SHAs in `known_commits` / `known_trees`; the 38 commit and 1 tree abbreviations whose full form
was not read are attested separately in `*_abbrev_only` and produce a **WARN**
("attested only as an abbreviation, typed check not possible") — never a pass, never a FAIL.

| Test | Assertion |
|---|---|
| `V5-N` | unambiguous 8-char prefix of a known full SHA → accepted |
| `V5-N2` | the full SHA itself → accepted |
| `V5-P` | `deadbeef1234` where only `deadbee` is attested → **FAIL** |
| `V5-W` | `deadbee` (short-only attestation) → **WARN** |
| `V5-W2` | …and not a FAIL |
| `V5-A` | 7-char prefix shared by two known full SHAs → **FATAL** |
| `V5-A2` | the ambiguous case is not also counted as FAIL |
| `V5-A3`/`V5-A4` | an 8-char prefix that resolves to exactly one of them → accepted |

## Two defects found *during* v3 and fixed here

1. **`| tee report.txt || true`** — I wrote this into the workflow to stop `set -e` aborting the
   step. `|| true` overwrites `PIPESTATUS`, so every failure would have read as 0 — the exact
   v1 defect, reintroduced. The step now drops `set -e` instead. Test `C10` proves the bug;
   `C11`–`C14` prove the v3 shape, including that exit **3** survives the pipe.
2. **`FATAL=` in the summary line** broke the self-test's own `^FAIL=` extractor, so the
   baseline assertion `N0` was silently failing. Fixed, and the extractor no longer anchors.
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
# v3 — what could NOT be measured

Recorded under the standing rule: never silently convert one evidence category into another.

## B-1 · Git-for-Windows transcript — **BLOCKED**

**Requested:** "Git-for-Windows and Linux transcripts."
**Status:** the Linux transcripts are MEASURED on this host. **There is no Windows host in this
session.** No Windows transcript is supplied, and none is simulated. A transcript I typed out
would be a fabrication of the same class as the `MANIFEST.sha256` size I invented in an earlier
round.

What can honestly be said about Windows portability is a list of **risks**, not results —
`SPECIFIED, NOT EXECUTED`:

| Risk | Mitigation already in the scripts | Still unproven |
|---|---|---|
| CRLF line endings break `bash` | both scripts abort with `FATAL: CRLF line endings` | the check itself is untested on Windows |
| `python3` may only exist as `python` | none — the scripts call `python3` | would need a `PY=${PY:-python3}` shim |
| `sha256sum` absent in some shells | Git-for-Windows ships it in its usrbin | unverified |
| `mktemp -d` path contains spaces | every path is quoted | unverified |
| `core.autocrlf=true` rewrites fixture files | fixtures are created in a temp repo, not checked out | unverified |
| `declare -A` needs bash ≥ 4 | Git-for-Windows ships bash 5.x | unverified |

**To close B-1:** run `bash test_ledger_guard.sh` and `bash test_ci_propagation.sh` in Git Bash on
a Windows host and paste the output. That is a ten-minute task for anyone with the machine. It is
not a task I can honestly complete from here.

## B-2 · "Measured" exact-REV-16 report — **BLOCKED; ATTESTED supplied instead**

**Requested:** "a measured exact-REV-16 report."
**Status:** the guard has **no git access to `altisinfonet/lens-lustre-learn-Claude`** in this
session (`git push` blocked; `GH_TOKEN` returns 403 "GitHub access to this repository is not
enabled for this session"). `REV16_REPORT_V3.txt` was therefore produced with `--facts`, and
**every finding in it is printed with the `[ATTESTED]` tag**. The ledger file itself IS the real
one — 182,502 bytes, sha256 `f00f612a…5943` — so the document-only checks (LG-06, LG-07, LG-08,
LG-10) are measured; the git-derived checks (LG-01, LG-02, LG-04, LG-05, LG-09) are only as good
as `facts_rev16.json`, which I read from GitHub's compare and blob views at 12:02Z.

**To close B-2:** run the `--repo` form in any checkout of `staging`. One command, and every
`[ATTESTED]` tag becomes `[MEASURED]`.

## B-3 · Live-git ambiguous abbreviation — **SPECIFIED, NOT EXECUTED**

See `V3_FIX_EVIDENCE.md`, FIX 2 scope note. The attested branch is tested; the `GitFacts` branch
raising `Ambiguous` from git's own error text is not, because a 7-hex object collision cannot be
manufactured cheaply.

---

## MANIFEST.sha256 (verbatim)

```
404f9e6047338d6bd6c3f3a6ca1dc92f594e485a04cfc6a847384e6bd7596f25  00_README_V3.md
023302b33920ec22387f7c64f24d554c93fadebb044829392a9b480c3c4f5d1a  BLOCKED_ITEMS_V3.md
4a178c4705693cf4e822edf3e586ddfbd604f6cdf631859d43379902c301a8cc  REV16_FINDING_CLASSIFICATION_V3.md
844890d7b189912efd5ef1a9c95dc5c4de2dc8af640897140a99b0deecbdd3be  REV16_REPORT_V3.txt
440b4bcdf91c4e218cc37e6fb99f1ef079ba620401c4d10b4a7344525a6a2cf4  TRANSCRIPT_ci_linux.txt
df35fd74db1af25e578e4c34c973c309e7fe3c8226dd8f094ba31f2b36f807ca  TRANSCRIPT_selftest_linux.txt
6f499ddeae266f00299deeb22e712c89eda44e37aaf52c54c9687bbd4e261d95  V3_FIX_EVIDENCE.md
b343a7d1bd024300dde09013c11bd1bdc1b92abcda7aa5b87d1029336337dd0a  facts_rev16.json
3eafce220e79aca8f411bcd9c9b0e2d6de97d32b5f41c419cf186178b3d8a1cd  ledger-guard.yml
a9629fcf2d18d0ce7a3a2567e4471d261f2f963b503d3dcb6629c08274b79a42  ledger_guard.py
429eaa172305309b1723cabcf0a8f38d74d381134a5c2ae473f70bcd0e00c289  test_ci_propagation.sh
39e5bd950f9dd6884e25ef6e3a0e3a6e57593a5f9226ae94ac5e48f7b7560e91  test_ledger_guard.sh

# sizes (bytes), measured 2026-08-29T16:04:42Z
#       2720  00_README_V3.md
#       2806  BLOCKED_ITEMS_V3.md
#       3978  REV16_FINDING_CLASSIFICATION_V3.md
#       1913  REV16_REPORT_V3.txt
#       1131  TRANSCRIPT_ci_linux.txt
#       5040  TRANSCRIPT_selftest_linux.txt
#       5213  V3_FIX_EVIDENCE.md
#       3381  facts_rev16.json
#       3662  ledger-guard.yml
#      29338  ledger_guard.py
#       4647  test_ci_propagation.sh
#      17913  test_ledger_guard.sh
```

Pack tarball `ledger-guard-v3.tar.gz` sha256 `abeccf1a6284ef8ad5893d9779fb3578587c2799e94984121c31969258572d83` (27,697 bytes).
