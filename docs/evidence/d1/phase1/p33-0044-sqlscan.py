"""D1 · U6 · 20260910_0044 — static SQL safety scan.

The scanner is docs/evidence/d1/phase1/unitC-sqlscan.py (PR #291). This is the
0044 driver for it. 0044 is the first unit in Phase 1 that DROPS something on
production, so the properties that matter are about what the DROP can take
with it, and about the one extension it may touch:

  * DROP EXTENSION plpgsql_check RESTRICT — RESTRICT spelled out, exactly once,
    and CASCADE nowhere as an executable statement. The harness shows what
    CASCADE does with a dependent view: the move "succeeds" and the view is gone.
  * CREATE EXTENSION plpgsql_check WITH SCHEMA extensions (the rollback: public),
    exactly once, and with NO VERSION clause: the version is carried by the
    pre-image and asserted by the postcondition, because production's version
    is not known to this repository and a literal would be a guess.
  * no ALTER EXTENSION ... SET SCHEMA: measured to fail for plpgsql_check
    ("does not support SET SCHEMA"), so its presence would be a file that
    cannot run.
  * no other extension touched, no GRANT, no REVOKE, no TO PUBLIC.
  * both files assert the lane `= 'production'` exactly.
  * the caller check matches on the extension's MEMBER NAMES (member_rx), not
    on the string 'plpgsql_check' alone — the first draft did the latter and let
    a call to public.plpgsql_profiler_reset_all() through. A regression to that
    form fails here.
  * the probe is read-only: BEGIN, one SELECT, COMMIT, and nothing else.

Run from the repository root:  python3 docs/evidence/d1/phase1/p33-0044-sqlscan.py
"""
import sys, re, io, os
sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
import importlib.util
spec = importlib.util.spec_from_file_location("sqlscan", os.path.join(HERE, "unitC-sqlscan.py"))
S = importlib.util.module_from_spec(spec); spec.loader.exec_module(S)

MIG = 'supabase/migrations/20260910_0044_p33_plpgsql_check_out_of_public.sql'
RB  = 'supabase/rollback/20260910_0044_p33_plpgsql_check_out_of_public_ROLLBACK.sql'
PRB = 'supabase/migrations/PROBE_p33_0044_plpgsql_check_readonly.sql'
for flag, var in (('--mig', 'MIG'), ('--rb', 'RB'), ('--probe', 'PRB')):
    if flag in sys.argv: globals()[var] = sys.argv[sys.argv.index(flag) + 1]

ok = True
def check(label, cond, detail=''):
    global ok
    if not cond: ok = False
    print(f"  {'PASS' if cond else 'FAIL'}  {label}" + (f"  {detail}" if detail else ''))
def norm(s): return re.sub(r'\s+', ' ', s).strip().rstrip(';')

print("D1 · U6 · 20260910_0044 — STATIC SQL SAFETY SCAN")
print("instrument: docs/evidence/d1/phase1/unitC-sqlscan.py")

for p, target in ((MIG, 'extensions'), (RB, 'public')):
    raw  = io.open(p, encoding='utf-8', newline='').read()
    ne   = [s for s in S.statements(S.strip_comments(raw)) if s.strip()]
    kw   = [s for s in ne if re.match(r'(?i)^\s*' + S.KEYWORDS + r'\b', S.norm(s))]
    rem  = [s for s in ne if s not in kw]
    top  = [norm(S.norm(s)) for s in ne]
    deep = [norm(S.norm(s)) for s in S.statements(S.strip_comments(raw), into_dollar=True)]
    body = S.strip_comments(raw)
    ext_ddl = [t for t in top if re.match(r'(?i)^(CREATE|DROP|ALTER)\s+EXTENSION\b', t)]

    print(f"\n=== {p}")
    print(f"  executable statements (top level) : {len(ne)}")
    print(f"  REMAINDER (unclassified)          : {len(rem)}")
    for r in rem: print(f"      !! {S.norm(r)[:120]}")
    print(f"  extension DDL                     : {ext_ddl}")
    print()
    check("remainder is 0 — the scan understood every statement", not rem)

    drops = [t for t in ext_ddl if re.match(r'(?i)^DROP\s+EXTENSION\b', t)]
    creates = [t for t in ext_ddl if re.match(r'(?i)^CREATE\s+EXTENSION\b', t)]
    check("exactly one DROP EXTENSION, and it is `DROP EXTENSION plpgsql_check RESTRICT`",
          drops == ['DROP EXTENSION plpgsql_check RESTRICT'], str(drops))
    check(f"exactly one CREATE EXTENSION, and it is `... plpgsql_check WITH SCHEMA {target}`",
          creates == [f'CREATE EXTENSION plpgsql_check WITH SCHEMA {target}'], str(creates))
    check("no VERSION clause — the version is carried by the pre-image, not guessed",
          not any(re.search(r'(?i)\bVERSION\b', t) for t in creates))
    # Judged on the statements that can CARRY a CASCADE (DROP, TRUNCATE,
    # REVOKE, ALTER), not on the text: both files say "never uses CASCADE" inside
    # a RAISE EXCEPTION message, and an error string is not a DROP.
    casc = [t for t in deep if re.match(r'(?i)^(DROP|TRUNCATE|REVOKE|ALTER)\b', t)
                               and re.search(r'(?i)\bCASCADE\b', t)]
    check("no CASCADE on any DROP / TRUNCATE / REVOKE / ALTER statement", not casc,
          str([t[:70] for t in casc]) if casc else '')
    check("no ALTER EXTENSION (SET SCHEMA is measured to fail for plpgsql_check)",
          not any(re.match(r'(?i)^ALTER\s+EXTENSION\b', t) for t in ext_ddl))
    check("no other extension is named in any extension DDL",
          all(re.match(r'(?i)^(CREATE|DROP)\s+EXTENSION\s+plpgsql_check\b', t) for t in ext_ddl))
    check("no GRANT and no REVOKE",
          not any(re.match(r'(?i)^(GRANT|REVOKE)\b', t) for t in deep))
    check("no TO PUBLIC", not S.grants_to_public(raw))
    check("no ALTER DEFAULT PRIVILEGES", not re.search(r'(?i)\bALTER\s+DEFAULT\s+PRIVILEGES\b', body))

    secdef = re.findall(r'(?is)(CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b.{0,400}?\bSECURITY\s+DEFINER\b.{0,200}?\bAS\b)', body)
    check("no SECURITY DEFINER function created without a pinned search_path",
          all(re.search(r'(?i)SET\s+search_path\s*=', d) for d in secdef),
          f"{len(secdef)} definer function(s)")

    lane = re.findall(r"(?is)p32\.lane'.{0,60}?(NOT\s+IN|\bIN\b|<>|=)\s*(\([^)]*\)|'[a-z]+')", body)
    lane = [(re.sub(r'\s+', ' ', a).upper(), b) for a, b in lane]
    print(f"  lane assertion(s) found           : {lane}")
    check("PRODUCTION-ONLY assertion: <> 'production'",
          any(a == '<>' and b == "'production'" for a, b in lane))
    check("the lane assertion does not accept staging", not any('staging' in b for _, b in lane))

    if p == MIG:
        check("the caller check matches the extension's MEMBER NAMES, not just 'plpgsql_check'",
              re.search(r'prosrc\s*~\*\s*member_rx', body) is not None
              and re.search(r"command\s*~\*\s*\$1", body) is not None)
        check("the postcondition compares the version against the pre-image",
              re.search(r'v IS DISTINCT FROM pre\.version', body) is not None)

print(f"\n=== {PRB}")
raw = io.open(PRB, encoding='utf-8', newline='').read()
top = [norm(S.norm(s)) for s in S.statements(S.strip_comments(raw)) if s.strip()]
kinds = [re.match(r'(?i)^(\w+)', t).group(1).upper() for t in top]
print(f"  statements: {kinds}")
check("the probe is BEGIN, one read-only query, COMMIT — nothing else",
      kinds == ['BEGIN', 'WITH', 'COMMIT'] or kinds == ['BEGIN', 'SELECT', 'COMMIT'], str(kinds))
check("the probe contains no DDL or DML keyword as a statement",
      not any(re.match(r'(?i)^(CREATE|DROP|ALTER|GRANT|REVOKE|INSERT|UPDATE|DELETE|TRUNCATE|DO)\b', t) for t in top))

print(f"\n  ALL CHECKS PASS: {ok}")
sys.exit(0 if ok else 1)
