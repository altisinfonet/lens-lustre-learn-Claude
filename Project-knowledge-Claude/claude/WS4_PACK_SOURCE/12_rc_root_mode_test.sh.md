#!/usr/bin/env bash
# 09_rc_regression.sh --rc-root <path> is the AUTHORITATIVE mode - the one the auditor will
# run against a real checkout of a42b209e - and until now it had never been executed at all.
# This script exercises the mode's plumbing against a synthetic checkout, with negative
# controls, so the auditor does not discover a broken flag on their first attempt.
#
# WHAT THIS DOES NOT PROVE: the synthetic checkout is built from the shipped SHAPE FIXTURES.
# A green run here says the MODE works. It says NOTHING about whether the recorded ground
# truth matches the real RC files. Only a run against a real checkout can say that (B1).
set -uo pipefail; export LC_ALL=C
HERE="$(cd "$(dirname "$0")" && pwd)"
grep -q $'\r' "$0" 2>/dev/null && { echo "FATAL: CRLF line endings; re-checkout with LF."; exit 2; }
miss=""; for t in bash python3 mktemp cp sed grep; do command -v "$t" >/dev/null 2>&1 || miss="$miss $t"; done
[ -n "$miss" ] && { echo "FATAL: missing tool(s):$miss"; exit 2; }

echo "=== PLATFORM ==="
echo "uname       : $(uname -srm 2>/dev/null || echo unknown)"
echo "bash        : ${BASH_VERSION:-unknown}"
echo "started UTC : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "=== TESTS ==="
pass=0; fail=0
ok(){ if [ "$2" = "$3" ]; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1 : expected [$3] got [$2]"; fail=$((fail+1)); fi; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
CO="$TMP/checkout"                       # a directory shaped like a real repository checkout
mkdir -p "$CO"
cp -R "$HERE/fixtures/rc/." "$CO/"
REL="supabase/functions"
F3="$CO/$REL/_shared/transactional-email-templates/entry-winner.tsx"

ok "K0 synthetic checkout has the three RC paths" \
   "$(find "$CO/$REL" -name '*.ts' -o -name '*.tsx' | wc -l | tr -d ' ')" "3"

run_rcroot(){ bash "$HERE/09_rc_regression.sh" --rc-root "$1" >"$TMP/out" 2>&1; echo $?; }

rc=$(run_rcroot "$CO")
ok "K1 --rc-root exits 0 against a well-formed checkout" "$rc" "0"
ok "K2 the transcript records mode : real-checkout (not fixture)" \
   "$(grep -c '^mode  *: real-checkout' "$TMP/out")" "1"
ok "K3 the transcript records the base it was pointed at" \
   "$(grep -c "^base  *: $CO" "$TMP/out")" "1"
ok "K4 all eight regression assertions ran" "$(grep -c '^PASS  R' "$TMP/out")" "8"

# --- negative control 1: a changed local specifier must FAIL, not pass silently ---
cp "$F3" "$TMP/f3.bak"
sed -i 's|"./Disclaimer.tsx"|"./DisclaimerRENAMED.tsx"|' "$F3"
rc=$(run_rcroot "$CO")
ok "K5 NEGATIVE: a renamed local dependency FAILS the regression" "$rc" "1"
ok "K5b and the failure names the specifier set that moved" \
   "$(grep -c 'R6 entry-winner.tsx: local deps complete' "$TMP/out")" "1"
cp "$TMP/f3.bak" "$F3"
rc=$(run_rcroot "$CO"); ok "K5c restoring the file makes it pass again" "$rc" "0"

# --- negative control 2: a missing input must FAIL, never be skipped -------------
mv "$CO/$REL/detect-orphan-files/index.ts" "$TMP/held.ts"
rc=$(run_rcroot "$CO")
ok "K6 NEGATIVE: a missing RC file FAILS" "$rc" "1"
ok "K6b and it is reported as a missing input, not as a parse result" \
   "$(grep -c 'missing input' "$TMP/out")" "1"
mv "$TMP/held.ts" "$CO/$REL/detect-orphan-files/index.ts"

# --- negative control 3: an unparseable file must FAIL CLOSED -------------------
printf '\nconst broken = "unterminated;\n' >> "$CO/$REL/submit-judge-decision/index.ts"
rc=$(run_rcroot "$CO")
ok "K7 NEGATIVE: an unparseable RC file FAILS (fail-closed)" "$rc" "1"

# --- pointing at a directory that is not a checkout at all ----------------------
mkdir -p "$TMP/empty"
rc=$(run_rcroot "$TMP/empty")
ok "K8 NEGATIVE: an empty --rc-root FAILS rather than reporting success" "$rc" "1"

echo "-----------------------------------------"
echo "PASS=$pass FAIL=$fail"
echo "SCOPE: mode plumbing only. Ground truth vs the REAL RC remains BLOCKED (B1)."
echo "finished UTC : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
[ "$fail" -eq 0 ]
