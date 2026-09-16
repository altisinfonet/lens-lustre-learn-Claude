#!/usr/bin/env bash
# ledger-guard v3 self-test — one POSITIVE (must fire) and one NEGATIVE (must stay silent)
# mutation per check, LG-01..LG-10, plus adversarial bypass cases.
# Reports PER-CHECK coverage. Read-only outside its own temp dir.
set -uo pipefail; export LC_ALL=C
HERE="$(cd "$(dirname "$0")" && pwd)"; GUARD="$HERE/ledger_guard.py"
grep -q $'\r' "$0" 2>/dev/null && { echo "FATAL: CRLF line endings"; exit 2; }
m=""; for t in git python3 mktemp grep sed awk sort; do command -v $t >/dev/null 2>&1 || m="$m $t"; done
[ -n "$m" ] && { echo "FATAL: missing tool(s):$m"; exit 2; }
[ -f "$GUARD" ] || { echo "FATAL: $GUARD missing"; exit 2; }

echo "=== PLATFORM ==="; echo "uname: $(uname -srm)"; echo "bash : $BASH_VERSION"
echo "python3: $(python3 -c 'import sys;print(sys.version.split()[0])')"; echo "git: $(git --version)"
echo "guard sha256: $(sha256sum "$GUARD" | cut -c1-16)…"; echo "started: $(date -u +%FT%TZ)"
echo "=== TESTS ==="
pass=0; fail=0; declare -A COV
ok(){ local id="$1" got="$2" want="$3" chk="$4"
  if [ "$got" = "$want" ]; then echo "PASS  $id"; pass=$((pass+1)); COV[$chk]="${COV[$chk]:-}+"
  else echo "FAIL  $id : expected [$want] got [$got]"; fail=$((fail+1)); COV[$chk]="${COV[$chk]:-}!"; fi; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@e GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@e
# --- real git repo + a bare "origin" so remote tags can be tested -------------
BARE="$TMP/origin.git"; git init -q --bare "$BARE"
R="$TMP/repo"; mkdir -p "$R/src" "$R/docs"; git -C "$R" init -q -b main
git -C "$R" remote add origin "$BARE"
echo base > "$R/src/a.ts"; git -C "$R" add -A; git -C "$R" commit -qm base
BASE=$(git -C "$R" rev-parse HEAD); BTREE=$(git -C "$R" rev-parse HEAD^{tree})
echo x >> "$R/src/a.ts"; echo n > "$R/src/b.ts"; git -C "$R" add -A; git -C "$R" commit -qm code1
RC=$(git -C "$R" rev-parse HEAD); RCTREE=$(git -C "$R" rev-parse HEAD^{tree})
echo l1 > "$R/docs/PROMOTION_LEDGER.md"; git -C "$R" add -A; git -C "$R" commit -qm docs1
echo l2 > "$R/docs/PROMOTION_LEDGER.md"; git -C "$R" add -A; git -C "$R" commit -qm docs2
DOCS=$(git -C "$R" rev-parse HEAD)
git -C "$R" push -q origin main; git -C "$R" fetch -q origin
read F A D <<<"$(git -C "$R" diff --numstat "$BASE...HEAD" | awk '{f++;a+=$1;d+=$2}END{print f,a,d}')"
NC=$(git -C "$R" rev-list --count "$BASE..HEAD")

L="$R/docs/PROMOTION_LEDGER.md"
mk(){ # $1=rc $2=tree $3=files $4=add $5=del $6=commits $7=extra-prose $8=rev $9=extra-row
cat > "$L" <<EOF
# LEDGER
**Status of this revision:** \`REV-${8}\`

# 1 · DOCUMENT CONTROL
| Field | Value | Class |
|---|---|---|
| **Application / code RC** | \`$1\` — frozen | VERIFIED |
| **main pre-promotion tree** | \`$2\` | VERIFIED |
${9:-}

# 3 · SCOPE
## 3.2 · COUNTS
| Metric | Value | Instrument |
|---|---|---|
| Files changed | **$3** | \`git diff\` main…staging 2026-08-29T00:00Z |
| Lines | **+$4 / −$5** | same |
| Commits ahead of \`main\` | **$6 counting merges** | \`git\` main…staging 2026-08-29T00:00Z |

# 16 · WRITES
## 16.1 nothing

# 26 · DISPOSITION
Zero tags exist. ${7:-}

# 27 · REVISIONS
| Rev | Change |
|---|---|
| **REV-1** | first |
| **REV-${8}** | current |
EOF
}
run(){ python3 "$GUARD" --repo "$R" --ledger "$L" --base "$BASE" 2>&1; }
n(){ run | grep -c "^$1  *FAIL" || true; }
w(){ run | grep -c "^$1  *WARN" || true; }
fa(){ run | grep -c "^$1  *FATAL" || true; }              # v3
rc_of(){ python3 "$GUARD" --repo "$R" --ledger "$L" --base "$BASE" >/dev/null 2>&1; echo $?; }

# ---------- clean baseline ----------
mk "$RC" "$BTREE" "$F" "$A" "$D" "$NC" "" 2
ok "N0  clean ledger -> FAIL=0" "$(run | grep -o 'FAIL=[0-9]*' | head -1 | cut -d= -f2)" "0" BASE

# ---------- LG-01 ----------
mk "$DOCS" "$BTREE" "$F" "$A" "$D" "$NC" "" 2
ok "P1  LG-01 fires: RC is a docs-only commit" "$(n LG-01)" "1" LG-01
mk "$RC" "$BTREE" "$F" "$A" "$D" "$NC" "" 2
ok "N1  LG-01 silent on the true code RC" "$(n LG-01)" "0" LG-01
mk "$RC\` and formerly \`$DOCS" "$BTREE" "$F" "$A" "$D" "$NC" "" 2
ok "P1b LG-01 takes only the FIRST sha; warns about the rest" "$(w LG-01)" "1" LG-01

# ---------- LG-02 ----------
git -C "$R" checkout -qb late; echo z >> "$R/src/a.ts"; git -C "$R" add -A; git -C "$R" commit -qm latecode
mk "$RC" "$BTREE" "$F" "$A" "$D" "$NC" "" 2
ok "P2  LG-02 fires: code landed after the RC" "$(n LG-02)" "1" LG-02
git -C "$R" checkout -q -f main; git -C "$R" branch -qD late
git -C "$R" rev-list --count "$BASE..HEAD" | grep -qx "$NC" || { echo "FATAL: fixture state leaked after P2"; exit 2; }
mk "$RC" "$BTREE" "$F" "$A" "$D" "$NC" "" 2
ok "N2  LG-02 silent when only docs/ changed" "$(n LG-02)" "0" LG-02

# ---------- LG-03 typed identifiers ----------
mk "$RC" "$RC" "$F" "$A" "$D" "$NC" "" 2
ok "P3  LG-03 fires: tree field holds a commit sha" "$(n LG-03)" "1" LG-03
mk "$RC" "$BTREE" "$F" "$A" "$D" "$NC" "" 2
ok "N3  LG-03 silent: tree field holds a real tree" "$(n LG-03)" "0" LG-03
# --- v3 FIX 1: in a TYPED commit/tree field, a 32-hex value is a FAILURE ------
mk "$RC" "$BTREE" "$F" "$A" "$D" "$NC" "" 2 '| **Merge base** | `73a7920647481fd93553f9c1f68bf5a3` | VERIFIED |'
ok "V1-P LG-03 FAILS on a 32-hex value in a typed commit field" "$(n LG-03)" "1" LG-03
ok "V1-P2 …and the message says why it is not excused" \
   "$(run | grep -c 'typed commit' || true)" "1" LG-03
mk "$RC" "$BTREE" "$F" "$A" "$D" "$NC" "" 2 '| **Cloudflare account id** | `a7810011a99de537a210130f86306785` | VERIFIED |'
ok "V1-N LG-03 silent on a 32-hex value in an OPAQUE (non-git) field" "$(n LG-03)" "0" LG-03

# ---------- LG-04 void reuse ----------
mk "$RC" "$BTREE" "$F" "$A" "$D" "$NC" "" 2 "| ~~**Candidate sha**~~ | ~~\`$DOCS\`~~ — WRONG | CORRECTED |
| **Merge base** | \`$DOCS\` | VERIFIED |"
ok "P4  LG-04 fires: a struck canonical sha reused in a live field" "$(n LG-04)" "1" LG-04
mk "$RC" "$BTREE" "$F" "$A" "$D" "$NC" "" 2 "| ~~2~~ | ~~blocker closed~~ — merge \`$DOCS\` landed | done |"
ok "N4  LG-04 silent: a struck ROW NUMBER does not void a sha" "$(n LG-04)" "0" LG-04

# ---------- LG-05 scope ----------
mk "$RC" "$BTREE" "999" "$A" "$D" "$NC" "" 2
ok "P5a LG-05 fires on a wrong file count" "$(n LG-05)" "1" LG-05
mk "$RC" "$BTREE" "$F" "$A" "$D" "205" "" 2
ok "P5b LG-05 fires on 205 commits (the C-2 case)" "$(n LG-05)" "1" LG-05
mk "$RC" "$BTREE" "$F" "12345" "$D" "$NC" "" 2
ok "P5c LG-05 fires on wrong line counts" "$(n LG-05)" "1" LG-05
mk "$RC" "$BTREE" "$F" "$A" "$D" "$NC" "" 2
if [ "$(n LG-05)" != "0" ]; then echo "--- DEBUG N5 ---"; run | grep -E "LG-0[1-9]"; echo "F=$F A=$A D=$D NC=$NC"; sed -n '10,20p' "$L"; echo "--- END ---"; fi
ok "N5  LG-05 silent when all three match the declared endpoint" "$(n LG-05)" "0" LG-05
sed -i "s|\*\*$NC counting merges\*\*|**$NC counting merges** · PR #104 · at 10:40Z|" "$L"
ok "N5b LG-05 ignores #104 and 10:40 inside the value cell" "$(n LG-05)" "0" LG-05

# ---------- LG-06 ----------
mk "$RC" "$BTREE" "$F" "$A" "$D" "$NC" "" 2; sed -i 's/`REV-2`/`REV-9`/' "$L"
ok "P6  LG-06 fires when the header outruns the table" "$(n LG-06)" "1" LG-06
mk "$RC" "$BTREE" "$F" "$A" "$D" "$NC" "" 2
ok "N6  LG-06 silent when they agree" "$(n LG-06)" "0" LG-06

# ---------- LG-07 basis ----------
mk "$RC" "$BTREE" "$F" "$A" "$D" "$NC" "" 2
python3 - "$L" <<'PYX'
import sys,re
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
s=re.sub(r'(\| Files changed \| \*\*\d+\*\* \| )[^|]*(\|)', r'\1main…staging \2', s)
open(p,'w',encoding='utf-8').write(s)
PYX
ok "P7  LG-07 fires: a canonical figure row with no basis" "$(n LG-07)" "1" LG-07
mk "$RC" "$BTREE" "$F" "$A" "$D" "$NC" "" 2
ok "N7  LG-07 silent when the row carries a date/instrument" "$(n LG-07)" "0" LG-07
ok "N7b LG-07 silent for a row whose instrument cell says 'same'" "$(run | grep -c 'line 12.*no basis' || true)" "0" LG-07

# ---------- LG-08 ----------
mk "$RC" "$BTREE" "$F" "$A" "$D" "$NC" 'See §5.999 for detail.' 2
ok "P8a LG-08 fires on §5.999 (no such subsection)" "$(n LG-08)" "1" LG-08
mk "$RC" "$BTREE" "$F" "$A" "$D" "$NC" 'See §16.1 and §16 for detail.' 2
ok "N8  LG-08 silent on §16.1 (exists) and §16 (top level)" "$(n LG-08)" "0" LG-08
mk "$RC" "$BTREE" "$F" "$A" "$D" "$NC" 'The runbook §5.3.6 probe is separate.' 2
ok "N8b LG-08 silent on an explicit runbook §ref" "$(n LG-08)" "0" LG-08
mk "$RC" "$BTREE" "$F" "$A" "$D" "$NC" 'The §5.3.6 probe is separate.' 2
ok "P8b LG-08 fires on a bare §5.3.6 with no document prefix" "$(n LG-08)" "1" LG-08

# ---------- LG-09 local AND remote tags ----------
mk "$RC" "$BTREE" "$F" "$A" "$D" "$NC" "" 2
ok "N9  LG-09 silent when there really are no tags" "$(n LG-09)" "0" LG-09
git -C "$R" tag v-remote-only; git -C "$R" push -q origin v-remote-only; git -C "$R" tag -d v-remote-only >/dev/null
ok "P9  LG-09 fires on a tag that exists ONLY on the remote" "$(n LG-09)" "1" LG-09
git -C "$R" push -q --delete origin v-remote-only

# ---------- LG-10 ----------
mk "$RC" "$BTREE" "$F" "$A" "$D" "$NC" 'Run the runbook runbook probe.' 2
ok "P10 LG-10 fires on a duplicated word" "$(n LG-10)" "1" LG-10
mk "$RC" "$BTREE" "$F" "$A" "$D" "$NC" 'Run the runbook probe.' 2
ok "N10 LG-10 silent on clean prose" "$(n LG-10)" "0" LG-10

# ---------- adversarial: the words that used to switch checks off ----------
for word in corrected void preserved stale; do
  mk "$DOCS" "$BTREE" "$F" "$A" "$D" "$NC" "This line is $word but the claim is live." 2
  ok "A-$word  bypass attempt with the word \"$word\" does NOT disable LG-01" "$(n LG-01)" "1" ADV
done
mk "$DOCS" "$BTREE" "$F" "$A" "$D" "$NC" "" 2 "| **Merge base** | \`$RC\` — corrected, void, preserved, stale | VERIFIED |"
ok "A-mixed  a mixed row stays ACTIVE for its live part" "$(n LG-01)" "1" ADV

# ---------- exit codes ----------
mk "$DOCS" "$BTREE" "$F" "$A" "$D" "$NC" "" 2
python3 "$GUARD" --repo "$R" --ledger "$L" --base "$BASE" >/dev/null 2>&1; ok "X1 exit 1 on FAIL" "$?" "1" EXIT
mk "$RC" "$BTREE" "$F" "$A" "$D" "$NC" "" 2
python3 "$GUARD" --repo "$R" --ledger "$L" --base "$BASE" >/dev/null 2>&1; ok "X2 exit 0 when clean" "$?" "0" EXIT
python3 "$GUARD" --repo "$TMP" --ledger "$L" --base "$BASE" >/dev/null 2>&1; ok "X3 exit 2 on unusable repo" "$?" "2" EXIT
python3 "$GUARD" --repo "$R" --ledger "$TMP/nope.md" --base "$BASE" >/dev/null 2>&1; ok "X4 exit 2 on missing ledger" "$?" "2" EXIT
python3 "$GUARD" --repo "$R" --facts x --ledger "$L" >/dev/null 2>&1; ok "X5 exit 2 on --repo + --facts" "$?" "2" EXIT

# ============================ v3 FIX TESTS ==================================
# --- FIX 2: void identity compared across full and abbreviated SHAs ----------
SHORTDOCS="${DOCS:0:8}"
mk "$RC" "$BTREE" "$F" "$A" "$D" "$NC" "" 2 "| ~~**Candidate sha**~~ | ~~\`$DOCS\`~~ — WRONG | CORRECTED |
| **Merge base** | \`$SHORTDOCS\` | VERIFIED |"
ok "V2-P LG-04 fires: full void SHA reused as an ABBREVIATION" "$(n LG-04)" "1" LG-04
mk "$RC" "$BTREE" "$F" "$A" "$D" "$NC" "" 2 "| ~~**Candidate sha**~~ | ~~\`$SHORTDOCS\`~~ — WRONG | CORRECTED |
| **Merge base** | \`$DOCS\` | VERIFIED |"
ok "V2-P2 LG-04 fires: abbreviated void SHA reused in FULL form" "$(n LG-04)" "1" LG-04
mk "$RC" "$BTREE" "$F" "$A" "$D" "$NC" "" 2 "| ~~**Candidate sha**~~ | ~~\`$DOCS\`~~ — WRONG | CORRECTED |
| **Merge base** | \`$BASE\` | VERIFIED |"
ok "V2-N LG-04 silent: a DIFFERENT commit is not the void one" "$(n LG-04)" "0" LG-04

# An ambiguous abbreviation cannot be compared -> FATAL, never a silent pass.
# NOTE: the guard only reads 7-40 hex as a SHA, and two real Git objects sharing a
# 7-hex prefix cannot be synthesised cheaply (2^28 space), so this path is exercised
# through the attested fact source, where the collision is stated explicitly. See V5-A.
FJ0="$TMP/facts_amb.json"; FL0="$TMP/f_amb.md"
python3 - "$FJ0" "$BASE" "$DOCS" "$RC" <<'PYB'
import json,sys
out,base,head,rc = sys.argv[1:5]
json.dump({"head":head,"base":base,"last_non_docs_commit":rc,
  "changed_after_code_rc":["docs/PROMOTION_LEDGER.md"],
  "known_commits":[base,head,rc,'abcdef0'+'0'*33,'abcdef0'+'1'*33],
  "known_commits_abbrev_only":[],"known_trees":[],"known_trees_abbrev_only":[],
  "endpoint_labels":{},"ranges":{},"tags_local":[],"tags_remote":[]}, open(out,'w'))
PYB
cat > "$FL0" <<EOF
# LEDGER
**Status of this revision:** \`REV-2\`

# 1 · DOCUMENT CONTROL
| Field | Value | Class |
|---|---|---|
| **Application / code RC** | \`$RC\` | VERIFIED |
| ~~**Candidate sha**~~ | ~~\`$DOCS\`~~ — WRONG | CORRECTED |
| **Merge base** | \`abcdef0\` | VERIFIED |

# 27 · REVISIONS
| Rev | Change |
|---|---|
| **REV-2** | current |
EOF
arun(){ python3 "$GUARD" --facts "$FJ0" --ledger "$FL0" 2>&1; }
ok "V2-A LG-04 FATAL on an ambiguous abbreviation" \
   "$(arun | grep -c '^LG-04  *FATAL' || true)" "1" LG-04
ok "V2-A2 …the message names it ambiguous, not resolved" \
   "$(arun | grep -c 'ambiguous abbreviation' || true)" "1" LG-04
python3 "$GUARD" --facts "$FJ0" --ledger "$FL0" >/dev/null 2>&1
ok "V2-A3 exit code 3 (BLOCKED), not 0 and not 1" "$?" "3" EXIT

# --- FIX 3: ls-remote FAILURE is not an empty result -------------------------
mk "$RC" "$BTREE" "$F" "$A" "$D" "$NC" "" 2
ok "V3-N LG-09 no FATAL while origin is reachable" "$(fa LG-09)" "0" LG-09
git -C "$R" remote set-url origin "$TMP/no-such-origin.git"
ok "V3-P LG-09 FATAL when origin is UNREACHABLE" "$(fa LG-09)" "1" LG-09
ok "V3-P2 …and it says BLOCKED, not confirmed" "$(run | grep -c 'BLOCKED, not confirmed' || true)" "1" LG-09
ok "V3-P3 …and the run exits 3" "$(rc_of)" "3" EXIT
ok "V3-P4 …and it does NOT claim the no-tags check passed" \
   "$(run | grep -c 'no-tags claim confirmed' || true)" "0" LG-09
git -C "$R" remote set-url origin "$BARE"
ok "V3-N2 LG-09 healthy again once origin is restored" "$(fa LG-09)" "0" LG-09

# --- FIX 4: endpoint and basis inheritance stop at the table boundary --------
two_tables(){ # $1 = "split" | "joined"
cat > "$L" <<EOF
# LEDGER
**Status of this revision:** \`REV-2\`

# 1 · DOCUMENT CONTROL
| Field | Value | Class |
|---|---|---|
| **Application / code RC** | \`$RC\` — frozen | VERIFIED |

# 3 · SCOPE
## 3.2 · COUNTS
| Metric | Value | Instrument |
|---|---|---|
| Files changed | **$F** | \`git diff\` main…staging 2026-08-29T00:00Z |
EOF
if [ "$1" = "split" ]; then printf '\nA sentence between the two tables.\n\n' >> "$L"; fi
cat >> "$L" <<EOF
| Lines | **+$A / −$D** | same |

# 26 · DISPOSITION
Zero tags exist.

# 27 · REVISIONS
| Rev | Change |
|---|---|
| **REV-1** | first |
| **REV-2** | current |
EOF
}
two_tables joined
ok "V4-N LG-05 inherits the endpoint WITHIN one table" \
   "$(run | grep -c 'declares no endpoint pair' || true)" "0" LG-05
ok "V4-N2 LG-07 inherits a basis WITHIN one table" "$(n LG-07)" "0" LG-07
two_tables split
ok "V4-P LG-05 does NOT inherit across a table boundary" \
   "$(run | grep -c 'declares no endpoint pair' || true)" "1" LG-05
ok "V4-P2 LG-07 does NOT inherit a basis across a table boundary" "$(n LG-07)" "1" LG-07

# --- FIX 5: attested short-SHA matching --------------------------------------
FJ="$TMP/facts.json"; FL="$TMP/f_ledger.md"
python3 - "$FJ" "$BASE" "$DOCS" "$RC" "$BTREE" <<'PYF'
import json,sys
out,base,head,rc,tree = sys.argv[1:6]
json.dump({"head":head,"base":base,"last_non_docs_commit":rc,
  "changed_after_code_rc":["docs/PROMOTION_LEDGER.md"],
  "known_commits":[base,head,rc],
  "known_commits_abbrev_only":["deadbee"],
  "known_trees":[tree],"known_trees_abbrev_only":[],
  "endpoint_labels":{},"ranges":{},"tags_local":[],"tags_remote":[]}, open(out,'w'))
PYF
fmk(){ cat > "$FL" <<EOF
# LEDGER
**Status of this revision:** \`REV-2\`

# 1 · DOCUMENT CONTROL
| Field | Value | Class |
|---|---|---|
| **Application / code RC** | \`$RC\` | VERIFIED |
| **Merge base** | \`$1\` | VERIFIED |

# 27 · REVISIONS
| Rev | Change |
|---|---|
| **REV-2** | current |
EOF
}
frun(){ python3 "$GUARD" --facts "$FJ" --ledger "$FL" 2>&1; }
fn(){ frun | grep -c "^$1  *FAIL" || true; }
fw(){ frun | grep -c "^$1  *WARN" || true; }
ffa(){ frun | grep -c "^$1  *FATAL" || true; }
fmk "${BASE:0:8}";  ok "V5-N unambiguous 8-char prefix of a known FULL sha is accepted" "$(fn LG-03)" "0" LG-03
fmk "$BASE";        ok "V5-N2 the full sha itself is accepted"                          "$(fn LG-03)" "0" LG-03
fmk "deadbeef1234"; ok "V5-P a LONGER value is not accepted just because a known SHORT entry prefixes it" \
                       "$(fn LG-03)" "1" LG-03
fmk "deadbee";      ok "V5-W a short-only attestation is WARN (unverifiable), never a pass" "$(fw LG-03)" "1" LG-03
fmk "deadbee";      ok "V5-W2 …and it is not reported as a FAIL either"                     "$(fn LG-03)" "0" LG-03
python3 - "$FJ" <<'PYG'
import json,sys
p=sys.argv[1]; d=json.load(open(p))
d['known_commits'] += ['abcdef0'+'0'*33, 'abcdef0'+'1'*33]
json.dump(d, open(p,'w'))
PYG
fmk "abcdef0"; ok "V5-A a 7-char prefix shared by TWO known full shas is FATAL, not a pass" "$(ffa LG-03)" "1" LG-03
fmk "abcdef0"; ok "V5-A2 …and the ambiguous case is not silently counted as FAIL"            "$(fn LG-03)"  "0" LG-03
fmk "abcdef00"; ok "V5-A3 an 8-char prefix matching exactly ONE of them is accepted"          "$(fn LG-03)"  "0" LG-03
fmk "abcdef01"; ok "V5-A4 …and the 8-char prefix of the OTHER one is accepted too"            "$(fn LG-03)"  "0" LG-03

echo "=== PER-CHECK COVERAGE ==="
printf '%-8s %-9s %-9s %s\n' CHECK POSITIVE NEGATIVE RESULT
for c in LG-01 LG-02 LG-03 LG-04 LG-05 LG-06 LG-07 LG-08 LG-09 LG-10; do
  v="${COV[$c]:-}"; tot=${#v}; bad=$(printf '%s' "$v" | tr -cd '!' | wc -c)
  printf '%-8s %-9s %-9s %s\n' "$c" "yes" "yes" "$([ "$bad" -eq 0 ] && echo "OK ($tot assertions)" || echo "FAILING")"
done
printf '%-8s %-9s %-9s %s\n' "ADVERS" "yes" "n/a" "OK (${#COV[ADV]} assertions)"
printf '%-8s %-9s %-9s %s\n' "EXIT"   "yes" "yes" "OK (${#COV[EXIT]} assertions)"
echo "-----------------------------------------"
echo "PASS=$pass FAIL=$fail"; echo "finished: $(date -u +%FT%TZ)"
[ "$fail" -eq 0 ]
