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
