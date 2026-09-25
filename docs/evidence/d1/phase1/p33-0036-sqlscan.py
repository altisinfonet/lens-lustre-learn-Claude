"""D1 · P33 · 20260910_0036 — static SQL safety scan.

The scanner is docs/evidence/d1/phase1/unitC-sqlscan.py, committed in PR #291
and unchanged here: statement-scoped, case-insensitive, and aware of single
quotes, DOUBLE-QUOTED IDENTIFIERS, dollar quotes, block comments and line
comments. This file is the 0036 driver for it.

Beyond the usual GRANT/REVOKE/PUBLIC census it asserts the four things that
are specific to this unit, because they are the four ways it could be wrong
while still looking right:

  1. the migration's lane assertion is TWO-LANE and the rollback's is
     STAGING-ONLY. The two forms are deliberately different (R-9 vs. the
     closing-file form); copying one into the other would either let a
     door-opening rollback run on production or stop a door-closing migration
     from ever reaching it.
  2. NO view definition is touched. 0036 changes privileges only; the two
     OPEN views are fixed by 0042, and a DROP/CREATE here would also reopen
     the default PUBLIC grant (F-66).
  3. NO `ALTER DEFAULT PRIVILEGES`, no `pg_default_acl`, no `postgres`.
  4. exactly the five named relations appear in GRANT/REVOKE statements, and
     none of the six KEPT relations does.

Run from the repository root:  python3 docs/evidence/d1/phase1/p33-0036-sqlscan.py
"""
import sys, re, io, os
sys.dont_write_bytecode = True   # re-running this must not dirty the working tree
HERE = os.path.dirname(os.path.abspath(__file__))
import importlib.util
spec = importlib.util.spec_from_file_location("sqlscan", os.path.join(HERE, "unitC-sqlscan.py"))
S = importlib.util.module_from_spec(spec); spec.loader.exec_module(S)

# The two paths default to the real files. They are overridable so that
# p33-0036-sqlscan-falsify.sh can point the SAME instrument at deliberately
# broken copies and show each check going RED (C-34: a check that could not
# have failed is not evidence).
MIG = 'supabase/migrations/20260910_0036_p33_definer_view_read_closure.sql'
RB  = 'supabase/rollback/20260910_0036_p33_definer_view_read_closure_ROLLBACK.sql'
if '--mig' in sys.argv: MIG = sys.argv[sys.argv.index('--mig') + 1]
if '--rb'  in sys.argv: RB  = sys.argv[sys.argv.index('--rb') + 1]

CLOSED = ['judging_progression_audit', 'v_judging_drift', 'entry_public_status',
          'entry_vote_counts', 'entry_final_votes_legacy']
KEPT   = ['judge_comments_owner_safe', 'judge_decisions_owner_safe',
          'judge_tag_assignments_owner_safe', 'judge_tag_assignments_public_r4',
          'profiles_public', 'entry_final_votes']

ok = True
def check(label, cond, detail=''):
    global ok
    if not cond: ok = False
    print(f"  {'PASS' if cond else 'FAIL'}  {label}" + (f"  {detail}" if detail else ''))

print("D1 · P33 · 20260910_0036 — STATIC SQL SAFETY SCAN")
print("instrument: docs/evidence/d1/phase1/unitC-sqlscan.py (statement-scoped,")
print("            case-insensitive, '..' / \"..\" / $..$ / -- / /* */ aware)")

for p in (MIG, RB):
    raw = io.open(p, encoding='utf-8', newline='').read()
    ne = [s for s in S.statements(S.strip_comments(raw)) if s.strip()]
    kw = [s for s in ne if re.match(r'(?i)^\s*' + S.KEYWORDS + r'\b', S.norm(s))]
    remainder = [s for s in ne if s not in kw]
    deep = S.statements(S.strip_comments(raw), into_dollar=True)
    grants  = [S.norm(s) for s in deep if re.match(r'(?i)^\s*GRANT\b',  S.norm(s))]
    revokes = [S.norm(s) for s in deep if re.match(r'(?i)^\s*REVOKE\b', S.norm(s))]
    pub_grants = S.grants_to_public(raw)
    pub_named  = [S.norm(s) for s in deep
                  if re.match(r'(?i)^\s*(GRANT|REVOKE)\b', S.norm(s))
                  and re.search(r'(?i)(^|[\s,(])PUBLIC([\s,)]|$)', S.norm(s))]
    bad_pub = [t for t in pub_named if not re.match(r'(?i)^\s*REVOKE\b', t)]
    body = S.strip_comments(raw)           # comments cannot satisfy a check below
    acl  = grants + revokes

    print(f"\n=== {p}")
    print(f"  executable statements (top level) : {len(ne)}")
    print(f"  classified by keyword             : {len(kw)}")
    print(f"  REMAINDER (unclassified)          : {len(remainder)}")
    for r in remainder: print(f"      !! {S.norm(r)[:120]}")
    print(f"  GRANT statements                  : {len(grants)}")
    for g in grants: print(f"      + {g[:110]}")
    print(f"  REVOKE statements                 : {len(revokes)}")
    for g in revokes: print(f"      - {g[:110]}")
    print()
    check("remainder is 0 — the scan understood every statement", not remainder)
    check("0 executable GRANT ... TO PUBLIC", not pub_grants,
          f"({len(pub_named)} statement(s) name PUBLIC, all REVOKE)" if pub_named else '')
    check("every statement naming PUBLIC is a REVOKE", not bad_pub)
    check("no view definition touched (no CREATE/DROP/ALTER ... VIEW)",
          not re.search(r'(?i)\b(CREATE|DROP)\s+(OR\s+REPLACE\s+)?(MATERIALIZED\s+)?VIEW\b', body)
          and not re.search(r'(?i)\bALTER\s+(MATERIALIZED\s+)?VIEW\b', body))
    check("no ALTER DEFAULT PRIVILEGES", not re.search(r'(?i)\bALTER\s+DEFAULT\s+PRIVILEGES\b', body))
    check("no pg_default_acl", 'pg_default_acl' not in body)
    check("does not grant or revoke anything to/from postgres",
          not any(re.search(r'(?i)(^|[\s,])postgres([\s,;]|$)', s) for s in acl))
    # Whole-word matching, not substring: `entry_final_votes` is a prefix of
    # `entry_final_votes_legacy`, and a substring test reports the KEPT view as
    # touched by a file that only names the closed one.
    def named_in(rel, stmts):
        pat = re.compile(r'\b' + re.escape(rel) + r'\b')
        return [s for s in stmts if pat.search(s)]
    def names(rel): return named_in(rel, acl)
    kept_hit = [r for r in KEPT if names(r)]
    # Per statement TYPE, not merely "appears somewhere": deleting one of the
    # five REVOKEs leaves that relation's GRANT behind, and an "is it named"
    # test would not notice the door that stayed open.
    miss_rev = [r for r in CLOSED if not named_in(r, revokes)]
    miss_gnt = [r for r in CLOSED if not named_in(r, grants)]
    if p == MIG:
        check("all five closed relations are REVOKEd", not miss_rev, str(miss_rev) if miss_rev else '')
        check("all five closed relations keep an explicit service_role GRANT",
              not miss_gnt, str(miss_gnt) if miss_gnt else '')
    else:
        check("all five closed relations are GRANTed back", not miss_gnt, str(miss_gnt) if miss_gnt else '')
        check("the rollback REVOKEs nothing", not revokes, str(revokes) if revokes else '')
    check("names none of the six KEPT relations in GRANT/REVOKE",
          not kept_hit, str(kept_hit) if kept_hit else '')
    check("touches only SELECT (no INSERT/UPDATE/DELETE/TRUNCATE/ALL privileges)",
          not any(re.search(r'(?i)\b(INSERT|UPDATE|DELETE|TRUNCATE|TRIGGER|REFERENCES|ALL\s+PRIVILEGES)\b', s)
                  for s in acl))

    # Anchored on the GUC name as it appears inside current_setting() -- i.e.
    # `p32.lane'` with its closing quote -- so the RAISE message's prose and the
    # hint's `SET p32.lane = ''staging'';` are not mistaken for the assertion.
    # The operator is allowed to be up to 60 characters away because the real
    # assertion wraps the call in coalesce(..., '').
    lane = re.findall(r"(?is)p32\.lane'.{0,60}?(NOT\s+IN|\bIN\b|<>|=)\s*(\([^)]*\)|'[a-z]+')", body)
    lane = [(re.sub(r'\s+', ' ', a).upper(), b) for a, b in lane]
    print(f"  lane assertion(s) found           : {lane}")
    if p == MIG:
        check("TWO-LANE assertion: NOT IN ('staging','production')",
              any(a == 'NOT IN' and 'staging' in b and 'production' in b for a, b in lane))
        check("the migration does NOT restrict itself to one lane",
              not any(a in ('=', '<>') for a, _ in lane))
    else:
        check("R-9 STAGING-ONLY guard: <> 'staging'",
              any(a == '<>' and b == "'staging'" for a, b in lane))
        check("the rollback does NOT accept production",
              not any('production' in b for _, b in lane))
        check("restores by grantee NAME only (anon, authenticated)",
              all(re.search(r'(?i)\bTO\s+anon\s*,\s*authenticated\b', g) for g in grants) and bool(grants))

print(f"\n  ALL CHECKS PASS: {ok}")
sys.exit(0 if ok else 1)
