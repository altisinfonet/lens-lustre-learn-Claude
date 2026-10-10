# TRANSCRIPT — ledger-guard v3 CI propagation test (Linux)
# host: Linux 6.18.44-fc-v22 x86_64 · 2026-08-29T16:03:01Z
# command: bash test_ci_propagation.sh

=== PLATFORM ===
uname: Linux 6.18.44-fc-v22 x86_64
bash : 5.2.21(1)-release
started: 2026-08-29T16:03:01Z
=== TESTS ===
PASS  C1 bare guard exits 1 on a failing ledger
PASS  C2 naive '| tee' WITHOUT pipefail wrongly reports 0 (the defect)
PASS  C3 'set -o pipefail' propagates exit 1 through tee
PASS  C4 PIPESTATUS[0] propagates exit 1 through tee
PASS  C5 pipefail fix still writes the report
PASS  C6 PIPESTATUS fix still writes the report
PASS  C7 clean ledger still exits 0 through the pipe
PASS  C8 workflow command shape: exit 0 when clean
PASS  C9 workflow command shape: exit 1 when failing
PASS  C10 '| tee ... || true' destroys PIPESTATUS (the defect)
PASS  C11 v3 shape: exit 1 survives on a failing ledger
PASS  C12 v3 shape still writes the report
PASS  C13 v3 shape: exit 3 (BLOCKED) survives, not flattened to 1
PASS  C14 the BLOCKED report says so in words
-----------------------------------------
PASS=14 FAIL=0
finished: 2026-08-29T16:03:02Z
exit=0
