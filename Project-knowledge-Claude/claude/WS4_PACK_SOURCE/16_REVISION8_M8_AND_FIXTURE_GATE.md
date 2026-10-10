# REVISION 8 — M8 repair, fail-closed fixture generation, template correction

**Revision 7 is NOT accepted.** This revision responds to the independent auditor's
Git-for-Windows execution of revision 7 and changes nothing outside this external pack.

**No repository change. No ledger change. No provider operation. No deviation drafted.
Nothing installed, committed, pushed, deployed, migrated or configured.**
`main` remains `b671e1fb0c5bcf145d442076c229eca888afd674`.

**This pack is not ready, and WS4 is not closed.** See §8.5.

---

## 8.0 · What the auditor's Windows run returned

| Suite | Windows result |
|---|---|
| `10_verify_pack.sh` | 28/28, exit 0 |
| `08_selftest.sh` | 51/51, exit 0 |
| `12_rc_root_mode_test.sh` | 12/12, exit 0 |
| `09_rc_regression.sh` — exact clean `a42b209e` | **8/8, exit 0** |
| `11_mutation_control.sh` | **DETECTED=11, UNDETECTED=1 — M8 escaped — exit 1** |

The exact-RC regression result closes the substance of **B1**: the recorded ground truth matches
the real RC files. It is recorded as **AUDITOR-ATTESTED**. The compiler did not witness that run
and does not restate it as a measurement of its own.

## 8.1 · Why M8 escaped — and why it was not a test gap

Revision 7's M8 substituted `os.path.abspath()` for `os.path.realpath()`.

**Those two functions differ only in symlink resolution** (plus Windows junctions and 8.3 short
names). Measured directly:

```
'/tmp/nx/a/b/f.ts'          abspath == realpath   True
'/tmp/nx/a/./b/f.ts'        abspath == realpath   True
'/tmp/nx/a/b/../b/f.ts'     abspath == realpath   True
```

`os.path.relpath()` also normalises both of its arguments lexically, so `.` and `..` segments
cannot discriminate either. On Linux the mutation was caught by exactly one test — `T36`, which
creates a symlink with `ln -s`. On Git for Windows without Developer Mode `ln -s` is unavailable,
`T36` skips, and **no test can detect the mutation, because there is nothing to detect: it is an
equivalent mutant on that filesystem.**

Revision 7 shipped a mutation whose detection depended on a platform capability, and counted the
resulting green as coverage. That was the defect. The auditor is right that platform-specific
symlink behaviour must not be treated as proof of canonicalisation.

## 8.2 · The repair

**M8 now mutates the portable half of `norm()`'s contract.** Output must be **root-relative**;
the mutant returns the absolute path instead. That is a real defect — absolute paths would leak
into the manifest — and it is detected on every platform.

**A new platform-conditional mutation `M8c`** removes the `os.sep → '/'` normalisation. On
Windows that is a real defect: two auditors on different operating systems would produce
manifests that differ by separator alone. On POSIX `os.sep` is already `/`, so the substitution
cannot change a byte. The mutation control detects the platform and reports:

* on Windows — `DETECTED` or `UNDETECTED`, as an ordinary mutation;
* on POSIX — **`NO-OP`**, with the reason printed and an explicit note that it **remains BLOCKED
  until re-run where it is a defect**. A no-op is never counted as coverage.

**The abspath substitutions are now declared equivalent mutants**, `E2` and `E3`, with their
reason stated, and the equivalence claim is asserted in both directions — if a test ever detected
one, the run fails with `FALSE-EQUIV-CLAIMS`. They can never again be reported as `UNDETECTED`.

**Five new portable assertions** replace the symlink test as the canonicalisation contract:

| Test | Assertion |
|---|---|
| `T38` | closure output is root-relative, never absolute |
| `T38b` | manifest paths are root-relative too |
| `T38c` | no `.` or `..` segment survives into the output |
| `T39` | output uses forward slashes only, on every platform |
| `T39b` | and so does the manifest |

`T36` is retained, relabelled, and **excluded from every coverage claim**.

## 8.3 · `13_make_rc_fixtures.sh` now fails closed

Four gates, evaluated **before any directory is created or any byte copied**:

| Gate | Condition |
|---|---|
| **G1** | the source is a Git worktree — an unusable or absent `git` is identity **UNAVAILABLE**, and refused |
| **G2** | `HEAD` equals the full 40-character expected RC `a42b209e4f70a6efed4f3dcdb654e0f994416594`, exactly |
| **G3** | the worktree **and the index** are clean (tracked files; untracked files alone do not block) |
| **G4** | each of the three files' working-tree bytes equal its `HEAD` blob — `git hash-object` vs `git rev-parse HEAD:<path>` |

On any failure: nothing is copied, the output directory is not written to, and the script exits
non-zero. **There is no `--force`.** The provenance file is written only after all four pass, and
it records the gate result rather than a caveat.

### `15_fixture_gate_test.sh` — 30 assertions, negative controls first

Each negative control asserts **both** the non-zero exit **and** that no fixture set exists —
"no usable fixture set" is checked directly, never inferred from the exit code.

* **G1a–c** a non-Git directory is refused, no fixtures, and the refusal says nothing was copied
* **G1d–e** a `git` that always fails (identity unavailable) is refused, no fixtures
* **G2a–d** the shipped script against a repo that is not the RC — refused, names the expected RC
* **G2e–g** one empty commit moves `HEAD` → refused; resetting `HEAD` back → passes again
* **G3a–c** a dirty tracked **RC** file → refused, and the refusal names the path
* **G3d–e** a dirty tracked file **outside** the three → also refused
* **G3f–g** a **staged-only** change → refused
* **G3h** an untracked file alone does **not** block generation
* **G4a–c** bytes differing from the `HEAD` blob → refused **even when `git status` looks clean**
  (forced with `assume-unchanged`, so G4 is exercised rather than shadowed by G3)
* **G5a–b** a missing RC file → refused

The tests pin a **copy** of the generator to the throwaway repo's own `HEAD`. The shipped script's
hard-coded RC is never modified.

## 8.4 · Template and instruction corrections

`06_RESULTS_TEMPLATE.md` carried the revision-6 numbers — `PASS=36` for the self-test and
`PASS=11` for the verifier. Both were stale for two revisions. Corrected, and the harness section
now has fields for every suite:

* verifier **30**, self-test **56**, RC regression **8**, RC-root mode **12**, fixture gate **30**;
* mutation control — `DETECTED`, `UNDETECTED`, `SKIPPED`, `EQUIVALENT`, `FALSE-EQUIV-CLAIMS`,
  `NO-OP-HERE`, and the platform class the run reported;
* the fixture generator's exit code, the `git HEAD` it recorded, and whether the provenance line
  `identity      : MATCH` is present;
* a new **R.4.0** preamble: `UNDETECTED > 0` means no WS4 result derived from the suite may be
  relied on, and `NO-OP-HERE > 0` is **BLOCKED**, not coverage.

`BLOCKED_ITEMS` carries the same corrected numbers, plus **B3** (Windows mutation control) and
**B4** (symlink resolution untested on every platform).

## 8.5 · Measured results — Linux, this container

| Suite | Result |
|---|---|
| `10_verify_pack.sh` | **30 / 30** |
| `08_selftest.sh` | **56 / 56** |
| `09_rc_regression.sh` (fixture mode) | **8 / 8** |
| `11_mutation_control.sh` | **DETECTED 12 · UNDETECTED 0 · SKIPPED 0 · EQUIVALENT 3 · FALSE-EQUIV-CLAIMS 0 · NO-OP-HERE 1** |
| `12_rc_root_mode_test.sh` | **12 / 12** |
| `15_fixture_gate_test.sh` | **30 / 30** |

`EXECUTED` on Linux only.

### What is NOT claimed

* **Windows mutation testing for revision 8 is `BLOCKED`.** It does not exist. `M8c` has never
  been run where it is a defect, and the Linux `NO-OP-HERE=1` is not coverage. **B3.**
* **Symlink resolution is untested on every platform, by construction.** **B4.**
* **The pack is not ready**, and this revision does not make it ready. It is revision 8 awaiting
  the auditor's independent re-run.
* **WS4 is not closed.** The 71-function re-measurement needs Supabase access and is a separate
  authorized step. **No provider operation was performed by this revision.**
* Nothing here closes a §25 row, and nothing here makes the release ready.

## 8.6 · Hand-back

For the independent auditor, to re-run on Git for Windows against revision 8. Expected there:
verifier 30/30, self-test 56/56, RC regression 8/8, RC-root mode 12/12, fixture gate 30/30, and
**mutation control `DETECTED=13 UNDETECTED=0 NO-OP-HERE=0` with `M8c` DETECTED**.

**Thirteen, not twelve.** On POSIX, `M8c` is reported `NO-OP-HERE` and is therefore *not* counted
in `DETECTED`, giving `DETECTED=12 NO-OP-HERE=1`. On Windows it is a real defect, so it moves
*into* the detected count: `12 + 1 = 13`, with `NO-OP-HERE=0`. The two platform totals are
supposed to differ by exactly this one mutation.

A different result is a finding, and should be returned as one.

---

## 8.7 · Windows validation — RESULT RECORDED (auditor-attested)

The independent auditor's Git-for-Windows execution of revision 8 returned:

| Suite | Windows result |
|---|---|
| `10_verify_pack.sh` | 30 / 30 |
| `08_selftest.sh` | 56 / 56 |
| `12_rc_root_mode_test.sh` | 12 / 12 |
| `15_fixture_gate_test.sh` | 30 / 30 |
| `09_rc_regression.sh` — exact RC | 8 / 8 |
| `11_mutation_control.sh` | **DETECTED=13 · UNDETECTED=0 · SKIPPED=0 · EQUIVALENT=3 · FALSE-EQUIV-CLAIMS=0 · NO-OP-HERE=0**, exit 0 |

**`M8c` was DETECTED where it is a defect. B3 is closed.** Evidence class **AUDITOR-ATTESTED**:
the compiler did not witness the run and holds no transcript of it.

**B4 is NOT closed.** Symlink resolution remains untested on every platform, by construction.

**This revision makes no code change.** Only the three reporting lines that stated the Windows
expectation as `DETECTED=12` were corrected, plus this record. Every `.py` and `.sh` file in the
pack is byte-identical to the revision-8 build the auditor validated — see §8.8.

---

## 8.8 · Proof that no executable file changed

The reporting correction touched Markdown only. Every executable and fixture file in the pack is
byte-identical to the revision-8 build the auditor validated on Git for Windows:

| File | sha256 | Unchanged |
|---|---|---|
| `07_ws4_reference_impl.py` | `7c37bda4ac44617f…` | yes |
| `08_selftest.sh` | `d900f5c1740398fa…` | yes |
| `09_rc_regression.sh` | `fdfa89f26f1a960f…` | yes |
| `10_verify_pack.sh` | `cb669250d18b538a…` | yes |
| `11_mutation_control.sh` | `662a9dd991bcbb3a…` | yes |
| `12_rc_root_mode_test.sh` | `281f384f839a3efb…` | yes |
| `13_make_rc_fixtures.sh` | `51aada972a5b1d5e…` | yes |
| `15_fixture_gate_test.sh` | `ff39bf2ea5ac492d…` | yes |
| `extract_probe_yaml.sh` | `8b34d2957d15f348…` | yes |
| `fixtures/rc/supabase/functions/_shared/transactional-email-templates/entry-winner.tsx` | `ea3fd9ea4a8708ea…` | yes |
| `fixtures/rc/supabase/functions/detect-orphan-files/index.ts` | `68b1a4add6ff6114…` | yes |
| `fixtures/rc/supabase/functions/submit-judge-decision/index.ts` | `3ddab1f4a290a09d…` | yes |

**All 12 unchanged: confirmed.** Only `.md` files and `MANIFEST.sha256` differ from the validated build.
