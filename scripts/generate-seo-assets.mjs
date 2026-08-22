#!/usr/bin/env node
/**
 * Generates dist/robots.txt and dist/sitemap.xml from the build environment
 * (lane isolation, 2026-08-22).
 *
 * Both were committed with production URLs baked in. Copied unchanged to any
 * other lane they are the most damaging kind of leak in this whole change: a
 * sitemap is an instruction to a crawler, so a staging deploy would have
 * actively submitted production URLs for indexing from a non-production host,
 * and robots.txt would have pointed at the production sitemap.
 *
 * ⚠ THIS DOES NOT DECIDE WHETHER A LANE SHOULD BE INDEXED AT ALL. Templating
 * the origin is the isolation fix. A staging lane almost certainly wants
 * `Disallow: /` for every agent instead of a working sitemap — that is a
 * separate decision, deliberately not made here.
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { laneDefine } from "./lane-config.mjs";

const define = laneDefine();
const siteOrigin = JSON.parse(define.__LANE_SITE_ORIGIN__);
const siteHost = JSON.parse(define.__LANE_SITE_HOST__);
const apexHost = JSON.parse(define.__LANE_SITE_APEX_HOST__);

// Canonical URLs have always named the apex where one exists — see
// SITE_DISPLAY_ORIGIN in src/lib/env.ts. Keep production byte-identical.
const displayOrigin = `https://${apexHost || siteHost}`;

if (!existsSync("dist")) {
  console.error("generate-seo-assets FAIL: dist/ missing — run the build first.");
  process.exit(1);
}

let written = 0;
for (const file of ["robots.txt", "sitemap.xml"]) {
  const template = `public/${file}`;
  if (!existsSync(template)) {
    console.error(`generate-seo-assets FAIL: ${template} missing.`);
    process.exit(1);
  }
  const out = readFileSync(template, "utf8")
    .replaceAll("__SITE_ORIGIN__", displayOrigin)
    .replaceAll("__SITE_HOST__", apexHost || siteHost);

  const leftover = out.match(/__[A-Z_]+__/g);
  if (leftover) {
    console.error(
      `generate-seo-assets FAIL: unsubstituted placeholder(s) in ${file}: ${[...new Set(leftover)].join(", ")}`,
    );
    process.exit(1);
  }
  writeFileSync(`dist/${file}`, out);
  written++;
}

// A sitemap that still names another lane is the failure this script exists to
// prevent; refusing here beats discovering it in a search console.
const sitemap = readFileSync("dist/sitemap.xml", "utf8");
const strayOrigins = [...new Set(sitemap.match(/https?:\/\/[a-z0-9.-]+/gi) || [])].filter(
  (u) => !u.startsWith(displayOrigin) && !u.includes("sitemaps.org"),
);
if (strayOrigins.length) {
  console.error(`generate-seo-assets FAIL: sitemap names other origins: ${strayOrigins.join(", ")}`);
  process.exit(1);
}

console.log(`generate-seo-assets OK: ${written} files; origin=${displayOrigin}`);
