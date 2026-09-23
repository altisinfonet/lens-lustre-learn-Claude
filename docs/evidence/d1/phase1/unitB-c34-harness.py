import io, json, re, subprocess, sys, os
REPO='/home/claude/repo'
D=json.load(io.open('/tmp/uA/derived.json'))
META=json.load(io.open('/tmp/uA/meta.json'))
FAILED=[]
FALLBACK={}

def psql(db, args, sql=None, f=None, stop=True):
    cmd=['su','postgres','-c']
    inner=f"psql -X -qAt -d {db}"
    if stop: inner += " -v ON_ERROR_STOP=1"
    if sql: inner += ' -c "%s"' % sql.replace('"','\\"')
    if f:   inner += f" -f {f}"
    r=subprocess.run(cmd+[inner], capture_output=True, text=True)
    return r.returncode, (r.stdout or '')+(r.stderr or '')

def acl(db, sigs):
    q=("SELECT p.oid::regprocedure::text||' => '||coalesce(array_to_string(p.proacl,' | '),'(NULL)') "
       "FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' "
       "AND p.oid::regprocedure::text IN (%s) ORDER BY 1" %
       ",".join("'"+re.sub(r'\s+','',s).replace('public.','')+"'" for s in sigs))
    # regprocedure prints without spaces after commas
    rc,o=psql(db,None,sql=q)
    return o.strip()

def pubcount(db, sigs):
    ins=",".join("'"+re.sub(r'\s+','',s).replace('public.','')+"'" for s in sigs)
    rc,o=psql(db,None,sql=(
      "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace, "
      "aclexplode(p.proacl) a WHERE n.nspname='public' AND a.grantee=0 AND a.privilege_type='EXECUTE' "
      f"AND p.oid::regprocedure::text IN ({ins})"))
    return o.strip()

def named(db, sig, role):
    s=re.sub(r'\s+','',sig)
    rc,o=psql(db,None,sql=(f"SELECT EXISTS(SELECT 1 FROM pg_proc p, unnest(p.proacl) a "
                           f"WHERE p.oid=to_regprocedure('{sig}')::oid AND a::text LIKE '{role}=%')"))
    return o.strip()

roles_sql = ("DO $$ BEGIN "
 "IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; "
 "IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; "
 "IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF; "
 "END $$;")
subprocess.run(['su','postgres','-c',f'psql -X -qAtc "{roles_sql}"'],capture_output=True)


# ---------------------------------------------------------------------------
# Bring the fixture to the POST-APPLY ACL state.
# Preferred: run the apply verbatim -- strongest evidence.
# Fallback:  execute only the apply's GRANT/REVOKE statements, when the apply's
#            DDL cannot run against a stub (real parameter names, a missing
#            `auth` schema, a different return type). An ACL test is about the
#            ACL statements; the DDL adds nothing to it. Which files needed the
#            fallback, and why, is printed and reported -- not hidden.
# ---------------------------------------------------------------------------
sys.path.insert(0,'/tmp/uA')
from scan import strip_comments, statements as _stmts
import re as _re
def run_file(db, path):
    rc,o = psql(db, None, f=path)
    if rc == 0: return "full file", None
    err = next((l for l in o.split("\n") if "ERROR:" in l), "")
    err = err.split("ERROR:")[-1].strip() if err else "(no ERROR line)"
    raw = io.open(path, encoding="utf-8").read()
    n = 0
    for st in _stmts(strip_comments(raw)):
        t = " ".join(st.split())
        if _re.match(r"(?i)^\s*(GRANT|REVOKE)\b", t):
            psql(db, None, sql=t.replace("'", "''")); n += 1
    return f"ACL-only fallback ({n} statements)", err

def run_apply(db, applyfile):
    return run_file(db, f"{REPO}/supabase/migrations/{applyfile}")

print("D1 · UNIT B · C-34 — NINE STEPS PER FILE")
print("Seed = that file's own PRE-APPLY state, derived from its apply's REVOKE list.")
print("Then the APPLY is run, because a rollback is run from the post-apply state —")
print("without that, step 2 could not fail and would be C-34 all over again.")
print("="*100)

for key in META:
    m=META[key]; objs=D[key]['objects']; sigs=list(objs.keys())
    db=f"ub_{key.lower()}"
    subprocess.run(['su','postgres','-c',f'dropdb --if-exists {db}'],capture_output=True)
    subprocess.run(['su','postgres','-c',f'createdb {db}'],capture_output=True)
    psql(db,None,f='/tmp/uA/ub_stubs.sql')
    print(f"\n{'='*100}\nFILE {key}  (CASE {m['case']})  ·  {m['rb']}\n  objects: {len(sigs)}")

    # ---- seed pre-apply ------------------------------------------------
    for sig,x in objs.items():
        psql(db,None,sql=f"REVOKE ALL ON FUNCTION {sig} FROM PUBLIC, anon, authenticated, service_role")
        pre=set(x['revoked']) | {'service_role'}
        for r in pre:
            psql(db,None,sql=f"GRANT EXECUTE ON FUNCTION {sig} TO {r}")
    print(f"  STEP 1 · pre-apply seeded; PUBLIC entries = {pubcount(db,sigs)} of {len(sigs)}")
    mode, err = run_apply(db, D[key]['apply'])
    print(f"           apply -> {mode}; PUBLIC entries now = {pubcount(db,sigs)} of {len(sigs)}")
    if err: print(f"           (full apply refused by the stub fixture: {err[:90]})")
    FALLBACK[key] = (mode, err)
    base=acl(db,sigs)

    # ---- step 2: OLD body ----------------------------------------------
    old = f"{REPO}/supabase/rollback/UNAPPLIED_{m['rb']}" if m['case']=='B' else '/tmp/uA/old_'+m['rb']
    if m['case']=='A':
        blob=subprocess.run(['git','-C',REPO,'show',f"origin/staging:supabase/rollback/{m['rb']}"],
                            capture_output=True).stdout.decode()
        io.open(old,'w').write(blob)
    else:
        # the withdrawn file is neutralised; recover the original body for the probe
        raw=io.open(old,encoding='utf-8').read()
        blk=raw.split('END $withdrawn$;\n')[0]+'END $withdrawn$;\n'
        io.open('/tmp/uA/old_'+m['rb'],'w').write("\n".join(l[3:] for l in raw[len(blk):].split('\n')))
        old='/tmp/uA/old_'+m['rb']
    mode2, err2 = run_file(db, old)
    p_after_old=pubcount(db,sigs)
    ok2 = int(p_after_old)>0
    print(f"  STEP 2 · OLD body -> {mode2}; PUBLIC entries = {p_after_old} of {len(sigs)}"
          f"   {'PASS — the defect reproduced' if ok2 else '*** FAIL — no PUBLIC entry appeared'}")
    if err2: print(f"           (full old body refused by the stub fixture: {err2[:80]})")
    if ok2:
        rc,ent=psql(db,None,sql=(
          "SELECT p.oid::regprocedure::text||'  grantee=PUBLIC  '||a.privilege_type "
          "FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace, aclexplode(p.proacl) a "
          "WHERE n.nspname='public' AND a.grantee=0 AND a.privilege_type='EXECUTE' ORDER BY 1"))
        for l in ent.strip().split("\n")[:4]: print("           "+l)
    else: FAILED.append(f"{key} step2")

    # ---- step 3: reset --------------------------------------------------
    for sig,x in objs.items():
        psql(db,None,sql=f"REVOKE ALL ON FUNCTION {sig} FROM PUBLIC, anon, authenticated, service_role")
        for r in set(x['revoked'])|{'service_role'}: psql(db,None,sql=f"GRANT EXECUTE ON FUNCTION {sig} TO {r}")
    run_apply(db, D[key]['apply'])
    print(f"  STEP 3 · reset to post-apply; ACL matches step-1 baseline: {acl(db,sigs)==base}")

    NEW=f"{REPO}/supabase/rollback/{m['rb']}"
    # ---- steps 6,7 first (must not change anything) ---------------------
    for label,setline in (("6 · p32.lane unset","-- unset"),
                          ("7 · p32.lane='production'","SET p32.lane = 'production';")):
        io.open('/tmp/uA/case.sql','w').write(f"\\set VERBOSITY verbose\n{setline}\n\\i {NEW}\n")
        rc,o=psql(db,None,f='/tmp/uA/case.sql')
        same = acl(db,sigs)==base
        names = 'p32.lane' in o
        okk = rc!=0 and same and names and 'ROLLBACK REFUSED' in o
        print(f"  STEP {label:<26} rc={rc}  proacl byte-identical={same}  names p32.lane={names}   "
              f"{'PASS' if okk else '*** FAIL'}")
        if not okk: FAILED.append(f"{key} step{label[0]}")

    # ---- steps 4,5,8: staging -------------------------------------------
    io.open('/tmp/uA/case.sql','w').write(f"SET p32.lane = 'staging';\n\\i {NEW}\n")
    rc,o=psql(db,None,f='/tmp/uA/case.sql')
    p4=pubcount(db,sigs); passed='POST-CONDITION PASSED' in o
    ok4 = rc==0 and p4=='0' and passed
    print(f"  STEP 4 · CORRECTED body, lane=staging  rc={rc}  PUBLIC entries={p4}  post-condition={'passed' if passed else 'DID NOT PASS'}   {'PASS' if ok4 else '*** FAIL'}")
    if not ok4: FAILED.append(f"{key} step4"); print("         "+o.strip()[:400])
    a4=acl(db,sigs)
    rc,o=psql(db,None,f='/tmp/uA/case.sql')
    ok5 = rc==0 and acl(db,sigs)==a4
    print(f"  STEP 5 · re-run (idempotence)          rc={rc}  ACL byte-identical={acl(db,sigs)==a4}   {'PASS' if ok5 else '*** FAIL'}")
    if not ok5: FAILED.append(f"{key} step5")
    miss=[]
    for sig,x in objs.items():
        for r in sorted(set([q for q in x['revoked'] if q!='public']) | set(x['granted'])):
            if named(db,sig,r)!='t': miss.append(f"{sig}:{r}")
    ok8 = not miss
    print(f"  STEP 8 · intended named grantees present, per object: "
          f"{'ALL PRESENT' if ok8 else 'MISSING '+', '.join(miss[:4])}   {'PASS' if ok8 else '*** FAIL'}")
    if not ok8: FAILED.append(f"{key} step8")

    # ---- step 9 ----------------------------------------------------------
    bad=[]
    for v in ["Staging","STAGING"," staging","staging ",""]:
        io.open('/tmp/uA/case.sql','w').write(f"SET p32.lane = '{v}';\n\\i {NEW}\n")
        rc,o=psql(db,None,f='/tmp/uA/case.sql')
        if not (rc!=0 and 'ROLLBACK REFUSED' in o): bad.append(repr(v))
    io.open('/tmp/uA/case.sql','w').write(f"SET p32.lane='staging';\nRESET p32.lane;\n\\i {NEW}\n")
    rc,o=psql(db,None,f='/tmp/uA/case.sql')
    reset_ok = rc!=0 and 'ROLLBACK REFUSED' in o
    ok9 = not bad and reset_ok
    print(f"  STEP 9 · near-misses + reset-to-unset  refused: {'all 5 + reset' if ok9 else 'FAILURES '+','.join(bad)+(' reset' if not reset_ok else '')}   {'PASS' if ok9 else '*** FAIL'}")
    if not ok9: FAILED.append(f"{key} step9")
    subprocess.run(['su','postgres','-c',f'dropdb --if-exists {db}'],capture_output=True)

print("\n"+"="*100)
print("\nFIXTURE MODE PER FILE:")
for k,(mo,er) in FALLBACK.items():
    print(f"  {k:<9}{mo}" + (f"   <- {er[:70]}" if er else ""))
print("RESULT:", "ALL NINE STEPS PASSED ON ALL ELEVEN FILES" if not FAILED else "FAILURES: "+", ".join(FAILED))
sys.exit(1 if FAILED else 0)
