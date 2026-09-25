"""D1 · U3 · 20260910_0037 — static SQL safety scan.

The scanner is docs/evidence/d1/phase1/unitC-sqlscan.py, committed in PR #291.
This is the 0037 driver for it.

0037 is dispatched at PRODUCTION. Its safety properties are therefore stricter
than any staging unit's, and two of them are structural rather than a matter of
getting a list right:

  1. the migration contains NOT ONE GRANT. A file that cannot grant cannot
     widen access, whatever else is wrong with it. R-50's whole finding is that
     replaying staging's files on production would LOOSEN it, so "REVOKE only"
     is the property that makes this unit safe to exist at all.
  2. both files assert `= 'production'` EXACTLY. Not two-lane, not staging.
     0037's object list is production's; on staging most of it is already done
     and the rest would be wrong. The rollback is the documented exception to
     R-9's staging-only rule, for the reason its header gives: the state it
     restores exists only on production, and on staging it would OPEN doors
     rather than reopen them.

And two that are about getting the list right:

  3. the migration's REVOKE list equals, exactly, the set p1-0037-derive.py
     computes from the production reading. The SQL and the evidence cannot
     drift apart without this going red.
  4. every function REVOKE names PUBLIC. Seven of the 29 reach anon through
     PUBLIC, so a statement naming anon alone is a silent no-op (F-62) — and a
     silent no-op on production is the failure mode this project has been
     correcting since P32 began.

Run from the repository root:  python3 docs/evidence/d1/phase1/p1-0037-sqlscan.py
"""
import sys, re, io, os, json, subprocess
sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
import importlib.util
spec = importlib.util.spec_from_file_location("sqlscan", os.path.join(HERE, "unitC-sqlscan.py"))
S = importlib.util.module_from_spec(spec); spec.loader.exec_module(S)

MIG = 'supabase/migrations/20260910_0037_p1_production_closure.sql'
RB  = 'supabase/rollback/20260910_0037_p1_production_closure_ROLLBACK.sql'
if '--mig' in sys.argv: MIG = sys.argv[sys.argv.index('--mig') + 1]
if '--rb'  in sys.argv: RB  = sys.argv[sys.argv.index('--rb') + 1]

R = json.load(open(os.path.join(HERE, 'p1-0037-production-reading-20260925.json'), encoding='utf-8'))
def name_of(s): return s[:s.index('(')]
def items(a):   return [x for x in a.strip('{}').split(',') if x]
def pub(a):     return any(i.startswith('=') for i in items(a))
def has(a, r):  return any(i.startswith(r + '=') for i in items(a))
A_N = ['get_broadcast_feed','fix_certificate_readiness_admin','fix_gift_drift_admin','submit_competition_entry',
       'get_judging_tag_assignment_counts','get_judge_collusion_admin','admin_flag_entry_for_review',
       'get_certificate_drift_admin','admin_rewind_stage','backfill_judging_notifications',
       'admin_set_photo_rejected','fix_referral_drift_admin','backfill_tag_decision_drift_admin',
       'register_push_token','unregister_push_token','request_withdrawal','admin_search_users',
       'change_custom_url','claim_username']
B_N = ['apply_decision_to_remaining','_gen_competition_order_no','recompute_entry_from_tag_assignments',
       'recompute_entry_public_status','set_write_path','get_derived_status_drift_admin',
       'judging_write_decision_atomic','clear_custom_url']
va = [(s, a) for (s, v, a) in R['functions'] if v == 'v' and (pub(a) or has(a, 'anon'))]
WANT_A = sorted(s for s, a in va if name_of(s) in A_N)
WANT_B = sorted(s for s, a in va if name_of(s) in B_N)
VIEWS = [t[0] for t in R['tables'] if t[0] not in
         ('categories_migration_dropped', 'posts_dead_host_backup_20260812')]

ok = True
def check(label, cond, detail=''):
    global ok
    if not cond: ok = False
    print(f"  {'PASS' if cond else 'FAIL'}  {label}" + (f"  {detail}" if detail else ''))

print("D1 · U3 · 20260910_0037 — STATIC SQL SAFETY SCAN")
print("instrument: docs/evidence/d1/phase1/unitC-sqlscan.py")

for p in (MIG, RB):
    raw  = io.open(p, encoding='utf-8', newline='').read()
    ne   = [s for s in S.statements(S.strip_comments(raw)) if s.strip()]
    kw   = [s for s in ne if re.match(r'(?i)^\s*' + S.KEYWORDS + r'\b', S.norm(s))]
    rem  = [s for s in ne if s not in kw]
    deep = S.statements(S.strip_comments(raw), into_dollar=True)
    grants  = [S.norm(s) for s in deep if re.match(r'(?i)^\s*GRANT\b',  S.norm(s))]
    revokes = [S.norm(s) for s in deep if re.match(r'(?i)^\s*REVOKE\b', S.norm(s))]
    adp     = [S.norm(s) for s in deep if re.match(r'(?i)^\s*ALTER\s+DEFAULT\s+PRIVILEGES\b', S.norm(s))]
    body    = S.strip_comments(raw)
    pub_grants = S.grants_to_public(raw)

    print(f"\n=== {p}")
    print(f"  executable statements (top level) : {len(ne)}")
    print(f"  REMAINDER (unclassified)          : {len(rem)}")
    for r in rem: print(f"      !! {S.norm(r)[:120]}")
    print(f"  REVOKE / GRANT                    : {len(revokes)} / {len(grants)}")
    print(f"  ALTER DEFAULT PRIVILEGES          : {len(adp)}")
    for a in adp: print(f"      {a[:130]}")
    print()

    check("remainder is 0 — the scan understood every statement", not rem)
    check("0 executable GRANT ... TO PUBLIC", not pub_grants, str(pub_grants[:2]) if pub_grants else '')
    check("no CREATE or DROP of any object",
          not re.search(r'(?i)\b(CREATE|DROP)\s+(OR\s+REPLACE\s+)?(TABLE|VIEW|MATERIALIZED|FUNCTION|POLICY|INDEX|SCHEMA|ROLE)\b', body),
          '')
    check("no ALTER TABLE / POLICY / ROLE", not re.search(r'(?i)\bALTER\s+(TABLE|POLICY|ROLE|SCHEMA)\b', body))
    check("nothing granted to or revoked from postgres / supabase_auth_admin",
          not any(re.search(r'(?i)(^|[\s,])(postgres|supabase_auth_admin)([\s,;]|$)', s)
                  for s in grants + revokes))
    check("exactly one ALTER DEFAULT PRIVILEGES statement", len(adp) == 1, f"got {len(adp)}")
    check("the default-privilege statement is scoped IN SCHEMA public",
          bool(adp) and re.search(r'(?i)IN\s+SCHEMA\s+public', adp[0]))

    lane = re.findall(r"(?is)p32\.lane'.{0,60}?(NOT\s+IN|\bIN\b|<>|=)\s*(\([^)]*\)|'[a-z]+')", body)
    lane = [(re.sub(r'\s+', ' ', a).upper(), b) for a, b in lane]
    print(f"  lane assertion(s) found           : {lane}")
    check("PRODUCTION-ONLY assertion: <> 'production'",
          any(a == '<>' and b == "'production'" for a, b in lane))
    check("the lane assertion does not accept staging",
          not any('staging' in b for _, b in lane))
    check("not two-lane", not any(a in ('NOT IN', 'IN') for a, _ in lane))

    if p == MIG:
        check("THE MIGRATION GRANTS NOTHING — REVOKE only", not grants,
              str(grants[:3]) if grants else '')
        check("its default-privilege statement REVOKEs", bool(adp) and 'REVOKE' in adp[0].upper())
        fr = [s for s in revokes if re.search(r'(?i)^\s*REVOKE\s+EXECUTE\b', s)]
        check("every function REVOKE names PUBLIC (F-62)",
              all(re.search(r'(?i)FROM\s+PUBLIC\b', s) for s in fr if 'email_exists' not in s),
              str([s[:70] for s in fr if 'email_exists' not in s and not re.search(r'(?i)FROM\s+PUBLIC\b', s)]))
        got_a = sorted(m.group(1) for s in revokes
                       for m in [re.match(r'(?i)REVOKE EXECUTE ON FUNCTION public\.(.+?) FROM PUBLIC, anon$', s.rstrip(';').strip())] if m)
        got_b = sorted(m.group(1) for s in revokes
                       for m in [re.match(r'(?i)REVOKE EXECUTE ON FUNCTION public\.(.+?) FROM PUBLIC, anon, authenticated$', s.rstrip(';').strip())] if m)
        # get_primary_admin_user_id() is revoked with the same `FROM PUBLIC, anon`
        # shape but belongs to P33, not to the P32 group. It is checked on its
        # own line below; counting it into GROUP A would make this comparison
        # pass at 22 against a want of 21 only by luck of the same spelling.
        SINGLETON = 'get_primary_admin_user_id()'
        got_a = [g for g in got_a if g != SINGLETON]
        check("GROUP A equals the set derived from the production reading (21)",
              got_a == WANT_A, f"got {len(got_a)}, want {len(WANT_A)}: {sorted(set(got_a) ^ set(WANT_A))}")
        check("get_primary_admin_user_id() is revoked from PUBLIC and anon (P33, not P32)",
              any(re.match(r'(?i)REVOKE EXECUTE ON FUNCTION public\.get_primary_admin_user_id\(\) FROM PUBLIC, anon$',
                           s2.rstrip(';').strip()) for s2 in revokes))
        check("email_exists(text) loses authenticated only (P30)",
              any(re.match(r'(?i)REVOKE EXECUTE ON FUNCTION public\.email_exists\(text\) FROM authenticated$',
                           s2.rstrip(';').strip()) for s2 in revokes))
        check("GROUP B equals the set derived from the production reading (8)",
              got_b == WANT_B, f"got {len(got_b)}, want {len(WANT_B)}: {sorted(set(got_b) ^ set(WANT_B))}")
        vr = [s for s in revokes if re.search(r'(?i)ON\s+TABLE\s+public\.', s)]
        check("all 11 definer relations lose the 7 write privileges",
              all(any(re.search(rf'(?i)ON TABLE public\.{re.escape(v)}\b', s)
                      and re.search(r'(?i)INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN', s)
                      for s in vr) for v in VIEWS),
              str([v for v in VIEWS if not any(re.search(rf'(?i)ON TABLE public\.{re.escape(v)}\b', s) for s in vr)]))
        check("SELECT is never revoked from a definer relation",
              not any(re.search(r'(?i)REVOKE[^;]*\bSELECT\b[^;]*ON TABLE public\.(' + '|'.join(map(re.escape, VIEWS)) + r')\b', s)
                      for s in vr))
        check("the backup table loses ALL", any(re.search(r'(?i)REVOKE ALL ON TABLE public\.posts_dead_host_backup_20260812', s) for s in revokes))
    else:
        check("the rollback grants, and every grant names a role (never PUBLIC)",
              bool(grants) and all(not re.search(r'(?i)\bTO\s+PUBLIC\b', s) for s in grants))
        check("its default-privilege statement GRANTs to anon, not PUBLIC",
              bool(adp) and 'GRANT' in adp[0].upper()
              and re.search(r'(?i)TO\s+anon\b', adp[0]) and not re.search(r'(?i)TO\s+PUBLIC\b', adp[0]))
        check("judging_progression_audit is NOT re-granted (the reading has it closed)",
              not any(re.search(r'(?i)judging_progression_audit', s) for s in grants),
              str([s[:60] for s in grants if 'judging_progression_audit' in s]))
        check("the rollback revokes nothing", not revokes, str(revokes[:2]) if revokes else '')

print(f"\n  ALL CHECKS PASS: {ok}")
sys.exit(0 if ok else 1)
