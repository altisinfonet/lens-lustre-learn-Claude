#!/usr/bin/env node
/**
 * Behavioural + negative + mutation harness for scripts/generate-seo-assets.mjs
 * (G7 indexing policy, 2026-08-23).
 *
 * The generator decides whether a deployed lane is crawlable. That decision is
 * invisible in review — it is one boolean, and both branches "look fine" — and
 * a wrong answer is expensive in both directions: a crawlable staging lane
 * competes with production in search, and a `Disallow: /` on production
 * de-indexes the live site. So it gets executed tests, not inspection.
 *
 * HERMETICITY (Standing Rule 12). Every variable the generator or lane-config
 * reads is stripped from the inherited environment before each run: a harness
 * asserting on the ABSENCE of a variable is void if the parent supplied it.
 * Runs also use a fixture cwd, never the repo root, because the generator
 * reads `dist/` and `public/` relative to cwd.
 *
 * MUTATION DISCIPLINE (Standing Rule 9). Every mutant must be killed by at
 * least one case. An equivalent mutant is RETARGETED with the invariant
 * restated — never deleted.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const GEN = join(HERE, "generate-seo-assets.mjs");
const LANE = join(HERE, "lane-config.mjs");

// Everything lane-config.mjs or the generator reads. Inheriting any of these
// from the parent shell would make the production-default cases meaningless.
const LANE_VARS = ["VITE_SITE_ORIGIN", "VITE_CDN_HOST"];

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(`${name} — ${detail}`); console.log(`  FAIL  ${name} — ${detail}`); }
}

/** A fixture cwd: dist/ plus the repo's real public/ templates. */
function fixture({ withDist = true, withTemplates = true, robotsTpl, sitemapTpl } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "seo-"));
  if (withDist) mkdirSync(join(cwd, "dist"));
  if (withTemplates) {
    mkdirSync(join(cwd, "public"));
    if (robotsTpl === undefined) copyFileSync(join(ROOT, "public/robots.txt"), join(cwd, "public/robots.txt"));
    else writeFileSync(join(cwd, "public/robots.txt"), robotsTpl);
    if (sitemapTpl === undefined) copyFileSync(join(ROOT, "public/sitemap.xml"), join(cwd, "public/sitemap.xml"));
    else writeFileSync(join(cwd, "public/sitemap.xml"), sitemapTpl);
  }
  return cwd;
}

function run(genPath, cwd, env = {}) {
  const base = { ...process.env };
  for (const v of LANE_VARS) delete base[v];
  const r = spawnSync(process.execPath, [genPath], { cwd, env: { ...base, ...env }, encoding: "utf8" });
  const read = (f) => (existsSync(join(cwd, "dist", f)) ? readFileSync(join(cwd, "dist", f), "utf8") : null);
  return { code: r.status, out: (r.stdout || "") + (r.stderr || ""), robots: read("robots.txt"), sitemap: read("sitemap.xml") };
}

// A blanket disallow: `User-agent: *` whose group contains `Disallow: /`.
function blanketDisallow(robots) {
  if (!robots) return false;
  const lines = robots.split("\n").map((l) => l.trim());
  let inStar = false, found = false;
  for (const l of lines) {
    if (/^user-agent:/i.test(l)) inStar = /^user-agent:\s*\*$/i.test(l);
    else if (inStar && /^disallow:\s*\/\s*$/i.test(l)) found = true;
  }
  return found;
}
const sitemapLines = (r) => (r ? r.split("\n").filter((l) => /^\s*sitemap:/i.test(l)).length : -1);
const locCount = (s) => (s ? (s.match(/<loc>/g) || []).length : -1);

const PROD_ROBOTS_EXPECT = "https://50mmretina.com";

/** The full case set. `gen` lets mutants reuse it unchanged. */
function runCases(gen, { quiet = false } = {}) {
  const results = {};
  const record = (name, cond, detail) => {
    results[name] = cond;
    if (!quiet) check(name, cond, detail);
  };

  // ---- GREEN: the production lane, in every spelling that reaches it -------
  const c1 = fixture(); const r1 = run(gen, c1, {});
  record("GREEN-1 production by default (VITE_SITE_ORIGIN unset) is indexable",
    r1.code === 0 && !blanketDisallow(r1.robots) && sitemapLines(r1.robots) === 1 &&
    (r1.robots || "").includes(PROD_ROBOTS_EXPECT) && locCount(r1.sitemap) > 0,
    `code=${r1.code} blanket=${blanketDisallow(r1.robots)} sitemapLines=${sitemapLines(r1.robots)} locs=${locCount(r1.sitemap)}`);

  const c2 = fixture(); const r2 = run(gen, c2, { VITE_SITE_ORIGIN: "https://www.50mmretina.com" });
  record("GREEN-2 explicit www origin is byte-identical to the default",
    r2.robots === r1.robots && r2.sitemap === r1.sitemap, "differs from GREEN-1");

  const c3 = fixture(); const r3 = run(gen, c3, { VITE_SITE_ORIGIN: "https://www.50mmretina.com/" });
  record("GREEN-3 trailing slash is normalised, not a new lane",
    r3.robots === r1.robots && r3.sitemap === r1.sitemap, "differs from GREEN-1");

  // The regression this file exists for: the apex and www are ONE site.
  const c4 = fixture(); const r4 = run(gen, c4, { VITE_SITE_ORIGIN: "https://50mmretina.com" });
  record("GREEN-4 bare apex is production, NOT a lane to de-index",
    r4.code === 0 && r4.robots === r1.robots && r4.sitemap === r1.sitemap,
    `code=${r4.code} blanket=${blanketDisallow(r4.robots)} — apex was classed non-production`);

  // ---- GREEN: non-production lanes ---------------------------------------
  const c5 = fixture(); const r5 = run(gen, c5, { VITE_SITE_ORIGIN: "https://staging.50mmretina.com" });
  record("GREEN-5 staging emits a blanket Disallow and no sitemap reference",
    r5.code === 0 && blanketDisallow(r5.robots) && sitemapLines(r5.robots) === 0 && locCount(r5.sitemap) === 0,
    `code=${r5.code} blanket=${blanketDisallow(r5.robots)} sitemapLines=${sitemapLines(r5.robots)} locs=${locCount(r5.sitemap)}`);

  // ⚠ THE PRODUCTION HOST IS BUILT BY CONCATENATION, NOT WRITTEN WHOLE.
  // The relay that carries this file between sessions autolinks bare hostnames,
  // and it has rewritten this exact literal into a markdown link three times -
  // which turns the clause into `.includes("[host](https://host)")`, a needle
  // that is never present and therefore an assertion that always passes.
  // Splitting the string puts it beyond that rewrite. Mutant M15 proves the
  // clause is live rather than merely present.
  const PROD_HOST_IN_ROBOTS = "//" + "www." + "50mmretina.com";
  record("GREEN-6 staging robots names its own lane, never production",
    (r5.robots || "").includes("staging.50mmretina.com") && !(r5.robots || "").includes(PROD_HOST_IN_ROBOTS),
    "lane origin missing or production origin leaked into staging robots");

  const c7 = fixture(); const r7 = run(gen, c7, { VITE_SITE_ORIGIN: "https://lens-lustre-learn.pages.dev" });
  record("GREEN-7 a pages.dev preview lane is non-production",
    r7.code === 0 && blanketDisallow(r7.robots) && sitemapLines(r7.robots) === 0, `code=${r7.code}`);

  // The www-strip must not swallow a subdomain that merely starts with www.
  const c8 = fixture(); const r8 = run(gen, c8, { VITE_SITE_ORIGIN: "https://www.staging.50mmretina.com" });
  record("GREEN-8 a www-prefixed staging subdomain is non-production (www-strip is not greedy)",
    r8.code === 0 && blanketDisallow(r8.robots), `code=${r8.code} blanket=${blanketDisallow(r8.robots)}`);

  // A suffix look-alike: any host merely ENDING in the production apex must be
  // non-production. Full-host equality after the www-strip is what makes this
  // safe; an .endsWith() refactor would hand indexable output to this host.
  const c9 = fixture(); const r9 = run(gen, c9, { VITE_SITE_ORIGIN: "https://50mmretina.com.evil.test" });
  record("GREEN-9 a suffix look-alike host is non-production",
    r9.code === 0 && blanketDisallow(r9.robots), `code=${r9.code} blanket=${blanketDisallow(r9.robots)}`);

  // ---- RED: refusals ------------------------------------------------------
  const cA = fixture({ withDist: false }); const rA = run(gen, cA, {});
  record("RED-1 missing dist/ refuses", rA.code === 1 && /dist\/ missing/.test(rA.out), `code=${rA.code}`);

  const cB = fixture({ withTemplates: false }); const rB = run(gen, cB, {});
  record("RED-2 production lane with no template refuses",
    rB.code === 1 && /public\/robots\.txt missing/.test(rB.out), `code=${rB.code}`);

  const cC = fixture(); const rC = run(gen, cC, { VITE_SITE_ORIGIN: "" });
  record("RED-3 empty VITE_SITE_ORIGIN refuses, never silently defaults",
    rC.code !== 0 && /set but empty/.test(rC.out), `code=${rC.code}`);

  const cD = fixture(); const rD = run(gen, cD, { VITE_SITE_ORIGIN: "http://staging.50mmretina.com" });
  record("RED-4 non-https origin refuses", rD.code !== 0 && /not an https origin/.test(rD.out), `code=${rD.code}`);

  const cE = fixture({ robotsTpl: "User-agent: *\nSitemap: __SITE_ORIGIN__/sitemap.xml\nX: __UNKNOWN_TOKEN__\n" });
  const rE = run(gen, cE, {});
  record("RED-5 an unsubstituted placeholder refuses",
    rE.code === 1 && /unsubstituted placeholder/.test(rE.out), `code=${rE.code}`);

  const cF = fixture({ sitemapTpl: '<?xml version="1.0"?>\n<urlset><url><loc>https://evil.example/x</loc></url></urlset>\n' });
  const rF = run(gen, cF, {});
  record("RED-6 a sitemap naming a foreign origin refuses",
    rF.code === 1 && /names other origins/.test(rF.out), `code=${rF.code}`);

  for (const d of [c1,c2,c3,c4,c5,c7,c8,c9,cA,cB,cC,cD,cE,cF]) rmSync(d, { recursive: true, force: true });
  return results;
}

// ---------------------------------------------------------------------------
console.log("BASELINE — unmutated generator\n");
const baseline = runCases(GEN);
if (fail > 0) {
  console.log(`\nBASELINE RED (${fail} failing). Refusing to run mutations over a red baseline:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Mutants. Each must be killed by at least one case above.
const MUTANTS = [
  ["M1  non-production branch deleted (pre-G7 behaviour)", (s) => s.replace(/\nif \(!isProduction\) \{[\s\S]*?\n\}\n/, "\n")],
  ["M2  branch condition inverted", (s) => s.replace("if (!isProduction) {", "if (isProduction) {")],
  ["M3  classification reverted to strict origin equality", (s) => s.replace(/const isProduction = .*;/, "const isProduction = siteOrigin === PRODUCTION_SITE_ORIGIN;")],
  ["M4  www-strip dropped from the lane host", (s) => s.replace('siteHost.replace(/^www\\./, "")', "siteHost")],
  ["M5  www-strip dropped from the production host", (s) => s.replace('PRODUCTION_SITE_ORIGIN.replace(/^https?:\\/\\//, "").replace(/^www\\./, "")', 'PRODUCTION_SITE_ORIGIN.replace(/^https?:\\/\\//, "")')],
  ["M6  Disallow weakened to Allow", (s) => s.replace('"\\nUser-agent: *\\nDisallow: /\\n"', '"\\nUser-agent: *\\nAllow: /\\n"')],
  ["M7  blanket narrowed to a single agent", (s) => s.replace("\\nUser-agent: *\\nDisallow: /\\n", "\\nUser-agent: Googlebot\\nDisallow: /\\n")],
  ["M8  a Sitemap: line re-added to the blocked robots", (s) => s.replace('"\\nUser-agent: *\\nDisallow: /\\n"', '`\\nSitemap: ${siteOrigin}/sitemap.xml\\nUser-agent: *\\nDisallow: /\\n`')],
  ["M9  non-production sitemap populated instead of empty", (s) => s.replace("</urlset>", "<url><loc>https://x.test/</loc></url></urlset>")],
  ["M10 early exit removed so templating overwrites the block", (s) => s.replace("  process.exit(0);\n}", "}")],
  ["M11 unsubstituted-placeholder check removed", (s) => s.replace(/  if \(leftover\) \{[\s\S]*?\n  \}\n/, "\n")],
  ["M12 stray-origin sitemap check removed", (s) => s.replace(/if \(strayOrigins\.length\) \{[\s\S]*?\n\}\n/, "\n")],
  ["M13 dist existence check removed", (s) => s.replace(/if \(!existsSync\("dist"\)\) \{[\s\S]*?\n\}\n/, "\n")],
  ["M14 classification compares the origin instead of the host", (s) => s.replace("const isProduction = siteHost", "const isProduction = siteOrigin")],
  // The mutant GREEN-6's comment names, and it targets GREEN-6's SECOND clause
  // specifically. It ADDS a production reference while leaving the lane origin
  // line in place, so the first clause still passes; and it leaves every other
  // property correct — blanket Disallow intact, no Sitemap: line, empty
  // sitemap — so no other case can catch it either. Only the second clause can.
  //
  // ⚠ MEASURED, AND THE FIRST ATTEMPT WAS WRONG. This mutant originally
  // REPLACED the lane origin with the production one, which also removed
  // "staging..." from the file — so GREEN-6's first clause killed it and the
  // second was never exercised. It died either way, autolinked needle or not,
  // and proved nothing. A mutant that dies for the wrong reason is worse than
  // no mutant: it reads as coverage. The production host is built by
  // concatenation here for the same reason it is in GREEN-6.
  ["M15 blocked robots also names the production origin (GREEN-6 clause 2 only)",
     (s) => s.replace(
       '"# Generated by scripts/generate-seo-assets.mjs. The production lane is the\\n" +',
       '"# Canonical: https://" + "www." + "50mmretina.com\\n" + "# Generated by scripts/generate-seo-assets.mjs. The production lane is the\\n" +')],
];

/**
 * Cases that legitimately kill no mutant. Declared, not discovered: a case that
 * kills nothing is either guarding something no mutant models, or asserting
 * nothing at all — and those two look identical on a green report. Naming the
 * expected four turns the second kind into a failure instead of a silent pass.
 *
 *   GREEN-2, GREEN-3  assert equality with GREEN-1's output. Any mutation that
 *     changes the generated bytes changes them for GREEN-1 too, so GREEN-1 fails
 *     first and these never get to be the killer. They guard normalisation —
 *     www-vs-default and the trailing slash — which no mutant models.
 *   RED-3, RED-4      exercise validation that lives in lane-config.mjs, not in
 *     the generator. Only the generator is mutated, so nothing here can kill
 *     through them.
 *
 * A case NOT on this list that kills nothing fails the run.
 */
const EXPECTED_NON_KILLING = new Set(["GREEN-2", "GREEN-3", "RED-3", "RED-4"]);

console.log("\nMUTATIONS — each must be killed\n");
const src = readFileSync(GEN, "utf8");
let killed = 0, survived = [];
const killers = new Set();
for (const [name, mutate] of MUTANTS) {
  const mutated = mutate(src);
  if (mutated === src) { survived.push(`${name} (MUTATION DID NOT APPLY — the harness is testing nothing)`); console.log(`  SURVIVED  ${name}  <- mutation did not apply`); continue; }
  const dir = mkdtempSync(join(tmpdir(), "mut-"));
  copyFileSync(LANE, join(dir, "lane-config.mjs"));
  const mgen = join(dir, "generate-seo-assets.mjs");
  writeFileSync(mgen, mutated);
  const res = runCases(mgen, { quiet: true });
  const dead = Object.entries(res).filter(([, ok]) => !ok).map(([n]) => n.split(" ")[0]);
  rmSync(dir, { recursive: true, force: true });
  if (dead.length) { killed++; for (const d of dead) killers.add(d); console.log(`  KILLED    ${name}  by ${dead.join(", ")}`); }
  else { survived.push(name); console.log(`  SURVIVED  ${name}`); }
}

// Which cases did no killing this run — reported every time, never inferred by
// a reader counting kill lists by eye.
const idle = Object.keys(baseline)
  .map((n) => n.split(" ")[0])
  .filter((c) => !killers.has(c));
const unexpectedIdle = idle.filter((c) => !EXPECTED_NON_KILLING.has(c));
console.log(`\nCASES THAT KILLED NOTHING: ${idle.length ? idle.join(", ") : "(none)"}`);
if (unexpectedIdle.length) {
  console.log(`  UNDECLARED: ${unexpectedIdle.join(", ")} — a case that kills no mutant is`);
  console.log("  either guarding something unmodelled or asserting nothing. Add a mutant that");
  console.log("  it kills, or declare it in EXPECTED_NON_KILLING with the reason.");
}

console.log(`\n${pass} case(s) passed, ${fail} failed. Mutants killed ${killed}/${MUTANTS.length}.`);
if (fail || survived.length || unexpectedIdle.length) {
  for (const s of survived) console.log(`  SURVIVING MUTANT: ${s}`);
  for (const c of unexpectedIdle) console.log(`  UNDECLARED NON-KILLING CASE: ${c}`);
  process.exit(1);
}
console.log("SEO-ASSETS HARNESS PASS");
