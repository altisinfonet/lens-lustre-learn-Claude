#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WEB VITALS — Addendum A, Phase 0, unit 0.5. REPORT-ONLY, BY DESIGN.
 *
 * ⚠ EVERY PATH IN THIS FILE EXITS 0. That is not an oversight and it is not
 * laziness. Turning a budget into a build-breaking ceiling is unit P13, in
 * Phase 5, and it happens against numbers this harness will have been
 * collecting for weeks by then. A gate switched on before anyone knows what the
 * numbers normally do is a gate that goes red on its first run, gets waved
 * through twice, and is ignored from then on. The owner's words on this were
 * plain: "we will build one gate you will break another gate which is working.
 * This should not happen." So: measure now, threshold later, and make the
 * report-only state loud rather than implicit.
 *
 * ⚠ AND IT NEVER REPORTS A MEASUREMENT IT DID NOT TAKE. If Playwright is
 * absent, if Chromium will not launch, if the page never loads, if the browser
 * does not support the `event` entry type — the record says `status:
 * "unmeasured"` and carries the reason. It does not fall back to zero. A zero
 * LCP is a perfect score, and a harness that answers "perfect" when it means "I
 * could not look" is worse than no harness at all.
 *
 * ⚠ THIS IS AN EMULATED PROFILE, NOT A DEVICE. Chromium with a 4x CPU throttle,
 * a 360x800 viewport at DPR 3, a mobile user agent and Slow-4G network
 * conditions is a repeatable proxy for a mid-range Android — good for spotting
 * a regression between two commits, and NOT a substitute for the real-device
 * measurement the standard of practice requires before and after a performance
 * change. Every record carries `realDevice: false` so no reader can mistake one
 * for the other. The real-device leg is a separate, manual measurement and is
 * marked BLOCKED in CI.
 *
 * ⚠ "INP" HERE IS AN APPROXIMATION, AND SAYS SO. Real INP is the 98th
 * percentile of a real member's interaction latencies over a whole session, as
 * computed by the web-vitals library. This harness dispatches a handful of
 * scripted interactions and reports the WORST `event` entry duration among
 * them. The field is named `inpApproxMs` and carries `method`. It is a
 * regression tripwire, not a field measurement. When the dependency window
 * opens, the honest upgrade is the web-vitals library itself; until then this
 * uses only what the platform gives us, because the Phase 0 dependency window
 * is closed.
 *
 * NO NEW DEPENDENCIES. Playwright is ALREADY a devDependency of this repository
 * (used by tools/uishot) and is imported dynamically, so this file also runs —
 * and reports honestly — in an environment where it is not installed.
 *
 * USAGE
 *   node scripts/web-vitals-report.mjs [--dist=dist] [--routes=/,/feed]
 *   node scripts/web-vitals-report.mjs --url=https://staging.50mmretina.com
 * ─────────────────────────────────────────────────────────────────────────────
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { serializeRecords } from "./web-baseline.mjs";

export const TOOL = "web-vitals-report";
export const TOOL_VERSION = "0.5.0";

/* The profile. Numbers chosen to sit near a mid-range Android on a mediocre
   4G connection — the device class most of this platform's members actually
   hold. Changing them invalidates comparison with every earlier run, so they
   are constants here and a change to them is a change to the baseline. */
export const ANDROID_MID_PROFILE = Object.freeze({
  name: "android-mid-2026",
  realDevice: false,
  viewport: { width: 360, height: 800 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  cpuThrottlingRate: 4,
  network: {
    label: "Slow 4G",
    latencyMs: 150,
    downloadThroughputBps: Math.round((1.6 * 1024 * 1024) / 8),
    uploadThroughputBps: Math.round((750 * 1024) / 8),
  },
});

/* Installed before any page script runs, so `buffered: true` cannot miss an
   entry that fired during boot. Everything is guarded: an unsupported entry
   type must show up as an unsupported entry type, never as a zero. */
const COLLECTOR = `(() => {
  const s = { lcp: null, cls: 0, clsEntries: 0, events: [], longTasks: [], observerErrors: [],
              supported: (self.PerformanceObserver && PerformanceObserver.supportedEntryTypes) || [] };
  self.__d2vitals = s;
  const obs = (type, cb, extra) => {
    try {
      if (!s.supported.includes(type)) { s.observerErrors.push(type + ": entry type not supported"); return; }
      new PerformanceObserver((l) => { for (const e of l.getEntries()) cb(e); })
        .observe(Object.assign({ type, buffered: true }, extra || {}));
    } catch (err) { s.observerErrors.push(type + ": " + err.message); }
  };
  obs("largest-contentful-paint", (e) => {
    s.lcp = { startTime: e.startTime, renderTime: e.renderTime, size: e.size, url: e.url || null,
              element: e.element ? e.element.tagName : null };
  });
  obs("layout-shift", (e) => { if (!e.hadRecentInput) { s.cls += e.value; s.clsEntries++; } });
  obs("event", (e) => {
    s.events.push({ name: e.name, startTime: e.startTime, duration: e.duration,
                    processingStart: e.processingStart, processingEnd: e.processingEnd,
                    interactionId: e.interactionId || 0 });
  }, { durationThreshold: 16 });
  obs("longtask", (e) => { s.longTasks.push({ startTime: e.startTime, duration: e.duration }); });
})();`;

const INTERACTION_EVENTS = new Set([
  "pointerdown", "pointerup", "click", "mousedown", "mouseup",
  "keydown", "keyup", "keypress", "touchstart", "touchend",
]);

/* ── A static server for dist/, so a baseline needs no deployed origin ──── */
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".avif": "image/avif", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8", ".map": "application/json; charset=utf-8",
};

export function serveDist(dist) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url, "http://127.0.0.1");
        let rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
        let abs = path.join(dist, rel);
        // Never serve outside dist/, whatever the request says.
        if (!abs.startsWith(path.resolve(dist))) { res.writeHead(403).end(); return; }
        if (!rel || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
          abs = path.join(dist, "index.html"); // SPA fallback, as Pages does.
        }
        const body = fs.readFileSync(abs);
        res.writeHead(200, {
          "content-type": MIME[path.extname(abs).toLowerCase()] || "application/octet-stream",
          "content-length": body.byteLength,
          "cache-control": "no-store",
        });
        res.end(body);
      } catch (err) {
        res.writeHead(500, { "content-type": "text/plain" }).end(String(err && err.message));
      }
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}

/** Reduce raw `event` entries to a worst-case interaction latency. Returns null
 *  — never 0 — when there is nothing to reduce. */
export function summariseInteractions(events, dispatched) {
  const relevant = (events || []).filter((e) => INTERACTION_EVENTS.has(e.name));
  if (!dispatched) return { inpApproxMs: null, reason: "no interaction was dispatched", samples: 0 };
  if (!relevant.length)
    return {
      inpApproxMs: null,
      reason: "interactions were dispatched but no `event` entry exceeded the 16 ms observer threshold; this is a plausible good result and is reported as unmeasured rather than as 0",
      samples: 0,
    };
  const worst = relevant.reduce((a, b) => (b.duration > a.duration ? b : a));
  return {
    inpApproxMs: Number(worst.duration.toFixed(1)),
    worstEvent: worst.name,
    samples: relevant.length,
    reason: null,
  };
}

export function median(values) {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : Number(((v[m - 1] + v[m]) / 2).toFixed(3));
}

async function measureOnce({ browser, origin, route, timeoutMs, settleMs }) {
  const context = await browser.newContext({
    viewport: ANDROID_MID_PROFILE.viewport,
    deviceScaleFactor: ANDROID_MID_PROFILE.deviceScaleFactor,
    isMobile: ANDROID_MID_PROFILE.isMobile,
    hasTouch: ANDROID_MID_PROFILE.hasTouch,
    userAgent: ANDROID_MID_PROFILE.userAgent,
  });
  try {
    const page = await context.newPage();
    await page.addInitScript(COLLECTOR);

    const throttling = { cpu: false, network: false, error: null };
    try {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: ANDROID_MID_PROFILE.cpuThrottlingRate });
      throttling.cpu = true;
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: ANDROID_MID_PROFILE.network.latencyMs,
        downloadThroughput: ANDROID_MID_PROFILE.network.downloadThroughputBps,
        uploadThroughput: ANDROID_MID_PROFILE.network.uploadThroughputBps,
      });
      throttling.network = true;
    } catch (err) {
      // A profile that silently failed to apply would make every later number
      // incomparable with every earlier one. Say so on the record.
      throttling.error = String(err && err.message ? err.message : err);
    }

    const url = origin.replace(/\/$/, "") + route;
    const response = await page.goto(url, { waitUntil: "load", timeout: timeoutMs });
    await page.waitForTimeout(settleMs);

    /* Interactions, so that an interaction latency exists to be measured at
       all. Deliberately modest and deliberately counted: the count is on the
       record, and zero interactions yields a null INP, not a zero one. */
    let dispatched = 0;
    try {
      await page.mouse.move(180, 400);
      await page.mouse.click(180, 400);
      dispatched += 1;
      await page.waitForTimeout(200);
      await page.keyboard.press("Tab");
      dispatched += 1;
      await page.waitForTimeout(200);
      await page.mouse.click(180, 620);
      dispatched += 1;
      await page.waitForTimeout(400);
    } catch { /* an unclickable page is still a measurable one for LCP and CLS */ }

    const s = await page.evaluate(() => {
      const v = self.__d2vitals || {};
      const nav = performance.getEntriesByType("navigation")[0] || null;
      const paints = performance.getEntriesByType("paint").map((p) => ({ name: p.name, startTime: p.startTime }));
      const res = performance.getEntriesByType("resource");
      return {
        ...v,
        nav: nav
          ? {
              ttfbMs: nav.responseStart,
              domContentLoadedMs: nav.domContentLoadedEventEnd,
              loadMs: nav.loadEventEnd,
              transferSize: nav.transferSize,
              encodedBodySize: nav.encodedBodySize,
            }
          : null,
        paints,
        resourceCount: res.length,
        resourceTransferBytes: res.reduce((a, r) => a + (r.transferSize || 0), 0),
      };
    });

    const inp = summariseInteractions(s.events, dispatched);
    const fcp = (s.paints.find((p) => p.name === "first-contentful-paint") || {}).startTime;

    return {
      status: "measured",
      route,
      url,
      httpStatus: response ? response.status() : null,
      throttling,
      lcpMs: s.lcp ? Number((s.lcp.renderTime || s.lcp.startTime).toFixed(1)) : null,
      lcpUnmeasuredReason: s.lcp ? null : "no largest-contentful-paint entry was observed",
      lcpElement: s.lcp ? s.lcp.element : null,
      lcpUrl: s.lcp ? s.lcp.url : null,
      cls: s.clsEntries || s.supported.includes("layout-shift") ? Number(s.cls.toFixed(4)) : null,
      clsShiftCount: s.clsEntries,
      inpApproxMs: inp.inpApproxMs,
      inpMethod: "worst PerformanceObserver `event` entry among scripted interactions (durationThreshold 16 ms)",
      inpUnmeasuredReason: inp.reason,
      inpSamples: inp.samples,
      interactionsDispatched: dispatched,
      fcpMs: typeof fcp === "number" ? Number(fcp.toFixed(1)) : null,
      ttfbMs: s.nav ? Number(s.nav.ttfbMs.toFixed(1)) : null,
      loadMs: s.nav ? Number(s.nav.loadMs.toFixed(1)) : null,
      longTaskCount: s.longTasks.length,
      longTaskTotalMs: Number(s.longTasks.reduce((a, t) => a + t.duration, 0).toFixed(1)),
      resourceCount: s.resourceCount,
      resourceTransferBytes: s.resourceTransferBytes,
      observerErrors: s.observerErrors,
      unsupportedEntryTypes: ["largest-contentful-paint", "layout-shift", "event", "longtask"].filter(
        (t) => !(s.supported || []).includes(t)
      ),
    };
  } finally {
    await context.close().catch(() => {});
  }
}

export async function run(options) {
  const { dist, url, routes, runs, timeoutMs, settleMs, chromiumPath } = options;
  const runId = crypto.randomUUID();
  const stamp = (rec) => ({ runId, measuredAtUtc: new Date().toISOString(), ...rec });
  const records = [];
  const base = {
    tool: TOOL,
    toolVersion: TOOL_VERSION,
    mode: "report-only",
    blocking: false,
    blockingBecomes: "P13 (Phase 5) — until then a red number is information, not a stop",
    deviceProfile: ANDROID_MID_PROFILE,
    realDevice: false,
    realDeviceNote:
      "Emulated Chromium on CI. The standard of practice requires a real mid-range Android for before/after performance claims; that leg is BLOCKED in CI and must be measured by hand.",
    node: process.version,
  };

  let playwright = null;
  let importError = null;
  try {
    playwright = await import("playwright");
  } catch (err) {
    importError = String(err && err.message ? err.message : err);
  }

  if (!playwright) {
    records.push(
      stamp({
        type: "run",
        ...base,
        status: "unmeasured",
        reason: `playwright could not be imported: ${importError}`,
        remedy: "Install devDependencies (npm ci) and ensure PLAYWRIGHT_BROWSERS_PATH points at an installed Chromium.",
      })
    );
    return { runId, records, exitCode: 0 };
  }

  let served = null;
  let origin = url;
  if (!origin) {
    if (!fs.existsSync(dist)) {
      records.push(
        stamp({
          type: "run", ...base, status: "unmeasured",
          reason: `neither --url was given nor does ${path.resolve(dist)} exist, so there is nothing to load`,
          remedy: "npm run build, or pass --url=<origin>.",
        })
      );
      return { runId, records, exitCode: 0 };
    }
    served = await serveDist(path.resolve(dist));
    origin = served.origin;
  }

  let browser = null;
  try {
    /* `executablePath` exists because CI browser revisions and the pinned
       Playwright version DO drift apart — a runner carrying chromium-1194 under
       PLAYWRIGHT_BROWSERS_PATH while the installed Playwright wants 1234 fails
       to launch with a message about installing browsers, and the whole
       measurement silently becomes "unmeasured". Naming the binary is the
       honest repair; guessing one is not, so there is no default. */
    browser = await playwright.chromium.launch({
      args: ["--disable-dev-shm-usage"],
      ...(chromiumPath ? { executablePath: chromiumPath } : {}),
    });
  } catch (err) {
    records.push(
      stamp({
        type: "run", ...base, status: "unmeasured",
        reason: `chromium would not launch: ${String(err && err.message ? err.message : err)}`,
        remedy: "npx playwright install chromium, or set PLAYWRIGHT_BROWSERS_PATH to an existing browser directory, or name the binary with --chromium=<path>.",
        chromiumPath: chromiumPath || null,
        browsersPath: process.env.PLAYWRIGHT_BROWSERS_PATH || null,
      })
    );
    if (served) served.server.close();
    return { runId, records, exitCode: 0 };
  }

  records.push(
    stamp({ type: "run", ...base, status: "started", origin, servedFrom: served ? path.resolve(dist) : null, routes, runsPerRoute: runs })
  );

  try {
    for (const route of routes) {
      const samples = [];
      for (let i = 0; i < runs; i += 1) {
        let rec;
        try {
          rec = await measureOnce({ browser, origin, route, timeoutMs, settleMs });
        } catch (err) {
          rec = {
            status: "unmeasured",
            route,
            reason: String(err && err.message ? err.message : err),
            lcpMs: null, cls: null, inpApproxMs: null,
          };
        }
        samples.push(rec);
        records.push(stamp({ type: "sample", iteration: i + 1, ...base, ...rec }));
      }
      const measured = samples.filter((s) => s.status === "measured");
      records.push(
        stamp({
          type: "route-summary",
          ...base,
          route,
          samples: samples.length,
          measuredSamples: measured.length,
          status: measured.length ? "measured" : "unmeasured",
          reason: measured.length ? null : "no sample on this route produced a measurement",
          lcpMsMedian: median(measured.map((s) => s.lcpMs)),
          clsMedian: median(measured.map((s) => s.cls)),
          inpApproxMsMedian: median(measured.map((s) => s.inpApproxMs)),
          fcpMsMedian: median(measured.map((s) => s.fcpMs)),
          ttfbMsMedian: median(measured.map((s) => s.ttfbMs)),
          lcpMsAll: measured.map((s) => s.lcpMs),
          note: "Median of a handful of lab runs. Spread matters as much as the middle; every sample is on its own line above.",
        })
      );
    }
  } finally {
    await browser.close().catch(() => {});
    if (served) served.server.close();
  }

  return { runId, records, exitCode: 0 };
}

/* ── CLI ──────────────────────────────────────────────────────────────── */

const HELP = `web-vitals-report.mjs — LCP, CLS and an INP approximation on an emulated
mid-range Android profile. REPORT-ONLY: every path exits 0.

  node scripts/web-vitals-report.mjs [options]

  --dist=<dir>     Build output to serve locally.  Default: dist
  --url=<origin>   Measure a live origin instead of serving dist/.
  --chromium=<p>   Path to a Chromium binary, when the runner's installed
                   revision does not match the pinned Playwright version.
  --routes=<list>  Comma-separated paths.          Default: /
  --runs=<n>       Samples per route.              Default: 3
  --out=<dir>      Evidence directory.             Default: docs/evidence/d2/baseline
  --timeout=<ms>   Per-navigation timeout.         Default: 60000
  --settle=<ms>    Quiet period after load.        Default: 3000
  --help, -h       This text.

Exit code is ALWAYS 0. Making a vitals number blocking is unit P13, Phase 5.
When something cannot be measured the record says status:"unmeasured" and why;
it never reports a passing number it did not take.`;

export function parseArgs(argv) {
  const o = {
    dist: "dist", url: null, routes: ["/"], runs: 3, chromiumPath: process.env.D2_CHROMIUM_PATH || null,
    out: "docs/evidence/d2/baseline", timeoutMs: 60000, settleMs: 3000, help: false, unknown: [],
  };
  for (const a of argv) {
    if (a === "--help" || a === "-h") o.help = true;
    else if (a.startsWith("--dist=")) o.dist = a.slice("--dist=".length);
    else if (a.startsWith("--url=")) o.url = a.slice("--url=".length);
    else if (a.startsWith("--chromium=")) o.chromiumPath = a.slice("--chromium=".length);
    else if (a.startsWith("--routes=")) o.routes = a.slice("--routes=".length).split(",").map((r) => r.trim()).filter(Boolean).map((r) => (r.startsWith("/") ? r : "/" + r));
    else if (a.startsWith("--runs=")) o.runs = Math.max(1, Number(a.slice("--runs=".length)) || 1);
    else if (a.startsWith("--out=")) o.out = a.slice("--out=".length);
    else if (a.startsWith("--timeout=")) o.timeoutMs = Number(a.slice("--timeout=".length)) || 60000;
    else if (a.startsWith("--settle=")) o.settleMs = Number(a.slice("--settle=".length)) || 3000;
    else o.unknown.push(a);
  }
  return o;
}

export async function main(argv) {
  const o = parseArgs(argv);
  if (o.help) { console.log(HELP); return 0; }
  if (o.unknown.length) {
    // Even a misuse exits 0 here. This harness must never be the reason a
    // pipeline stops in Phase 0 — it says what is wrong and gets out of the way.
    console.error(`web-vitals-report: ignoring unknown argument(s): ${o.unknown.join(", ")}`);
  }

  let result;
  try {
    result = await run(o);
  } catch (err) {
    result = {
      runId: crypto.randomUUID(),
      records: [
        {
          type: "run", tool: TOOL, toolVersion: TOOL_VERSION, mode: "report-only", blocking: false,
          status: "unmeasured", realDevice: false,
          reason: `the harness itself threw: ${String(err && err.stack ? err.stack : err)}`,
        },
      ],
    };
    result.records[0].runId = result.runId;
    result.records[0].measuredAtUtc = new Date().toISOString();
  }

  const out = path.resolve(o.out);
  try {
    fs.mkdirSync(out, { recursive: true });
    const stampName = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(out, `web-vitals-${stampName}-${result.runId.slice(0, 8)}.ndjson`);
    fs.writeFileSync(file, serializeRecords(result.records));
    console.log(`web-vitals-report ${TOOL_VERSION} (report-only) — ${result.records.length} records`);
    for (const r of result.records.filter((x) => x.type === "route-summary")) {
      console.log(
        `  ${r.route.padEnd(16)} status=${r.status} LCP=${r.lcpMsMedian ?? "unmeasured"}ms ` +
          `CLS=${r.clsMedian ?? "unmeasured"} INP~=${r.inpApproxMsMedian ?? "unmeasured"}ms`
      );
    }
    for (const r of result.records.filter((x) => x.status === "unmeasured")) {
      console.log(`  UNMEASURED (${r.type}${r.route ? " " + r.route : ""}): ${r.reason}`);
    }
    console.log(`  written ${file}`);
  } catch (err) {
    console.error(`web-vitals-report: could not write evidence — ${String(err && err.message ? err.message : err)}`);
  }

  // ⚠ ALWAYS 0. See the header. P13 is what changes this line, and P13 is not now.
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
