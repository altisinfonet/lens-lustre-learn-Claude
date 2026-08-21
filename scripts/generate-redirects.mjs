#!/usr/bin/env node
/** Generates dist/_redirects from the build environment (isolation guard, 2026-08-21).
 *  public/_redirects was a committed production artifact; environment-specific
 *  artifacts are generated, never committed. Fails closed if the env is absent. */
import { writeFileSync, existsSync } from "node:fs";
const url = (process.env.VITE_SUPABASE_URL || "").trim().replace(/\/$/, "");
if (!/^https:\/\/[a-z0-9]{15,25}\.supabase\.co$/.test(url)) {
  console.error("generate-redirects FAIL: VITE_SUPABASE_URL unset/invalid — refusing to emit _redirects");
  process.exit(1);
}
if (!existsSync("dist")) { console.error("generate-redirects FAIL: dist/ missing"); process.exit(1); }
writeFileSync("dist/_redirects", `/sitemap.xml  ${url}/functions/v1/sitemap  200\n`);
console.log(`generate-redirects OK: /sitemap.xml -> ${url}/functions/v1/sitemap`);
