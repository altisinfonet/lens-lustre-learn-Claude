#!/usr/bin/env bash
# NEGATIVE CONTROLS for 13_make_rc_fixtures.sh (revision 8).
#
# The generator must FAIL CLOSED: a wrong HEAD, an unavailable identity, or a dirty source must
# produce NO usable fixture set. "No usable fixture set" is asserted directly - the output
# directory must not exist, or must contain no fixture files - not inferred from the exit code.
#
# The shipped script hard-codes the expected RC. To exercise G3/G4 in isolation, these tests run
# a COPY whose EXPECTED_RC line is rewritten to the throwaway repo's own HEAD. The shipped file
# is never modified.
set -uo pipefail; export LC_ALL=C
HERE="$(cd "$(dirname "$0")" && pwd)"
GEN="$HERE/13_make_rc_fixtures.sh"
grep -q $'\r' "$0" 2>/dev/null && { echo "FATAL: CRLF line endings; re-checkout with LF."; exit 2; }
miss=""; for t in git python3 mktemp cp sed grep; do command -v "$t" >/dev/null 2>&1 || miss="$miss $t"; done
[ -n "$miss" ] && { echo "FATAL: missing tool(s):$miss"; exit 2; }
[ -f "$GEN" ] || { echo "FATAL: $GEN missing"; exit 2; }

echo "=== PLATFORM ==="
echo "uname       : $(uname -srm 2>/dev/null || echo unknown)"
echo "bash        : ${BASH_VERSION:-unknown}"
echo "git         : $(git --version)"
echo "started UTC : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "=== TESTS ==="
pass=0; fail=0
ok(){ if [ "$2" = "$3" ]; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1 : expected [$3] got [$2]"; fail=$((fail+1)); fi; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@e GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@e

REL1=supabase/functions/submit-judge-decision/index.ts
REL2=supabase/functions/detect-orphan-files/index.ts
REL3=supabase/functions/_shared/transactional-email-templates/entry-winner.tsx

# --- a throwaway repo containing the three paths ------------------------------
R="$TMP/repo"; mkdir -p "$R"
cp -R "$HERE/fixtures/rc/." "$R/"
echo "unrelated" > "$R/README.md"
git -C "$R" init -q -b main
git -C "$R" add -A >/dev/null
git -C "$R" commit -qm "rc"
REPO_HEAD="$(git -C "$R" rev-parse HEAD)"

# --- a copy of the generator pinned to THIS repo's head -----------------------
GEN_PINNED="$TMP/gen_pinned.sh"
sed "s/^EXPECTED_RC=.*/EXPECTED_RC=$REPO_HEAD/" "$GEN" > "$GEN_PINNED"
grep -q "^EXPECTED_RC=$REPO_HEAD\$" "$GEN_PINNED" || { echo "FATAL: could not pin the test copy"; exit 2; }

OUT="$TMP/out"
run(){ rm -rf "$OUT"; bash "$1" --rc-root "$2" --out "$OUT" >"$TMP/log" 2>&1; echo $?; }
# "no usable fixture set" = the three fixture files are absent
has(){ grep -q -- "$1" "$TMP/log" && echo yes || echo no; }
fixtures_present(){ n=0; for f in "$REL1" "$REL2" "$REL3"; do [ -f "$OUT/$f" ] && n=$((n+1)); done; echo "$n"; }

# ---------- POSITIVE: everything clean and pinned ----------
rc=$(run "$GEN_PINNED" "$R")
ok "G0  clean repo at the pinned HEAD -> exit 0"          "$rc" "0"
ok "G0b all three fixtures written"                        "$(fixtures_present)" "3"
ok "G0c provenance records identity MATCH"                 "$(grep -c '^identity      : MATCH' "$OUT/FIXTURE_PROVENANCE.txt" || true)" "1"
ok "G0d provenance records all four gates passed"          "$(grep -c 'ALL PASSED' "$OUT/FIXTURE_PROVENANCE.txt" || true)" "1"
ok "G0e recorded blob sha1 equals the HEAD blob"           "$(awk '$4=="'"$REL1"'"{print $1}' "$OUT/FIXTURE_PROVENANCE.txt")" "$(git -C "$R" rev-parse "HEAD:$REL1")"

# ---------- G1: not a Git worktree ----------
ND="$TMP/plain"; mkdir -p "$ND"; cp -R "$HERE/fixtures/rc/." "$ND/"
rc=$(run "$GEN_PINNED" "$ND")
ok "G1a a non-Git directory is REFUSED"                    "$rc" "1"
ok "G1b and NO fixture set exists"                         "$(fixtures_present)" "0"
ok "G1c the refusal says nothing was copied"               "$(grep -c 'NO fixture set was created' "$TMP/log" || true)" "1"

# ---------- G1: git present but broken (identity unavailable) ----------
FAKE="$TMP/fakebin"; mkdir -p "$FAKE"
printf '#!/bin/sh\nexit 1\n' > "$FAKE/git"; chmod +x "$FAKE/git"
rm -rf "$OUT"; PATH="$FAKE:$PATH" bash "$GEN_PINNED" --rc-root "$R" --out "$OUT" >"$TMP/log" 2>&1; rc=$?
ok "G1d an unusable git (identity UNAVAILABLE) is REFUSED" "$rc" "1"
ok "G1e and NO fixture set exists"                         "$(fixtures_present)" "0"

# ---------- G2: wrong HEAD ----------
rc=$(run "$GEN" "$R")          # the SHIPPED script, pinned to a42b209e - this repo is not that
ok "G2a a repo whose HEAD is not the expected RC is REFUSED" "$rc" "1"
ok "G2b and NO fixture set exists"                           "$(fixtures_present)" "0"
ok "G2c the refusal names the expected RC"                   "$(has 'a42b209e4f70a6efed4f3dcdb654e0f994416594')" "yes"
ok "G2d and says this checkout is NOT the frozen RC"         "$(grep -c 'NOT the frozen RC' "$TMP/log" || true)" "1"
# a second commit moves HEAD away from the pinned value
git -C "$R" commit -q --allow-empty -m "moves HEAD"
rc=$(run "$GEN_PINNED" "$R")
ok "G2e HEAD moved by one empty commit -> REFUSED"           "$rc" "1"
ok "G2f and NO fixture set exists"                           "$(fixtures_present)" "0"
git -C "$R" reset -q --hard "$REPO_HEAD"
rc=$(run "$GEN_PINNED" "$R"); ok "G2g resetting HEAD back makes it pass again" "$rc" "0"

# ---------- G3: dirty tracked files ----------
printf '\n// local edit\n' >> "$R/$REL2"
rc=$(run "$GEN_PINNED" "$R")
ok "G3a a DIRTY tracked RC file is REFUSED"                  "$rc" "1"
ok "G3b and NO fixture set exists"                           "$(fixtures_present)" "0"
ok "G3c the refusal names the dirty path"                    "$(has "$REL2")" "yes"
git -C "$R" checkout -q -- "$REL2"

printf 'edited\n' >> "$R/README.md"                          # dirty, but NOT one of the three
rc=$(run "$GEN_PINNED" "$R")
ok "G3d a dirty tracked file OUTSIDE the three is also REFUSED" "$rc" "1"
ok "G3e and NO fixture set exists"                              "$(fixtures_present)" "0"
git -C "$R" checkout -q -- README.md

printf '\n// staged only\n' >> "$R/$REL3"                     # index dirty
git -C "$R" add "$REL3" >/dev/null
rc=$(run "$GEN_PINNED" "$R")
ok "G3f a STAGED-only change is REFUSED"                      "$rc" "1"
ok "G3g and NO fixture set exists"                            "$(fixtures_present)" "0"
git -C "$R" reset -q --hard "$REPO_HEAD"

UNTR="$R/scratch.txt"; echo hi > "$UNTR"
rc=$(run "$GEN_PINNED" "$R")
ok "G3h an UNTRACKED file alone does not block generation"    "$rc" "0"
rm -f "$UNTR"

# ---------- G4: bytes differ from the HEAD blob ----------
# G3 normally catches this first; force the G4 path by hiding the change from `git status`
# with assume-unchanged, so the worktree looks clean while the bytes have moved.
printf '\n// invisible edit\n' >> "$R/$REL1"
git -C "$R" update-index --assume-unchanged "$REL1"
rc=$(run "$GEN_PINNED" "$R")
ok "G4a bytes differing from the HEAD blob are REFUSED even when status looks clean" "$rc" "1"
ok "G4b and NO fixture set exists"                            "$(fixtures_present)" "0"
ok "G4c the refusal names the byte mismatch"                  "$(grep -c 'differ from HEAD blob' "$TMP/log" || true)" "1"
git -C "$R" update-index --no-assume-unchanged "$REL1"
git -C "$R" checkout -q -- "$REL1"

# ---------- a missing RC file ----------
git -C "$R" rm -q --cached "$REL3" >/dev/null; rm -f "$R/$REL3"
git -C "$R" commit -qm "drop one"
GEN_P2="$TMP/gen2.sh"; sed "s/^EXPECTED_RC=.*/EXPECTED_RC=$(git -C "$R" rev-parse HEAD)/" "$GEN" > "$GEN_P2"
rc=$(run "$GEN_P2" "$R")
ok "G5a a missing RC file is REFUSED"                         "$rc" "1"
ok "G5b and NO fixture set exists"                            "$(fixtures_present)" "0"

echo "-----------------------------------------"
echo "PASS=$pass FAIL=$fail"
echo "finished UTC : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
[ "$fail" -eq 0 ]
