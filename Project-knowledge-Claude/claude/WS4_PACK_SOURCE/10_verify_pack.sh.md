#!/usr/bin/env bash
# Pack self-verification: syntax-check every shell block shipped in the markdown, and
# confirm the YAML byte contract reproduces. Parse-only; nothing is executed.
set -uo pipefail
export LC_ALL=C
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
if grep -q $'\r' "$0" 2>/dev/null; then echo "FATAL: CRLF line endings; re-checkout with LF."; exit 2; fi
missing=""; for t in bash awk python3 sha256sum grep; do command -v "$t" >/dev/null 2>&1 || missing="$missing $t"; done
[ -n "$missing" ] && { echo "FATAL: required tool(s) not found:$missing"; exit 2; }

echo "=== PLATFORM ==="
echo "uname : $(uname -srm 2>/dev/null || echo unknown)"
echo "bash  : ${BASH_VERSION:-unknown}"
echo "python3: $(python3 -c 'import sys;print(sys.version.split()[0])')"
echo "started UTC: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "=== bash -n ON EVERY SHIPPED SHELL BLOCK ==="

pass=0; fail=0
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
for md in *.md; do
  python3 - "$md" "$TMP" <<'PY'
import re,sys,os
md,tmp=sys.argv[1],sys.argv[2]
src=open(md,encoding='utf-8').read()
for i,b in enumerate(re.findall(r'```bash\n(.*?)```', src, re.S)):
    open(os.path.join(tmp,'%s.%d.sh'%(md.replace('/','_'),i)),'w',encoding='utf-8').write(b)
PY
done
for f in "$TMP"/*.sh; do
  [ -e "$f" ] || continue
  n="$(basename "$f")"
  if bash -n "$f" 2>"$TMP/err"; then echo "PASS  bash -n  $n"; pass=$((pass+1))
  else echo "FAIL  bash -n  $n : $(head -1 "$TMP/err")"; fail=$((fail+1)); fi
done

echo "=== bash -n ON EVERY SHIPPED SCRIPT ==="
for sh in ./*.sh; do
  [ -e "$sh" ] || continue
  if bash -n "$sh" 2>"$TMP/err2"; then echo "PASS  bash -n  $(basename "$sh")"; pass=$((pass+1))
  else echo "FAIL  bash -n  $(basename "$sh") : $(head -1 "$TMP/err2")"; fail=$((fail+1)); fi
  if grep -q $'\r' "$sh"; then echo "FAIL  CRLF in $(basename "$sh")"; fail=$((fail+1))
  else echo "PASS  LF endings  $(basename "$sh")"; pass=$((pass+1)); fi
done

echo "=== CHECKSUMS: MANIFEST.sha256 ==="
if [ -f MANIFEST.sha256 ]; then
  grep -v '^#' MANIFEST.sha256 | grep . > "$TMP/man" || true
  listed=$(wc -l < "$TMP/man" | tr -d ' ')
  # every file in the pack except the manifest itself must be listed
  # FULL recursive walk. An earlier draft used -maxdepth 3, which silently excluded
  # fixtures/rc/supabase/... (depth 5) from BOTH the manifest and this check - a coverage
  # test that agreed with itself. Generated exact fixtures are excluded by name only.
  present=$(find . -type f ! -name MANIFEST.sha256 ! -path './fixtures/rc-exact/*' | sed 's|^\./||' | sort)
  namedin=$(awk '{sub(/^\*/,"",$2); print $2}' "$TMP/man" | sort)
  if [ "$present" = "$namedin" ]; then echo "PASS  manifest covers every pack file ($listed entries), and no others"; pass=$((pass+1))
  else
    echo "FAIL  manifest coverage differs from the files on disk:"
    diff <(printf '%s\n' "$present") <(printf '%s\n' "$namedin") | head -20
    fail=$((fail+1))
  fi
  if sha256sum -c "$TMP/man" >"$TMP/ck" 2>&1; then echo "PASS  every checksum verifies"; pass=$((pass+1))
  else echo "FAIL  checksum mismatch:"; grep -v ': OK$' "$TMP/ck" | head -10; fail=$((fail+1)); fi
else
  echo "FAIL  MANIFEST.sha256 is missing"; fail=$((fail+1))
fi

echo "=== YAML BYTE CONTRACT ==="
a="$(./extract_probe_yaml.sh | sha256sum | cut -d' ' -f1)"
b="$(python3 -c "
import re,hashlib
s=open('05_APPENDIX_runbook_5.3_probe_PREPARED_NOT_RUN.md',encoding='utf-8').read()
print(hashlib.sha256(re.search(r'\`\`\`yaml\n(.*?)\`\`\`',s,re.S).group(1).encode()).hexdigest())")"
exp=b4d0cd9461840bea05c2ef1423a263f29c9aad45ed477ca58c77bc47b614aff1
if [ "$a" = "$b" ] && [ "$a" = "$exp" ]; then echo "PASS  awk and python agree, and match the recorded hash"; pass=$((pass+1))
else echo "FAIL  awk=$a python=$b expected=$exp"; fail=$((fail+1)); fi

echo "-----------------------------------------"
echo "PASS=$pass FAIL=$fail"
echo "finished UTC: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
[ "$fail" -eq 0 ]
