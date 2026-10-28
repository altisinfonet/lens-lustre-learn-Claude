#!/usr/bin/env node
/**
 * The Android app's origin journey, over the wire.
 *
 * usage: node scripts/app-origin-check.mjs <site origin>
 *
 * For every route in SITE_API (parsed from src/lib/net/siteApi.ts, so the list
 * cannot drift from what the app calls) send, from Origin https://localhost,
 * the preflight the WebView sends and then the request itself. FAIL unless the
 * preflight is 2xx/204 and BOTH answers carry exactly one
 * `Access-Control-Allow-Origin: https://localhost`.
 * The request is sent with no bearer token: the route answers with an error,
 * which is fine — the check is that the WebView is still handed it.
 * Prints routes, statuses and header values only. No secret, no member data.
 */
import { readFileSync } from "node:fs";

const site = (process.argv[2] ?? "").replace(/\/+$/, "");
if (!/^https:\/\/[a-z0-9.-]+$/i.test(site)) { console.error("usage: app-origin-check.mjs https://<site>"); process.exit(2); }
const APP_ORIGIN = "https://localhost";

const src = readFileSync(new URL("../src/lib/net/siteApi.ts", import.meta.url), "utf8");
const block = /export const SITE_API = \{([\s\S]*?)\} as const/.exec(src)?.[1] ?? "";
const paths = [...block.matchAll(/:\s*"(\/[^"]+)"/g)].map((m) => m[1]);
if (paths.length === 0) { console.error("could not read SITE_API from siteApi.ts"); process.exit(2); }
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
