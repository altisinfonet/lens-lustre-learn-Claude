#!/usr/bin/env node
/** RED + mutation harness for verify-bundle-isolation.mjs.
 *  Refuses to certify on a red baseline: every expectation is asserted, and
 *  five mutations of the guard must each be DETECTED (i.e. the mutated guard
 *  lets a bad bundle through or blocks a good one, and this harness notices).
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const GUARD = new URL("./verify-bundle-isolation.mjs", import.meta.url).pathname;
const PROD = "jtdtehuqtinjxropkkcn";
const STAG = "stgabcdefghijklmnopq"; // synthetic 20-char staging ref
const results = [];
/** ⚠ THE HARNESS MUST BE HERMETIC, AND ONCE WAS NOT.
 *
 *  Several cases test what the guard does when a variable is ABSENT. Inheriting
 *  process.env makes that untestable the moment something upstream sets it: the
 *  lane-aware build job carries VITE_SUPABASE_URL and ISOLATION_FORBIDDEN_REFS
 *  at job level, and on 2026-08-22 those leaked in and turned RED-3 into an R2
 *  and RED-8 into an R5 — two cases quietly asserting the wrong rule, on a
 *  harness whose whole job is to notice exactly that.
 *
 *  So the guard's own variables are stripped from the inherited environment and
 *  each case states everything it needs. Anything not named by a case is absent,
 *  wherever the harness runs. */
const GUARD_VARS = ["VITE_SUPABASE_URL", "ISOLATION_FORBIDDEN_REFS", "ISOLATION_ALLOW_NO_FORBIDDEN", "ISOLATION_DIST_DIR",
  // Added with the host rules (G5a). EVERY new guard variable must be listed
  // here: the CI build job now sets these too, and an inherited value would
  // silently satisfy a case written to test their absence - the exact failure
  // that turned RED-3 and RED-8 into the wrong assertions on 2026-08-22.
  "ISOLATION_EXPECTED_HOST", "ISOLATION_FORBIDDEN_HOSTS"];
function runGuard(guardPath, dist, env) {
  const base = { ...process.env };
  for (const v of GUARD_VARS) delete base[v];
  return spawnSync(process.execPath, [guardPath], {
    env: { ...base, ISOLATION_DIST_DIR: dist, ...env }, encoding: "utf8" });
}
function fixture(kind) {
  const d = mkdtempSync(join(tmpdir(), "dist-"));
  mkdirSync(join(d, "assets"), { recursive: true });
  const put = (f, s) => writeFileSync(join(d, f), s);
  if (kind === "staging-clean")   { put("index.html", `<link rel="preconnect" href="https://${STAG}.supabase.co">`); put("assets/app.js", `const u="https://${STAG}.supabase.co";`); }
  if (kind === "staging-leaky")   { put("index.html", `<link rel="preconnect" href="https://${PROD}.supabase.co">`); put("assets/app.js", `const u="https://${STAG}.supabase.co";const bad="https://${PROD}.supabase.co";`); }
  if (kind === "env-ignored")     { put("index.html", "<html></html>"); put("assets/app.js", `const u="https://thirdprojectref9999x.supabase.co";`); } // env ignored: bundle holds neither expected nor forbidden ref
  if (kind === "prod-clean")      { put("index.html", `<link rel="preconnect" href="https://${PROD}.supabase.co">`); put("assets/app.js", `const u="https://${PROD}.supabase.co";`); }
  if (kind === "empty")           { /* nothing */ }
  if (kind === "redirects-leak") { put("index.html", `ok https://${STAG}.supabase.co`); put("_redirects", `/sitemap.xml https://${PROD}.supabase.co/functions/v1/sitemap 200`); }
  if (kind === "split-css-js")    { put("assets/style.css", `/* ${STAG} marker: https://${STAG}.supabase.co */`); put("assets/app.js", `const bad="https://${PROD}.supabase.co";`); }
  // --- host fixtures (G5a) ---
  if (kind === "host-staging-clean") { put("index.html", `<img src="https://cdn-staging.50mmretina.com/x.jpg">`); put("assets/app.js", `const u="https://${STAG}.supabase.co";const h="https://staging.50mmretina.com";`); }
  if (kind === "host-staging-leaky") { put("index.html", `<img src="https://cdn-staging.50mmretina.com/x.jpg">`); put("assets/app.js", `const u="https://${STAG}.supabase.co";const bad="https://cdn.50mmretina.com/y.jpg";`); }
  if (kind === "host-prod-clean")    { put("index.html", `<img src="https://cdn.50mmretina.com/x.jpg">`); put("assets/app.js", `const u="https://${PROD}.supabase.co";const h="https://www.50mmretina.com";`); }
  if (kind === "host-missing")       { put("index.html", `<html></html>`); put("assets/app.js", `const u="https://${STAG}.supabase.co";`); }
  // The email addresses a bare-apex forbidden list would wrongly flag.
  if (kind === "host-staging-emails"){ put("index.html", `<a href="mailto:mail@50mmretina.com">c</a><img src="https://cdn-staging.50mmretina.com/x.jpg">`); put("assets/app.js", `const u="https://${STAG}.supabase.co";const n="noreply@50mmretina.com";`); }
  return d;
}
function expect(name, r, wantExit, wantSnippet) {
  const out = (r.stdout || "") + (r.stderr || "");
  const ok = r.status === wantExit && (!wantSnippet || out.includes(wantSnippet));
  results.push({ name, ok, exit: r.status, out: out.trim().split("\n").pop() });
  return ok;
}
// Real hosts, because the substring traps are properties of these exact strings.
const PROD_HOST = "cdn.50mmretina.com";
const STAG_HOST = "cdn-staging.50mmretina.com";
const PROD_ORIGIN = "https://50mmretina.com";
const STAG_ORIGIN_HOST = "staging.50mmretina.com";
const APEX = "50mmretina.com";

const stagingEnv = { VITE_SUPABASE_URL: `https://${STAG}.supabase.co`, ISOLATION_FORBIDDEN_REFS: PROD };
const prodEnv    = { VITE_SUPABASE_URL: `https://${PROD}.supabase.co`, ISOLATION_FORBIDDEN_REFS: STAG };

// ---- BASELINE (RED first: the leak cases must FAIL before anything passes) ----
expect("RED-1 staging bundle containing production ref -> FAIL R3", runGuard(GUARD, fixture("staging-leaky"), stagingEnv), 1, "[R3]");
expect("RED-2 staging build that ignored env (.env fallback shape) -> FAIL R2", runGuard(GUARD, fixture("env-ignored"), stagingEnv), 1, "[R2]");
expect("RED-3 VITE_SUPABASE_URL unset -> FAIL R1", runGuard(GUARD, fixture("staging-clean"), { ISOLATION_FORBIDDEN_REFS: PROD }), 1, "[R1]");
expect("RED-4 empty dist -> FAIL R4", runGuard(GUARD, fixture("empty"), stagingEnv), 1, "[R4]");
expect("RED-5 expected ref also forbidden -> FAIL R5", runGuard(GUARD, fixture("staging-clean"), { VITE_SUPABASE_URL: `https://${STAG}.supabase.co`, ISOLATION_FORBIDDEN_REFS: `${PROD},${STAG}` }), 1, "[R5]");
expect("RED-6 leak in extensionless _redirects -> FAIL R3", runGuard(GUARD, fixture("redirects-leak"), stagingEnv), 1, "[R3]");
expect("GREEN-1 clean staging bundle -> PASS", runGuard(GUARD, fixture("staging-clean"), stagingEnv), 0, "ISOLATION-GUARD PASS");
expect("GREEN-2 clean production bundle (inverse lane) -> PASS", runGuard(GUARD, fixture("prod-clean"), prodEnv), 0, "ISOLATION-GUARD PASS");
// R6, added 2026-08-22. An empty forbidden list used to be a warning, and the
// production lane shipped with exactly that - so the only rule that can see a
// cross-environment leak was switched off in the lane that matters most.
expect("RED-7 no forbidden refs, no escape hatch -> FAIL R6", runGuard(GUARD, fixture("prod-clean"), { VITE_SUPABASE_URL: `https://${PROD}.supabase.co`, ISOLATION_FORBIDDEN_REFS: "" }), 1, "[R6]");
expect("RED-8 forbidden var absent entirely -> FAIL R6", runGuard(GUARD, fixture("prod-clean"), { VITE_SUPABASE_URL: `https://${PROD}.supabase.co` }), 1, "[R6]");
expect("GREEN-3 no forbidden refs WITH explicit escape hatch -> PASS", runGuard(GUARD, fixture("prod-clean"), { VITE_SUPABASE_URL: `https://${PROD}.supabase.co`, ISOLATION_FORBIDDEN_REFS: "", ISOLATION_ALLOW_NO_FORBIDDEN: "1" }), 0, "ISOLATION-GUARD PASS");

// ---- HOST RULES R7-R10, added 2026-08-22 (G5a) ----
// The lane environments exactly as CI supplies them.
const stagingHostEnv = { ...stagingEnv, ISOLATION_EXPECTED_HOST: STAG_HOST, ISOLATION_FORBIDDEN_HOSTS: `${PROD_HOST},www.50mmretina.com,${PROD_ORIGIN}` };
const prodHostEnv    = { ...prodEnv,    ISOLATION_EXPECTED_HOST: PROD_HOST, ISOLATION_FORBIDDEN_HOSTS: `${STAG_HOST},${STAG_ORIGIN_HOST}` };

expect("RED-9 staging bundle containing the production CDN host -> FAIL R8", runGuard(GUARD, fixture("host-staging-leaky"), stagingHostEnv), 1, "[R8]");
expect("RED-10 expected host absent from the bundle -> FAIL R7", runGuard(GUARD, fixture("host-missing"), stagingHostEnv), 1, "[R7]");
expect("RED-11 expected host also listed as forbidden -> FAIL R9", runGuard(GUARD, fixture("host-staging-clean"), { ...stagingEnv, ISOLATION_EXPECTED_HOST: STAG_HOST, ISOLATION_FORBIDDEN_HOSTS: `${PROD_HOST},${STAG_HOST}` }), 1, "[R9]");
expect("RED-12 forbidden hosts empty, no escape hatch -> FAIL R10", runGuard(GUARD, fixture("host-staging-clean"), { ...stagingEnv, ISOLATION_EXPECTED_HOST: STAG_HOST, ISOLATION_FORBIDDEN_HOSTS: "" }), 1, "[R10]");
expect("RED-13 forbidden-hosts var absent entirely -> FAIL R10", runGuard(GUARD, fixture("host-staging-clean"), { ...stagingEnv, ISOLATION_EXPECTED_HOST: STAG_HOST }), 1, "[R10]");
// ⚠ THE TRAP, AS A RULE: a bare apex is a parent of the expected host, so it
// would fail this lane on its own bytes. Refused as misconfiguration, not
// reported as a leak.
expect("RED-14 bare apex forbidden while expecting a subdomain -> FAIL R9", runGuard(GUARD, fixture("host-staging-clean"), { ...stagingEnv, ISOLATION_EXPECTED_HOST: STAG_HOST, ISOLATION_FORBIDDEN_HOSTS: APEX }), 1, "[R9]");

expect("GREEN-4 clean staging bundle with host rules -> PASS", runGuard(GUARD, fixture("host-staging-clean"), stagingHostEnv), 0, "ISOLATION-GUARD PASS");
expect("GREEN-5 clean production bundle with host rules (inverse lane) -> PASS", runGuard(GUARD, fixture("host-prod-clean"), prodHostEnv), 0, "ISOLATION-GUARD PASS");
// The allowed email addresses must NOT trip the staging lane. This is the case
// a bare-apex forbidden list would break.
expect("GREEN-6 staging bundle with mail@/noreply@ addresses -> PASS", runGuard(GUARD, fixture("host-staging-emails"), stagingHostEnv), 0, "ISOLATION-GUARD PASS");
expect("GREEN-7 host rules inactive when no expected host is named -> PASS", runGuard(GUARD, fixture("staging-clean"), stagingEnv), 0, "host rules inactive");

if (results.some(r => !r.ok)) { report(); console.error("\nBASELINE RED — refusing to run mutations over a failing baseline."); process.exit(1); }

// ---- MUTATIONS: each mutated guard must be DETECTED by these fixtures ----
const src = readFileSync(GUARD, "utf8");
// KILL mutations: the mutated guard must let a bad bundle PASS (escape), which this harness detects.
const killMutations = [
  ["W1 forbidden scan removed",            src.replace("if (body.includes(ref)) leaks.push", "if (false) leaks.push"),
     g => runGuard(g, fixture("staging-leaky"), stagingEnv).status === 0],
  ["W2 expected-ref check inverted",       src.replace("if (!expectedSeen)", "if (expectedSeen && false)"),
     g => runGuard(g, fixture("env-ignored"), stagingEnv).status === 0],
  ["W3 fail() no longer exits nonzero",    src.replace("process.exit(1);", "process.exit(0);"),
     g => runGuard(g, fixture("staging-leaky"), stagingEnv).status === 0],
  ["W6 scan scope narrowed to .css only",  src.replace(/const TEXT_EXT = new Set\(\[[^\]]*\]\);/, 'const TEXT_EXT = new Set([".css"]);'),
     g => runGuard(g, fixture("split-css-js"), stagingEnv).status === 0],
  // W7: R6 reverted to the warning it used to be. The mutant lets a lane that
  // forbids nothing build cleanly - precisely the state the production lane was
  // in before 2026-08-22 - so the harness must catch the escape.
  ["W7 R6 downgraded back to a warning",
     src.replace(/if \(forbidden\.length === 0 && process\.env\.ISOLATION_ALLOW_NO_FORBIDDEN !== "1"\)\n  fail\("R6",[^;]*;/, 'if (false) fail("R6", "disarmed");'),
     g => runGuard(g, fixture("prod-clean"), { VITE_SUPABASE_URL: `https://${PROD}.supabase.co`, ISOLATION_FORBIDDEN_REFS: "" }).status === 0],

  // --- host rules R7-R10 (G5a). One kill mutation per rule, plus the trap. ---
  ["W8 R7 removed - expected host never checked",
     src.replace('if (!expectedHostSeen) fail("R7"', 'if (false) fail("R7"'),
     g => runGuard(g, fixture("host-missing"), stagingHostEnv).status === 0],
  ["W9 R8's forbidden-host scan removed",
     src.replace("for (const h of forbiddenHosts) if (body.includes(h)) hostLeaks.push", "for (const h of forbiddenHosts) if (false) hostLeaks.push"),
     g => runGuard(g, fixture("host-staging-leaky"), stagingHostEnv).status === 0],
  ["W11 R10 downgraded to a warning, exactly as W7 does for R6",
     src.replace(/if \(forbiddenHosts\.length === 0 && process\.env\.ISOLATION_ALLOW_NO_FORBIDDEN !== "1"\)\n    fail\("R10",[^;]*;/, 'if (false) fail("R10", "disarmed");'),
     g => runGuard(g, fixture("host-staging-clean"), { ...stagingEnv, ISOLATION_EXPECTED_HOST: STAG_HOST, ISOLATION_FORBIDDEN_HOSTS: "" }).status === 0],
  // ⚠ THE TRAP AS A MUTANT. Replacing the apex guard with permissive matching
  // lets a bare apex into the forbidden list, where it matches the staging
  // lane's OWN host - the clean staging bundle then fails on its own bytes.
  // Killed by that false failure, not by an escape.
  ["W12 apex guard removed - bare apex accepted into the forbidden list",
     src.replace("    if (expectedHost.endsWith(`.${h}`))", "    if (false)"),
     g => !((runGuard(g, fixture("host-staging-clean"), { ...stagingEnv, ISOLATION_EXPECTED_HOST: STAG_HOST, ISOLATION_FORBIDDEN_HOSTS: APEX }).stderr || "").includes("[R9]"))],
];
// EQUIVALENT-REDUNDANT mutations (W4/W5): R2 backstops them, so the end state cannot change.
// Per standing rule 9 the target is RETARGETED, invariant restated: under these mutations the
// guard must STILL fail closed (exit nonzero) — defense-in-depth proven, nothing weakened.
const failClosedMutations = [
  ["W4 empty-dist rule dropped -> must still fail closed (via R2 backstop)",
     src.replace('if (files.length === 0) fail("R4"', 'if (false) fail("R4"'),
     g => runGuard(g, fixture("empty"), stagingEnv).status !== 0],
  // ⚠ W10 RETARGETED, NOT DELETED (standing rule 9). It was written as a kill:
  // "drop R9 and a misconfigured lane sails through". Measured, it does not -
  // with R9 gone the run still refuses, via R8 when the expected host is present
  // and via R7 when it is absent. R9 is a DIAGNOSTIC rule, exactly like R5 for
  // refs: it turns a confusing downstream failure into one that names the
  // misconfiguration. The invariant it protects is therefore not "a hole opens"
  // but "the guard still refuses" - which is what this now asserts.
  ["W10 R9 dropped -> a lane forbidding its own host must STILL fail closed (via R8/R7)",
     src.replace('if (forbiddenHosts.includes(expectedHost))\n    fail("R9"', 'if (false)\n    fail("R9"'),
     g => runGuard(g, fixture("host-staging-clean"), { ...stagingEnv, ISOLATION_EXPECTED_HOST: STAG_HOST, ISOLATION_FORBIDDEN_HOSTS: `${PROD_HOST},${STAG_HOST}` }).status !== 0],
  ["W5 URL validation loosened -> garbage URL must still fail closed (via R2 backstop)",
     src.replace(/const m = url.match\([^\n]+\);/, 'const m = ["", url.replace(/[^a-z0-9]/g, "").slice(0,20) || "x"];'),
     g => runGuard(g, fixture("staging-clean"), { VITE_SUPABASE_URL: "http://evil.example", ISOLATION_FORBIDDEN_REFS: PROD }).status !== 0],
];
let detected = 0;
const mutTotal = killMutations.length + failClosedMutations.length;
for (const [name, mutated, check] of [...killMutations, ...failClosedMutations]) {
  const mp = join(mkdtempSync(join(tmpdir(), "mut-")), "guard.mjs");
  writeFileSync(mp, mutated);
  const ok = check(mp);
  results.push({ name: `MUT ${name}`, ok, exit: ok ? "DETECTED/HELD" : "NOT-DETECTED", out: "" });
  if (ok) detected++;
}
function report() {
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.out ? "  | " + r.out : ""}`);
}
report();
console.log(`\nMutations detected/held: ${detected}/${mutTotal}`);
process.exit(results.every(r => r.ok) && detected === mutTotal ? 0 : 1);
