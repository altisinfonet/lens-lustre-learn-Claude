#!/usr/bin/env node
/**
 * Generates dist/_headers from the build environment (lane isolation, 2026-08-22).
 *
 * public/_headers was a committed production artifact: its CSP named
 * `https://cdn.50mmretina.com` and its CORS policy pinned
 * `https://50mmretina.com`. Shipped unchanged to another lane, the CSP would
 * have blocked that lane's own images while allowing production's, and the
 * CORS header would have advertised the production origin.
 *
 * ⚠ THIS FILE IS THE BUILD-TIME HALF OF THE DEFAULTING RULE in src/lib/env.ts.
 * Unset means production. Set-but-empty is a configuration error and the build
 * stops here rather than emitting a CSP with a hostless entry in it.
 *
 * ⚠ NOT LIKE generate-redirects.mjs. That script emits a 200-rewrite to an
 * external origin, which Cloudflare Pages rejects outright (`Parsed 0 valid
 * redirect rules`). `_headers` is a real, applied Pages feature — so this file
 * is validated line by line before it is written, because a malformed rule here
 * silently drops real security headers.
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { laneDefine } from "./lane-config.mjs";

const TEMPLATE = "public/_headers";
const OUT = "dist/_headers";

// One resolver for the whole build — the production values and the "empty is
// not a default" rule live in lane-config.mjs and nowhere else.
let define;
try {
  define = laneDefine();
} catch (e) {
  console.error(`generate-headers FAIL: ${e.message}`);
  process.exit(1);
}
const cdnHost = JSON.parse(define.__LANE_CDN_HOST__);
const siteOrigin = JSON.parse(define.__LANE_SITE_ORIGIN__);
const siteHost = JSON.parse(define.__LANE_SITE_HOST__);
const apexHost = JSON.parse(define.__LANE_SITE_APEX_HOST__);

/**
 * ⚠ ACAO USES THE APEX FORM, NOT THE SERVING ORIGIN — A DELIBERATE G4 DECISION.
 *
 * Production serves from `www.` but its CORS policy has always named the apex,
 * and this gate keeps it byte-identical: the only difference between the
 * generated production _headers and main's committed copy is this file's
 * template banner.
 *
 * The tempting "fix" is to point VITE_SITE_ORIGIN at the apex instead. That
 * would be a silent regression: index.html derives the apex->www redirect by
 * stripping a leading `www.` from this same value, so an apex serving origin
 * yields an empty apex and DISABLES the redirect — reopening the 2026-08-05
 * incident where members on the bare domain got a logged-out copy of the site,
 * apex and www being separate browser origins with separate logins and caches.
 *
 * Whether production CORS should name www rather than the apex is a real
 * question. It is NOT settled here, and nothing in this gate depends on the
 * answer.
 */
const acaoOrigin = `https://${apexHost || siteHost}`;

if (!existsSync("dist")) {
  console.error("generate-headers FAIL: dist/ missing — run the build first.");
  process.exit(1);
}
if (!existsSync(TEMPLATE)) {
  console.error(`generate-headers FAIL: ${TEMPLATE} missing.`);
  process.exit(1);
}

// #!template lines document the TEMPLATE and must not reach the shipped file:
// they would carry this lane's hostnames into a comment in every artifact, and
// they would make the production output differ from main's committed copy.
const template = readFileSync(TEMPLATE, "utf8")
  .split("\n")
  .filter((l) => !l.startsWith("#!template"))
  .join("\n");
const out = template
  .replaceAll("__CDN_HOST__", cdnHost)
  .replaceAll("__SITE_DISPLAY_ORIGIN__", acaoOrigin)
  .replaceAll("__SITE_ORIGIN__", siteOrigin);

// A leftover placeholder means the template gained one this script does not
// know about. Emitting it verbatim would put the literal string into a live
// security header.
const leftover = out.match(/__[A-Z_]+__/g);
if (leftover) {
  console.error(`generate-headers FAIL: unsubstituted placeholder(s): ${[...new Set(leftover)].join(", ")}`);
  process.exit(1);
}

// Pages _headers syntax: a rule is a path line at column 0, followed by
// `  Header: value` lines indented beneath it. A header line that escapes its
// rule is silently ignored by Pages, which is how a security header goes
// missing without anything going red.
let currentRule = null;
let ruleCount = 0;
let headerCount = 0;
for (const [i, line] of out.split("\n").entries()) {
  if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
  if (!/^\s/.test(line)) {
    if (!line.startsWith("/") && !line.startsWith("http")) {
      console.error(`generate-headers FAIL: line ${i + 1} is neither a path rule nor an indented header: ${line}`);
      process.exit(1);
    }
    currentRule = line;
    ruleCount++;
    continue;
  }
  if (!currentRule) {
    console.error(`generate-headers FAIL: line ${i + 1} is a header with no rule above it: ${line}`);
    process.exit(1);
  }
  if (!/^\s+[A-Za-z0-9-]+:\s*.+$/.test(line)) {
    console.error(`generate-headers FAIL: line ${i + 1} is not a valid "Name: value" header: ${line}`);
    process.exit(1);
  }
  headerCount++;
}

writeFileSync(OUT, out);
console.log(
  `generate-headers OK: ${ruleCount} rules, ${headerCount} headers; ` +
    `cdn=${cdnHost} serving-origin=${siteOrigin} acao=${acaoOrigin}`,
);
