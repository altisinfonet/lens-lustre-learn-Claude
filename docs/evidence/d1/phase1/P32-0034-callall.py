import subprocess, sys, io, os
sys.dont_write_bytecode = True
UNIT, PGBIN, H, P, DB, ROLE = sys.argv[1:7]
rows=[(l.rstrip('\n').split('\t')+['','',''])[:3] for l in io.open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'P32-0034-signatures-20260925.tsv'),encoding='utf-8') if l.strip('\n')]
succ=denied=0; other=[]
for u,n,a in rows:
    if u!=UNIT: continue
    args = [] if not a.strip() else [p.strip().split(' ',1)[1] for p in a.split(', ')]
    call = f"SELECT public.{n}(" + ", ".join(f"NULL::{t}" for t in args) + ")"
    r=subprocess.run([f"{PGBIN}/psql","-X","-q","-A","-t","-h",H,"-p",P,"-U","postgres","-d",DB,
                      "-v","VERBOSITY=verbose","-c",f"SET ROLE {ROLE}; {call};"],capture_output=True,text=True)
    o=r.stdout+r.stderr
    if r.returncode==0 and "ERROR" not in o: succ+=1
    elif "42501" in o: denied+=1
    else: other.append(f"{n}: "+o.strip().split('\n')[0][:90])
print(f"{succ} {denied} {len(other)}")
for x in other: print("      ?? "+x, file=sys.stderr)
