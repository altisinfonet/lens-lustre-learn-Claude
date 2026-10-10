#!/usr/bin/env bash
# Proves guard exit 1 SURVIVES a pipe to tee — the defect in v1's workflow, where
# `python3 guard.py | tee report.txt` reported the exit status of TEE, always 0.
set -uo pipefail; export LC_ALL=C
HERE="$(cd "$(dirname "$0")" && pwd)"; GUARD="$HERE/ledger_guard.py"
grep -q $'\r' "$0" 2>/dev/null && { echo "FATAL: CRLF"; exit 2; }
for t in git python3 mktemp tee; do command -v $t >/dev/null 2>&1 || { echo "FATAL: missing $t"; exit 2; }; done
echo "=== PLATFORM ==="; echo "uname: $(uname -srm)"; echo "bash : $BASH_VERSION"; echo "started: $(date -u +%FT%TZ)"
echo "=== TESTS ==="
pass=0; fail=0
ok(){ if [ "$2" = "$3" ]; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1 : expected [$3] got [$2]"; fail=$((fail+1)); fi; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@e GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@e
R="$TMP/r"; mkdir -p "$R/src" "$R/docs"; git -C "$R" init -q -b main
echo a > "$R/src/a.ts"; git -C "$R" add -A; git -C "$R" commit -qm base; B=$(git -C "$R" rev-parse HEAD)
echo b >> "$R/src/a.ts"; git -C "$R" add -A; git -C "$R" commit -qm code
echo x > "$R/docs/PROMOTION_LEDGER.md"; git -C "$R" add -A; git -C "$R" commit -qm docs
BADRC=$(git -C "$R" rev-parse HEAD)          # a docs-only commit -> LG-01 must FAIL
L="$R/docs/PROMOTION_LEDGER.md"
cat > "$L" <<EOF
# L
**Status of this revision:** \`REV-1\`
| Field | Value | Class |
|---|---|---|
| **Application / code RC** | \`$BADRC\` | VERIFIED |
| Rev | x |
| **REV-1** | first |
EOF

# 1. bare invocation
python3 "$GUARD" --repo "$R" --ledger "$L" --base "$B" >/dev/null 2>&1
ok "C1 bare guard exits 1 on a failing ledger" "$?" "1"

# 2. THE BUG: naive pipe to tee reports tee's status
naive(){ set +o pipefail; python3 "$GUARD" --repo "$R" --ledger "$L" --base "$B" 2>/dev/null | tee "$TMP/r1.txt" >/dev/null; }
naive; ok "C2 naive '| tee' WITHOUT pipefail wrongly reports 0 (the defect)" "$?" "0"

# 3. FIX A: set -o pipefail
fix_pipefail(){ set -o pipefail; python3 "$GUARD" --repo "$R" --ledger "$L" --base "$B" 2>/dev/null | tee "$TMP/r2.txt" >/dev/null; }
fix_pipefail; ok "C3 'set -o pipefail' propagates exit 1 through tee" "$?" "1"

# 4. FIX B: PIPESTATUS[0]
fix_ps(){ set +o pipefail; python3 "$GUARD" --repo "$R" --ledger "$L" --base "$B" 2>/dev/null | tee "$TMP/r3.txt" >/dev/null; return "${PIPESTATUS[0]}"; }
fix_ps; ok "C4 PIPESTATUS[0] propagates exit 1 through tee" "$?" "1"

# 5. the report is still written in both fixes
ok "C5 pipefail fix still writes the report" "$([ -s "$TMP/r2.txt" ] && echo yes || echo no)" "yes"
ok "C6 PIPESTATUS fix still writes the report" "$([ -s "$TMP/r3.txt" ] && echo yes || echo no)" "yes"

# 6. and a CLEAN ledger must still exit 0 through the same pipeline
GOODRC=$(git -C "$R" rev-list -1 HEAD -- . ':(exclude)docs/*')
sed -i "s|\`$BADRC\`|\`$GOODRC\`|" "$L"
fix_pipefail; ok "C7 clean ledger still exits 0 through the pipe" "$?" "0"

# 7. the exact workflow-command shape used in ledger-guard.yml
wf(){ set -o pipefail; python3 "$GUARD" --repo "$R" --ledger "$L" --base "$B" | tee "$TMP/wf.txt"; }
wf >/dev/null 2>&1; ok "C8 workflow command shape: exit 0 when clean" "$?" "0"
sed -i "s|\`$GOODRC\`|\`$BADRC\`|" "$L"
wf >/dev/null 2>&1; ok "C9 workflow command shape: exit 1 when failing" "$?" "1"


# 8. THE SECOND BUG (v3, caught in review): appending `|| true` to the pipeline
#    OVERWRITES PIPESTATUS with the status of `true`, so every failure reads as 0.
bug_ortrue(){ set -o pipefail
  python3 "$GUARD" --repo "$R" --ledger "$L" --base "$B" 2>/dev/null | tee "$TMP/r4.txt" >/dev/null || true
  return "${PIPESTATUS[0]}"; }
bug_ortrue; ok "C10 '| tee ... || true' destroys PIPESTATUS (the defect)" "$?" "0"

# 9. the v3 workflow shape: no `set -e`, no `|| true`, status read from PIPESTATUS[0]
v3shape(){ set -uo pipefail
  python3 "$GUARD" --repo "$R" --ledger "$L" --base "$B" 2>/dev/null | tee "$TMP/r5.txt" >/dev/null
  return "${PIPESTATUS[0]}"; }
v3shape; ok "C11 v3 shape: exit 1 survives on a failing ledger" "$?" "1"
ok "C12 v3 shape still writes the report" "$([ -s "$TMP/r5.txt" ] && echo yes || echo no)" "yes"

# 10. exit 3 (BLOCKED) must survive the same pipeline, distinct from 0 and 1
git -C "$R" remote add origin "$TMP/no-such-origin.git"
printf '\nZero tags exist.\n' >> "$L"
v3shape; ok "C13 v3 shape: exit 3 (BLOCKED) survives, not flattened to 1" "$?" "3"
ok "C14 the BLOCKED report says so in words" \
   "$(grep -c 'BLOCKED, not confirmed' "$TMP/r5.txt" || true)" "1"

echo "-----------------------------------------"; echo "PASS=$pass FAIL=$fail"; echo "finished: $(date -u +%FT%TZ)"
[ "$fail" -eq 0 ]
