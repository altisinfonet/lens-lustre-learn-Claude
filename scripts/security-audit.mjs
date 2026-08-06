#!/usr/bin/env node
/**
 * THE STANDING SECURITY GATE. Owner instruction, 2026-08-06:
 *   "i need a permanent solution, system made scanner to constant investigate
 *    after the changes you done but before publishing."
 *
 * Generic scanners (semgrep, gitleaks, npm audit) catch generic bugs. They would
 * never have caught the one that actually bit this project — a deleted member
 * keeping write access — because that is a policy and logic problem, not a
 * pattern. THIS file encodes the rules that are specific to 50mm Retina World,
 * so a violation fails the build instead of reaching a member.
 *
 * Exit code 1 on any FAIL. Wire it before the build, never after.
 * Add a rule here every time something bites; that is the whole point.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const findings = [];
const add = (sev, rule, detail, where) => findings.push({ sev, rule, detail, where });

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/node_modules|\.git|dist|coverage|\.bun/.test(p)) walk(p, out); }
    else out.push(p);
  }
  return out;
};
const read = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return ""; } };
const srcFiles = fs.existsSync("src") ? walk("src").filter((f) => /\.(ts|tsx)$/.test(f)) : [];
const isTest = (f) => /__tests__|\.test\.|\.spec\.|src[\\/]test[\\/]/.test(f);
const appFiles = srcFiles.filter((f) => !isTest(f));

/* 1 — A SERVICE-ROLE KEY MUST NEVER BE REACHABLE FROM THE CLIENT.
   The anon key is public by design. The service key bypasses every RLS policy
   in the database; in a client bundle it is a total compromise, not a leak. */
for (const f of [...appFiles, "index.html"].filter(Boolean)) {
  const t = read(f);
  if (/SUPABASE_SERVICE_ROLE_KEY|service_role_key|SERVICE_ROLE_KEY/.test(t) && !/\/\/|\*/.test(t.split("\n").find((l) => /SERVICE_ROLE/i.test(l)) || ""))
    add("CRITICAL", "service-role-in-client", "A service-role key reference reachable from client code", f);
}

/* 2 — NO HARDCODED JWT. Keys belong in env vars, never in a committed file. */
for (const f of [...appFiles, "index.html"].filter(Boolean)) {
  const m = read(f).match(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
  if (m) add("CRITICAL", "hardcoded-jwt", `Hardcoded JWT-shaped literal (${m[0].slice(0, 18)}…)`, f);
}

/* 3 — EVERY EDGE FUNCTION THAT USES THE SERVICE KEY MUST FIRST VERIFY ITS CALLER.
   A function holding the service key with no caller check is an open door to
   the whole database for anyone who learns its URL. */
if (fs.existsSync("supabase/functions")) {
  for (const d of fs.readdirSync("supabase/functions", { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== "_shared")) {
    const idx = path.join("supabase/functions", d.name, "index.ts");
    const t = read(idx);
    if (!t) continue;
    const usesServiceKey = /SUPABASE_SERVICE_ROLE_KEY/.test(t);
    // Supabase requires a valid JWT unless config.toml explicitly opts out, so
    // only the opted-out functions are actually reachable unauthenticated.
    // Grading every service-key function CRITICAL made the gate cry wolf on
    // seven functions that were never open. A scanner nobody trusts is worse
    // than no scanner.
    const cfg = read("supabase/config.toml");
    const optedOut = new RegExp(`\\[functions\\.${d.name}\\][^\\[]*verify_jwt\\s*=\\s*false`, "m").test(cfg);
    // getClaims() verifies a JWT just as getUser() does, and an opaque token
    // looked up in a table (one-click unsubscribe, RFC 8058) is a legitimate
    // unauthenticated pattern. Missing either produced two false CRITICALs on
    // payment and unsubscribe endpoints that were correctly protected.
    const verifiesCaller = /auth\.getUser\(|auth\.getClaims\(|x-internal-secret|INTERNAL_SECRET|CRON_SECRET|signature|hmac|_tokens'\)|_tokens"\)/i.test(t);
    // GRADE BY WHAT IT CAN DO, NOT MERELY BY BEING OPEN. A public read-only
    // endpoint holding the service key (sitemap, SEO metadata) is a normal,
    // necessary shape — the protection is its own WHERE clause, and that is a
    // code-review question, not a pattern one. An open endpoint that WRITES is
    // a different animal entirely. Grading both CRITICAL made the gate red for
    // a sitemap that was verified correct, and a permanently red gate is one
    // nobody reads.
    const writes = /\.(insert|update|upsert|delete)\s*\(|\.rpc\s*\(/.test(t);
    if (usesServiceKey && optedOut && !verifiesCaller && writes)
      add("CRITICAL", "edge-fn-open-and-writes",
          "Reachable WITHOUT a JWT and holds the service-role key, and it WRITES — no signature or secret check", idx);
    else if (usesServiceKey && optedOut && !verifiesCaller)
      add("MEDIUM", "edge-fn-open-read-only",
          "Public read-only endpoint holding the service-role key. RLS does not protect it, so its own filters are the only protection \u2014 re-read them when it changes", idx);
    else if (usesServiceKey && !verifiesCaller && !optedOut)
      add("LOW", "edge-fn-jwt-only",
          "Uses the service-role key and relies solely on Supabase's default JWT gate — any signed-in member can invoke it", idx);
  }
}

/* 4 — EVERY `SECURITY DEFINER` FUNCTION MUST PIN search_path.
   Without it, a caller can point search_path at their own schema and make the
   function run their code with the definer's privileges. */
if (fs.existsSync("supabase/migrations")) {
  // MIGRATIONS ARE A HISTORY, NOT A STATE. A function defined unsafely in March
  // and redefined safely in May is safe today. Only the LAST definition counts —
  // reporting every historical one produced five false alarms on this project,
  // all of which the live database had already fixed.
  const latest = new Map();
  for (const f of walk("supabase/migrations").filter((x) => x.endsWith(".sql")).sort()) {
    const t = read(f);
    for (const b of t.split(/create\s+(?:or\s+replace\s+)?function/i).slice(1)) {
      const head = b.slice(0, 700);
      const name = (head.match(/^\s*([a-z0-9_."]+)\s*\(/i) || [])[1];
      if (!name) continue;
      latest.set(name, { file: f, definer: /security\s+definer/i.test(head), pinned: /set\s+search_path/i.test(head) });
    }
  }
  for (const [name, v] of latest)
    if (v.definer && !v.pinned)
      add("HIGH", "secdef-no-search-path", `SECURITY DEFINER function "${name}" does not pin search_path in its most recent definition`, v.file);
}

/* 5 — NO console.*  It is untraceable on a member's phone. Every failure must
   carry a catalogue code so it can be found in the Error Log. */
for (const f of appFiles) {
  if (/src[\\/]lib[\\/]logger\.ts$/.test(f)) continue;
  read(f).split("\n").forEach((l, i) => {
    if (/(?<![\w.])console\s*\.\s*(log|warn|error|info|debug|trace)\s*\(/.test(l) && !/^\s*(\/\/|\*)/.test(l))
      add("MEDIUM", "console-call", "console.* reaches a member's device untraceably", `${f}:${i + 1}`);
  });
}

/* 6 — EVERY LOG CARRIES A CATALOGUE CODE. A log nobody can group is noise. */
for (const f of appFiles) {
  const t = read(f);
  const re = /logger\s*\.\s*(trace|debug|info|warn|error|fatal)\s*\(\s*\{/g;
  let m;
  while ((m = re.exec(t))) {
    let depth = 0, end = re.lastIndex - 1;
    for (let j = re.lastIndex - 1; j < t.length; j++) {
      if (t[j] === "{") depth++;
      else if (t[j] === "}") { depth--; if (!depth) { end = j; break; } }
    }
    if (!/\bcode\s*:/.test(t.slice(re.lastIndex - 1, end + 1)))
      add("MEDIUM", "log-without-code", `logger.${m[1]} with no catalogue code`, f);
  }
}

/* 7 — NO PERSONAL ADDRESS WHERE A MEMBER CAN READ IT. Owner ruling 2026-08-06. */
for (const f of appFiles) {
  const m = read(f).match(/[A-Za-z0-9._%+-]+@(gmail|yahoo|hotmail|outlook|proton)\.[a-z]{2,}/i);
  if (m) add("HIGH", "personal-email-exposed", `Personal address in member-readable code (${m[0].replace(/^(.).*@/, "$1***@")})`, f);
}

/* 8 — UNSANITISED HTML INJECTION. */
for (const f of appFiles) {
  const t = read(f);
  // Reviewed exceptions. Written down WITH A REASON rather than quietly
  // dropped, so the next person can disagree with the judgement instead of
  // wondering why the rule does not fire. Anything not listed still fails.
  const HTML_REVIEWED = {
    "src/components/ui/chart.tsx":
      "Builds a CSS string from the developer-defined THEMES/chart config; the interpolated id comes from React's useId(). No member input reaches it. Reviewed 2026-08-06.",
  };
  const key = f.split(path.sep).join("/");
  if (/dangerouslySetInnerHTML/.test(t) && !/DOMPurify|sanitiz/i.test(t) && !HTML_REVIEWED[key])
    add("HIGH", "unsanitised-html", "dangerouslySetInnerHTML with no visible sanitisation", f);
  if (/(?<![\w.])eval\s*\(|new\s+Function\s*\(/.test(t))
    add("HIGH", "dynamic-code-execution", "eval() or new Function() executes attacker-controllable strings", f);
}

/* 9 — NO COMMITTED ENV FILE. */
// A committed .env is only a breach if it holds something secret. This repo
// commits one containing the project URL and the ANON key — both are public by
// design and already ship inside the client bundle. Grading it CRITICAL on the
// filename alone was a false alarm; grade it on what is inside.
const SECRET_NAMES = /SERVICE_ROLE|SECRET|PRIVATE_KEY|PASSWORD|_TOKEN|ACCESS_KEY|API_KEY|SMTP|BREVO|OPENAI|ANTHROPIC|RAZORPAY|STRIPE/i;
for (const f of [".env", ".env.local", ".env.production", ".env.development"]) {
  if (!fs.existsSync(path.join(ROOT, f))) continue;
  const lines = read(f).split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
  const secretish = lines.map((l) => l.split("=")[0].trim()).filter((k) => SECRET_NAMES.test(k));
  if (secretish.length)
    add("CRITICAL", "secret-in-committed-env", `${f} holds secret-shaped keys: ${secretish.join(", ")}`, f);
  else
    add("LOW", "committed-env-public-only", `${f} is committed but holds only public values (project URL, anon key)`, f);
}

/* ── report ───────────────────────────────────────────────────────────────── */
const ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
findings.sort((a, b) => ORDER[a.sev] - ORDER[b.sev]);
const counts = findings.reduce((a, f) => ((a[f.sev] = (a[f.sev] || 0) + 1), a), {});
console.log("── 50mm Retina World · security gate ──");
console.log(`scanned ${appFiles.length} application files\n`);
if (!findings.length) console.log("PASS — no violations.");
for (const f of findings) console.log(`[${f.sev}] ${f.rule}: ${f.detail}\n        ${f.where}`);
console.log(`\nCRITICAL ${counts.CRITICAL || 0} · HIGH ${counts.HIGH || 0} · MEDIUM ${counts.MEDIUM || 0} · LOW ${counts.LOW || 0}`);
const blocking = (counts.CRITICAL || 0) + (counts.HIGH || 0);
if (blocking) { console.error(`\nFAIL — ${blocking} blocking finding(s). Nothing publishes while this is red.`); process.exit(1); }
console.log("\nPASS — no blocking findings.");
