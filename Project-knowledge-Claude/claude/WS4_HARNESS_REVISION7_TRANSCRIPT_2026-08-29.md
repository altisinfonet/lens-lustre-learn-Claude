WS4 EXTERNAL EVIDENCE PACK — TEST TRANSCRIPT (revision 7)
captured UTC : 2026-08-29T16:31:51Z
host         : Linux 6.18.44-fc-v22 x86_64
bash         : 5.2.21(1)-release
python3      : 3.11.15
provenance   : EXECUTED on Linux, this container. No provider access. No network calls.
note         : 10_verify_pack.sh is NOT captured here - it verifies MANIFEST.sha256, which
               is generated after this transcript. Run it yourself first, after unpacking:
                   bash 10_verify_pack.sh      (expected PASS=28 FAIL=0)

################################################################
### bash 08_selftest.sh
################################################################
=== PLATFORM ===
uname       : Linux 6.18.44-fc-v22 x86_64
bash        : 5.2.21(1)-release
python3     : 3.11.15
impl sha256 : 7c37bda4ac44617fb4d01a9b51254f73cc13c213b45ff6a3e92d32df89f59d60
command     : bash 08_selftest.sh
started UTC : 2026-08-29T16:31:51Z
=== TESTS ===
PASS  T1  closure: shared + dynamic included
PASS  T2  identical trees -> MATCH
PASS  T3  only secureHeaders differs -> HEADER-ONLY
PASS  T4  util differs -> DRIFT
PASS  T5  extra reachable file -> DRIFT
PASS  T6  import cycle terminates (3 files)
PASS  T7  import map resolves bare specifier
PASS  T8  unresolved BARE import -> exit 3
PASS  T8b unresolved bare reported
PASS  T9  remote import EXTERNAL -> exit 0
PASS  T10 commented imports ignored
PASS  T11 MULTILINE import { ... } from
PASS  T12 MULTILINE export {..} from + export * [as]
PASS  T13 import-like text in strings/templates ignored
PASS  T14 trailing // comment with import text ignored
PASS  T15 malformed source -> UNPARSEABLE exit 3
PASS  T16 import inside ${} interpolation -> UNPARSEABLE
PASS  T17 dynamic import(non-literal) -> UNPARSEABLE
PASS  T18 regex literal containing import text ignored
PASS  T19 unresolved LOCAL import -> exit 3
PASS  T19b unresolved local reported
PASS  T20 identical trees w/ unparseable dep -> UNKNOWN (not MATCH)
PASS  T21 guarded wrapper still returns MATCH on clean input
PASS  T22 JSX .tsx: header-complete fallback allowed
PASS  T23 import AFTER the JSX stop -> fallback refused (exit 3)
PASS  T24 same JSX in a .ts file -> NOT eligible, fails closed
PASS  T25 import type { T } from      -> specifier
PASS  T26 import type T from          -> specifier
PASS  T27 export type { T } from      -> specifier
PASS  T28 export type T = ...         -> NO invented specifier
PASS  T29a exit 3 -> exactly one UNKNOWN row
PASS  T29b UNKNOWN names the failing function
PASS  T29c no inventory row for the UNKNOWN function
PASS  T29d no manifest file for the UNKNOWN function
PASS  T29e loop continued: 2 inventory rows
PASS  T29f classified + unknown == 3 functions
PASS  T30 prod has an EXTRA path, all shared bytes identical -> DRIFT
PASS  T31 prod is MISSING a path, all shared bytes identical -> DRIFT
PASS  T31b the DRIFT detail names the path-set reason
PASS  T32 manifest digest is SHA-256 of the bytes (known-answer vector)
PASS  T32b manifest records the byte size
PASS  T33 manifest output is SORTED regardless of input order
PASS  T33b reversed and forward input give identical output
PASS  T34 import map resolves an EXACT (non-prefix) key
PASS  T35 dep outside the root -> exit 3 (never silently included)
PASS  T35b the escape is reported as OUTSIDE_ROOT
PASS  T35c the outside file is NOT in the closure
PASS  T36 root reached via a SYMLINK yields canonical in-root paths
PASS  T37 one file, two spellings -> listed ONCE
PASS  T37b and the manifest therefore has one row per file
PASS  T36b a dep reached through './sub/../' is listed ONCE, canonically
-----------------------------------------
PASS=51 FAIL=0
finished UTC : 2026-08-29T16:31:54Z
### exit=0

################################################################
### bash 09_rc_regression.sh
################################################################
=== PLATFORM ===
uname       : Linux 6.18.44-fc-v22 x86_64
bash        : 5.2.21(1)-release
python3     : 3.11.15
impl sha256 : 7c37bda4ac44617fb4d01a9b51254f73cc13c213b45ff6a3e92d32df89f59d60
mode        : fixture
base        : /home/claude/ROUND5_PACK/fixtures/rc
started UTC : 2026-08-29T16:31:54Z
=== RC SPECIFIER REGRESSION ===
PASS  R1 submit-judge-decision: parses cleanly
PASS  R2 submit-judge-decision: local deps complete
PASS  R3 detect-orphan-files: parses cleanly
PASS  R4 detect-orphan-files: local deps complete
PASS  R5 entry-winner.tsx: parses cleanly
PASS  R6 entry-winner.tsx: local deps complete (5)
PASS  R7 entry-winner.tsx: npm: specifiers seen and treated as EXTERNAL
PASS  R8 detect-orphan-files: https: specifier seen and EXTERNAL
-----------------------------------------
PASS=8 FAIL=0
finished UTC : 2026-08-29T16:31:54Z
### exit=0

################################################################
### bash 11_mutation_control.sh
################################################################
=== PLATFORM ===
uname       : Linux 6.18.44-fc-v22 x86_64
bash        : 5.2.21(1)-release
python3     : 3.11.15
impl sha256 : 7c37bda4ac44617fb4d01a9b51254f73cc13c213b45ff6a3e92d32df89f59d60
started UTC : 2026-08-29T16:31:54Z
=== BASELINE ===
PASS  baseline is GREEN (mutations are meaningful)
=== MUTATIONS ===
DETECTED    M1  classify(): path-set difference no longer means DRIFT
DETECTED    M2  classify(): HEADER-ONLY made unreachable (the rev-2 defect, re-planted)
DETECTED    M3  manifest(): sha256 silently downgraded to md5
DETECTED    M4  extract_specifiers(): FAILS OPEN - malformed source returns no specifiers
DETECTED    M5  extract_specifiers(): JSX fallback ungated - applies to ANY stop reason
DETECTED    M6  extract_specifiers(): JSX fallback accepts a remaining import/require
DETECTED    M7  inside(): containment check disabled - a dep may escape the root
DETECTED    M8  canonicalisation removed at BOTH closure() root and norm() (a symlinked root escapes)
DETECTED    M8b  resolve(): resolved target not normalised at all (the infinite-walk defect)
DETECTED    M9  REMOTE_PREFIXES emptied - npm:/https: would be treated as local deps
DETECTED    M10  apply_import_map(): exact import-map hits ignored
DETECTED    M11  manifest(): output no longer sorted (two auditors, two orderings)
=== EQUIVALENT MUTANTS (claimed redundant, claim tested) ===
EQUIVALENT  E1  norm(): its internal realpath() removed (closure() still canonicalises the root)
        claim: closure() canonicalises root_abs and every member of seen, so norm() receives canonical arguments and its own realpath() is redundant. norm() and closure() COMPENSATE FOR EACH OTHER: removing either alone is invisible, so neither is tested alone. M8 removes BOTH and is DETECTED by T36; M8b removes the resolve()-side canonicalisation and is DETECTED by T37. The redundancy is therefore documented, not merely assumed.
EQUIVALENT  E2  closure(): root_abs canonicalisation removed (norm() still canonicalises)
        claim: the mirror image of E1. Neither single removal is observable; the pair is, and M8 tests the pair.
=== RESTORE CONTROL ===
PASS  suite GREEN again after restore (the RED results above were caused by the mutations)
-----------------------------------------
DETECTED=12 UNDETECTED=0 SKIPPED=0 EQUIVALENT=2 FALSE-EQUIV-CLAIMS=0
finished UTC : 2026-08-29T16:32:52Z
### exit=0

################################################################
### bash 12_rc_root_mode_test.sh
################################################################
=== PLATFORM ===
uname       : Linux 6.18.44-fc-v22 x86_64
bash        : 5.2.21(1)-release
started UTC : 2026-08-29T16:32:52Z
=== TESTS ===
PASS  K0 synthetic checkout has the three RC paths
PASS  K1 --rc-root exits 0 against a well-formed checkout
PASS  K2 the transcript records mode : real-checkout (not fixture)
PASS  K3 the transcript records the base it was pointed at
PASS  K4 all eight regression assertions ran
PASS  K5 NEGATIVE: a renamed local dependency FAILS the regression
PASS  K5b and the failure names the specifier set that moved
PASS  K5c restoring the file makes it pass again
PASS  K6 NEGATIVE: a missing RC file FAILS
PASS  K6b and it is reported as a missing input, not as a parse result
PASS  K7 NEGATIVE: an unparseable RC file FAILS (fail-closed)
PASS  K8 NEGATIVE: an empty --rc-root FAILS rather than reporting success
-----------------------------------------
PASS=12 FAIL=0
SCOPE: mode plumbing only. Ground truth vs the REAL RC remains BLOCKED (B1).
finished UTC : 2026-08-29T16:32:55Z
### exit=0

