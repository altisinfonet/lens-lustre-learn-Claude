# TRANSCRIPT — ledger-guard v3 self-test (Linux)
# host: Linux 6.18.44-fc-v22 x86_64 · 2026-08-29T16:02:54Z
# command: bash test_ledger_guard.sh

=== PLATFORM ===
uname: Linux 6.18.44-fc-v22 x86_64
bash : 5.2.21(1)-release
python3: 3.11.15
git: git version 2.43.0
guard sha256: a9629fcf2d18d0ce…
started: 2026-08-29T16:02:54Z
=== TESTS ===
fatal: expected 'acknowledgments', received 'packfile'
warning: push negotiation failed; proceeding anyway with push
PASS  N0  clean ledger -> FAIL=0
PASS  P1  LG-01 fires: RC is a docs-only commit
PASS  N1  LG-01 silent on the true code RC
PASS  P1b LG-01 takes only the FIRST sha; warns about the rest
PASS  P2  LG-02 fires: code landed after the RC
PASS  N2  LG-02 silent when only docs/ changed
PASS  P3  LG-03 fires: tree field holds a commit sha
PASS  N3  LG-03 silent: tree field holds a real tree
PASS  V1-P LG-03 FAILS on a 32-hex value in a typed commit field
PASS  V1-P2 …and the message says why it is not excused
PASS  V1-N LG-03 silent on a 32-hex value in an OPAQUE (non-git) field
PASS  P4  LG-04 fires: a struck canonical sha reused in a live field
PASS  N4  LG-04 silent: a struck ROW NUMBER does not void a sha
PASS  P5a LG-05 fires on a wrong file count
PASS  P5b LG-05 fires on 205 commits (the C-2 case)
PASS  P5c LG-05 fires on wrong line counts
PASS  N5  LG-05 silent when all three match the declared endpoint
PASS  N5b LG-05 ignores #104 and 10:40 inside the value cell
PASS  P6  LG-06 fires when the header outruns the table
PASS  N6  LG-06 silent when they agree
PASS  P7  LG-07 fires: a canonical figure row with no basis
PASS  N7  LG-07 silent when the row carries a date/instrument
PASS  N7b LG-07 silent for a row whose instrument cell says 'same'
PASS  P8a LG-08 fires on §5.999 (no such subsection)
PASS  N8  LG-08 silent on §16.1 (exists) and §16 (top level)
PASS  N8b LG-08 silent on an explicit runbook §ref
PASS  P8b LG-08 fires on a bare §5.3.6 with no document prefix
PASS  N9  LG-09 silent when there really are no tags
PASS  P9  LG-09 fires on a tag that exists ONLY on the remote
fatal: --negotiate-only needs one or more --negotiation-tip=*
warning: push negotiation failed; proceeding anyway with push
PASS  P10 LG-10 fires on a duplicated word
PASS  N10 LG-10 silent on clean prose
PASS  A-corrected  bypass attempt with the word "corrected" does NOT disable LG-01
PASS  A-void  bypass attempt with the word "void" does NOT disable LG-01
PASS  A-preserved  bypass attempt with the word "preserved" does NOT disable LG-01
PASS  A-stale  bypass attempt with the word "stale" does NOT disable LG-01
PASS  A-mixed  a mixed row stays ACTIVE for its live part
PASS  X1 exit 1 on FAIL
PASS  X2 exit 0 when clean
PASS  X3 exit 2 on unusable repo
PASS  X4 exit 2 on missing ledger
PASS  X5 exit 2 on --repo + --facts
PASS  V2-P LG-04 fires: full void SHA reused as an ABBREVIATION
PASS  V2-P2 LG-04 fires: abbreviated void SHA reused in FULL form
PASS  V2-N LG-04 silent: a DIFFERENT commit is not the void one
PASS  V2-A LG-04 FATAL on an ambiguous abbreviation
PASS  V2-A2 …the message names it ambiguous, not resolved
PASS  V2-A3 exit code 3 (BLOCKED), not 0 and not 1
PASS  V3-N LG-09 no FATAL while origin is reachable
PASS  V3-P LG-09 FATAL when origin is UNREACHABLE
PASS  V3-P2 …and it says BLOCKED, not confirmed
PASS  V3-P3 …and the run exits 3
PASS  V3-P4 …and it does NOT claim the no-tags check passed
PASS  V3-N2 LG-09 healthy again once origin is restored
PASS  V4-N LG-05 inherits the endpoint WITHIN one table
PASS  V4-N2 LG-07 inherits a basis WITHIN one table
PASS  V4-P LG-05 does NOT inherit across a table boundary
PASS  V4-P2 LG-07 does NOT inherit a basis across a table boundary
PASS  V5-N unambiguous 8-char prefix of a known FULL sha is accepted
PASS  V5-N2 the full sha itself is accepted
PASS  V5-P a LONGER value is not accepted just because a known SHORT entry prefixes it
PASS  V5-W a short-only attestation is WARN (unverifiable), never a pass
PASS  V5-W2 …and it is not reported as a FAIL either
PASS  V5-A a 7-char prefix shared by TWO known full shas is FATAL, not a pass
PASS  V5-A2 …and the ambiguous case is not silently counted as FAIL
PASS  V5-A3 an 8-char prefix matching exactly ONE of them is accepted
PASS  V5-A4 …and the 8-char prefix of the OTHER one is accepted too
=== PER-CHECK COVERAGE ===
CHECK    POSITIVE  NEGATIVE  RESULT
LG-01    yes       yes       OK (3 assertions)
LG-02    yes       yes       OK (2 assertions)
LG-03    yes       yes       OK (14 assertions)
LG-04    yes       yes       OK (7 assertions)
LG-05    yes       yes       OK (7 assertions)
LG-06    yes       yes       OK (2 assertions)
LG-07    yes       yes       OK (5 assertions)
LG-08    yes       yes       OK (4 assertions)
LG-09    yes       yes       OK (7 assertions)
LG-10    yes       yes       OK (2 assertions)
ADVERS   yes       n/a       OK (5 assertions)
EXIT     yes       yes       OK (7 assertions)
-----------------------------------------
PASS=66 FAIL=0
finished: 2026-08-29T16:03:01Z
exit=0
