/**
 * THE 30-DAY BLANK PAGE: A MISSING CHUNK CACHED AS HTML FOR A YEAR.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Owner, 2026-08-05, after ~30 days of recurring blank pages, with a console
 * capture that finally named it:
 *
 *   Failed to load module script: Expected a JavaScript-or-Wasm module script
 *   but the server responded with a MIME type of "text/html".
 *   TypeError: Failed to fetch dynamically imported module:
 *   https://50mmretina.com/assets/AdminPushBroadcast-D_bNnshh.js
 *   [AppErrorBoundary] ... at Lazy / at Suspense
 *
 * MEASURED AGAINST PRODUCTION THE SAME HOUR:
 *
 *   GET /assets/<chunk that no longer exists>   ->   200   text/html
 *   GET /index.html                             ->   cache-control: max-age=0
 *   public/_headers:  /assets/*  ->  max-age=31536000, immutable
 *
 * So a missing asset is answered with the SPA fallback (index.html, status
 * **200**, not 404) and that HTML is then stored under the `.js` URL and marked
 * **immutable for one year**. Every later attempt reads the poisoned entry off
 * disk. That is why it survived reloads and why it lasted 30 days.
 *
 * TWO FAULTS IN OUR OWN HEALING MADE IT WORSE, and both are pinned below:
 *   1. the retry flag was GLOBAL and cleared only on a successful lazy load, so
 *      the first failure in a session disarmed healing for every other route;
 *   2. a plain reload re-read the same poisoned Cache Storage entry.
 *
 * The structural fix belongs in hosting — a missing `/assets/*` file must 404,
 * not return HTML. Until that lands, these pin the client-side self-heal.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const app = read("src/App.tsx");
const headers = read("public/_headers");

describe("healing gets a chance on every route, not just the first", () => {
  it("the retry flag is keyed per chunk", () => {
    // A single global key meant one failure poisoned the healing for all 49
    // lazy routes for the rest of the session.
    expect(app).toMatch(/const flag = "chunk_reload_" \+ key;/);
    expect(app).not.toMatch(/getItem\("chunk_reload_v1"\)/);
  });

  it("every lazy route passes its own key", () => {
    const calls = [...app.matchAll(/lazyRetry\(\(\) => import\([^)]*\)/g)];
    expect(calls.length).toBeGreaterThan(40);
    // None may be left without a second argument.
    const keyless = [...app.matchAll(/lazyRetry\(\(\) => import\("[^"]+"\)\)/g)];
    expect(keyless.map((m) => m[0])).toEqual([]);
  });

  it("clears its own key on success, so a later deploy re-arms it", () => {
    expect(app).toMatch(/sessionStorage\.removeItem\("chunk_reload_" \+ key\)/);
  });
});

describe("the poisoned cache entry is evicted before reloading", () => {
  it("deletes cached /assets/ responses", () => {
    // Without this the reload is served the same text/html from disk and the
    // member sees the identical error screen — which is exactly what happened.
    expect(app).toMatch(/caches\.keys\(\)/);
    expect(app).toMatch(/r\.url\.includes\("\/assets\/"\)/);
    expect(app).toMatch(/c\.delete\(r\)/);
  });

  it("reloads with a cache-busting parameter", () => {
    // index.html is what names the dead chunk; `?cb=` defeats any intermediate
    // cache still holding the old copy.
    expect(app).toMatch(/searchParams\.set\("cb", String\(Date\.now\(\)\)\)/);
  });

  it("main.tsx still strips that parameter from the address bar", () => {
    expect(read("src/main.tsx")).toMatch(/stripCacheBusterParam\(\)/);
  });
});

describe("the failure is recorded either way", () => {
  it("reports before healing, and says whether it healed", () => {
    // Since 2026-07-28 this reloaded silently, so a fault firing ten times a
    // day was indistinguishable from one that never fired.
    expect(app).toMatch(/reportClientError\("blank_page", err, \{ cause: "chunk_load", chunk: key, firstTry \}\)/);
  });

  it("reporting can never block the healing", () => {
    expect(app).toMatch(/\.catch\(\(\) => \{ \/\* reporting must never block healing \*\/ \}\)/);
  });
});

describe("the hosting rule that makes this possible is documented, not silently changed", () => {
  it("/assets/* is still immutable for a year", () => {
    // Correct for genuinely hashed files — and a trap while a missing one
    // returns 200 text/html. Changing caching for every asset on a live site is
    // the owner's call, so this test records the state rather than altering it.
    expect(headers).toMatch(/\/assets\/\*\s*\n\s*Cache-Control: public, max-age=31536000, immutable/);
  });
});
