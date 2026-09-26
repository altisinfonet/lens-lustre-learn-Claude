"""D1 · P33 · 20260910_0042 — static SQL safety scan.

The scanner is docs/evidence/d1/phase1/unitC-sqlscan.py, committed in PR #291:
statement-scoped, case-insensitive, and aware of single quotes, DOUBLE-QUOTED
IDENTIFIERS, dollar quotes, block comments and line comments. This file is the
0042 driver for it.

0042 is a DEFINITION change, so its safety properties are the opposite of a
privilege unit's. What must be true here:

  1. it grants and revokes NOTHING. A definition fix that quietly adjusts an
     ACL is two units in one file.
  2. it uses CREATE OR REPLACE VIEW and never DROP VIEW. Re-creating a view
     resets its ACL to NULL, so anon, authenticated and service_role all lose
     SELECT (measured in p33-0042-run-tests.sh step 7; this is NOT the PUBLIC
     reopening F-66 describes, which is a function phenomenon).
  3. it redefines exactly the two leaking views and leaves
     judge_decisions_owner_safe alone.
  4. the migration's definitions CARRY the round correlation and the
     rollback's definitions DO NOT — the two files are mirror images, and a
     copy-paste between them is the likeliest way to ship a no-op.
  5. the migration's lane assertion is TWO-LANE and the rollback's is
     STAGING-ONLY (R-9), because the rollback restores finding C-A19.

Run from the repository root:  python3 docs/evidence/d1/phase1/p33-0042-sqlscan.py
"""
import sys, re, io, os
sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
import importlib.util
spec = importlib.util.spec_from_file_location("sqlscan", os.path.join(HERE, "unitC-sqlscan.py"))
S = importlib.util.module_from_spec(spec); spec.loader.exec_module(S)

MIG = 'supabase/migrations/20260910_0042_p33_owner_safe_round_correlation.sql'
RB  = 'supabase/rollback/20260910_0042_p33_owner_safe_round_correlation_ROLLBACK.sql'
if '--mig' in sys.argv: MIG = sys.argv[sys.argv.index('--mig') + 1]
if '--rb'  in sys.argv: RB  = sys.argv[sys.argv.index('--rb') + 1]

TARGETS = ['judge_comments_owner_safe', 'judge_tag_assignments_owner_safe']
OUT_OF_SCOPE = 'judge_decisions_owner_safe'

ok = True
def check(label, cond, detail=''):
    global ok
    if not cond: ok = False
    print(f"  {'PASS' if cond else 'FAIL'}  {label}" + (f"  {detail}" if detail else ''))

print("D1 · P33 · 20260910_0042 — STATIC SQL SAFETY SCAN")
print("instrument: docs/evidence/d1/phase1/unitC-sqlscan.py")

for p in (MIG, RB):
    raw = io.open(p, encoding='utf-8', newline='').read()
    ne  = [s for s in S.statements(S.strip_comments(raw)) if s.strip()]
    kw  = [s for s in ne if re.match(r'(?i)^\s*' + S.KEYWORDS + r'\b', S.norm(s))]
    remainder = [s for s in ne if s not in kw]
    deep = S.statements(S.strip_comments(raw), into_dollar=True)
    grants  = [S.norm(s) for s in deep if re.match(r'(?i)^\s*GRANT\b',  S.norm(s))]
    revokes = [S.norm(s) for s in deep if re.match(r'(?i)^\s*REVOKE\b', S.norm(s))]
    body = S.strip_comments(raw)

    # The CREATE OR REPLACE VIEW statements and the definition each carries.
    cor = re.findall(r'(?is)CREATE\s+OR\s+REPLACE\s+VIEW\s+public\.(\w+)\s+AS(.*?);\s*(?=\n\S|$)', body)
    cor_names = [n for n, _ in cor]
    defs = {n: d for n, d in cor}

    print(f"\n=== {p}")
    print(f"  executable statements (top level) : {len(ne)}")
    print(f"  REMAINDER (unclassified)          : {len(remainder)}")
    for r in remainder: print(f"      !! {S.norm(r)[:120]}")
    print(f"  CREATE OR REPLACE VIEW            : {cor_names}")
    print(f"  GRANT / REVOKE statements         : {len(grants)} / {len(revokes)}")
    print()

    check("remainder is 0 — the scan understood every statement", not remainder)
    check("grants nothing", not grants, str(grants) if grants else '')
    check("revokes nothing", not revokes, str(revokes) if revokes else '')
    check("no DROP VIEW anywhere (a re-created view loses every named grant)",
          not re.search(r'(?i)\bDROP\s+(MATERIALIZED\s+)?VIEW\b', body))
    check("no bare CREATE VIEW (only CREATE OR REPLACE)",
          not re.search(r'(?is)\bCREATE\s+(?!OR\s+REPLACE\s+)(MATERIALIZED\s+)?VIEW\b', body))
    check("redefines exactly the two target views",
          sorted(cor_names) == sorted(TARGETS), str(sorted(cor_names)))
    check(f"does not redefine {OUT_OF_SCOPE}", OUT_OF_SCOPE not in cor_names)
    check("no ALTER DEFAULT PRIVILEGES", not re.search(r'(?i)\bALTER\s+DEFAULT\s+PRIVILEGES\b', body))
    check("no pg_default_acl", 'pg_default_acl' not in body)
    # `security_invoker = ...`, not the bare word: both files mention it in a
    # RAISE message, and an error string is not a setting. Since C-A24 the
    # migration's precondition 3 also compares reloptions against the literal
    # arrays '{security_invoker=off}' / '{security_invoker=false}' -- a
    # comparison, not a setting -- so string literals are blanked first.
    unquoted = re.sub(r"'[^']*'", "''", body)
    check("does not set security_invoker",
          not re.search(r'(?i)\bsecurity_invoker\s*=', unquoted))
    if p == MIG:
        # C-A24: precondition 3 accepts NULL/'{}' and the two explicit
        # spellings of the default, and NOTHING else. An allowlist that let
        # security_invoker=on (or =true) through would accept an invoker view,
        # where this file's reasoning does not hold.
        allow = re.search(r"(?is)coalesce\(\(SELECT reloptions FROM pg_class WHERE oid = oid_\),\s*'\{\}'::text\[\]\)\s*NOT IN\s*\((.*?)\)\s*THEN", body)
        vals = sorted(re.findall(r"'([^']*)'::text\[\]", allow.group(1))) if allow else None
        check("precondition 3 allowlist is exactly {}, {security_invoker=off}, {security_invoker=false}",
              vals == sorted(['{}', '{security_invoker=off}', '{security_invoker=false}']), str(vals))
    check("no CREATE POLICY / ALTER POLICY / ALTER TABLE",
          not re.search(r'(?i)\b(CREATE|ALTER|DROP)\s+POLICY\b', body)
          and not re.search(r'(?i)\bALTER\s+TABLE\b', body))

    # Every restored/fixed definition must keep the two checks that were always
    # correct, whichever direction the file runs in.
    check("every definition keeps the owner check (auth.uid())",
          bool(defs) and all('auth.uid()' in d for d in defs.values()))
    check("every definition keeps the publication check",
          bool(defs) and all('published_at IS NOT NULL' in d for d in defs.values()))

    jta = defs.get('judge_tag_assignments_owner_safe', '')
    jc  = defs.get('judge_comments_owner_safe', '')
    has_jta_corr = bool(re.search(r'crp\.round_number\s*=\s*jta\.round_number', jta))
    has_jc_corr  = bool(re.search(r'crp\.round_number\s*=\s*jr\.round_number', jc))
    has_jc_map   = bool(re.search(r'jr\.id\s*=\s*jc\.round_id', jc))
    has_jc_comp  = bool(re.search(r'jr\.competition_id\s*=\s*ce\.competition_id', jc))

    if p == MIG:
        check("tags: crp.round_number = jta.round_number", has_jta_corr)
        check("comments: joins judging_rounds on jc.round_id", has_jc_map)
        check("comments: crp.round_number = jr.round_number", has_jc_corr)
        check("comments: jr.competition_id = ce.competition_id", has_jc_comp)
        check("comments: no `round_id IS NULL` escape hatch (fail closed)",
              not re.search(r'(?i)round_id\s+IS\s+NULL', jc))
    else:
        check("the rollback restores the UNCORRELATED tag definition", not has_jta_corr)
        check("the rollback restores the UNCORRELATED comment definition",
              not has_jc_corr and not has_jc_map)

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

print(f"\n  ALL CHECKS PASS: {ok}")
sys.exit(0 if ok else 1)
