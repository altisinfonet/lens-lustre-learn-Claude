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

const PRODUCTION_CDN_HOST = "cdn.50mmretina.com";
const PRODUCTION_SITE_ORIGIN = "https://www.50mmretina.com";
const TEMPLATE = "public/_headers";
const OUT = "dist/_headers";

function laneValue(name, productionDefault) {
  const raw = process.env[name];
  if (raw === undefined) return productionDefault;
  const value = raw.trim();
  if (value === "") {
    console.error(
      `generate-headers FAIL: ${name} is set but empty. An empty string is a ` +
        `configuration error, not a default — it would emit a hostless entry into ` +
        `the CSP. Unset it for the production value, or give it this lane's host.`,
    );
    process.exit(1);
  }
  return value;
}

const cdnHost = laneValue("VITE_CDN_HOST", PRODUCTION_CDN_HOST);
const siteOrigin = laneValue("VITE_SITE_ORIGIN", PRODUCTION_SITE_ORIGIN).replace(/\/+$/, "");

if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(cdnHost)) {
  console.error(`generate-headers FAIL: VITE_CDN_HOST "${cdnHost}" is not a bare hostname.`);
  process.exit(1);
}
if (!/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/i.test(siteOrigin)) {
  console.error(`generate-headers FAIL: VITE_SITE_ORIGIN "${siteOrigin}" is not an https origin.`);
  process.exit(1);
}
if (!existsSync("dist")) {
  console.error("generate-headers FAIL: dist/ missing — run the build first.");
  process.exit(1);
}
if (!existsSync(TEMPLATE)) {
  console.error(`generate-headers FAIL: ${TEMPLATE} missing.`);
  process.exit(1);
}

const template = readFileSync(TEMPLATE, "utf8");
const out = template
  .replaceAll("__CDN_HOST__", cdnHost)
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
    `cdn=${cdnHost} origin=${siteOrigin}`,
);
