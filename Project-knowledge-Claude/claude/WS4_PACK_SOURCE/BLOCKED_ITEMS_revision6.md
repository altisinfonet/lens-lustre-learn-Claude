# ITEMS THE COMPILER CANNOT PERFORM — revisions 6, 7 and 8

**Recorded here rather than faked, per the pack's own rule (§0.2): an unfilled check is `BLOCKED`,
never a pass, and fixture mode is never described as testing real RC files.**

## B1 · Item 3 — authoritative `09_rc_regression.sh --rc-root` run against `a42b209e`

**Status at revision 6/7: `BLOCKED`. Not attempted by substitution.**

> **Revision 8 update — reported CLOSED by the independent auditor, not by the compiler.**
> The auditor's Git-for-Windows execution reported an **exact clean `a42b209e` regression:
> `8/8`, exit 0**. That closes the substance of B1: the recorded ground truth matches the real
> RC files. **Evidence class: AUDITOR-ATTESTED.** The compiler did not witness the run, holds
> no transcript of it, and does not restate it as a measurement of its own. Revision 8 does not
> change the ground truth this result validated.
> Revision 8 additionally makes `13_make_rc_fixtures.sh` **fail closed** (G1–G4), so a future
> `--rc-root` run cannot silently be pointed at the wrong or a dirty checkout.

**The original record, preserved:**

| | |
|---|---|
| Required | run the RC regression in `mode=real-checkout` against a real clone or `git archive` of `a42b209e4f70a6efed4f3dcdb654e0f994416594`, transcript naming the commit/tree |
| Why blocked | the compiler has **no git access to this private repository** (API returns 403, `git clone` unavailable), and the **file contents of the three RC files are refused by a content filter** on the read path that is available. The three shipped `fixtures/rc/*` files are therefore **shape fixtures** — real specifiers, real statement shapes, **elided bodies** |
| Consequence | `TEST_TRANSCRIPT.txt` shows `mode : fixture`. **That is not a real-RC run and is not described as one.** |
| Who can close it | the auditor or owner, from a checkout: `bash 09_rc_regression.sh --rc-root <path>` — the transcript must read `mode : real-checkout` and record `git rev-parse HEAD` (= `a42b209e…`) and `git rev-parse HEAD^{tree}` |
| Expected on success | `PASS=8 FAIL=0`. **A failure there is a real finding** — it would mean the shipped ground truth diverges from the real files |

## B2 · Item 4 (second half) — re-run under Git for Windows

**Status: CLOSED 2026-08-29 — AUDITOR-ATTESTED.** The independent auditor executed revision 8 under
Git for Windows: verifier 30/30, self-test 56/56, RC-root 12/12, fixture gate 30/30, exact RC
regression 8/8, mutation control `DETECTED=13 UNDETECTED=0 NO-OP-HERE=0`, exit 0. The compiler did
not witness the run and holds no transcript of it.

**The original record, preserved:**

**Status at revisions 6/7: `BLOCKED`. Not simulated.**

| | |
|---|---|
| Required | execute both suites under Git for Windows with an LF-checked-out script, proving CRLF robustness end to end |
| Why blocked | this environment is **Linux only** (`Linux 6.18.44 x86_64`). There is no Windows host, and emulating one would not be evidence |
| What WAS done | the **cause** is addressed in code: every captured comparison value is passed through `tr -d '\r'`, so CRLF on **Python's stdout** (the Windows case) no longer breaks comparisons — not merely CRLF in the script file. A CRLF **script** still exits 2 with one FATAL. A **prerequisite gate** now emits one FATAL and exits 2 when `python3`, `timeout`, `sha256sum` or any other required tool is missing, instead of a suite of misleading failures |
| Who can close it | anyone with a Windows host: check out with `core.autocrlf=input` and run, in Git Bash — `bash 10_verify_pack.sh` (expect **`PASS=30 FAIL=0`**), `bash 08_selftest.sh` (**`PASS=56 FAIL=0`**), `bash 09_rc_regression.sh` (**`PASS=8 FAIL=0`**), `bash 12_rc_root_mode_test.sh` (**`PASS=12 FAIL=0`**), `bash 15_fixture_gate_test.sh` (**`PASS=30 FAIL=0`**), `bash 11_mutation_control.sh` (**`DETECTED=13 UNDETECTED=0 NO-OP-HERE=0`** — thirteen on Windows, because `M8c` is a defect there and moves into the detected count; on POSIX it is `12` with `NO-OP-HERE=1`) |
| ⚠ counts changed | revision 6 said `PASS=36` and `PASS=11`. Revision 7 raised the self-test to 51 and the verifier to 28; **revision 8 raises the self-test to 56** (T38/T38b/T38c/T39/T39b, the portable path-output contract) **and the verifier to 30**, and adds `15_fixture_gate_test.sh` (30 assertions) plus the platform-conditional mutation `M8c`. Use the numbers in this row, not the older ones |

**Neither item is claimed as done. Neither is labelled `SMOKE-TESTED` or `EXECUTED`.**


---

## B3 · Windows MUTATION CONTROL — **CLOSED 2026-08-29, AUDITOR-ATTESTED**

**Status: CLOSED.** The auditor's Git-for-Windows run of revision 8 returned `DETECTED=13
UNDETECTED=0 SKIPPED=0 EQUIVALENT=3 FALSE-EQUIV-CLAIMS=0 NO-OP-HERE=0`, exit 0 — **`M8c`
DETECTED where it is a defect.** The compiler did not witness the run.

**The original record, preserved:**

**Status at the time of writing: `BLOCKED`. Not claimed, not inferred from the Linux run.**

| | |
|---|---|
| What happened | The auditor's independent Git-for-Windows run of **revision 7** returned `DETECTED=11 UNDETECTED=1`, with **M8 escaping**, exit 1. Every other suite passed. |
| Why it escaped | Revision 7's M8 substituted `os.path.abspath()` for `os.path.realpath()`. **Those two functions differ ONLY in symlink resolution.** It was detected on Linux solely because `T36` could create a symlink with `ln -s`. On Git for Windows without Developer Mode `ln -s` is unavailable, `T36` skips, and the mutation is **genuinely undetectable — an equivalent mutant, not a test gap.** |
| What revision 8 changed | M8 now mutates the **portable** half of `norm()`'s contract — output must be root-relative — and is detected on every platform. The abspath substitutions are recorded as **E2/E3 equivalent mutants** with the reason stated, so they can never again be reported as UNDETECTED. A new platform-conditional mutation **M8c** (separator normalisation) is a real defect on Windows and a declared no-op on POSIX. |
| Still blocked | **M8c has never been executed where it is a defect.** The Linux run reports it `NO-OP-HERE`, which is **not coverage**. Windows mutation-control results for revision 8 do not exist. |
| Who can close it | the auditor, by re-running `bash 11_mutation_control.sh` on Git for Windows against revision 8. Expected there: `DETECTED=13 UNDETECTED=0 NO-OP-HERE=0`, with **M8c DETECTED** — `12 + M8c = 13`. |

## B4 · Symlink resolution — **UNTESTED ON EVERY PLATFORM, by construction**

`os.path.realpath()` differs from `os.path.abspath()` only for symlinks, junctions and Windows
short names. The pack therefore **cannot** prove that the `realpath` calls in `closure()` and
`norm()` are load-bearing, on any platform, without creating a symlink — and a symlink test is
platform-gated, so it is **not proof**. `T36` is retained and clearly labelled; it is **excluded
from every coverage claim**. The property is recorded here as untested rather than counted.

**This is a limitation of the pack, stated. It is not closed by revision 8.**
