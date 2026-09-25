import io, subprocess, sys, re
NINE=[l.strip() for l in io.open('/tmp/uc/nine.txt') if l.strip()]
def sh(c): return subprocess.run(['su','postgres','-c',c],capture_output=True,text=True)
SNAP=("SELECT string_agg(x,'|' ORDER BY x) FROM ("
 "SELECT p.oid::text||p.proname||coalesce(p.proacl::text,'') AS x FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' "
 "UNION ALL SELECT c.relname||c.relkind||coalesce(c.relacl::text,'') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' "
 "UNION ALL SELECT t.tgname||t.tgrelid::text FROM pg_trigger t WHERE NOT t.tgisinternal) s")
def snap(db):
    r=sh(f"psql -X -qAt -d {db} -c \\\"{SNAP}\\\""); return r.stdout.strip()
for r in ("anon","authenticated","service_role"):
    sh(f"psql -X -qAtc \\\"DO \\$\\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='{r}') THEN CREATE ROLE {r} NOLOGIN; END IF; END \\$\\$;\\\"")
print("C-34 · SCRATCH POSTGRES ONLY. No staging, no production connection.")
print(f"  {'file':<56}{'OLD stmts ran':>15}{'NEW raises':>12}{'catalog identical':>19}")
allok=True
for p in NINE:
    db='uc_'+re.sub(r'\W','_',p.split('/')[-1])[:40].lower()
    sh(f"dropdb --if-exists {db}"); sh(f"createdb {db}")
    # minimal stubs so the old body has something to act on
    sh(f"psql -X -q -d {db} -c \\\"CREATE TABLE IF NOT EXISTS public.certificates(id uuid primary key default gen_random_uuid(), issued_at timestamptz default now(), custom_heading text, certificate_type text); CREATE TABLE IF NOT EXISTS public.profiles(id uuid primary key default gen_random_uuid(), created_at timestamptz default now()); CREATE TABLE IF NOT EXISTS public.notifications(id uuid primary key default gen_random_uuid(), certificate_id uuid); CREATE EXTENSION IF NOT EXISTS pgcrypto;\\\"")
    old=io.open(p,encoding='utf-8',newline='').read()
    m='END $withdrawn$;\n'; blk=old.split(m)[0]+m
    body="\n".join(l[3:] for l in old[len(blk):].split('\n'))
    io.open('/tmp/uc/old.sql','w',encoding='utf-8',newline='').write(body)
    base=snap(db)
    r=sh(f"psql -X -d {db} -f /tmp/uc/old.sql")   # ON_ERROR_STOP deliberately OFF
    tags=len([l for l in (r.stdout or '').split('\n') if re.match(r'^(CREATE|DROP|ALTER|GRANT|REVOKE|COMMENT|DO|SET|BEGIN|COMMIT|TRUNCATE|INSERT|UPDATE|DELETE)\b', l.strip())])
    after_old=snap(db)
    ran = tags>0 or after_old!=base
    # reset, then the NEW file
    sh(f"dropdb --if-exists {db}"); sh(f"createdb {db}")
    sh(f"psql -X -q -d {db} -c \\\"CREATE TABLE IF NOT EXISTS public.certificates(id uuid primary key, issued_at timestamptz, custom_heading text, certificate_type text); CREATE TABLE IF NOT EXISTS public.profiles(id uuid primary key, created_at timestamptz); CREATE TABLE IF NOT EXISTS public.notifications(id uuid primary key, certificate_id uuid);\\\"")
    b2=snap(db)
    r2=sh(f"psql -X -v ON_ERROR_STOP=1 -d {db} -f /home/claude/repo/{p}")
    raises = r2.returncode!=0 and 'WITHDRAWN' in (r2.stdout+r2.stderr)
    same = snap(db)==b2
    ok = ran and raises and same; allok &= ok
    print(f"  {p.split('/')[-1][:54]:<56}{str(tags)+' tags':>15}{str(raises):>12}{str(same):>19}  {'' if ok else '*** FAIL'}")
    sh(f"dropdb --if-exists {db}")
print(f"\n  ALL NINE: old body executes, new file raises on the guard and changes nothing: {allok}")
