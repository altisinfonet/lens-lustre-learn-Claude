#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# P3 · the exporter's C-34 harness. Connects to nothing. Run from the repo root:
#   bash docs/evidence/d1/phase3/p3-export-run-tests.sh
# 1 self-test · 2 the committed exports regenerate byte for byte · 3 every
# hand-edit and every bad reading is refused (fail first) · 4 D2's comparator
# accepts the document's shape and gives its verdict on each lane.
# ═══════════════════════════════════════════════════════════════════════════
set -u
cd "$(dirname "$0")/../../../.."
EX=scripts/db-publication-export.mjs; P=docs/evidence/d1/phase3; fail=0
step() { printf '\n══ %s\n' "$*"; }
ok() { if [ "$1" = 0 ]; then echo "  PASS  $2"; else echo "  FAIL  $2"; fail=1; fi; }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT

step "1 · self-test"
node $EX --self-test | tail -1; ok $? "self-test"

step "2 · the committed exports are exactly the exporter's output of their readings"
for f in $P/db-publication-export.json $P/db-publication-export.staging.json; do node $EX --check $f | sed 's/^/        /'; ok ${PIPESTATUS[0]} "--check $f"; done

step "3 · fail first: hand-edits and bad readings are refused"
mk() { mkdir -p "$T/$1/$P/readings" "$T/$1/scripts"; cp $EX "$T/$1/scripts/"; cp $P/readings/*.json "$T/$1/$P/readings/"; cp $P/db-publication-export.json "$T/$1/$P/"; }
red() { local name="$1" edit="$2" expect="${3:-differs from the exporter}"; mk "$name"; (cd "$T/$name" && python3 -c "$edit"); o=$(cd "$T/$name" && node scripts/db-publication-export.mjs --check 2>&1); r=$?
  [ $r -eq 1 ] && echo "$o" | grep -q "$expect" && { echo "  PASS  red: $name"; echo "$o" | head -1 | sed 's/::error::/        /' | cut -c1-170; } || { echo "  FAIL  not caught: $name"; fail=1; }; }
J="import json;p='$P/db-publication-export.json';d=json.load(open(p))"
W="open(p,'w').write(json.dumps(d,indent=2)+'\n')"
red "a table added by hand (e.g. to make parity pass)" "$J;d['tables'].append('site_settings');d['tables'].sort();d['counts']['tables']+=1;$W"
red "a table removed by hand" "$J;d['tables'].remove('post_shares');d['counts']['tables']-=1;$W"
red "the lane relabelled" "$J;d['lane']='staging';$W"
red "the reading changed after the export (stale export)" "import json;p='$P/readings/publication-production-20261004.json';d=json.load(open(p));d['tables']=d['tables'][:-1];open(p,'w').write(json.dumps(d,indent=2)+'\n')" "is refused"
red "the verbatim reading edited (its sidecar hash no longer matches)" "p='$P/readings/publication-production-20261004.json';s=open(p).read();open(p,'w').write(s.replace('\"post_shares\"','\"post_sharez\"'))" "sha256"
red "the lane record relabelled to staging" "import json;p='$P/readings/publication-production-20261004.lane.json';d=json.load(open(p));d['lane']='staging';open(p,'w').write(json.dumps(d,indent=2)+'\n')" "differs from the exporter"
red "the reading file deleted" "import os;os.remove('$P/readings/publication-production-20261004.json')" "cannot be read"
bad() { local name="$1" edit="$2" expect="$3"; python3 -c "import json;d=json.load(open('$P/readings/publication-staging-20261004.json'));$edit;json.dump(d,open('$T/r.json','w'))"
  mkdir -p "$T/x"; o=$(node $EX --reading "$T/r.json" --out "$T/x/o.json" 2>&1); r=$?
  [ $r -eq 1 ] && echo "$o" | grep -q "$expect" && { echo "  PASS  refused: $name"; echo "$o" | head -1 | sed 's/::error::/        /' | cut -c1-170; } || { echo "  FAIL  accepted: $name"; fail=1; }; }
bad "a reading of another publication" "d['publication']='supabase_realtime_messages_publication'" "publication is"
bad "a FOR ALL TABLES publication" "d['allTables']=True" "FOR ALL TABLES"
bad "a reading with no lane and no lane record" "d.pop('lane')" "has no lane and no readable sidecar"
bad "the same table twice" "d['tables']=[{'schema':'public','table':'posts'},{'schema':'public','table':'posts'}]" "appears twice"

step "4 · D2's comparator (scripts/web-p3-parity.mjs, unchanged) on each export"
node --input-type=module -e "
import fs from 'node:fs'; import { validate } from './scripts/web-p3-parity.mjs';
for (const f of ['$P/db-publication-export.json', '$P/db-publication-export.staging.json']) {
  const e = validate(JSON.parse(fs.readFileSync(f, 'utf8')), 'db-publication-export');
  console.log((e.length ? '  FAIL  ' : '  PASS  ') + 'schemaVersion 1 shape accepted by D2: ' + f + (e.length ? ' — ' + e.join('; ') : ''));
  if (e.length) process.exitCode = 1;
}"; ok $? "D2 validation"
for f in $P/db-publication-export.json $P/db-publication-export.staging.json; do
  node scripts/web-p3-parity.mjs --db $f 2>/dev/null | sed "s#^#        $f → #"
done
echo "        (both FAIL: that is the P3 reading, not a defect of the exporter — see README)"

echo; [ $fail -eq 0 ] && echo "ALL CASES PASS" || echo "SOME CASES FAILED"; exit $fail
