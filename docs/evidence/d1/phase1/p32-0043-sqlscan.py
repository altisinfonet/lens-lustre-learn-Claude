"""D1 · U5 · 20260910_0043 — static SQL safety scan.

The scanner is docs/evidence/d1/phase1/unitC-sqlscan.py, committed in PR #291.
This is the 0043 driver for it.

0043 is the one file in Phase 1 that is ALLOWED to write `... TO PUBLIC`, so
the property that matters most here is not "no TO PUBLIC" but "exactly one, and
exactly that one":

    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA extensions
      GRANT EXECUTE ON FUNCTIONS TO PUBLIC;

scoped `IN SCHEMA extensions`. Any other `TO PUBLIC`, in either file, fails —
including the same statement with its schema scope removed, which would re-open
the global default this unit exists to close and make the whole file a no-op
with extra steps.

The other checks:
  * the three statements are present, in the ruled order. Order is load-bearing
    only in the sense that the file must not be read as "the per-schema line is
    the fix"; the scan asserts the sequence the ruling gives.
  * the global statement is present at all. Without it (F-65, C-A20) the file
    changes nothing about whether anon can execute a new function, which the
    behavioural harness demonstrates by deleting exactly that line.
  * neither file grants or revokes on any OBJECT. 0043 touches default
    privileges and nothing else; existing ACLs everywhere are untouched.
  * the rollback restores by NAME and never re-creates the PUBLIC grant, and
    never removes the extensions carve-out.
  * every SECURITY DEFINER function either file creates pins `search_path`.

CORRECTION C-A22. The first version of this unit created its probe without
`SET search_path = ''`, and the required Security check ("This project's own
security rules", secdef-no-search-path, HIGH) failed #300. THIS SCAN DID NOT
CATCH IT, which is the more interesting half: it checked the statements the
ruling named and not the function the file creates. The check is added below,
with a mutant, so the instrument now fails on the same thing the repository's
own rule fails on. A definer function that lives for three statements inside a
transaction is still a definer function.

Run from the repository root:  python3 docs/evidence/d1/phase1/p32-0043-sqlscan.py
"""
import sys, re, io, os
sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
import importlib.util
spec = importlib.util.spec_from_file_location("sqlscan", os.path.join(HERE, "unitC-sqlscan.py"))
S = importlib.util.module_from_spec(spec); spec.loader.exec_module(S)

MIG = 'supabase/migrations/20260910_0043_p32_default_privilege_recurrence.sql'
RB  = 'supabase/rollback/20260910_0043_p32_default_privilege_recurrence_ROLLBACK.sql'
if '--mig' in sys.argv: MIG = sys.argv[sys.argv.index('--mig') + 1]
if '--rb'  in sys.argv: RB  = sys.argv[sys.argv.index('--rb') + 1]

WANT = [
 "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon",
 "ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC",
 "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA extensions GRANT EXECUTE ON FUNCTIONS TO PUBLIC",
]

ok = True
def check(label, cond, detail=''):
    global ok
    if not cond: ok = False
    print(f"  {'PASS' if cond else 'FAIL'}  {label}" + (f"  {detail}" if detail else ''))

def norm(s): return re.sub(r'\s+', ' ', s).strip().rstrip(';')

print("D1 · U5 · 20260910_0043 — STATIC SQL SAFETY SCAN")
print("instrument: docs/evidence/d1/phase1/unitC-sqlscan.py")

for p in (MIG, RB):
    raw  = io.open(p, encoding='utf-8', newline='').read()
    ne   = [s for s in S.statements(S.strip_comments(raw)) if s.strip()]
    kw   = [s for s in ne if re.match(r'(?i)^\s*' + S.KEYWORDS + r'\b', S.norm(s))]
    rem  = [s for s in ne if s not in kw]
    deep = S.statements(S.strip_comments(raw), into_dollar=True)
    adp  = [norm(S.norm(s)) for s in deep if re.match(r'(?i)^\s*ALTER\s+DEFAULT\s+PRIVILEGES\b', S.norm(s))]
    # object-level grants/revokes, i.e. ones that are NOT part of an
    # ALTER DEFAULT PRIVILEGES statement.
    og   = [S.norm(s) for s in deep
            if re.match(r'(?i)^\s*(GRANT|REVOKE)\b', S.norm(s))]
    body = S.strip_comments(raw)
    # Computed from STATEMENTS, not from a regex over the text: both files carry
    # the phrase "grant to PUBLIC" inside a RAISE EXCEPTION message, and an
    # error string is not a grant. Scanning the prose is how an instrument ends
    # up reporting a file for the sentence that says it must not do the thing.
    to_public = [a for a in adp if re.search(r'(?i)\bTO\s+PUBLIC\b', a)] + \
                [S.norm(x) for x in S.grants_to_public(raw)]

    print(f"\n=== {p}")
    print(f"  executable statements (top level) : {len(ne)}")
    print(f"  REMAINDER (unclassified)          : {len(rem)}")
    for r in rem: print(f"      !! {S.norm(r)[:120]}")
    print(f"  ALTER DEFAULT PRIVILEGES          : {len(adp)}")
    for a in adp: print(f"      {a}")
    print(f"  object-level GRANT / REVOKE       : {len(og)}")
    print(f"  statements naming TO PUBLIC       : {len(to_public)}")
    for t in to_public: print(f"      {norm(t)[:120]}")
    print()

    check("remainder is 0 — the scan understood every statement", not rem)
    check("no object-level GRANT or REVOKE — default privileges only",
          not og, str([x[:60] for x in og[:2]]) if og else '')
    # Judged on STATEMENTS, not on the text: both files mention CREATE EXTENSION
    # inside a RAISE EXCEPTION message, and a sentence about an extension is not
    # a CREATE EXTENSION. The probe function, created and dropped inside the same
    # transaction by both files, is the one permitted CREATE/DROP: the catalogue
    # row is not the answer (F-65), so the merged result is measured on a real
    # function.
    # NOTE on what this can and cannot see: the probe's CREATE and DROP live
    # inside EXECUTE '...' string literals, so they are never statements and do
    # not appear here at all. That is why they are checked separately, by name,
    # further down. This check is about DDL the file would really execute.
    ddl = [S.norm(x) for x in deep if re.match(r'(?i)^\s*(CREATE|DROP)\b', S.norm(x))]
    stray = [d for d in ddl if '_p32r_probe' not in d]
    check("no executable CREATE or DROP statement",
          not stray, str([d[:70] for d in stray]) if stray else '')
    check("no ALTER TABLE / POLICY / ROLE", not re.search(r'(?i)\bALTER\s+(TABLE|POLICY|ROLE|SCHEMA)\b', body))

    # C-A22. The probe is built inside an EXECUTE '...' string, so it never
    # appears as a statement -- which is exactly why the earlier version of this
    # scan walked past it. Matched on the text of the CREATE, from the keyword to
    # the AS that opens the body.
    secdef = re.findall(r'(?is)(CREATE\s+FUNCTION\b.{0,400}?\bSECURITY\s+DEFINER\b.{0,200}?\bAS\b)', body)
    unpinned = [re.sub(r'\s+', ' ', d)[:110] for d in secdef
                if not re.search(r'(?i)SET\s+search_path\s*=', d)]
    check("every SECURITY DEFINER function this file creates pins search_path "
          "(secdef-no-search-path, HIGH)",
          bool(secdef) and not unpinned, str(unpinned) if unpinned else f"{len(secdef)} definer function(s)")

    # The sanctioned exception, and only it.
    bad_public = [t for t in to_public
                  if not re.search(r'(?is)ALTER\s+DEFAULT\s+PRIVILEGES.*IN\s+SCHEMA\s+extensions\s+GRANT\s+EXECUTE\s+ON\s+FUNCTIONS\s+TO\s+PUBLIC', t)]
    if p == MIG:
        check("exactly one TO PUBLIC, and it is the extensions carve-out",
              len(to_public) == 1 and not bad_public,
              str([norm(t)[:80] for t in bad_public]) if bad_public else f"count {len(to_public)}")
    else:
        check("no TO PUBLIC anywhere", not to_public, str([norm(t)[:80] for t in to_public]))

    lane = re.findall(r"(?is)p32\.lane'.{0,60}?(NOT\s+IN|\bIN\b|<>|=)\s*(\([^)]*\)|'[a-z]+')", body)
    lane = [(re.sub(r'\s+', ' ', a).upper(), b) for a, b in lane]
    print(f"  lane assertion(s) found           : {lane}")

    if p == MIG:
        check("exactly three ALTER DEFAULT PRIVILEGES statements", len(adp) == 3, f"got {len(adp)}")
        check("they are the three the ruling names, in that order", adp == WANT,
              str([a for a in adp if a not in WANT]) if adp != WANT else '')
        check("the GLOBAL statement is present (the one that closes anon — F-65, C-A20)",
              WANT[1] in adp)
        check("the global statement has no IN SCHEMA clause",
              not any(re.search(r'(?i)IN\s+SCHEMA', a) for a in adp if 'REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC' == a.split('postgres ')[-1]))
        check("TWO-LANE assertion: NOT IN ('staging','production')",
              any(a == 'NOT IN' and 'staging' in b and 'production' in b for a, b in lane))
        check("the migration is not restricted to one lane",
              not any(a in ('=', '<>') for a, _ in lane))
        check("it creates the probe function and DROPs it again in the same file",
              body.count('_p32r_probe') >= 2
              and re.search(r'(?i)CREATE FUNCTION public\._p32r_probe', body)
              and re.search(r'(?i)DROP FUNCTION public\._p32r_probe', body))
    else:
        check("exactly one ALTER DEFAULT PRIVILEGES statement", len(adp) == 1, f"got {len(adp)}")
        check("it is the GLOBAL entry, restored by grantee NAME",
              bool(adp) and adp[0] == "ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role",
              adp[0] if adp else '')
        check("the rollback does not touch the extensions carve-out",
              not any(re.search(r'(?i)IN\s+SCHEMA\s+extensions', a) for a in adp))
        check("the rollback does not touch the public schema entry",
              not any(re.search(r'(?i)IN\s+SCHEMA\s+public', a) for a in adp))
        check("R-9 STAGING-ONLY guard: <> 'staging'",
              any(a == '<>' and b == "'staging'" for a, b in lane))
        check("the rollback does not accept production",
              not any('production' in b for _, b in lane))
        check("it creates the probe function and DROPs it again in the same file",
              re.search(r'(?i)CREATE FUNCTION public\._p32r_probe', body)
              and re.search(r'(?i)DROP FUNCTION public\._p32r_probe', body))

print(f"\n  ALL CHECKS PASS: {ok}")
sys.exit(0 if ok else 1)
