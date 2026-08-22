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
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const DIST = process.env.ISOLATION_DIST_DIR || "dist";
const url = (process.env.VITE_SUPABASE_URL || "").trim();
const forbidden = (process.env.ISOLATION_FORBIDDEN_REFS || "")
  .split(",").map(s => s.trim()).filter(Boolean);

const TEXT_EXT = new Set([".html", ".js", ".mjs", ".css", ".json", ".txt", ".webmanifest", ".map", ".svg"]);
const fail = (code, msg) => { console.error(`ISOLATION-GUARD FAIL [${code}]: ${msg}`); process.exit(1); };

const m = url.match(/^https:\/\/([a-z0-9]{15,25})\.supabase\.co\/?$/);
if (!m) fail("R1", `VITE_SUPABASE_URL is unset or not a https://<ref>.supabase.co URL (got: "${url}")`);
const expectedRef = m[1];
if (forbidden.includes(expectedRef)) fail("R5", `expected ref "${expectedRef}" is also listed in ISOLATION_FORBIDDEN_REFS`);
if (forbidden.length === 0 && process.env.ISOLATION_ALLOW_NO_FORBIDDEN !== "1")
  fail("R6", "ISOLATION_FORBIDDEN_REFS is empty — a lane that forbids nothing is not isolated. Set the other lane's ref, or ISOLATION_ALLOW_NO_FORBIDDEN=1 to state deliberately that this build has no counterpart lane.");
if (forbidden.length === 0) console.warn("ISOLATION-GUARD WARN: no forbidden refs, explicitly allowed — leak check limited to R2.");

if (!existsSync(DIST)) fail("R4", `dist directory "${DIST}" does not exist`);
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else { const e = extname(name).toLowerCase(); if (TEXT_EXT.has(e) || e === "") files.push(p); } // extensionless (_redirects, _headers) are text artifacts too
  }
})(DIST);
if (files.length === 0) fail("R4", `no text assets found under "${DIST}" — nothing was verified`);

let expectedSeen = false;
const leaks = [];
for (const f of files) {
  const body = readFileSync(f, "utf8");
  if (body.includes(expectedRef)) expectedSeen = true;
  for (const ref of forbidden) if (body.includes(ref)) leaks.push(`${ref} in ${f}`);
}
if (leaks.length > 0) fail("R3", `forbidden backend ref(s) present in bundle:\n  ${leaks.join("\n  ")}`);
if (!expectedSeen) fail("R2", `expected ref "${expectedRef}" not found in any bundle asset — the build ignored its environment (committed .env fallback?)`);

console.log(`ISOLATION-GUARD PASS: expected=${expectedRef} present; forbidden=[${forbidden.join(",")}] absent; ${files.length} assets scanned.`);
