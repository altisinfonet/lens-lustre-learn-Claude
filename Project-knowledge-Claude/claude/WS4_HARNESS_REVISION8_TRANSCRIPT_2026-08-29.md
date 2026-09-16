WS4 EXTERNAL EVIDENCE PACK — TEST TRANSCRIPT (revision 8)
captured UTC : 2026-08-29T17:15:43Z
host         : Linux 6.18.44-fc-v22 x86_64
bash         : 5.2.21(1)-release
python3      : 3.11.15
git          : git version 2.43.0
provenance   : EXECUTED on Linux, this container. No provider access. No network calls.
NOT CLAIMED  : Windows mutation control for revision 8 (BLOCKED, B3); symlink resolution (B4).
note         : 10_verify_pack.sh is NOT captured here - it verifies MANIFEST.sha256, which is
               generated after this transcript. Run it yourself first: expect PASS=30 FAIL=0.

################################################################
### bash 08_selftest.sh
################################################################
=== PLATFORM ===
uname       : Linux 6.18.44-fc-v22 x86_64
bash        : 5.2.21(1)-release
python3     : 3.11.15
impl sha256 : 7c37bda4ac44617fb4d01a9b51254f73cc13c213b45ff6a3e92d32df89f59d60
command     : bash 08_selftest.sh
started UTC : 2026-08-29T17:15:43Z
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
PASS  T38 closure output is ROOT-RELATIVE (never absolute)
PASS  T38b manifest paths are ROOT-RELATIVE too
PASS  T38c closure output contains no '.' or '..' segment
PASS  T39 output uses FORWARD SLASHES only, on every platform
PASS  T39b and so does the manifest
PASS  T36b a dep reached through './sub/../' is listed ONCE, canonically
-----------------------------------------
PASS=56 FAIL=0
finished UTC : 2026-08-29T17:15:46Z
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
started UTC : 2026-08-29T17:15:46Z
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
finished UTC : 2026-08-29T17:15:47Z
### exit=0

################################################################
### bash 11_mutation_control.sh
################################################################
=== PLATFORM ===
uname       : Linux 6.18.44-fc-v22 x86_64
bash        : 5.2.21(1)-release
python3     : 3.11.15
impl sha256 : 7c37bda4ac44617fb4d01a9b51254f73cc13c213b45ff6a3e92d32df89f59d60
started UTC : 2026-08-29T17:15:47Z
=== BASELINE ===
PASS  baseline is GREEN (mutations are meaningful)
platform class : posix (os.sep is '\' on windows, '/' on posix)
=== MUTATIONS ===
DETECTED    M1  classify(): path-set difference no longer means DRIFT
DETECTED    M2  classify(): HEADER-ONLY made unreachable (the rev-2 defect, re-planted)
DETECTED    M3  manifest(): sha256 silently downgraded to md5
DETECTED    M4  extract_specifiers(): FAILS OPEN - malformed source returns no specifiers
DETECTED    M5  extract_specifiers(): JSX fallback ungated - applies to ANY stop reason
DETECTED    M6  extract_specifiers(): JSX fallback accepts a remaining import/require
DETECTED    M7  inside(): containment check disabled - a dep may escape the root
DETECTED    M8  norm(): output no longer made root-relative (absolute paths leak into the manifest)
DETECTED    M8b  resolve(): resolved target not normalised at all (the infinite-walk defect)
NO-OP       M8c  norm(): os.sep no longer normalised to '/' (manifests differ by OS)
        not a defect on posix: os.sep is already '/' here, so the substitution cannot change a single byte
        MUST be re-run on windows, where it IS a defect. Until then: BLOCKED, not covered.
DETECTED    M9  REMOTE_PREFIXES emptied - npm:/https: would be treated as local deps
DETECTED    M10  apply_import_map(): exact import-map hits ignored
DETECTED    M11  manifest(): output no longer sorted (two auditors, two orderings)
=== EQUIVALENT MUTANTS (claimed redundant, claim tested) ===
EQUIVALENT  E1  norm(): its internal realpath() removed (os.path.relpath still normalises lexically)
        claim: os.path.relpath() normalises both of its arguments lexically, so removing the explicit realpath() cannot change the result for any path that contains no symlink. The portable half of norm()'s contract is covered by M8 (root-relative) and M8c (separator).
EQUIVALENT  E2  closure(): root_abs canonicalisation removed (norm() still canonicalises)
        claim: os.path.abspath() and os.path.realpath() differ ONLY in symlink resolution. Absent a symlink they return the same string, so this is a no-op by construction.
EQUIVALENT  E3  norm(): realpath -> abspath (the mutation that escaped the Windows run)
        claim: same reason as E2. THIS IS THE REPAIRED FINDING: revision 7 shipped this as M8 and expected it to be DETECTED, which it was on Linux only because T36 could create a symlink. On Git for Windows T36 skips and the mutation is genuinely undetectable. Symlink resolution is therefore recorded as an UNTESTED property (see BLOCKED_ITEMS), never as coverage.
=== RESTORE CONTROL ===
PASS  suite GREEN again after restore (the RED results above were caused by the mutations)
-----------------------------------------
DETECTED=12 UNDETECTED=0 SKIPPED=0 EQUIVALENT=3 FALSE-EQUIV-CLAIMS=0 NO-OP-HERE=1
NOTE: 1 mutation(s) are no-ops on posix and remain BLOCKED until re-run on the other platform.
NOTE: symlink resolution (realpath vs abspath) is NOT covered on any platform - see E2/E3.
finished UTC : 2026-08-29T17:16:57Z
### exit=0

################################################################
### bash 12_rc_root_mode_test.sh
################################################################
=== PLATFORM ===
uname       : Linux 6.18.44-fc-v22 x86_64
bash        : 5.2.21(1)-release
started UTC : 2026-08-29T17:16:57Z
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
finished UTC : 2026-08-29T17:16:59Z
### exit=0

################################################################
### bash 15_fixture_gate_test.sh
################################################################
=== PLATFORM ===
uname       : Linux 6.18.44-fc-v22 x86_64
bash        : 5.2.21(1)-release
git         : git version 2.43.0
started UTC : 2026-08-29T17:16:59Z
=== TESTS ===
PASS  G0  clean repo at the pinned HEAD -> exit 0
PASS  G0b all three fixtures written
PASS  G0c provenance records identity MATCH
PASS  G0d provenance records all four gates passed
PASS  G0e recorded blob sha1 equals the HEAD blob
PASS  G1a a non-Git directory is REFUSED
PASS  G1b and NO fixture set exists
PASS  G1c the refusal says nothing was copied
PASS  G1d an unusable git (identity UNAVAILABLE) is REFUSED
PASS  G1e and NO fixture set exists
PASS  G2a a repo whose HEAD is not the expected RC is REFUSED
PASS  G2b and NO fixture set exists
PASS  G2c the refusal names the expected RC
PASS  G2d and says this checkout is NOT the frozen RC
PASS  G2e HEAD moved by one empty commit -> REFUSED
PASS  G2f and NO fixture set exists
PASS  G2g resetting HEAD back makes it pass again
PASS  G3a a DIRTY tracked RC file is REFUSED
PASS  G3b and NO fixture set exists
PASS  G3c the refusal names the dirty path
PASS  G3d a dirty tracked file OUTSIDE the three is also REFUSED
PASS  G3e and NO fixture set exists
PASS  G3f a STAGED-only change is REFUSED
PASS  G3g and NO fixture set exists
PASS  G3h an UNTRACKED file alone does not block generation
PASS  G4a bytes differing from the HEAD blob are REFUSED even when status looks clean
PASS  G4b and NO fixture set exists
PASS  G4c the refusal names the byte mismatch
PASS  G5a a missing RC file is REFUSED
PASS  G5b and NO fixture set exists
-----------------------------------------
PASS=30 FAIL=0
finished UTC : 2026-08-29T17:17:01Z
### exit=0

