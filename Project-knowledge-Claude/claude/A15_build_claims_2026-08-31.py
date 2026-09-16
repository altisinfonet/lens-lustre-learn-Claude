#!/usr/bin/env python3
"""
A15 — the 138-file CLAIMS document generator.

Every row asserts something CHECKABLE AGAINST SOURCE, and names the command that checks it.
No row asserts a conclusion. No row asserts "this file is fine".

Endpoints, fixed:
  BASE = b671e1fb0c5bcf145d442076c229eca888afd674   (origin/main)
  RC   = a42b209e4f70a6efed4f3dcdb654e0f994416594   (the frozen release candidate)
  NEW  = 9384ba9aeef585f615148b208f13d68fdbe169f5   (replacement RC branch head, NOT adopted)
"""
import subprocess, json, os, csv, sys
BASE="b671e1fb0c5bcf145d442076c229eca888afd674"
RC  ="a42b209e4f70a6efed4f3dcdb654e0f994416594"
NEW ="9384ba9aeef585f615148b208f13d68fdbe169f5"
G=["git","-C","/home/claude/repo/src"]
def run(*a): return subprocess.run(G+list(a),capture_output=True,text=True).stdout
status={}
for line in run("diff","--name-status",BASE,RC).splitlines():
    if not line.strip(): continue
    st,path=line.split("\t",1); status[path]=st
num={}
for line in run("diff","--numstat",BASE,RC).splitlines():
    if not line.strip(): continue
    a,d,path=line.split("\t",2); num[path]=(a,d)
patched=set(p for p in run("diff","--name-only",RC,NEW).splitlines() if p.strip())
blob={}
for line in run("ls-tree","-r","--long",RC).splitlines():
    parts=line.split(None,4)
    if len(parts)==5: blob[parts[4]]=(parts[2],parts[3])

def category(p):
    if p.startswith(".github/workflows/"): return "CI workflow"
    if p.startswith("supabase/migrations/"): return "DB migration"
    if p.startswith("supabase/rollback/"):   return "DB rollback"
    if p.startswith("supabase/functions/"):  return "edge function"
    if p.startswith("supabase/"):            return "supabase config"
    if p.startswith("functions/"):           return "Pages edge function"
    if p.startswith("scripts/"):             return "build/CI script"
    if "__tests__" in p or "/test/" in p or p.endswith(".test.ts") or p.endswith(".test.tsx"): return "test"
    if p.startswith("src/components/"):      return "web component"
    if p.startswith("src/pages/"):           return "web page"
    if p.startswith("src/lib/") or p.startswith("src/hooks/") or p.startswith("src/utils/"): return "web library"
    if p.startswith("src/"):                 return "web source"
    if p.startswith("docs/"):                return "documentation"
    if p.startswith("cloudflare/"):          return "cloudflare worker"
    return "root/config"

def risk(p,cat,st):
    if cat=="CI workflow" and p.endswith(("apply-migration.yml","verify-schema-dependencies.yml")): return "HIGH"
    if cat=="CI workflow": return "MED"
    if cat=="Pages edge function": return "HIGH"
    if cat in ("DB migration","DB rollback"): return "HIGH"
    if cat=="edge function": return "MED"
    if cat=="supabase config": return "MED"
    if cat=="build/CI script": return "MED"
    if cat=="documentation": return "N/A"
    if cat=="test": return "LOW"
    return "LOW"

# per-category "what a reviewer should check", phrased as a checkable question
CHECK={
 "CI workflow":"Does any `${{ ... }}` expression appear inside a `run:` body? Does the job declare `environment:`? What are its `on:` triggers?",
 "Pages edge function":"Is any value interpolated into HTML or a `<script>` without escaping `<`?",
 "DB migration":"Is the file wrapped in BEGIN/COMMIT? Is it idempotent? Does it drop or rewrite data?",
 "DB rollback":"Does it reverse exactly the migration it names, and nothing else?",
 "edge function":"Does it call `getSecureHeaders`, or define a local CORS object? Does it reach storage, and if so does it call `assertStorageLane`?",
 "supabase config":"Does it change `verify_jwt`, function registration, or project refs?",
 "build/CI script":"Does it execute anything derived from an input, env var or argv?",
 "test":"Does it require live provider credentials? Does it skip silently when they are absent?",
 "web component":"Does it render unescaped user-supplied strings? Does it change an auth or privacy boundary?",
 "web page":"same as web component, plus: does it change a route or its guard?",
 "web library":"Does it construct SQL, URLs or HTML from unvalidated input?",
 "web source":"Does it change a client-side auth or data-access path?",
 "documentation":"Documentation only. `docs/PROMOTION_LEDGER.md` is frozen under §28.",
 "cloudflare worker":"Is any value injected into HTML unescaped?",
 "root/config":"Does it change build, lint, type or secret-scanning configuration?",
}
rows=[]
for p in sorted(status):
    st=status[p]; a,d=num.get(p,("?","?")); cat=category(p); rk=risk(p,cat,st)
    sha,size=blob.get(p,("(absent)","?"))
    rows.append(dict(path=p,status=st,added=a,deleted=d,category=cat,risk=rk,
                     blob_sha_at_RC=sha,bytes_at_RC=size,
                     touched_by_replacement_RC=("YES" if p in patched else "no"),
                     check=CHECK[cat]))
with open("A15_CLAIMS_138.tsv","w",newline="") as fh:
    w=csv.DictWriter(fh,fieldnames=list(rows[0].keys()),delimiter="\t")
    w.writeheader(); [w.writerow(r) for r in rows]
json.dump(rows,open("A15_CLAIMS_138.json","w"),indent=1)
print("rows:",len(rows))
from collections import Counter
print("by status  :",dict(Counter(r['status'] for r in rows)))
print("by category:",dict(Counter(r['category'] for r in rows)))
print("by risk    :",dict(Counter(r['risk'] for r in rows)))
print("touched by the replacement RC:",[r['path'] for r in rows if r['touched_by_replacement_RC']=='YES'])
