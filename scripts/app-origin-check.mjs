#!/usr/bin/env node
/**
 * The Android app's origin journey, over the wire.
 *
 * usage: node scripts/app-origin-check.mjs <site origin>
 *
 * For every route in SITE_API of the commit the site is serving (its
 * <meta name="build-commit">, read with git; parsed from src/lib/net/siteApi.ts,
 * so the list cannot drift from what the app calls) send, from Origin https://localhost,
 * the preflight the WebView sends and then the request itself. FAIL unless the
 * preflight is 2xx/204 and BOTH answers carry exactly one
 * `Access-Control-Allow-Origin: https://localhost`.
 * The request is sent with no bearer token: the route answers with an error,
 * which is fine — the check is that the WebView is still handed it.
 * A route only this checkout has (a PR adding one, before its merge is
 * deployed) is printed as SKIP: the in-process step covers it. If the stamp or
 * that commit cannot be read, every route in this checkout is checked.
 * Prints routes, statuses and header values only. No secret, no member data.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { readStamp } from "./web-build-commit.mjs";

/** The route strings of `export const SITE_API = { ... } as const` in a siteApi.ts source. Pure. */
export function parseSiteApi(src) {
  const block = /export const SITE_API = \{([\s\S]*?)\} as const/.exec(src)?.[1] ?? "";
  return [...block.matchAll(/:\s*"(\/[^"]+)"/g)].map((m) => m[1]);
}

/**
 * Which routes to ask the site about. Pure.
 * - deployedPaths known: ask about every route the DEPLOYED commit has (a route
 *   this checkout removed must still answer until the removal is deployed);
 *   routes only this checkout has are `notDeployed` — the in-process step
 *   (src/__tests__/appOriginJourney.test.ts) covers them before the merge.
 * - deployedPaths null (stamp or commit unreadable): fail closed, ask about
 *   every route in this checkout, as before.
 */
export function selectRoutes(checkoutPaths, deployedPaths) {
  if (!Array.isArray(deployedPaths) || deployedPaths.length === 0) return { check: checkoutPaths, notDeployed: [] };
  const deployed = new Set(deployedPaths);
  return { check: deployedPaths, notDeployed: checkoutPaths.filter((p) => !deployed.has(p)) };
}

/** SITE_API of the commit the site says it was built from, or null (with the reason printed). */
async function deployedSiteApi(site) {
  let sha = null;
  try {
    sha = readStamp(await (await fetch(site + "/", { headers: { "cache-control": "no-cache" } })).text());
  } catch { /* handled below */ }
  if (!sha || !/^[0-9a-f]{40}$/.test(sha)) { console.log("WARN  no build-commit stamp on the site: checking every route in this checkout"); return null; }
  const git = (args) => execFileSync("git", args, { stdio: ["ignore", "pipe", "ignore"] }).toString();
  try {
    try { git(["cat-file", "-e", `${sha}^{commit}`]); } catch { git(["fetch", "--depth=1", "--no-tags", "origin", sha]); }
    const paths = parseSiteApi(git(["show", `${sha}:src/lib/net/siteApi.ts`]));
    console.log(`INFO  the site serves build ${sha}: ${paths.length} SITE_API routes`);
    return paths;
  } catch {
    console.log(`WARN  could not read SITE_API at ${sha}: checking every route in this checkout`);
    return null;
  }
}

async function main() {
const site = (process.argv[2] ?? "").replace(/\/+$/, "");
if (!/^https:\/\/[a-z0-9.-]+$/i.test(site)) { console.error("usage: app-origin-check.mjs https://<site>"); process.exit(2); }
const APP_ORIGIN = "https://localhost";

const src = readFileSync(new URL("../src/lib/net/siteApi.ts", import.meta.url), "utf8");
const checkoutPaths = parseSiteApi(src);
if (checkoutPaths.length === 0) { console.error("could not read SITE_API from siteApi.ts"); process.exit(2); }
const { check: paths, notDeployed } = selectRoutes(checkoutPaths, await deployedSiteApi(site));
for (const p of notDeployed) console.log(`SKIP  ${p}  not in the deployed build yet; checked in-process (appOriginJourney.test.ts)`);
// siteFetch callers: every route is POST except the settings read.
const methodFor = (p) => (p === "/config/site-settings" ? "GET" : "POST");

let failures = 0;
const check = (ok, label, detail) => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}  ${detail}`); if (!ok) failures += 1; };
const acao = (res) => res.headers.get("access-control-allow-origin");

for (const p of paths) {
  const method = methodFor(p);
  try {
    const pre = await fetch(site + p, {
      method: "OPTIONS",
      headers: { origin: APP_ORIGIN, "access-control-request-method": method, "access-control-request-headers": "authorization, content-type" },
    });
    check(pre.status >= 200 && pre.status < 300, `preflight ${method} ${p}`, `status ${pre.status}`);
    check(acao(pre) === APP_ORIGIN, `preflight ACAO ${p}`, `got ${JSON.stringify(acao(pre))}`);

    const res = await fetch(site + p, {
      method,
      headers: { origin: APP_ORIGIN, "content-type": "application/json" },
      body: method === "POST" ? "{}" : undefined,
    });
    check(acao(res) === APP_ORIGIN, `request ACAO ${method} ${p}`, `status ${res.status}, got ${JSON.stringify(acao(res))}`);
  } catch (e) {
    check(false, `${method} ${p}`, `network error: ${e instanceof Error ? e.message : "unknown"}`);
  }
}
console.log(`\n${paths.length} routes checked against ${site}: ${failures === 0 ? "ALL PASS" : failures + " FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
