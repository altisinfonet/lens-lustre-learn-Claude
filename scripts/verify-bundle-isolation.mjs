#!/usr/bin/env node
/**
 * BUNDLE ISOLATION GUARD — verify-bundle-isolation.mjs
 *
 * Fails the build if the produced bundle is wired to the wrong backend.
 * This is the enforcement half of the staging/production boundary:
 * a staging build must NEVER silently contain the production Supabase ref,
 * and a production build must never contain the staging ref.
 *
 * Usage (CI and Pages build command, after `npm run build`):
 *   node scripts/verify-bundle-isolation.mjs
 *
 * Required environment:
 *   VITE_SUPABASE_URL        the URL the build was given (same var Vite baked in)
 *   ISOLATION_FORBIDDEN_REFS comma-separated project refs that must NOT appear
 *                            (production lane: the staging ref, once it exists;
 *                             staging lane: jtdtehuqtinjxropkkcn)
 * Optional:
 *   ISOLATION_DIST_DIR       default "dist"
 *
 * FAIL-CLOSED RULES (each is deliberate; the mutation harness pins them):
 *   R1 VITE_SUPABASE_URL unset/empty            -> exit 1 (a build with no target is wrong)
 *   R2 expected ref not found anywhere in dist  -> exit 1 (env was ignored => .env fallback)
 *   R3 any forbidden ref found anywhere in dist -> exit 1 (cross-environment leak)
 *   R4 dist missing or contains no text assets  -> exit 1 (nothing verified is not a pass)
 *   R5 expected ref listed as forbidden         -> exit 1 (misconfiguration, refuse to run)
 *   R6 ISOLATION_FORBIDDEN_REFS empty           -> exit 1 (a lane that forbids
 *      nothing is not isolated; R2 alone cannot see a cross-environment leak).
 *      This was a WARNING until 2026-08-22 and the production lane shipped with
 *      an empty list, so the one rule that catches a leak was disarmed in the
 *      lane that matters most. Escape hatch, for a deliberate single-lane
 *      build only: ISOLATION_ALLOW_NO_FORBIDDEN=1.
 *
 * HOST RULES, added 2026-08-22 (G5a). R1-R6 police the Supabase project ref and
 * nothing else, so a bundle could name the wrong CDN or the wrong site origin
 * and pass every one of them. These mirror the ref rules exactly:
 *
 *   R7  ISOLATION_EXPECTED_HOST absent from every scanned file -> exit 1
 *   R8  any ISOLATION_FORBIDDEN_HOSTS entry present            -> exit 1
 *   R9  expected host also listed as forbidden                 -> exit 1
 *   R10 ISOLATION_FORBIDDEN_HOSTS empty, no explicit allowance -> exit 1
 *   R12 ISOLATION_EXPECTED_HOST unset, no explicit allowance   -> exit 1
 *
 * R10 reuses ISOLATION_ALLOW_NO_FORBIDDEN rather than adding a second hatch, so
 * there is exactly one way to say "this lane has no counterpart".
 *
 * R12, added 2026-08-23 (G8). R7-R10 were opt-in: a lane that did not name an
 * expected host simply skipped them and printed PASS. That PASS is byte-for-byte
 * as reassuring as one from a lane that was fully checked, so the failure mode
 * was not a red build but a green one that had checked half of what it claimed.
 * A Pages project missing the two host variables is exactly that shape, and it
 * is the likeliest way for them to be missing — nobody deletes them on purpose.
 *
 * R12 gets its OWN hatch rather than reusing ISOLATION_ALLOW_NO_FORBIDDEN,
 * because the two say different things and collapsing them would let one
 * intention silently grant the other: ALLOW_NO_FORBIDDEN says "this lane has no
 * counterpart to forbid", while ALLOW_NO_HOST_RULES says "this build is checked
 * on refs only". A single-lane build legitimately wants the first without the
 * second. The summary line names the hatch when it is used, so a run that
 * skipped R7-R10 can never be mistaken for one that ran them.
 *
 * FUNCTIONS SCANNING, added 2026-08-23 (G5b). Cloudflare Pages Functions have
 * NO build step, so nothing about them appears in dist. Until G5b the guard was
 * blind to them, and functions/_seo.ts carried three production literals that
 * would have shipped into any lane. Extra roots are scanned alongside dist:
 *
 *   R11 a functions/ directory exists but is not among the scanned roots -> exit 1
 *
 * R11 exists because an opt-in scan that CI forgets to request is no scan at
 * all, and the failure would be silent. Escape hatch, for a repository that
 * deliberately has no Pages Functions to guard:
 * ISOLATION_ALLOW_UNSCANNED_FUNCTIONS=1.
 *
 * ⚠ NEVER PUT THE BARE APEX IN A FORBIDDEN LIST. Matching is substring, and
 * `50mmretina.com` is a substring of `staging.50mmretina.com`,
 * `cdn-staging.50mmretina.com` AND `mail@50mmretina.com` - it would flag the
 * staging lane's own hosts and two legitimate email addresses. Forbid the
 * scheme-qualified `https://50mmretina.com`, which does not match
 * `https://staging.50mmretina.com`. R9 refuses a bare apex of the expected host
 * outright, and src/__tests__/laneIsolation.test.ts pins all seven measured
 * cases, so a "simplification" back to bare-apex matching dies rather than
 * merely misbehaving.
 *
 * Overlap between forbidden needles is tolerated - `staging.50mmretina.com` is a
 * substring of `cdn-staging.50mmretina.com`, and in the production lane both are
 * forbidden anyway - but every leak is reported with the NEEDLE THAT MATCHED and
 * the file, so a hit is never misattributed to the wrong host.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const DIST = process.env.ISOLATION_DIST_DIR || "dist";
// Additional source roots scanned alongside dist. Pages Functions are deployed
// from source, so their lane values can only be checked here.
const explicitExtras = (process.env.ISOLATION_EXTRA_DIRS || "")
  .split(",").map(s => s.trim()).filter(Boolean);
const url = (process.env.VITE_SUPABASE_URL || "").trim();
const forbidden = (process.env.ISOLATION_FORBIDDEN_REFS || "")
  .split(",").map(s => s.trim()).filter(Boolean);
const expectedHost = (process.env.ISOLATION_EXPECTED_HOST || "").trim();
const forbiddenHosts = (process.env.ISOLATION_FORBIDDEN_HOSTS || "")
  .split(",").map(s => s.trim()).filter(Boolean);

// .ts is here for the Pages Functions roots: they ship as TypeScript source,
// so a lane literal in them is never compiled away into dist.
const TEXT_EXT = new Set([".html", ".js", ".mjs", ".css", ".json", ".txt", ".webmanifest", ".map", ".svg", ".ts"]);
const fail = (code, msg) => { console.error(`ISOLATION-GUARD FAIL [${code}]: ${msg}`); process.exit(1); };

const m = url.match(/^https:\/\/([a-z0-9]{15,25})\.supabase\.co\/?$/);
if (!m) fail("R1", `VITE_SUPABASE_URL is unset or not a https://<ref>.supabase.co URL (got: "${url}")`);
const expectedRef = m[1];
if (forbidden.includes(expectedRef)) fail("R5", `expected ref "${expectedRef}" is also listed in ISOLATION_FORBIDDEN_REFS`);
if (forbidden.length === 0 && process.env.ISOLATION_ALLOW_NO_FORBIDDEN !== "1")
  fail("R6", "ISOLATION_FORBIDDEN_REFS is empty — a lane that forbids nothing is not isolated. Set the other lane's ref, or ISOLATION_ALLOW_NO_FORBIDDEN=1 to state deliberately that this build has no counterpart lane.");
if (forbidden.length === 0) console.warn("ISOLATION-GUARD WARN: no forbidden refs, explicitly allowed — leak check limited to R2.");

// ⚠ NOT opt-in any more. See R12 in the header: an unset ISOLATION_EXPECTED_HOST
// silently skipped R7-R10 and still printed PASS, which is indistinguishable
// from a lane that was actually checked.
if (expectedHost === "" && process.env.ISOLATION_ALLOW_NO_HOST_RULES !== "1")
  fail("R12", "ISOLATION_EXPECTED_HOST is unset, which would skip R7-R10 entirely and still report PASS — a bundle naming the other lane's CDN or origin would ship. Set this lane's expected host (and ISOLATION_FORBIDDEN_HOSTS), or ISOLATION_ALLOW_NO_HOST_RULES=1 to state deliberately that this build is checked on refs only.");
const hostRulesActive = expectedHost !== "";
if (hostRulesActive) {
  if (forbiddenHosts.includes(expectedHost))
    fail("R9", `expected host "${expectedHost}" is also listed in ISOLATION_FORBIDDEN_HOSTS`);
  if (forbiddenHosts.length === 0 && process.env.ISOLATION_ALLOW_NO_FORBIDDEN !== "1")
    fail("R10", "ISOLATION_FORBIDDEN_HOSTS is empty — a lane that forbids no host is not isolated. Set the other lane's hosts, or ISOLATION_ALLOW_NO_FORBIDDEN=1 to state deliberately that this build has no counterpart lane.");
  // A bare apex of the expected host matches the expected host itself, so it
  // would fail this lane on its own bytes. That is a misconfiguration, not a
  // leak, and it is refused rather than reported as one.
  for (const h of forbiddenHosts) {
    if (expectedHost.endsWith(`.${h}`))
      fail("R9", `forbidden host "${h}" is a parent domain of the expected host "${expectedHost}" — it matches this lane's own host. Forbid the scheme-qualified origin instead.`);
  }
}

if (!existsSync(DIST)) fail("R4", `dist directory "${DIST}" does not exist`);

// Scanning functions/ is ON BY DEFAULT when the directory is there. An opt-in
// scan would have to be requested identically by CI *and* by the Pages build
// command, and the day one of them forgot, the failure would be silence. The
// var stays available for additional roots, and naming any root explicitly
// takes over completely - which is what R11 then polices.
const extraDirs = explicitExtras.length > 0
  ? explicitExtras
  : (existsSync("functions") ? ["functions"] : []);

// R11 — a Pages Functions directory that nobody asked us to scan is a blind
// spot, not an absence of risk. Functions carry lane values in source.
if (existsSync("functions")
    && !extraDirs.some(d => d === "functions" || d.startsWith("functions/"))
    && process.env.ISOLATION_ALLOW_UNSCANNED_FUNCTIONS !== "1") {
  fail("R11", 'a "functions" directory exists but ISOLATION_EXTRA_DIRS names other roots '
    + "and excludes it — Pages Functions have no build step, so nothing about them "
    + "reaches dist and this guard would be blind to a production literal in them. "
    + 'Include "functions" in the list, or set ISOLATION_ALLOW_UNSCANNED_FUNCTIONS=1 '
    + "to state deliberately that this repository has no Pages Functions to guard.");
}

const roots = [DIST, ...extraDirs];
for (const r of extraDirs) {
  if (!existsSync(r)) fail("R4", `scan root "${r}" listed in ISOLATION_EXTRA_DIRS does not exist`);
}
const files = [];
(function walkAll(dirs) {
  for (const dir of dirs) (function walk(d) {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else { const e = extname(name).toLowerCase(); if (TEXT_EXT.has(e) || e === "") files.push(p); } // extensionless (_redirects, _headers) are text artifacts too
    }
  })(dir);
})(roots);
if (files.length === 0) fail("R4", `no text assets found under ${roots.map(r => `"${r}"`).join(", ")} — nothing was verified`);

let expectedSeen = false;
let expectedHostSeen = false;
const leaks = [];
const hostLeaks = [];
for (const f of files) {
  const body = readFileSync(f, "utf8");
  if (body.includes(expectedRef)) expectedSeen = true;
  for (const ref of forbidden) if (body.includes(ref)) leaks.push(`${ref} in ${f}`);
  if (hostRulesActive) {
    if (body.includes(expectedHost)) expectedHostSeen = true;
    // Report the needle that matched, not just the file: forbidden hosts can
    // overlap, and a leak attributed to the wrong host sends the fix elsewhere.
    for (const h of forbiddenHosts) if (body.includes(h)) hostLeaks.push(`${h} in ${f}`);
  }
}
if (leaks.length > 0) fail("R3", `forbidden backend ref(s) present in bundle:\n  ${leaks.join("\n  ")}`);
if (!expectedSeen) fail("R2", `expected ref "${expectedRef}" not found in any bundle asset — the build ignored its environment (committed .env fallback?)`);
if (hostRulesActive) {
  if (hostLeaks.length > 0) fail("R8", `forbidden host(s) present in bundle:\n  ${hostLeaks.join("\n  ")}`);
  if (!expectedHostSeen) fail("R7", `expected host "${expectedHost}" not found in any bundle asset — the build did not use this lane's hosts`);
}

const hostSummary = hostRulesActive
  ? ` host=${expectedHost} present; forbidden-hosts=[${forbiddenHosts.join(",")}] absent;`
  : " host rules DELIBERATELY DISABLED via ISOLATION_ALLOW_NO_HOST_RULES=1 — R7-R10 did not run;";
console.log(`ISOLATION-GUARD PASS: expected=${expectedRef} present; forbidden=[${forbidden.join(",")}] absent;${hostSummary} ${files.length} assets scanned across ${roots.length} root(s): ${roots.join(", ")}.`);
