# WO-2 (revised) item 0 — full 25-file pack reconstruction, hash verification, and suite runs

Nothing in this report closes a §25 row.

Run 2026-08-30, ~02:00–02:08Z. All 25 pack files named in `MANIFEST.sha256` plus the manifest
itself were reconstructed from the 26 `claude/WS4_PACK_SOURCE/*` project docs now present,
mapped per the exact path table F-7 specified.

## Responses to F-8 through F-12

**F-8 — the tenth file, named.** The prior report said "reconstructed all 10 ... verified
9/9 checkable" without naming the tenth. The tenth was `MANIFEST.sha256` itself — it is the
reference the other 9 files were checked against, so it cannot be checked against itself. Not
an oversight in that run, but it should have been named rather than left implicit. Named now.

**F-9 — restated.** "Not a code defect (08_selftest exercises the same implementation cleanly)"
overclaimed. Corrected reading: the **cause** of `09_rc_regression.sh`'s prior failure (missing
`fixtures/rc/*` input files) was **VERIFIED** directly from the failure text
(`FAIL missing input: <path>`). Whether `07_ws4_reference_impl.py` itself carried a defect
could not be determined while that suite could not run at all — it is **UNDETERMINED**, not
ruled out, by a different suite passing on different (synthetic) inputs. That question is now
moot for this run, since the real fixture files are present and `09_rc_regression.sh` ran clean
(§2 below) — but the corrected reasoning stands as the rule going forward.

**F-10 — named verbatim, this run.** `10_verify_pack.sh` returned `PASS=29 FAIL=1`. The one
failing assertion, verbatim:

```
FAIL  checksum mismatch:
00_README_AND_EVIDENCE_RULES.md: FAILED
sha256sum: WARNING: 1 computed checksum did NOT match
```

Every other assertion in that suite passed: all 11 `bash -n` checks on shipped shell blocks
inside `.md` files, all 14 `bash -n` + LF-ending checks on the 7 shipped scripts, the manifest
coverage check (`PASS manifest covers every pack file (25 entries), and no others`), and the
YAML byte contract (`PASS awk and python agree, and match the recorded hash`).

**F-11 — standing rule, applied.** Every one of the 25 reconstructed files was hash-verified
against `MANIFEST.sha256` **before** anything was executed. One file
(`00_README_AND_EVIDENCE_RULES.md`) did not verify — see §3. It is documentation, not executed
by any script, so its failure does not block the 6 suites below; none of the files those suites
execute or read (`07_ws4_reference_impl.py`, the 6 `.sh` scripts, `extract_probe_yaml.sh`, the 3
`fixtures/rc/*` files, `05_APPENDIX_runbook_5.3_probe_PREPARED_NOT_RUN.md`) failed verification.
Confirmed: the nine files run this session were run only because, and after, they hash-matched
— not because they were "reconstructed carefully."

**F-12 — status table, not prose.**

| Item | Status | Basis |
|---|---|---|
| `07_ws4_reference_impl.py` — MATCH/HEADER-ONLY/DRIFT/UNKNOWN classification | **VALIDATED on Linux/POSIX, this run** | `11_mutation_control.sh` ran to completion, `UNDETECTED=0` (see §2) |
| Same, on Windows | **NOT VALIDATED by this session** | Windows result (`DETECTED=13 UNDETECTED=0 NO-OP-HERE=0`) is recorded in `BLOCKED_ITEMS_revision6.md` B3 as **AUDITOR-ATTESTED** from an earlier round — this session did not witness it and holds no transcript |
| Symlink resolution (`realpath` vs `abspath` in `norm()`/`closure()`) | **UNTESTED on every platform, by construction** | `BLOCKED_ITEMS_revision6.md` B4 — a platform-gated property no test here can prove |
| The hard gate itself (no classification relied on until `UNDETECTED=0`) | **SATISFIED, this run, on Linux** | see §2 |

## 1 — Hash verification, all 25 files + manifest

24 of 25 pack files hash-matched exactly on the first reconstruction. One did not:

| File | Result |
|---|---|
| `00_README_AND_EVIDENCE_RULES.md` | **FAIL** — see §3 |
| all other 24 files | **PASS** |

Manifest coverage (every file on disk named in the manifest, and no extra files present):
**PASS** — confirmed independently via `find` and again inside `10_verify_pack.sh`'s own check.

## 2 — Suite runs, exact numbers

| Suite | Expected | Actual | Match? |
|---|---|---|---|
| `10_verify_pack.sh` | `PASS=30 FAIL=0` | **`PASS=29 FAIL=1`** | **NO — deviation, see below** |
| `08_selftest.sh` | `PASS=56 FAIL=0` | `PASS=56 FAIL=0` | YES |
| `09_rc_regression.sh` (fixture mode) | `PASS=8 FAIL=0`, `mode : fixture` | `PASS=8 FAIL=0`, `mode : fixture` | YES |
| `12_rc_root_mode_test.sh` | `PASS=12 FAIL=0` | `PASS=12 FAIL=0` | YES |
| `15_fixture_gate_test.sh` | `PASS=30 FAIL=0` | `PASS=30 FAIL=0` | YES |
| `11_mutation_control.sh` (Linux) | `DETECTED=12 UNDETECTED=0 SKIPPED=0 EQUIVALENT=3 FALSE-EQUIV-CLAIMS=0 NO-OP-HERE=1` | `DETECTED=12 UNDETECTED=0 SKIPPED=0 EQUIVALENT=3 FALSE-EQUIV-CLAIMS=0 NO-OP-HERE=1` | YES |

Five of six suites matched their expected numbers exactly. `10_verify_pack.sh` deviated by
exactly one assertion — the checksum check on `00_README_AND_EVIDENCE_RULES.md` — everything
else in it, including its own manifest-coverage self-check, passed.

**`UNDETECTED=0` on `11_mutation_control.sh`, run to completion, exit 0.** Per the hard gate: on
this platform, this run, classification produced by `07_ws4_reference_impl.py` may now be relied
on. That does not extend to Windows or to symlink resolution — see the F-12 table above.

## 3 — The one deviation, investigated

`00_README_AND_EVIDENCE_RULES.md` reconstructed to **exactly 16,741 bytes** — matching the size
`MANIFEST.sha256`'s own size-comment block records for this file — but its SHA-256 does not match
the manifest's hash line for it.

To rule out a transcription slip (the kind F-11 is about), the file was reconstructed a **second
time, independently**, from the same source project doc. Both reconstructions are byte-identical
to each other (`diff` reports no difference; both hash to
`0b5df7349528cc799885b00612a9c5a7b5ca9b985c8c65ea5faa9246d895b8fc`). That rules out a one-off
retyping error of the kind that hit `11_mutation_control.sh` in the previous round — this is
reproducible, not random.

**What this does not rule out:** a systematic rendering difference between the doc's stored bytes
and what the project-read path displays (for example, Unicode normalization of one of the
document's many special characters — it uses `—`, `§`, `·`, `→`, `⚠`, `✅`, `⇒`, `❌`, `🔴`, `≥`,
`−`, `…` throughout), or an inconsistency in `MANIFEST.sha256` itself (a hash computed from a
different byte-identical-length version of this file than the one now in the project). This
session has no way to distinguish those two explanations from here — both are consistent with
same-size, different-hash, reproducibly.

**Not forced to match.** No byte was altered to make this pass; per your instruction, this is
reported as a finding, not silently resolved.

## 4 — Consequence

Per the revised WO-2's own instruction — "ANY deviation from those numbers is a FINDING — report
it and stop, do not adjust anything to reach them" — **stopping here**, before WO-2 items 1–4
(the 71+74 function capture and hashing). `00_README_AND_EVIDENCE_RULES.md` is not executed by
anything and does not affect the validity of the five suites that matched exactly or the
mutation-control result, but it is a real, unresolved deviation from the numbers you specified,
and the instruction is explicit about what to do with one of those: report and stop.

Needed from you to resume: either confirm the manifest's hash for this one file is stale (and
supply a corrected `MANIFEST.sha256` line, or accept this session's byte content as canonical), or
supply the file directly so it can be compared byte-for-byte against what two independent
transcriptions produced.

## 5 — Track R

Per the prior turn's report, the 138-file audit report (attributed, per-item evidence class) was
requested once, in writing. Not requesting it again. Track R has not begun and does not begin in
this report.
