"""D1 · Unit D · Step 6 SQL safety scan.

The scanner itself is docs/evidence/d1/phase1/unitC-sqlscan.py, committed in
PR #291 and unchanged here: statement-scoped, case-insensitive, and aware of
single quotes, DOUBLE-QUOTED IDENTIFIERS, dollar quotes, block comments and
line comments. The double-quote arm is the correction made during the Phase-1
acceptance audit, where `CREATE POLICY "Ad comments follow the ad's
visibility"` inverted a splitter that ignored double quotes.

This file is the Unit D driver for it. It reports, for both 0033 files:
executable statement count, the REMAINDER (statements the keyword rule could
not classify -- a non-zero remainder means the scan did not understand the
file and its other numbers are not evidence), every GRANT, every REVOKE, and
every GRANT ... TO PUBLIC.

Run from the repository root:  python3 docs/evidence/d1/phase1/unitD-sqlscan.py
"""
import sys, re, io, os
sys.dont_write_bytecode = True   # re-running this must not dirty the working tree
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import importlib.util
spec = importlib.util.spec_from_file_location("sqlscan", os.path.join(HERE, "unitC-sqlscan.py"))
S = importlib.util.module_from_spec(spec); spec.loader.exec_module(S)

FILES = ['supabase/migrations/20260910_0033_p33_definer_view_write_revoke.sql',
         'supabase/rollback/20260910_0033_p33_definer_view_write_revoke_ROLLBACK.sql']
ok = True
print("D1 · UNIT D · STEP 6 SQL SAFETY SCAN")
print("instrument: docs/evidence/d1/phase1/unitC-sqlscan.py (statement-scoped,")
print("            case-insensitive, '..' / \"..\" / $..$ / -- / /* */ aware)")
for p in FILES:
    raw = io.open(p, encoding='utf-8', newline='').read()
    ne = [s for s in S.statements(S.strip_comments(raw)) if s.strip()]
    kw = [s for s in ne if re.match(r'(?i)^\s*' + S.KEYWORDS + r'\b', S.norm(s))]
    remainder = [s for s in ne if s not in kw]
    deep = S.statements(S.strip_comments(raw), into_dollar=True)
    grants = [S.norm(s) for s in deep if re.match(r'(?i)^\s*GRANT\b', S.norm(s))]
    revokes = [S.norm(s) for s in deep if re.match(r'(?i)^\s*REVOKE\b', S.norm(s))]
    pub_grants = S.grants_to_public(raw)
    pub_named = [S.norm(s) for s in deep
                 if re.match(r'(?i)^\s*(GRANT|REVOKE)\b', S.norm(s))
                 and re.search(r'(?i)(^|[\s,(])PUBLIC([\s,)]|$)', S.norm(s))]
    bad = [t for t in pub_named if not re.match(r'(?i)^\s*REVOKE\b', t)]
    print(f"\n=== {p}")
    print(f"  executable statements (top level) : {len(ne)}")
    print(f"  classified by keyword             : {len(kw)}")
    print(f"  REMAINDER (unclassified)          : {len(remainder)}")
    for r in remainder: print(f"      !! {S.norm(r)[:120]}")
    print(f"  GRANT statements                  : {len(grants)}")
    for g in grants: print(f"      + {g[:110]}")
    print(f"  REVOKE statements                 : {len(revokes)}")
    for g in revokes: print(f"      - {g[:110]}")
    print(f"  GRANT ... TO PUBLIC (executable)  : {len(pub_grants)}")
    for g in pub_grants: print(f"      *** {g[:140]}")
    print(f"  GRANT/REVOKE naming PUBLIC        : {len(pub_named)}  (all must be REVOKE)")
    if remainder or pub_grants or bad: ok = False
print(f"\n  PASS (remainder 0 in both, 0 executable GRANT ... TO PUBLIC in both): {ok}")
sys.exit(0 if ok else 1)
