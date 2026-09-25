"""D1 · R-23 · Step 2/3 SQL scan over the four files this unit touches.

Scanner: docs/evidence/d1/phase1/unitC-sqlscan.py, unchanged since PR #291 --
statement-scoped, case-insensitive, aware of '..' strings, ".." identifiers,
$..$ dollar quotes, -- line comments and block comments.

Run from the repository root:  python3 docs/evidence/d1/phase1/R23-sqlscan.py
"""
import sys, re, io, os, hashlib
sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
import importlib.util
spec = importlib.util.spec_from_file_location("sqlscan", os.path.join(HERE, "unitC-sqlscan.py"))
S = importlib.util.module_from_spec(spec); spec.loader.exec_module(S)

APPLY = 'supabase/migrations/20260910_0032_p32_money_account_control_revoke.sql'
RB    = 'supabase/rollback/20260910_0032_p32_money_account_control_revoke_ROLLBACK.sql'
W1    = 'supabase/migrations/UNAPPLIED_20260910_0027_p32_money_account_control_revoke.sql'
W2    = 'supabase/rollback/UNAPPLIED_20260910_0027_p32_money_account_control_revoke_ROLLBACK.sql'
RECORDED = {
  W1: '48b0ddaa9f40cb3ac5e5ccfbdc7c42cbdbae153c1aaab1c8e6fa77c50eb3487c',
  W2: 'b2c63497a69e780ea68c704e1972d1a1425f71e8c32cabda62c7765d9f2e9380',
}
fail = 0
def ok(label, got, want):
    global fail
    good = got == want
    print(f"  {'PASS' if good else 'FAIL'}  {label:<58} {got}" + ("" if good else f"   want={want}"))
    if not good: fail = 1

def scan(p):
    raw = io.open(p, encoding='utf-8', newline='').read()
    ne = [s for s in S.statements(S.strip_comments(raw)) if s.strip()]
    kw = [s for s in ne if re.match(r'(?i)^\s*' + S.KEYWORDS + r'\b', S.norm(s))]
    return raw, ne, [s for s in ne if s not in kw]

def verbs(p):
    raw = io.open(p, encoding='utf-8', newline='').read()
    deep = S.statements(S.strip_comments(raw), into_dollar=True)
    out = {}
    for s in deep:
        t = S.norm(s)
        m = re.match(r'(?i)^\s*([A-Z]+)', t)
        if m: out.setdefault(m.group(1).upper(), []).append(t)
    return out

print("D1 · R-23 · SQL SCAN")
print("instrument: docs/evidence/d1/phase1/unitC-sqlscan.py\n")

print("-- ROW 2  the two new files")
for p, label in ((APPLY, 'apply 0032'), (RB, 'rollback 0032')):
    raw, ne, rem = scan(p)
    v = verbs(p)
    print(f"\n  {p}")
    print(f"    executable statements   : {len(ne)}")
    print(f"    REMAINDER (unclassified): {len(rem)}")
    for r in rem: print(f"        !! {S.norm(r)[:110]}")
    # verbs() descends into dollar-quoted bodies, so BEGIN counts the file's own
    # BEGIN; plus the plpgsql BEGIN opening each DO block. 1 + 3 = 4 is expected.
    for k in ('BEGIN','DO','REVOKE','GRANT','COMMENT','COMMIT'):
        if k in v: print(f"    {k:<8}: {len(v[k])}" + ("   (1 top-level + 1 per DO body)" if k=='BEGIN' else ""))
    ok(f"{label}: remainder 0", len(rem), 0)
    pub = S.grants_to_public(raw)
    ok(f"{label}: executable GRANT ... TO PUBLIC", len(pub), 0)
    for g in pub: print(f"        *** {g[:130]}")

raw, ne, rem = scan(APPLY)
v = verbs(APPLY)
ok("apply: statement shape = BEGIN+3 DO+11 REVOKE+11 GRANT+11 COMMENT+COMMIT", len(ne), 1+3+11+11+11+1)
ok("apply: REVOKE count", len(v.get('REVOKE', [])), 11)
ok("apply: GRANT count", len(v.get('GRANT', [])), 11)
ok("apply: COMMENT count", len(v.get('COMMENT', [])), 11)
ok("apply: DO blocks (lane, pre, post)", len(v.get('DO', [])), 3)
ok("apply: every REVOKE names PUBLIC before anon",
   all(re.search(r'(?i)FROM\s+PUBLIC\s*,\s*anon\s*$', t) for t in v['REVOKE']), True)
ok("apply: every GRANT targets authenticated, service_role",
   all(re.search(r'(?i)TO\s+authenticated\s*,\s*service_role\s*$', t) for t in v['GRANT']), True)
ok("apply: no GRANT mentions anon", [t for t in v['GRANT'] if re.search(r'(?i)\banon\b', t)], [])

v = verbs(RB)
ok("rollback: GRANT count", len(v.get('GRANT', [])), 11)
ok("rollback: every GRANT targets anon by name",
   all(re.search(r'(?i)TO\s+anon\s*$', t) for t in v['GRANT']), True)
ok("rollback: no REVOKE", len(v.get('REVOKE', [])), 0)

# Comments carried across verbatim from 0027, which now lives inside the
# neutralised file with every line prefixed by "-- ".
print("\n-- COMMENTS carried from 0027, compared text-for-text")
orig = io.open(W1, encoding='utf-8', newline='').read()
m = orig.split('END $withdrawn$;\n', 1)[1]
orig_body = "\n".join(l[3:] for l in m.split('\n'))
oc = re.findall(r"(?is)COMMENT ON FUNCTION[^;]*?IS\s*'(.*?)';", orig_body)
nc = re.findall(r"(?is)COMMENT ON FUNCTION[^;]*?IS\s*'(.*?)';", io.open(APPLY, encoding='utf-8').read())
ok("0027 carried 11 COMMENTs", len(oc), 11)
ok("0032 carries 11 COMMENTs", len(nc), 11)
ok("every COMMENT body is byte-identical to 0027's", nc == oc, True)
for i,(a,b) in enumerate(zip(oc,nc),1):
    if a != b: print(f"      !! COMMENT {i} differs")

print("\n-- ROW 3  the two withdrawals")
for p in (W1, W2):
    raw, ne, rem = scan(p)
    guard = len(ne) == 1 and re.match(r'(?i)^\s*DO\s*\$withdrawn\$', S.norm(ne[0])) is not None
    ok(f"{p.split('/')[-1][:52]}: exactly 1 executable stmt", len(ne), 1)
    ok("  and it is the $withdrawn$ guard", guard, True)
    block = raw.split('END $withdrawn$;\n', 1)[0] + 'END $withdrawn$;\n'
    body = raw[len(block):]
    bad = [i+1 for i, l in enumerate(body.split('\n')) if l and not l.startswith('-- ')]
    ok("  non-conforming body lines", len(bad), 0)
    rec = "\n".join(l[3:] for l in body.split('\n'))
    h = hashlib.sha256(rec.encode('utf-8')).hexdigest()
    ok("  strip-and-rehash = the recorded sha256", h, RECORDED[p])
    ok("  the recorded sha256 is the one written INTO the file", RECORDED[p] in raw, True)
    ok("  guard block contains no /*", '/*' not in block, True)

print(f"\n  OVERALL: {'ALL SCAN CHECKS PASS' if not fail else '*** FAILED'}")
sys.exit(fail)
