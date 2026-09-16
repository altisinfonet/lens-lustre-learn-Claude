#!/usr/bin/env bash
# WS4 MUTATION CONTROL — does the WS4 suite actually DETECT a broken implementation?
#
# 36 passing tests prove the suite runs. They do not prove it discriminates. This script
# breaks `07_ws4_reference_impl.py` in named, specific ways and requires the suite to go RED
# for each one. An UNDETECTED mutation is a REAL FINDING about the tests, and is reported as
# such - never hidden.
#
# Read-only outside its own temp dir. No provider access. No network. Nothing is installed.
set -uo pipefail; export LC_ALL=C
HERE="$(cd "$(dirname "$0")" && pwd)"
grep -q $'\r' "$0" 2>/dev/null && { echo "FATAL: CRLF line endings; re-checkout with LF."; exit 2; }
miss=""; for t in python3 bash mktemp cp sha256sum; do command -v "$t" >/dev/null 2>&1 || miss="$miss $t"; done
[ -n "$miss" ] && { echo "FATAL: missing tool(s):$miss"; exit 2; }

echo "=== PLATFORM ==="
echo "uname       : $(uname -srm 2>/dev/null || echo unknown)"
echo "bash        : ${BASH_VERSION:-unknown}"
echo "python3     : $(python3 -c 'import sys;print(sys.version.split()[0])' 2>/dev/null || echo missing)"
echo "impl sha256 : $(sha256sum "$HERE/07_ws4_reference_impl.py" | cut -d' ' -f1)"
echo "started UTC : $(date -u +%Y-%m-%dT%H:%M:%SZ)"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
P="$TMP/pack"; mkdir -p "$P"
cp -R "$HERE/." "$P/" 2>/dev/null
CLEAN="$TMP/impl.clean.py"; cp "$HERE/07_ws4_reference_impl.py" "$CLEAN"

# --- the suite under test: fixture selftest + RC specifier regression ---------
suite(){ # -> 0 GREEN, 1 RED
  ( cd "$P" && bash 08_selftest.sh >"$TMP/out.self" 2>&1 ) ; a=$?
  ( cd "$P" && bash 09_rc_regression.sh >"$TMP/out.rc" 2>&1 ) ; b=$?
  [ $a -eq 0 ] && [ $b -eq 0 ] && return 0 || return 1
}

echo "=== BASELINE ==="
cp "$CLEAN" "$P/07_ws4_reference_impl.py"
if suite; then echo "PASS  baseline is GREEN (mutations are meaningful)"
else
  echo "FATAL: baseline is RED - refusing to run mutations over a red baseline."
  echo "--- 08_selftest.sh ---"; tail -20 "$TMP/out.self"
  echo "--- 09_rc_regression.sh ---"; tail -20 "$TMP/out.rc"; exit 2
fi

# --- mutation engine ---------------------------------------------------------
det=0; und=0; skipped=0
mutate(){ # $1 id  $2 description  $3 python-literal old  $4 python-literal new
  cp "$CLEAN" "$P/07_ws4_reference_impl.py"
  local applied
  applied=$(OLD="$3" NEW="$4" python3 - "$P/07_ws4_reference_impl.py" <<'PYM'
import os,sys
p=sys.argv[1]; old=os.environ['OLD']; new=os.environ['NEW']
s=open(p,encoding='utf-8').read()
n=s.count(old)
if n!=1:
    print('BADCOUNT:%d'%n); raise SystemExit(0)
open(p,'w',encoding='utf-8').write(s.replace(old,new,1)); print('OK')
PYM
)
  case "$applied" in
    OK) ;;
    *)  echo "SKIP  $1  $2"
        echo "        mutation did not apply cleanly ($applied) - the source moved; this control is STALE"
        skipped=$((skipped+1)); return;;
  esac
  if python3 -c "import ast,sys;ast.parse(open(sys.argv[1],encoding='utf-8').read())" "$P/07_ws4_reference_impl.py" 2>/dev/null; then :; else
    echo "SKIP  $1  $2 (mutant does not compile - not a fair control)"; skipped=$((skipped+1)); return; fi
  if suite; then
    echo "UNDETECTED  $1  $2"
    echo "        *** REAL FINDING: the suite stays GREEN with this defect present ***"
    und=$((und+1))
  else
    echo "DETECTED    $1  $2"
    det=$((det+1))
  fi
}

# An EQUIVALENT mutant is one whose removal provably cannot change behaviour, because every
# call site already supplies the property the code re-establishes. Claiming equivalence is how
# a test gap gets excused, so the claim is ASSERTED IN BOTH DIRECTIONS: the mutant must stay
# GREEN (or the claim is false), and a companion mutation at the line where the property is
# actually established must be DETECTED (or the property is untested).
equiv_ok=0; equiv_bad=0
equivalent(){ # $1 id  $2 description  $3 old  $4 new  $5 why
  cp "$CLEAN" "$P/07_ws4_reference_impl.py"
  local applied
  applied=$(OLD="$3" NEW="$4" python3 - "$P/07_ws4_reference_impl.py" <<'PYE'
import os,sys
p=sys.argv[1]; old=os.environ['OLD']; new=os.environ['NEW']
s=open(p,encoding='utf-8').read()
if s.count(old)!=1: print('BADCOUNT:%d'%s.count(old)); raise SystemExit(0)
open(p,'w',encoding='utf-8').write(s.replace(old,new,1)); print('OK')
PYE
)
  [ "$applied" = OK ] || { echo "SKIP  $1  $2 ($applied)"; skipped=$((skipped+1)); return; }
  if suite; then
    echo "EQUIVALENT  $1  $2"
    echo "        claim: $5"
    equiv_ok=$((equiv_ok+1))
  else
    echo "FAIL  $1  equivalence claim is FALSE - the suite detects this mutation"
    echo "        claim was: $5"
    equiv_bad=$((equiv_bad+1))
  fi
}

mutate2(){ # $1 id  $2 desc  $3 old1 $4 new1 $5 old2 $6 new2
  cp "$CLEAN" "$P/07_ws4_reference_impl.py"
  local applied
  applied=$(O1="$3" N1="$4" O2="$5" N2="$6" python3 - "$P/07_ws4_reference_impl.py" <<'PYM2'
import os,sys
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
for o,n in ((os.environ['O1'],os.environ['N1']),(os.environ['O2'],os.environ['N2'])):
    if s.count(o)!=1: print('BADCOUNT'); raise SystemExit(0)
    s=s.replace(o,n,1)
open(p,'w',encoding='utf-8').write(s); print('OK')
PYM2
)
  [ "$applied" = OK ] || { echo "SKIP  $1  $2 ($applied)"; skipped=$((skipped+1)); return; }
  if suite; then echo "UNDETECTED  $1  $2"; echo "        *** REAL FINDING ***"; und=$((und+1))
  else echo "DETECTED    $1  $2"; det=$((det+1)); fi
}

# --- platform detection: a mutation can be a real defect on one OS and a no-op on another ---
case "$(uname -s 2>/dev/null || echo unknown)" in
  MINGW*|MSYS*|CYGWIN*|Windows*) PLAT=windows ;;
  *) PLAT=posix ;;
esac
echo "platform class : $PLAT (os.sep is '\\' on windows, '/' on posix)"
noop=0
platform_mutant(){ # $1 id  $2 desc  $3 old  $4 new  $5 platform-where-it-is-a-DEFECT  $6 why-noop-elsewhere
  cp "$CLEAN" "$P/07_ws4_reference_impl.py"
  local applied
  applied=$(OLD="$3" NEW="$4" python3 - "$P/07_ws4_reference_impl.py" <<'PYP'
import os,sys
p=sys.argv[1]; old=os.environ['OLD']; new=os.environ['NEW']
s=open(p,encoding='utf-8').read()
if s.count(old)!=1: print('BADCOUNT:%d'%s.count(old)); raise SystemExit(0)
open(p,'w',encoding='utf-8').write(s.replace(old,new,1)); print('OK')
PYP
)
  [ "$applied" = OK ] || { echo "SKIP  $1  $2 ($applied)"; skipped=$((skipped+1)); return; }
  if [ "$PLAT" = "$5" ]; then
    if suite; then echo "UNDETECTED  $1  $2"; echo "        *** REAL FINDING on $5 ***"; und=$((und+1))
    else echo "DETECTED    $1  $2  [defect on $5]"; det=$((det+1)); fi
  else
    if suite; then
      echo "NO-OP       $1  $2"
      echo "        not a defect on $PLAT: $6"
      echo "        MUST be re-run on $5, where it IS a defect. Until then: BLOCKED, not covered."
      noop=$((noop+1))
    else
      echo "FAIL  $1  claimed a no-op on $PLAT but the suite detected it - the claim is wrong"
      und=$((und+1))
    fi
  fi
}

echo "=== MUTATIONS ==="
mutate M1 "classify(): path-set difference no longer means DRIFT" \
  "    if set(rc) != set(prod):" "    if False:"
mutate M2 "classify(): HEADER-ONLY made unreachable (the rev-2 defect, re-planted)" \
  "HEADER_SUFFIX = '_shared/secureHeaders.ts'" "HEADER_SUFFIX = '_shared/NEVER_MATCHES.ts'"
mutate M3 "manifest(): sha256 silently downgraded to md5" \
  "    h = hashlib.sha256()" "    h = hashlib.md5()"
mutate M4 "extract_specifiers(): FAILS OPEN - malformed source returns no specifiers" \
  "            raise Unparseable('malformed or unmodelled source: %s' % reason, part.err.line)" \
  "            return []"
mutate M5 "extract_specifiers(): JSX fallback ungated - applies to ANY stop reason" \
  "        if not jsx_ok:" "        if False:"
mutate M6 "extract_specifiers(): JSX fallback accepts a remaining import/require" \
  "        if 'import' in rest or 'require' in rest:" "        if False:"
mutate M7 "inside(): containment check disabled - a dep may escape the root" \
  "    return q == r or q.startswith(r + os.sep)" "    return True"
# REVISION 8: the old M8 substituted os.path.abspath() for os.path.realpath(). Those two
# differ ONLY on symlinks, so on Git for Windows - where `ln -s` is unavailable without
# Developer Mode - it was an EQUIVALENT mutant that no test could catch, and it escaped the
# auditor's Windows run. It is now recorded as E3/E4 below, and M8 tests the portable half of
# norm()'s contract instead: output must be ROOT-RELATIVE.
mutate M8 "norm(): output no longer made root-relative (absolute paths leak into the manifest)" \
  "    return os.path.relpath(os.path.realpath(p), os.path.realpath(root)).replace(os.sep, '/')" \
  "    return os.path.realpath(p)"
# NOTE: os.path.abspath() collapses ".." lexically, so substituting it here would be another
# EQUIVALENT mutant, not a defect. The real defect is NO normalisation at all.
mutate M8b "resolve(): resolved target not normalised at all (the infinite-walk defect)" \
  "            cand = os.path.realpath(cand)   # canonicalise: without this an import cycle never closes" \
  "            cand = cand + ''"
platform_mutant M8c "norm(): os.sep no longer normalised to '/' (manifests differ by OS)" \
  "    return os.path.relpath(os.path.realpath(p), os.path.realpath(root)).replace(os.sep, '/')" \
  "    return os.path.relpath(os.path.realpath(p), os.path.realpath(root))" \
  windows "os.sep is already '/' here, so the substitution cannot change a single byte" 

mutate M9 "REMOTE_PREFIXES emptied - npm:/https: would be treated as local deps" \
  "REMOTE_PREFIXES = ('http://', 'https://', 'npm:', 'jsr:', 'node:', 'data:', 'deno:')" \
  "REMOTE_PREFIXES = ()"
mutate M10 "apply_import_map(): exact import-map hits ignored" \
  "    if spec in imap:" "    if False:"
mutate M11 "manifest(): output no longer sorted (two auditors, two orderings)" \
  "            for r in sorted(rels)]" "            for r in list(rels)]"

echo "=== EQUIVALENT MUTANTS (claimed redundant, claim tested) ==="
equivalent E1 "norm(): its internal realpath() removed (os.path.relpath still normalises lexically)" \
  "    return os.path.relpath(os.path.realpath(p), os.path.realpath(root)).replace(os.sep, '/')" \
  "    return os.path.relpath(p, root).replace(os.sep, '/')" \
  "os.path.relpath() normalises both of its arguments lexically, so removing the explicit realpath() cannot change the result for any path that contains no symlink. The portable half of norm()'s contract is covered by M8 (root-relative) and M8c (separator)."
equivalent E2 "closure(): root_abs canonicalisation removed (norm() still canonicalises)" \
  "    root_abs = os.path.realpath(root)" "    root_abs = os.path.abspath(root)" \
  "os.path.abspath() and os.path.realpath() differ ONLY in symlink resolution. Absent a symlink they return the same string, so this is a no-op by construction."
equivalent E3 "norm(): realpath -> abspath (the mutation that escaped the Windows run)" \
  "    return os.path.relpath(os.path.realpath(p), os.path.realpath(root)).replace(os.sep, '/')" \
  "    return os.path.relpath(os.path.abspath(p), os.path.abspath(root)).replace(os.sep, '/')" \
  "same reason as E2. THIS IS THE REPAIRED FINDING: revision 7 shipped this as M8 and expected it to be DETECTED, which it was on Linux only because T36 could create a symlink. On Git for Windows T36 skips and the mutation is genuinely undetectable. Symlink resolution is therefore recorded as an UNTESTED property (see BLOCKED_ITEMS), never as coverage."

# --- restore and prove the harness is not stuck-red ---------------------------
cp "$CLEAN" "$P/07_ws4_reference_impl.py"
echo "=== RESTORE CONTROL ==="
if suite; then echo "PASS  suite GREEN again after restore (the RED results above were caused by the mutations)"
else echo "FAIL  suite still RED after restore - the results above are NOT attributable to the mutations"; und=$((und+1)); fi
echo "-----------------------------------------"
echo "DETECTED=$det UNDETECTED=$und SKIPPED=$skipped EQUIVALENT=$equiv_ok FALSE-EQUIV-CLAIMS=$equiv_bad NO-OP-HERE=$noop"
[ "$noop" -gt 0 ] && echo "NOTE: $noop mutation(s) are no-ops on $PLAT and remain BLOCKED until re-run on the other platform."
echo "NOTE: symlink resolution (realpath vs abspath) is NOT covered on any platform - see E2/E3."
echo "finished UTC : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
[ "$und" -eq 0 ] && [ "$skipped" -eq 0 ] && [ "$equiv_bad" -eq 0 ]
