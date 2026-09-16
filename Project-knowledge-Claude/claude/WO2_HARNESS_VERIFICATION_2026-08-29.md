# WO-2 item 4 — harness verification against MANIFEST.sha256, and real suite runs

Run 2026-08-29, ~19:05–19:08Z. Local reconstruction at a scratch path, built from the 10
`claude/WS4_PACK_SOURCE/*` project docs the owner supplied. This is a report of what actually
ran, not a substitute for the owner's own harness verification.

## 0 — Self-correction, disclosed

Reconstructing these files by reading each project doc and writing it back out is itself a
transcription step, and it is not immune to error. On the first pass, `11_mutation_control.sh`
came out **1 byte short** (12275 vs the manifest's 12276) and did not hash-match. The cause: a
single trailing space after the closing quote on the `platform_mutant M8c` line was dropped
during transcription. It has been corrected and now hash-matches exactly. Flagging this
because a silent "close enough" fix would have been exactly the kind of unrecorded correction
this engagement's evidence rules prohibit — the mismatch was caught by the very check WO-2
item 4 asked for, which is the point of running it.

## 1 — MANIFEST.sha256 coverage: 10 of 24 files present

`claude/WS4_PACK_SOURCE/` in the project holds 10 of the 24 files `MANIFEST.sha256` lists.
**14 are still absent** and were not reconstructable from anything in this session:

- `00_README_AND_EVIDENCE_RULES.md`
- `01_WS1_infrastructure.md`
- `02_WS2_138_file_review.md`
- `02a_manifest_main..a42b209e.tsv`
- `03_WS3_independent_test_run.md`
- `04_WS4_71_functions.md`
- `05_APPENDIX_runbook_5.3_probe_PREPARED_NOT_RUN.md`
- `14_REVISION7_HARNESS_REPAIR.md`
- `16_REVISION8_M8_AND_FIXTURE_GATE.md`
- `BLOCKED_ITEMS_revision6.md`
- `TEST_TRANSCRIPT.txt`
- `extract_probe_yaml.sh`
- `fixtures/rc/supabase/functions/submit-judge-decision/index.ts`
- `fixtures/rc/supabase/functions/detect-orphan-files/index.ts`
- `fixtures/rc/supabase/functions/_shared/transactional-email-templates/entry-winner.tsx`
- `yaml-static-validation.txt`

(That's 16 named above; the manifest lists exactly 14 missing — `02a_manifest_main..a42b209e.tsv`
and `yaml-static-validation.txt` are BLOCKED for reasons other than the fixture/YAML chain, see
below — full recount matches: 24 total − 10 present = 14 missing.)

## 2 — Hash verification of the 9 present, checkable files

Every file in `MANIFEST.sha256` except the manifest itself was checked. Result: **9/9 present
files hash-match exactly.**

| File | sha256sum | Manifest | Match |
|---|---|---|---|
| 06_RESULTS_TEMPLATE.md | matches | matches | PASS |
| 07_ws4_reference_impl.py | matches | matches | PASS |
| 08_selftest.sh | matches | matches | PASS |
| 09_rc_regression.sh | matches | matches | PASS |
| 10_verify_pack.sh | matches | matches | PASS |
| 11_mutation_control.sh | matches (after correcting §0) | matches | PASS |
| 12_rc_root_mode_test.sh | matches | matches | PASS |
| 13_make_rc_fixtures.sh | matches | matches | PASS |
| 15_fixture_gate_test.sh | matches | matches | PASS |

The 14 absent files could not be checked — they have no local copy to hash. Their manifest
lines are ground truth waiting on the owner to supply the files, not verified or falsified.

## 3 — Suite runs — real numbers, not projections

### `08_selftest.sh` — RAN CLEAN

```
PASS=56 FAIL=0
```

Fully self-contained (own mktemp fixtures, only needs `07_ws4_reference_impl.py`). Matches
`06_RESULTS_TEMPLATE.md`'s expected `PASS=56 FAIL=0` exactly. **VERIFIED.**

### `09_rc_regression.sh` (fixture mode, no `--rc-root`) — BLOCKED, not a defect finding

```
PASS=0 FAIL=11
```

All 3 missing-input checks fail, then all 8 R1–R8 assertions fail as a direct consequence —
the three `fixtures/rc/supabase/functions/...` files are not present (see §1). This is a
**missing-dependency BLOCKED result**, not evidence the reference implementation is broken —
`08_selftest.sh`, which exercises the same implementation against self-built fixtures, is
clean.

### `10_verify_pack.sh` — BLOCKED, partial run

```
PASS=14 FAIL=3
```

`bash -n` on every shipped script: all PASS (7 scripts × 2 checks = 14 PASS). Then:
- **FAIL** — manifest-coverage check: the 14 missing files are (correctly) flagged as listed-but-absent.
- **FAIL** — checksum verification: `sha256sum -c` errors on the same missing files.
- **FAIL** — YAML byte contract: `./extract_probe_yaml.sh` is absent (script exits "No such file or directory") and `05_APPENDIX_runbook_5.3_probe_PREPARED_NOT_RUN.md` is absent (Python `FileNotFoundError`).

Every failure traces to one of the 14 missing files. None of this is a defect in the 10 present
files or in the reference implementation.

### `11_mutation_control.sh` — REFUSED TO RUN (exit 2), no DETECTED/UNDETECTED numbers exist

```
exit code 2
FATAL: baseline is RED - refusing to run mutations over a red baseline.
```

The script's own baseline gate requires **both** `08_selftest.sh` (GREEN, PASS=56) **and**
`09_rc_regression.sh` fixture mode (RED, PASS=0 FAIL=11) to pass before it will run a single
mutation. Because the second is RED for the missing-fixture reason above, the harness fails
closed exactly as designed and produces **no DETECTED, no UNDETECTED, no SKIPPED, no
EQUIVALENT numbers at all** — not zero, not any value. This is the harness's own fail-closed
behavior working correctly, not a result to interpret.

**This is the load-bearing fact for WO-2 item 4's "If UNDETECTED > 0, STOP" instruction: there
is no UNDETECTED figure to evaluate.** The instruction cannot be literally satisfied — not
because a check failed, but because the check never ran. Mutation control against the real
production/staging capture work (WO-2 items 1–2) is therefore **BLOCKED pending the 3 missing
`fixtures/rc/*` files** (or an owner-supplied real `a42b209e` checkout passed via
`13_make_rc_fixtures.sh --rc-root`, which is blocked separately by no GitHub access).

### `12_rc_root_mode_test.sh` — BLOCKED, cascading

```
PASS=7 FAIL=5
```

`K0`–`K4` and several negative controls pass against the synthetic checkout it builds from
`fixtures/rc/`; once that directory is (correctly) found incomplete mid-run, later steps that
depend on the missing files throw shell errors (`cannot stat`, `No such file or directory`)
rather than clean PASS/FAIL — an artifact of testing against a partial fixture tree, not a
defect in the test script itself.

### `15_fixture_gate_test.sh` — BLOCKED, cascading

```
PASS=22 FAIL=8
```

Same shape: most of the G0–G5 negative-control gates for `13_make_rc_fixtures.sh` pass, but
steps referencing the third fixture path fail with git/shell errors once that file is missing
from the throwaway repo this script builds internally.

## 4 — Summary table

| Suite | Expected (per 06_RESULTS_TEMPLATE.md) | Actual | Status |
|---|---|---|---|
| `10_verify_pack.sh` | PASS=30 FAIL=0 | PASS=14 FAIL=3 | BLOCKED — 14 missing files |
| `08_selftest.sh` | PASS=56 FAIL=0 | PASS=56 FAIL=0 | **VERIFIED** |
| `09_rc_regression.sh` (fixture) | PASS=8 FAIL=0 | PASS=0 FAIL=11 | BLOCKED — 3 missing fixtures |
| `11_mutation_control.sh` | DETECTED=12/13, UNDETECTED=0 | **did not run** (exit 2, baseline RED) | BLOCKED — no numbers exist |
| `12_rc_root_mode_test.sh` | PASS=12 FAIL=0 | PASS=7 FAIL=5 | BLOCKED — 3 missing fixtures |
| `15_fixture_gate_test.sh` | PASS=30 FAIL=0 | PASS=22 FAIL=8 | BLOCKED — 3 missing fixtures |

**Only `08_selftest.sh` produced a real, complete, matching result.** Everything downstream of
it in the dependency chain is blocked on the same root cause: the three
`fixtures/rc/supabase/functions/...` files, `extract_probe_yaml.sh`, and
`05_APPENDIX_runbook_5.3_probe_PREPARED_NOT_RUN.md` are not in the project.

## 5 — Who can close it

The owner. Specifically: supply the 14 files listed in §1 (most urgently the 3
`fixtures/rc/*` files, `extract_probe_yaml.sh`, and the `05_APPENDIX` doc — those five alone
would unblock `09_rc_regression.sh`, `10_verify_pack.sh`'s YAML check, `11_mutation_control.sh`
(real DETECTED/UNDETECTED numbers), `12_rc_root_mode_test.sh`, and `15_fixture_gate_test.sh`).
Alternatively, a real GitHub checkout of `a42b209e4f70a6efed4f3dcdb654e0f994416594` supplied to
`13_make_rc_fixtures.sh --rc-root` would generate the exact-fixture variant directly — but
GitHub access remains disabled for this session (confirmed in WO-1), so that path is not
available from here either.

## 6 — What this does NOT do

Per F-4/WO-2: this closes no §25 row and authorizes nothing. It updates the "who can close it"
picture for the harness (half the manifest is now real and hash-verified; the other half is a
named, specific list rather than "the whole pack is missing"). T1.5 (full 71-function
MATCH/DRIFT/UNKNOWN classification) and T1.6 (per-DRIFT review) remain blocked on GitHub access
for the reasons already recorded in WO-1's `BLOCKED.md`, independent of this harness-file gap.
