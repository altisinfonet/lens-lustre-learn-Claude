#!/usr/bin/env bash
# WS4 reference-implementation self-test — synthetic known-answer fixtures.
#
# SUPPORTED PLATFORM: POSIX shell environment (Linux/macOS), bash >= 4, python3 >= 3.8.
#   Not supported: Windows cmd/PowerShell. Under Git-for-Windows/WSL it is supported ONLY if
#   this file has LF line endings (see the CRLF guard below).
# Run:  bash 08_selftest.sh
# Touches nothing outside its own mktemp directory. No network. No provider access.
set -uo pipefail
export LC_ALL=C

HERE="$(cd "$(dirname "$0")" && pwd)"
IMPL="$HERE/07_ws4_reference_impl.py"

# ---- portability guard: a CRLF checkout silently breaks heredocs and comparisons ----
if grep -q $'\r' "$0" 2>/dev/null; then
  echo "FATAL: this script has CRLF line endings. Re-checkout with LF"
  echo "       (git config core.autocrlf input; or: dos2unix 08_selftest.sh)."
  exit 2
fi

# ---- prerequisite gate: one FATAL, exit 2 - never a suite of misleading failures ----
missing=""
for tool in python3 sha256sum awk grep sed sort tr wc mktemp timeout date uname; do
  command -v "$tool" >/dev/null 2>&1 || missing="$missing $tool"
done
if [ -n "$missing" ]; then
  echo "FATAL: required tool(s) not found:$missing"
  echo "       (macOS: 'timeout' ships as 'gtimeout' in coreutils; 'sha256sum' as 'gsha256sum')"
  exit 2
fi
python3 -c 'import sys; sys.exit(0 if sys.version_info>=(3,8) else 1)' 2>/dev/null || {
  echo "FATAL: python3 >= 3.8 required"; exit 2; }
[ -f "$IMPL" ] || { echo "FATAL: implementation not found: $IMPL"; exit 2; }

echo "=== PLATFORM ==="
echo "uname       : $(uname -srm 2>/dev/null || echo unknown)"
echo "bash        : ${BASH_VERSION:-unknown}"
echo "python3     : $(python3 -c 'import sys;print(sys.version.split()[0])' 2>/dev/null || echo missing)"
echo "impl sha256 : $(sha256sum "$IMPL" | cut -d' ' -f1)"
echo "command     : bash 08_selftest.sh"
echo "started UTC : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "=== TESTS ==="

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
pass=0; fail=0
ok(){ set -- "$1" "$(printf '%s' "$2" | tr -d '\r')" "$3"; if [ "$2" = "$3" ]; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1 : expected [$3] got [$2]"; fail=$((fail+1)); fi; }
mk(){ mkdir -p "$(dirname "$1")"; printf '%s' "$2" > "$1"; }
# NOTE: Python on Windows emits CRLF on stdout. Every captured value is stripped of CR so
# comparisons are identical on Linux, macOS and Git-for-Windows. (revision 6)
nocr(){ tr -d '\r'; }
closure_of(){ python3 "$IMPL" closure --root "$1" --entry "${2:-fn/index.ts}" 2>/dev/null | nocr | sort; }
manifest_of(){ closure_of "$1" | python3 "$IMPL" manifest --root "$1" --files-from - | nocr ; }
verdict(){ python3 "$IMPL" classify --rc "$1" --prod "$2" | nocr | head -1; }
specs_of(){ python3 "$IMPL" extract --file "$1" 2>/dev/null | nocr | tr '\n' ','; }
specs_rc(){ python3 "$IMPL" extract --file "$1" >/dev/null 2>&1; echo $?; }

build(){ local R="$1"
  mk "$R/fn/index.ts" 'import { secure } from "../_shared/secureHeaders.ts";
import { helper } from "./util.ts";
const lazy = () => import("./dynamic.ts");
export default { secure, helper, lazy };'
  mk "$R/fn/util.ts" "${3:-export const helper = 1;}"
  mk "$R/fn/dynamic.ts" 'export const d = 2;'
  mk "$R/_shared/secureHeaders.ts" "$2"
}

# ---------- original suite (revisions 1-4) ----------
build "$TMP/a" 'export const secure = "v1";' ""
ok "T1  closure: shared + dynamic included" "$(closure_of "$TMP/a" | tr '\n' ',')" "_shared/secureHeaders.ts,fn/dynamic.ts,fn/index.ts,fn/util.ts,"
build "$TMP/b" 'export const secure = "v1";' ""
manifest_of "$TMP/a" > "$TMP/ma"; manifest_of "$TMP/b" > "$TMP/mb"
ok "T2  identical trees -> MATCH" "$(verdict "$TMP/ma" "$TMP/mb")" "MATCH"
build "$TMP/c" 'export const secure = "v2-CHANGED";' ""
manifest_of "$TMP/c" > "$TMP/mc"
ok "T3  only secureHeaders differs -> HEADER-ONLY" "$(verdict "$TMP/ma" "$TMP/mc")" "HEADER-ONLY"
build "$TMP/d" 'export const secure = "v1";' "export const helper = 999;"
manifest_of "$TMP/d" > "$TMP/md"
ok "T4  util differs -> DRIFT" "$(verdict "$TMP/ma" "$TMP/md")" "DRIFT"
build "$TMP/e" 'export const secure = "v1";' ""
mk "$TMP/e/fn/extra.ts" 'export const x = 1;'
mk "$TMP/e/fn/index.ts" 'import { secure } from "../_shared/secureHeaders.ts";
import { helper } from "./util.ts";
import { x } from "./extra.ts";
const lazy = () => import("./dynamic.ts");
export default { secure, helper, x, lazy };'
manifest_of "$TMP/e" > "$TMP/me"
ok "T5  extra reachable file -> DRIFT" "$(verdict "$TMP/ma" "$TMP/me")" "DRIFT"
mkdir -p "$TMP/f/fn"
mk "$TMP/f/fn/index.ts" 'import { a } from "./a.ts"; export default a;'
mk "$TMP/f/fn/a.ts" 'import { b } from "./b.ts"; export const a = b;'
mk "$TMP/f/fn/b.ts" 'import { a } from "./a.ts"; export const b = a;'
timeout 20 python3 "$IMPL" closure --root "$TMP/f" --entry fn/index.ts >"$TMP/cyc" 2>/dev/null
ok "T6  import cycle terminates (3 files)" "$(wc -l < "$TMP/cyc" | tr -d ' ')" "3"
mkdir -p "$TMP/g/fn" "$TMP/g/lib"
mk "$TMP/g/fn/index.ts" 'import { z } from "@lib/z.ts"; export default z;'
mk "$TMP/g/lib/z.ts" 'export const z = 1;'
mk "$TMP/g/import_map.json" '{"imports":{"@lib/":"/lib/"}}'
ok "T7  import map resolves bare specifier" "$(python3 "$IMPL" closure --root "$TMP/g" --entry fn/index.ts --import-map "$TMP/g/import_map.json" 2>/dev/null | sort | tr '\n' ',')" "fn/index.ts,lib/z.ts,"
mkdir -p "$TMP/h/fn"; mk "$TMP/h/fn/index.ts" 'import { q } from "missing-package"; export default q;'
python3 "$IMPL" closure --root "$TMP/h" --entry fn/index.ts >/dev/null 2>"$TMP/err"; rc=$?
ok "T8  unresolved BARE import -> exit 3" "$rc" "3"
ok "T8b unresolved bare reported" "$(grep -c UNRESOLVED "$TMP/err")" "1"
mkdir -p "$TMP/i/fn"; mk "$TMP/i/fn/index.ts" 'import { serve } from "https://deno.land/std/http/server.ts"; export default serve;'
python3 "$IMPL" closure --root "$TMP/i" --entry fn/index.ts >/dev/null 2>&1
ok "T9  remote import EXTERNAL -> exit 0" "$?" "0"
mkdir -p "$TMP/j/fn"
mk "$TMP/j/fn/index.ts" '// import { ghost } from "./ghost.ts";
/* import { ghost2 } from "./ghost2.ts"; */
export default 1;'
ok "T10 commented imports ignored" "$(closure_of "$TMP/j" | wc -l | tr -d ' ')" "1"

# ---------- revision 5: lexer fixtures demanded by the audit ----------
mkdir -p "$TMP/k"
mk "$TMP/k/multiline_import.ts" 'import {
  alpha,
  beta,
  gamma as g,
} from "../_shared/x.ts";
export default [alpha, beta, g];'
ok "T11 MULTILINE import { ... } from" "$(specs_of "$TMP/k/multiline_import.ts")" "../_shared/x.ts,"

mk "$TMP/k/multiline_export.ts" 'export {
  one,
  two,
} from "./x.ts";
export * from "./y.ts";
export * as ns from "./z.ts";'
ok "T12 MULTILINE export {..} from + export * [as]" "$(specs_of "$TMP/k/multiline_export.ts")" "./x.ts,./y.ts,./z.ts,"

mk "$TMP/k/string_noise.ts" 'const a = "import { ghost } from \"./ghost.ts\";";
const b = '"'"'import { ghost2 } from "./ghost2.ts";'"'"';
const c = `import { ghost3 } from "./ghost3.ts";`;
import { real } from "./real.ts";
export default [a,b,c,real];'
ok "T13 import-like text in strings/templates ignored" "$(specs_of "$TMP/k/string_noise.ts")" "./real.ts,"

mk "$TMP/k/trailing_comment.ts" 'import { real } from "./real.ts"; // import { ghost } from "./ghost.ts";
const x = 1; // from "./ghost2.ts"
export default [real, x];'
ok "T14 trailing // comment with import text ignored" "$(specs_of "$TMP/k/trailing_comment.ts")" "./real.ts,"

mk "$TMP/k/malformed.ts" 'import { a } from "./a.ts";
const broken = "unterminated
export default a;'
ok "T15 malformed source -> UNPARSEABLE exit 3" "$(specs_rc "$TMP/k/malformed.ts")" "3"

mk "$TMP/k/tmpl_interp.ts" 'const p = "./x.ts"; const s = `${ await import(p) }`; export default s;'
ok "T16 import inside \${} interpolation -> UNPARSEABLE" "$(specs_rc "$TMP/k/tmpl_interp.ts")" "3"

mk "$TMP/k/dyn_nonliteral.ts" 'const p = "./x.ts"; const f = () => import(p); export default f;'
ok "T17 dynamic import(non-literal) -> UNPARSEABLE" "$(specs_rc "$TMP/k/dyn_nonliteral.ts")" "3"

mk "$TMP/k/regex.ts" 'const re = /import\s+\{[^}]*\}\s+from\s+"[^"]*"/g;
const div = 10 / 2 / 1;
import { real } from "./real.ts";
export default [re, div, real];'
ok "T18 regex literal containing import text ignored" "$(specs_of "$TMP/k/regex.ts")" "./real.ts,"

mkdir -p "$TMP/l/fn"; mk "$TMP/l/fn/index.ts" 'import { gone } from "./nope.ts"; export default gone;'
python3 "$IMPL" closure --root "$TMP/l" --entry fn/index.ts >/dev/null 2>"$TMP/err2"; rc=$?
ok "T19 unresolved LOCAL import -> exit 3" "$rc" "3"
ok "T19b unresolved local reported" "$(grep -c UNRESOLVED "$TMP/err2")" "1"

# ---- T20: an unparseable dependency must yield UNKNOWN, NEVER MATCH ----
# The two trees are byte-identical, so a naive pipeline would say MATCH.
for side in rc prod; do
  mkdir -p "$TMP/m/$side/fn"
  mk "$TMP/m/$side/fn/index.ts" 'import { a } from "./a.ts"; export default a;'
  mk "$TMP/m/$side/fn/a.ts" 'const broken = "unterminated
export const a = 1;'
done
# the WS4 wrapper contract (04 §4.3): explicit if/else, errexit-safe, no classify on rc=3
classify_guarded(){ # $1 rc root, $2 prod root -> prints MATCH|HEADER-ONLY|DRIFT|UNKNOWN|ERROR
  local rrc prc
  if python3 "$IMPL" closure --root "$1" --entry fn/index.ts > "$TMP/cl_rc" 2>"$TMP/cl_rc.err"; then rrc=0; else rrc=$?; fi
  if python3 "$IMPL" closure --root "$2" --entry fn/index.ts > "$TMP/cl_pd" 2>"$TMP/cl_pd.err"; then prc=0; else prc=$?; fi
  if [ "$rrc" -eq 3 ] || [ "$prc" -eq 3 ]; then echo UNKNOWN; return 0; fi
  if [ "$rrc" -ne 0 ] || [ "$prc" -ne 0 ]; then echo ERROR; return 1; fi
  python3 "$IMPL" manifest --root "$1" --files-from "$TMP/cl_rc" > "$TMP/gm_rc"
  python3 "$IMPL" manifest --root "$2" --files-from "$TMP/cl_pd" > "$TMP/gm_pd"
  python3 "$IMPL" classify --rc "$TMP/gm_rc" --prod "$TMP/gm_pd" | head -1
}
ok "T20 identical trees w/ unparseable dep -> UNKNOWN (not MATCH)" "$(classify_guarded "$TMP/m/rc" "$TMP/m/prod")" "UNKNOWN"
ok "T21 guarded wrapper still returns MATCH on clean input" "$(classify_guarded "$TMP/a" "$TMP/b")" "MATCH"

# ---- T22/T23: the JSX header-complete fallback is narrow and fails closed ----
mk "$TMP/k/jsx_ok.tsx" 'import { A } from "./a.ts";
export default function C(){ return (<div><A />{1 / 2}</div>); }'
ok "T22 JSX .tsx: header-complete fallback allowed" "$(specs_of "$TMP/k/jsx_ok.tsx")" "./a.ts,"

# the late import must come AFTER the point where the lexer stops on JSX, otherwise it is
# captured normally and the fallback is never reached. (First draft of this test was wrong,
# not the code — recorded because a test that asserts the wrong thing is a defect too.)
mk "$TMP/k/jsx_bad.tsx" 'import { A } from "./a.ts";
export function C(){ return (<div><A /></div>); }
const later = () => import("./late.ts");
export default later;'
ok "T23 import AFTER the JSX stop -> fallback refused (exit 3)" "$(specs_rc "$TMP/k/jsx_bad.tsx")" "3"

mk "$TMP/k/jsx_as_ts.ts" 'import { A } from "./a.ts";
export default function C(){ return (<div><A /></div>); }'
ok "T24 same JSX in a .ts file -> NOT eligible, fails closed" "$(specs_rc "$TMP/k/jsx_as_ts.ts")" "3"

# ---- revision 6: TypeScript type-only module forms ----
mk "$TMP/k/type_named.ts"  'import type { T } from "./x.ts"; export default null as unknown as T;'
ok "T25 import type { T } from      -> specifier" "$(specs_of "$TMP/k/type_named.ts")"  "./x.ts,"
mk "$TMP/k/type_default.ts" 'import type T from "./x.ts"; export default null as unknown as T;'
ok "T26 import type T from          -> specifier" "$(specs_of "$TMP/k/type_default.ts")" "./x.ts,"
mk "$TMP/k/type_reexport.ts" 'export type { T } from "./x.ts";'
ok "T27 export type { T } from      -> specifier" "$(specs_of "$TMP/k/type_reexport.ts")" "./x.ts,"
mk "$TMP/k/type_alias.ts" 'export type T = { a: string; b: number };
export const q = obj.from;'
ok "T28 export type T = ...         -> NO invented specifier" "$(specs_of "$TMP/k/type_alias.ts")" ""

# ---- T29 integration: closure exit 3 writes exactly one UNKNOWN row, no inventory row,
#      and the loop CONTINUES to the next function (mirrors 04_WS4 §4.3 case/esac) ----
INT="$TMP/int"; mkdir -p "$INT/work" "$INT/snap"
mk "$INT/root/good/index.ts" 'import { a } from "../_shared/a.ts"; export default a;'
mk "$INT/root/_shared/a.ts"  'export const a = 1;'
mk "$INT/root/bad/index.ts"  'import { b } from "./missing.ts"; export default b;'
mk "$INT/root/tail/index.ts" 'export default 1;'
( cd "$INT"
  : > inventory.txt; : > unknown.tsv
  for SLUG in good bad tail; do
    if python3 "$IMPL" closure --root "root" --entry "$SLUG/index.ts"          > "snap/closure-$SLUG.txt" 2> "snap/closure-$SLUG.err"; then RC=0; else RC=$?; fi
    case "$RC" in
      0) python3 "$IMPL" manifest --root "root" --files-from "snap/closure-$SLUG.txt"             > "snap/manifest-$SLUG.txt"
         printf '%s  %s\n' "$(sha256sum "snap/manifest-$SLUG.txt" | cut -d' ' -f1)" "$SLUG" >> inventory.txt ;;
      3) printf 'UNKNOWN\t%s\t%s\n' "$SLUG" "$(tr '\n' ';' < "snap/closure-$SLUG.err")" >> unknown.tsv
         rm -f "snap/manifest-$SLUG.txt" ;;
      *) echo "FATAL unexpected $RC" >&2; exit "$RC" ;;
    esac
  done ) >/dev/null 2>&1
ok "T29a exit 3 -> exactly one UNKNOWN row"        "$(wc -l < "$INT/unknown.tsv" | tr -d ' ')" "1"
ok "T29b UNKNOWN names the failing function"       "$(cut -f2 "$INT/unknown.tsv" | tr -d '\n')" "bad"
ok "T29c no inventory row for the UNKNOWN function" "$(grep -c '  bad$' "$INT/inventory.txt" || true)" "0"
ok "T29d no manifest file for the UNKNOWN function" "$([ -f "$INT/snap/manifest-bad.txt" ] && echo yes || echo no)" "no"
ok "T29e loop continued: 2 inventory rows"          "$(wc -l < "$INT/inventory.txt" | tr -d ' ')" "2"
ok "T29f classified + unknown == 3 functions"       "$(( $(wc -l < "$INT/inventory.txt") + $(wc -l < "$INT/unknown.tsv") ))" "3"

# ============================ REVISION 7 — MUTATION-DRIVEN TESTS =============
# Added because 11_mutation_control.sh showed the 36-test suite stayed GREEN with six
# specific defects planted. Each block below is the discriminating test that was missing.
# Every one of these was written AFTER a mutation escaped, not before.

# --- M1: path sets differ, but every SHARED path is byte-identical ------------
# T5 passed only because its extra file also changed index.ts. Nothing isolated the
# path-set branch. These two use hand-written manifests so the branch is exercised alone.
printf '%s  10  fn/index.ts\n%s  10  fn/util.ts\n' aaaa bbbb > "$TMP/m_rc.txt"
printf '%s  10  fn/index.ts\n%s  10  fn/util.ts\n%s  10  fn/extra.ts\n' aaaa bbbb cccc > "$TMP/m_prod_more.txt"
printf '%s  10  fn/index.ts\n' aaaa > "$TMP/m_prod_fewer.txt"
ok "T30 prod has an EXTRA path, all shared bytes identical -> DRIFT" \
   "$(verdict "$TMP/m_rc.txt" "$TMP/m_prod_more.txt")" "DRIFT"
ok "T31 prod is MISSING a path, all shared bytes identical -> DRIFT" \
   "$(verdict "$TMP/m_rc.txt" "$TMP/m_prod_fewer.txt")" "DRIFT"
ok "T31b the DRIFT detail names the path-set reason" \
   "$(python3 "$IMPL" classify --rc "$TMP/m_rc.txt" --prod "$TMP/m_prod_more.txt" | nocr | grep -c 'path sets differ')" "1"

# --- M3: the digest algorithm is part of the contract, not an implementation detail ---
mkdir -p "$TMP/dig"; printf 'abc' > "$TMP/dig/f.ts"
ok "T32 manifest digest is SHA-256 of the bytes (known-answer vector)" \
   "$(echo 'f.ts' | python3 "$IMPL" manifest --root "$TMP/dig" --files-from - | nocr | cut -d' ' -f1)" \
   "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
ok "T32b manifest records the byte size" \
   "$(echo 'f.ts' | python3 "$IMPL" manifest --root "$TMP/dig" --files-from - | nocr | awk '{print $2}')" "3"

# --- M11: two auditors must produce byte-identical manifests -------------------
mkdir -p "$TMP/ord"; printf 'a' > "$TMP/ord/a.ts"; printf 'b' > "$TMP/ord/b.ts"; printf 'c' > "$TMP/ord/c.ts"
ok "T33 manifest output is SORTED regardless of input order" \
   "$(printf 'c.ts\nb.ts\na.ts\n' | python3 "$IMPL" manifest --root "$TMP/ord" --files-from - | nocr | awk '{print $3}' | tr '\n' ',')" \
   "a.ts,b.ts,c.ts,"
ok "T33b reversed and forward input give identical output" \
   "$( [ "$(printf 'c.ts\nb.ts\na.ts\n' | python3 "$IMPL" manifest --root "$TMP/ord" --files-from - | nocr | sha256sum)" \
      = "$(printf 'a.ts\nb.ts\nc.ts\n' | python3 "$IMPL" manifest --root "$TMP/ord" --files-from - | nocr | sha256sum)" ] && echo same || echo differ)" "same"

# --- M10: an import map has EXACT keys as well as prefix keys ------------------
mkdir -p "$TMP/im/fn" "$TMP/im/lib"
mk "$TMP/im/fn/index.ts" 'import { z } from "@z"; export default z;'
mk "$TMP/im/lib/z.ts" 'export const z = 1;'
mk "$TMP/im/import_map.json" '{"imports":{"@z":"/lib/z.ts"}}'
ok "T34 import map resolves an EXACT (non-prefix) key" \
   "$(python3 "$IMPL" closure --root "$TMP/im" --entry fn/index.ts --import-map "$TMP/im/import_map.json" 2>/dev/null | nocr | sort | tr '\n' ',')" \
   "fn/index.ts,lib/z.ts,"

# --- M7: a dependency that resolves OUTSIDE the root is a problem, not a member ---
mkdir -p "$TMP/esc/fn"; mk "$TMP/esc_outside.ts" 'export const o = 1;'
mk "$TMP/esc/fn/index.ts" 'import { o } from "../../esc_outside.ts"; export default o;'
python3 "$IMPL" closure --root "$TMP/esc" --entry fn/index.ts >"$TMP/esc.out" 2>"$TMP/esc.err"
ok "T35 dep outside the root -> exit 3 (never silently included)" "$?" "3"
ok "T35b the escape is reported as OUTSIDE_ROOT" \
   "$(cat "$TMP/esc.out" "$TMP/esc.err" | nocr | grep -c 'OUTSIDE_ROOT')" "1"
ok "T35c the outside file is NOT in the closure" \
   "$(nocr < "$TMP/esc.out" | grep -c 'esc_outside' || true)" "0"

# --- path normalisation ------------------------------------------------------
# NOTE (revision 8): the symlink case below is PLATFORM-GATED and is NOT counted as proof
# that canonicalisation is covered. os.path.abspath() and os.path.realpath() differ ONLY on
# symlinks (and Windows junctions/short names), so on a filesystem where `ln -s` is
# unavailable - Git for Windows without Developer Mode - a realpath->abspath substitution is
# an EQUIVALENT mutant and no test can detect it. That is recorded as a BLOCKED property,
# not as coverage. The portable contract is tested by T37, T38 and T39 instead.
mkdir -p "$TMP/realroot/fn"
mk "$TMP/realroot/fn/index.ts" 'import { h } from "./sub/../util.ts"; export default h;'
mk "$TMP/realroot/fn/util.ts" 'export const h = 1;'
mkdir -p "$TMP/realroot/fn/sub"
if ln -s "$TMP/realroot" "$TMP/linkroot" 2>/dev/null; then
  ok "T36 root reached via a SYMLINK yields canonical in-root paths" \
     "$(python3 "$IMPL" closure --root "$TMP/linkroot" --entry fn/index.ts 2>/dev/null | nocr | sort | tr '\n' ',')" \
     "fn/index.ts,fn/util.ts,"
else
  echo "SKIP  T36 (symlinks unavailable here; platform-gated, NOT proof of canonicalisation)"
fi
# The SAME file reached by TWO different spellings must appear ONCE. Without canonicalisation
# at resolution time, `seen` holds two strings for one file and the closure double-counts it -
# which would also double-count it in the manifest.
mk "$TMP/realroot/fn/index2.ts" 'import { h } from "./util.ts";
import { h2 } from "./sub/../util.ts";
export default { h, h2 };'
ok "T37 one file, two spellings -> listed ONCE" \
   "$(python3 "$IMPL" closure --root "$TMP/realroot" --entry fn/index2.ts 2>/dev/null | nocr | sort | tr '\n' ',')" \
   "fn/index2.ts,fn/util.ts,"
ok "T37b and the manifest therefore has one row per file" \
   "$(python3 "$IMPL" closure --root "$TMP/realroot" --entry fn/index2.ts 2>/dev/null | python3 "$IMPL" manifest --root "$TMP/realroot" --files-from - | nocr | wc -l | tr -d ' ')" "2"

# --- PORTABLE path-output contract (revision 8) ------------------------------
# Two auditors on different operating systems must produce byte-identical output. These hold
# on POSIX and on Git for Windows alike, and they do not depend on symlinks.
ok "T38 closure output is ROOT-RELATIVE (never absolute)" \
   "$(python3 "$IMPL" closure --root "$TMP/realroot" --entry fn/index2.ts 2>/dev/null | nocr \
      | grep -c -E '^(/|[A-Za-z]:)' || true)" "0"
ok "T38b manifest paths are ROOT-RELATIVE too" \
   "$(python3 "$IMPL" closure --root "$TMP/realroot" --entry fn/index2.ts 2>/dev/null \
      | python3 "$IMPL" manifest --root "$TMP/realroot" --files-from - | nocr | awk '{print $3}' \
      | grep -c -E '^(/|[A-Za-z]:)' || true)" "0"
ok "T38c closure output contains no '.' or '..' segment" \
   "$(python3 "$IMPL" closure --root "$TMP/realroot" --entry fn/index2.ts 2>/dev/null | nocr \
      | grep -c -E '(^|/)\.\.?(/|$)' || true)" "0"
ok "T39 output uses FORWARD SLASHES only, on every platform" \
   "$(python3 "$IMPL" closure --root "$TMP/realroot" --entry fn/index2.ts 2>/dev/null | nocr \
      | grep -c '\\' || true)" "0"
ok "T39b and so does the manifest" \
   "$(python3 "$IMPL" closure --root "$TMP/realroot" --entry fn/index2.ts 2>/dev/null \
      | python3 "$IMPL" manifest --root "$TMP/realroot" --files-from - | nocr | grep -c '\\' || true)" "0"

ok "T36b a dep reached through './sub/../' is listed ONCE, canonically" \
   "$(python3 "$IMPL" closure --root "$TMP/realroot" --entry fn/index.ts 2>/dev/null | nocr | sort | tr '\n' ',')" \
   "fn/index.ts,fn/util.ts,"


echo "-----------------------------------------"
echo "PASS=$pass FAIL=$fail"
echo "finished UTC : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
[ "$fail" -eq 0 ]
