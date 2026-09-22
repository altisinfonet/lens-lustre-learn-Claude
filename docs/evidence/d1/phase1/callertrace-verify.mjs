// D1 §4.2 verification instrument, REVISION 5 — FINAL. Its numbers are the ones used.
// REV4 scanned forward 500 chars from `.rpc` to the first string literal. That is the right
// direction but the wrong window: the cast-inside-the-parens shape used by AdminUsers.tsx and
// AdminCertificates.tsx puts a type annotation AND a multi-line comment between `.rpc` and the
// name, which is more than 500 characters. REV5 strips comments first, then scans forward 1200.
// Comment stripping is done without touching `//` inside a URL (`https://`).
import fs from 'node:fs'; import path from 'node:path';
const ROOT='/home/claude/repo';
const ROOTS=['src','functions','supabase/functions','scripts','harness','tools','cloudflare'];
const EXT=new Set(['.ts','.tsx','.js','.jsx','.mjs','.cjs']);
function walk(d,a=[]){let e;try{e=fs.readdirSync(path.join(ROOT,d),{withFileTypes:true})}catch{return a}
 for(const x of e){const r=path.join(d,x.name);
  if(x.isDirectory()){if(x.name==='node_modules'||x.name==='.git')continue;walk(r,a)}
  else if(EXT.has(path.extname(x.name)))a.push(r)}return a}
const files=ROOTS.flatMap(r=>walk(r));
const isTest=f=>/(^|\/)(__tests__|test|tests|test-utils|uiharness)(\/|$)/.test(f)||/\.(test|spec)\.[tj]sx?$/.test(f);
const isGen=f=>/src\/integrations\/supabase\/types/.test(f);
// blank out comments, preserving byte offsets and newlines so line numbers stay exact
function blankComments(s){
  const a=s.split(''); let i=0;
  while(i<a.length){
    const c=a[i], d=a[i+1];
    if(c==='/'&&d==='/'&&a[i-1]!==':'){ while(i<a.length&&a[i]!=='\n'){a[i]=' ';i++} }
    else if(c==='/'&&d==='*'){ while(i<a.length&&!(a[i]==='*'&&a[i+1]==='/')){if(a[i]!=='\n')a[i]=' ';i++} if(i<a.length){a[i]=' ';a[i+1]=' ';i+=2} }
    else i++;
  }
  return a.join('');
}
const lineOf=(s,i)=>s.slice(0,i).split('\n').length;
const calls=[];
for(const f of files){
  const raw=fs.readFileSync(path.join(ROOT,f),'utf8'); const src=blankComments(raw);
  const rpcRe=/\.rpc\b/g; let m;
  while((m=rpcRe.exec(src))){
    const seg=src.slice(m.index,m.index+1200);
    const lit=seg.match(/(["'`])([A-Za-z_][A-Za-z0-9_]*)\1/);
    if(lit) calls.push({name:lit[2],file:f,line:lineOf(src,m.index+seg.indexOf(lit[0])),kind:'rpc'});
  }
  const restRe=/rpc\/([A-Za-z_][A-Za-z0-9_]*)/g;
  while((m=restRe.exec(src))) calls.push({name:m[1],file:f,line:lineOf(src,m.index),kind:'REST'});
}
const objects=fs.readFileSync('/tmp/p1/objects.txt','utf8').trim().split('\n').map(l=>{const[s,n]=l.split('|');return{set:s,name:n}});
const out=objects.map(({set,name})=>{
  const mine=calls.filter(c=>c.name===name);
  const prod=[...new Set(mine.filter(c=>!isTest(c.file)&&!isGen(c.file)).map(c=>`${c.file}:${c.line}${c.kind==='REST'?' [REST]':''}`))].sort();
  const tst=[...new Set(mine.filter(c=>isTest(c.file)).map(c=>`${c.file}:${c.line}`))];
  return {set,name,invocation:prod,test:tst};
});
fs.writeFileSync('/tmp/p1/callers-final.json',JSON.stringify(out,null,1));
for(const o of out) console.log(`${o.set}|${o.name}|${o.invocation.join(' ; ')||'-'}|tests=${o.test.length}`);
const z=out.filter(o=>!o.invocation.length);
console.log('\nZERO PRODUCTION INVOCATION:',z.length,'\n ',z.map(o=>`${o.set}:${o.name}`).join(' · '));
