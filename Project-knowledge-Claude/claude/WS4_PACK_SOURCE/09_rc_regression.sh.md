#!/usr/bin/env bash
# FROZEN-RC REGRESSION — specifier extraction against representative real RC files.
#
# TWO MODES
#   (a) default            : runs against the shape-fixtures in fixtures/rc/ (shipped, offline).
#   (b) --rc-root <path>   : runs against a REAL checkout of a42b209e. Use this. It is the
#                            authoritative form; mode (a) exists so the pack is testable offline.
#
# GROUND TRUTH PROVENANCE
#   The expected specifier sets below were MEASURED from the real RC files at
#   a42b209e4f70a6efed4f3dcdb654e0f994416594 by a read-only structural scan (GitHub blob
#   contents, `from "<spec>"` occurrences). File BODIES were not retrievable by the compiler,
#   so fixtures/rc/*.ts(x) reproduce the real SPECIFIERS and the real STATEMENT SHAPE
#   (multiline named imports, npm: specifiers) with elided bodies. They are labelled as such.
#   Mode (b) removes that caveat entirely.
#
# SUPPORTED PLATFORM: see 08_selftest.sh. LF line endings required.
set -uo pipefail
export LC_ALL=C
HERE="$(cd "$(dirname "$0")" && pwd)"
IMPL="$HERE/07_ws4_reference_impl.py"
if grep -q $'\r' "$0" 2>/dev/null; then echo "FATAL: CRLF line endings; re-checkout with LF."; exit 2; fi

RCROOT=""; [ "${1:-}" = "--rc-root" ] && RCROOT="${2:-}"
MODE="fixture"; BASE="$HERE/fixtures/rc"
if [ -n "$RCROOT" ]; then MODE="real-checkout"; BASE="$RCROOT"; fi

echo "=== PLATFORM ==="
echo "uname       : $(uname -srm 2>/dev/null || echo unknown)"
echo "bash        : ${BASH_VERSION:-unknown}"
echo "python3     : $(python3 -c 'import sys;print(sys.version.split()[0])' 2>/dev/null || echo missing)"
echo "impl sha256 : $(sha256sum "$IMPL" | cut -d' ' -f1)"
echo "mode        : $MODE"
echo "base        : $BASE"
echo "started UTC : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "=== RC SPECIFIER REGRESSION ==="

pass=0; fail=0
ok(){ if [ "$2" = "$3" ]; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; echo "        expected: $3"; echo "        got     : $2"; fail=$((fail+1)); fi; }

# local (relative) specifiers only — remote npm:/https: are EXTERNAL by design and not part of
# the local closure. The extractor returns all specifiers; we filter to relative ones here.
locals_of(){ python3 "$IMPL" extract --file "$1" 2>/dev/null | grep '^\.' | sort | tr '\n' ','; }
allrc(){ python3 "$IMPL" extract --file "$1" >/dev/null 2>&1; echo $?; }

F1="$BASE/supabase/functions/submit-judge-decision/index.ts"
F2="$BASE/supabase/functions/detect-orphan-files/index.ts"
F3="$BASE/supabase/functions/_shared/transactional-email-templates/entry-winner.tsx"

for f in "$F1" "$F2" "$F3"; do
  [ -f "$f" ] || { echo "FAIL  missing input: $f"; fail=$((fail+1)); }
done

ok "R1 submit-judge-decision: parses cleanly"        "$(allrc "$F1")" "0"
ok "R2 submit-judge-decision: local deps complete"   "$(locals_of "$F1")" "../_shared/judgingAuth.ts,../_shared/secureHeaders.ts,"
ok "R3 detect-orphan-files: parses cleanly"          "$(allrc "$F2")" "0"
ok "R4 detect-orphan-files: local deps complete"     "$(locals_of "$F2")" "../_shared/referenceSet.ts,../_shared/s3.ts,"
ok "R5 entry-winner.tsx: parses cleanly"             "$(allrc "$F3")" "0"
ok "R6 entry-winner.tsx: local deps complete (5)"    "$(locals_of "$F3")" "../laneConfig.ts,../stageCatalog.ts,./BrandHeader.tsx,./Disclaimer.tsx,./registry.ts,"
ok "R7 entry-winner.tsx: npm: specifiers seen and treated as EXTERNAL" \
   "$(python3 "$IMPL" extract --file "$F3" 2>/dev/null | grep -c '^npm:')" "2"
ok "R8 detect-orphan-files: https: specifier seen and EXTERNAL" \
   "$(python3 "$IMPL" extract --file "$F2" 2>/dev/null | grep -c '^https:')" "1"

echo "-----------------------------------------"
echo "PASS=$pass FAIL=$fail"
echo "finished UTC : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
[ "$fail" -eq 0 ]
