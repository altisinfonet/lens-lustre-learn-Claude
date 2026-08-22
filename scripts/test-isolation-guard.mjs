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
const GUARD_VARS = ["VITE_SUPABASE_URL", "ISOLATION_FORBIDDEN_REFS", "ISOLATION_ALLOW_NO_FORBIDDEN", "ISOLATION_DIST_DIR"];
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
  return d;
}
function expect(name, r, wantExit, wantSnippet) {
  const out = (r.stdout || "") + (r.stderr || "");
  const ok = r.status === wantExit && (!wantSnippet || out.includes(wantSnippet));
  results.push({ name, ok, exit: r.status, out: out.trim().split("\n").pop() });
  return ok;
}
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
];
// EQUIVALENT-REDUNDANT mutations (W4/W5): R2 backstops them, so the end state cannot change.
// Per standing rule 9 the target is RETARGETED, invariant restated: under these mutations the
// guard must STILL fail closed (exit nonzero) — defense-in-depth proven, nothing weakened.
const failClosedMutations = [
  ["W4 empty-dist rule dropped -> must still fail closed (via R2 backstop)",
     src.replace('if (files.length === 0) fail("R4"', 'if (false) fail("R4"'),
     g => runGuard(g, fixture("empty"), stagingEnv).status !== 0],
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
