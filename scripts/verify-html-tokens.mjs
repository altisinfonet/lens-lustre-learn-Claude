#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * NO `%VITE_…%` TOKEN MAY SURVIVE INTO A SHIPPED PAGE.
 *
 * ⚠ WHY THIS GUARD EXISTS, AND WHAT IT WOULD HAVE CAUGHT.
 *
 * Vite substitutes `%VITE_X%` in index.html from the environment. When the
 * variable is not set it does NOT fail and it does NOT blank the token — it
 * leaves the literal text `%VITE_X%` in the HTML and prints a warning that is
 * one line inside several hundred lines of build output.
 *
 * On 2026-08-31 www.50mmretina.com was measured serving:
 *
 *     var origin = "%VITE_SITE_ORIGIN%";
 *     <meta property="og:url" content="%VITE_SITE_ORIGIN%/" />
 *
 * `origin.replace(/^https?:\/\//, "")` on that literal yields the token itself,
 * `apex` comes out empty, and the apex→www hop that exists specifically to stop
 * the 2026-08-05 logged-out-origin incident could never fire. The bare domain
 * answered 200 as a separate origin. Nothing failed. Every check was green,
 * because no check read the emitted HTML.
 *
 * The build environment is not the artefact. This script reads the artefact.
 *
 * It runs LAST in `npm run build`, after every generator, so it sees exactly the
 * bytes Cloudflare Pages will upload.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const DIST = "dist";

/**
 * The tokens Vite substitutes from the environment: `%` + the env prefix + a
 * name. Deliberately NOT every `%WORD%` — the first draft of this guard matched
 * its own documentation and failed a build that was correct. A guard that
 * cannot be trusted gets switched off, and then it guards nothing.
 *
 * Vite's built-in `%MODE%`, `%BASE_URL%`, `%PROD%`, `%DEV%` and `%SSR%` always
 * resolve and are not env-dependent, so they are not a failure mode here.
 */
const TOKEN = /%(VITE_[A-Z0-9_]+)%/g;

function htmlFilesUnder(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    console.error(
      `verify-html-tokens: '${dir}' does not exist. This script runs after ` +
        `'vite build'; a missing dist means the build did not produce a site.`,
    );
    process.exit(1);
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...htmlFilesUnder(full));
    else if (name.endsWith(".html")) out.push(full);
  }
  return out;
}

const files = htmlFilesUnder(DIST);

if (files.length === 0) {
  console.error(
    `verify-html-tokens: no .html file found under '${DIST}'. A build that ` +
      `emits no page must not read as a passing one.`,
  );
  process.exit(1);
}

const failures = [];

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    TOKEN.lastIndex = 0;
    let m;
    while ((m = TOKEN.exec(line)) !== null) {
      failures.push({
        file: relative(process.cwd(), file),
        line: i + 1,
        token: m[0],
        name: m[1],
        text: line.trim(),
      });
    }
  });
}

if (failures.length > 0) {
  console.error("");
  console.error(
    "FAIL: unsubstituted build tokens reached the shipped HTML. Vite leaves a",
  );
  console.error(
    "token verbatim when its variable is unset — the page ships broken and the",
  );
  console.error("build still succeeds. Not on this build.");
  console.error("");
  for (const f of failures) {
    console.error(`  ${f.file}:${f.line}  ${f.token}`);
    console.error(`      ${f.text}`);
  }
  console.error("");
  const names = [...new Set(failures.map((f) => f.name))].sort();
  console.error(`Unresolved variable${names.length === 1 ? "" : "s"}: ${names.join(", ")}`);
  console.error("");
  console.error(
    "Fix by either (a) giving the variable a lane default in " +
      "scripts/lane-config.mjs and substituting it in vite.config.ts's " +
      "laneHtmlPlugin — correct when the value can be derived from the lane; " +
      "or (b) setting it in this lane's build environment — correct when it " +
      "genuinely has no default, as with VITE_SUPABASE_URL.",
  );
  console.error("");
  process.exit(1);
}

console.log(
  `verify-html-tokens: ${files.length} HTML file${files.length === 1 ? "" : "s"} ` +
    `under ${DIST}/ carry no unsubstituted VITE_ token.`,
);
