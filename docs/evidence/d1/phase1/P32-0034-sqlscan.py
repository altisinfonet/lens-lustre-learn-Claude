import sys, re, io, os
sys.dont_write_bytecode = True
UNIT = sys.argv[1]; ROOT = sys.argv[2] if len(sys.argv)>2 else '.'
HERE = os.path.join(ROOT,'docs/evidence/d1/phase1')
import importlib.util
spec = importlib.util.spec_from_file_location("sqlscan", os.path.join(os.path.dirname(os.path.abspath(__file__)), 'unitC-sqlscan.py'))
S = importlib.util.module_from_spec(spec); spec.loader.exec_module(S)
STEM = {'0034':'20260910_0034_p32_service_role_only','0035':'20260910_0035_p32_authenticated_only'}[UNIT]
N = {'0034':27,'0035':25}[UNIT]
APPLY=os.path.join(ROOT,f'supabase/migrations/{STEM}.sql'); RB=os.path.join(ROOT,f'supabase/rollback/{STEM}_ROLLBACK.sql')
fail=0
def ok(l,g,w):
    global fail
    good = g==w
    print(f"  {'PASS' if good else 'FAIL'}  {l:<58} {g}" + ("" if good else f"   want={w}"))
    if not good: fail=1
def verbs(p):
    raw=io.open(p,encoding='utf-8',newline='').read()
    out={}
    for s in S.statements(S.strip_comments(raw), into_dollar=True):
        t=S.norm(s); m=re.match(r'(?i)^\s*([A-Z]+)',t)
        if m: out.setdefault(m.group(1).upper(),[]).append(t)
    return raw,out
print(f"D1 · P32 UNIT {UNIT} · SQL SCAN\ninstrument: docs/evidence/d1/phase1/unitC-sqlscan.py\n")
for p,label in ((APPLY,'apply'),(RB,'rollback')):
    raw,v = verbs(p)
    ne=[s for s in S.statements(S.strip_comments(raw)) if s.strip()]
    kw=[s for s in ne if re.match(r'(?i)^\s*'+S.KEYWORDS+r'\b', S.norm(s))]
    rem=[s for s in ne if s not in kw]
    print(f"\n  {p}")
    print(f"    executable statements   : {len(ne)}")
    print(f"    REMAINDER (unclassified): {len(rem)}")
    for r in rem: print(f"        !! {S.norm(r)[:110]}")
    for k in ('BEGIN','DO','REVOKE','GRANT','COMMENT','COMMIT'):
        if k in v: print(f"    {k:<8}: {len(v[k])}" + ("   (1 top-level + 1 per DO body)" if k=='BEGIN' else ""))
    ok(f"{label}: remainder 0", len(rem), 0)
    ok(f"{label}: GRANT ... TO PUBLIC", len(S.grants_to_public(raw)), 0)
raw,v = verbs(APPLY)
ok(f"apply: REVOKE count == {N}", len(v.get('REVOKE',[])), N)
ok(f"apply: GRANT count == {N}",  len(v.get('GRANT',[])),  N)
ok(f"apply: COMMENT count == {N}",len(v.get('COMMENT',[])),N)
ok("apply: DO blocks (lane, pre, post)", len(v.get('DO',[])), 3)
FROMPAT = r'(?i)FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated\s*$' if UNIT=='0034' else r'(?i)FROM\s+PUBLIC\s*,\s*anon\s*$'
TOPAT   = r'(?i)TO\s+service_role\s*$' if UNIT=='0034' else r'(?i)TO\s+authenticated\s*,\s*service_role\s*$'
ok("apply: every REVOKE names PUBLIC first, in the unit's form",
   all(re.search(FROMPAT,t) for t in v['REVOKE']), True)
ok("apply: every GRANT targets the unit's roles",
   all(re.search(TOPAT,t) for t in v['GRANT']), True)
raw,v = verbs(RB)
RBTO = r'(?i)TO\s+anon\s*,\s*authenticated\s*$' if UNIT=='0034' else r'(?i)TO\s+anon\s*$'
ok(f"rollback: GRANT count == {N}", len(v.get('GRANT',[])), N)
ok("rollback: every GRANT is by name, in the unit's form",
   all(re.search(RBTO,t) for t in v['GRANT']), True)
ok("rollback: no REVOKE", len(v.get('REVOKE',[])), 0)
# the signature set in the SQL must equal the verified TSV for this unit
tsv=[(l.rstrip('\n').split('\t')+['','',''])[:3] for l in io.open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'P32-0034-signatures-20260925.tsv'),encoding='utf-8') if l.strip('\n')]
want=sorted(f"{n}({a})" for u,n,a in tsv if u==UNIT)
# Parse the ARRAY[...] region, not every quoted line: a line-anchored regex
# also matches RAISE-message continuation lines, and misses the LAST array
# element (whose line ends with ']' rather than a comma). Both were artefacts
# of the check, not of the file.
src = io.open(APPLY, encoding='utf-8').read()
blocks = re.findall(r"FOREACH s IN ARRAY ARRAY\[(.*?)\]\n", src, re.S)
assert len(blocks) == 2, f"expected the signature array twice (pre + post), found {len(blocks)}"
assert blocks[0] == blocks[1], "the precondition and postcondition arrays differ"
got = sorted(re.findall(r"'([^']+)'", blocks[0]))
ok("apply: the signature array equals the verified TSV", got==want, True)
ok("  signatures in the array", len(got), N)
print(f"\n  OVERALL: {'ALL SCAN CHECKS PASS' if not fail else '*** FAILED'}")
sys.exit(fail)
