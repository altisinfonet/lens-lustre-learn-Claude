#!/usr/bin/env node
/**
 * P21 — FONT POLICY: STATED, ENFORCED, AND FIRST-PAINT MEASURED THROTTLED.
 *
 * Gate (docs/gates/GATE_REGISTER.md, P21, verbatim):
 *   "font strategy stated — subset, preload, `font-display` — and first-paint
 *    text measured with the network throttled."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE POLICY (prose + reasons: docs/evidence/d2/P21/font-policy.md)
 *   • Families: Inter 400/500/600/700 and Space Mono 400/700, ONE Google Fonts
 *     css2 request. Nothing else is fetched (Lora was dropped 2026-08-07).
 *   • font-display: swap — in the css2 URL (`&display=swap`) and on any local
 *     @font-face. Text paints in the fallback at once; the web font swaps in.
 *   • Non-blocking: the stylesheet is `media="print" onload="this.media='all'"`
 *     with a <noscript> twin. A render-blocking font stylesheet puts a Google
 *     round trip in front of first paint.
 *   • Preconnect to fonts.googleapis.com AND fonts.gstatic.com (crossorigin —
 *     font fetches are CORS; without it the preconnect is wasted).
 *   • No <link rel=preload> for font files: Google's file URLs are versioned
 *     and per-subset, so a hard-coded preload goes stale silently and then
 *     double-downloads. Preconnect is the stable equivalent.
 *   • Subset: Google serves per-script `unicode-range` subsets, so a browser
 *     downloads only the ranges a page uses. No family here covers Devanagari
 *     or Bengali; those languages render in the system font, by design.
 *   • Every --font-* stack ends in system fallbacks, so "font not loaded" is
 *     never "no text".
 *   • No CSS @import of a font (the 2026-08-07 render-blocking regression).
 *
 * MODES
 *   --static        structural guard over index.html + src/**\/*.css (CI)
 *   --self-test     the guard must catch each planted violation (C-34)
 *   --measure       first-paint text with Slow-4G + 4x CPU, synthetic and
 *                   deterministic: dist/ is served locally and the two font
 *                   hosts are answered by Playwright routes after a chosen
 *                   delay, with a real font file. Variants: the policy with a
 *                   0 ms and a 3000 ms font delay, and a MUTANT that makes the
 *                   stylesheet render-blocking — the measurement must show the
 *                   mutant's first paint waiting on the font and the policy's
 *                   not (fail-first on the measurement itself).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const POLICY_FAMILIES = "family=Inter:wght@400;500;600;700&family=Space+Mono:wght@400;700";

/** Structural check. Returns a list of violations (strings). */
export function checkStatic(indexHtml, cssFiles) {
  const v = [];
  const withoutNoscript = indexHtml.replace(/<noscript>[\s\S]*?<\/noscript>/g, "");
  const links = [...withoutNoscript.matchAll(/<link\b[^>]*>/g)].map((m) => m[0]);
  const fontCss = links.filter((l) => /fonts\.googleapis\.com\/css/.test(l) && /rel=["']stylesheet["']/.test(l));
  if (fontCss.length !== 1) v.push(`expected exactly 1 Google Fonts stylesheet outside <noscript>, found ${fontCss.length}`);
  for (const l of fontCss) {
    const href = (l.match(/href=["']([^"']+)["']/) || [])[1] || "";
    if (!/[?&]display=swap\b/.test(href)) v.push(`font stylesheet without display=swap: ${href}`);
    let fams = [];
    try { fams = new URL(href.replace(/&amp;/g, "&")).searchParams.getAll("family"); } catch { /* reported below */ }
    const want = new URLSearchParams(POLICY_FAMILIES).getAll("family");
    if (fams.length !== want.length || fams.some((f, i) => f !== want[i])) {
      v.push(`font stylesheet loads [${fams.join(" | ")}], policy is [${want.join(" | ")}]`);
    }
    if (!/media=["']print["']/.test(l) || !/onload=["']this\.media='all'["']/.test(l)) {
      v.push("font stylesheet is render-blocking (needs media=\"print\" onload=\"this.media='all'\")");
    }
  }
  if (!/<noscript>[\s\S]*fonts\.googleapis\.com\/css[\s\S]*<\/noscript>/.test(indexHtml)) v.push("no <noscript> fallback for the font stylesheet");
  if (!links.some((l) => /rel=["']preconnect["']/.test(l) && /fonts\.gstatic\.com/.test(l) && /crossorigin/.test(l))) {
    v.push("missing <link rel=preconnect href=https://fonts.gstatic.com crossorigin>");
  }
  if (!links.some((l) => /rel=["']preconnect["']/.test(l) && /fonts\.googleapis\.com/.test(l))) v.push("missing preconnect to fonts.googleapis.com");
  if (links.some((l) => /rel=["']preload["']/.test(l) && /as=["']font["']/.test(l))) v.push("font <link rel=preload> present — policy is preconnect (Google font URLs are versioned per subset)");

  for (const [file, css] of Object.entries(cssFiles)) {
    if (/@import[^;]*fonts\.(googleapis|gstatic)\.com/.test(css)) v.push(`${file}: @import of a web font (render-blocking)`);
    for (const m of css.matchAll(/@font-face\s*{([^}]*)}/g)) {
      if (!/font-display\s*:\s*(swap|optional|fallback)/.test(m[1])) v.push(`${file}: @font-face without font-display swap/optional/fallback`);
    }
    for (const m of css.matchAll(/--font-[\w-]+\s*:\s*([^;]+);/g)) {
      if (!/(sans-serif|serif|monospace|system-ui)\s*$/.test(m[1].trim())) v.push(`${file}: font stack without a generic fallback: ${m[0].trim()}`);
    }
  }
  return v;
}

function listCss(dir) {
  const out = {};
  (function walk(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) { if (n !== "node_modules" && n !== "__tests__") walk(p); }
      else if (n.endsWith(".css")) out[p.split(path.sep).join("/")] = fs.readFileSync(p, "utf8");
    }
  })(dir);
  return out;
}

export function staticOnRepo() {
  return checkStatic(fs.readFileSync("index.html", "utf8"), listCss("src"));
}

const GOOD_HTML = `<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${POLICY_FAMILIES}&display=swap" media="print" onload="this.media='all'" />
<noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?${POLICY_FAMILIES}&display=swap" /></noscript>`;
const GOOD_CSS = { "a.css": ":root{--font-body:'Inter',Helvetica,Arial,sans-serif;}" };

export const SELF_TEST = [
  { name: "the policy", html: GOOD_HTML, css: GOOD_CSS, bad: false },
  { name: "render-blocking stylesheet", html: GOOD_HTML.replace(` media="print" onload="this.media='all'"`, ""), css: GOOD_CSS, bad: true },
  { name: "display=block", html: GOOD_HTML.replaceAll("display=swap", "display=block"), css: GOOD_CSS, bad: true },
  { name: "extra family", html: GOOD_HTML.replaceAll(POLICY_FAMILIES, POLICY_FAMILIES + "&family=Lora"), css: GOOD_CSS, bad: true },
  { name: "gstatic preconnect without crossorigin", html: GOOD_HTML.replace(' crossorigin', ""), css: GOOD_CSS, bad: true },
  { name: "font preload", html: GOOD_HTML + `<link rel="preload" as="font" href="https://fonts.gstatic.com/x.woff2" crossorigin>`, css: GOOD_CSS, bad: true },
  { name: "CSS @import of the font", html: GOOD_HTML, css: { "a.css": "@import url('https://fonts.googleapis.com/css2?family=Inter');" }, bad: true },
  { name: "@font-face without font-display", html: GOOD_HTML, css: { "a.css": "@font-face{font-family:X;src:url(x.woff2)}" }, bad: true },
  { name: "stack with no generic fallback", html: GOOD_HTML, css: { "a.css": ":root{--font-body:'Inter';}" }, bad: true },
  { name: "no noscript twin", html: GOOD_HTML.replace(/<noscript>.*<\/noscript>/, ""), css: GOOD_CSS, bad: true },
];

export function selfTest() {
  return SELF_TEST.filter((c) => (checkStatic(c.html, c.css).length > 0) !== c.bad)
    .map((c) => `${c.name}: expected ${c.bad ? "violation" : "clean"}, got ${JSON.stringify(checkStatic(c.html, c.css))}`);
}

// ── the throttled measurement ──────────────────────────────────────────────

const FONT_CANDIDATES = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/google-fonts/Poppins-Regular.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
];

/**
 * A local server for dist/ that ALSO plays the two font hosts, after a chosen
 * delay. (Playwright's page.route() cannot be used: a routed request is
 * fulfilled outside the throttled network stack, so the Slow-4G profile would
 * not apply to exactly the requests being measured.) The served index.html has
 * its Google Fonts URL pointed at this server; `blocking` additionally strips
 * the non-blocking attributes — the mutant.
 */
export function fontServer(dist, fontBytes, state) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://x");
      const origin = `http://${req.headers.host}`;
      const send = (code, type, body) => { res.writeHead(code, { "content-type": type, "cache-control": "no-store", "access-control-allow-origin": "*" }); res.end(body); };
      if (url.pathname === "/__fonts/css2") {
        return setTimeout(() => send(200, "text/css",
          `@font-face{font-family:'Inter';font-style:normal;font-weight:400;font-display:swap;src:url(${origin}/__fonts/inter.ttf) format('truetype');}`), state.delay);
      }
      if (url.pathname === "/__fonts/inter.ttf") return setTimeout(() => send(200, "font/ttf", fontBytes), state.delay);
      let rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
      const root = path.resolve(dist);
      let abs = path.resolve(root, rel);
      if (abs !== root && !abs.startsWith(root + path.sep)) return send(403, "text/plain", "outside dist/");
      if (!rel || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) abs = path.join(root, "index.html");
      if (abs.endsWith("index.html")) {
        let html = fs.readFileSync(abs, "utf8").replaceAll("https://fonts.googleapis.com/css2", `${origin}/__fonts/css2`);
        if (state.blocking) html = html.replace(/\s+media="print"\s+onload="this\.media='all'"/, "");
        return send(200, "text/html; charset=utf-8", html);
      }
      const ext = path.extname(abs);
      const type = { ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" }[ext] || "application/octet-stream";
      return send(200, type, fs.readFileSync(abs));
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}

export async function measure({ dist = "dist", runs = 3, delayMs = 8000 } = {}) {
  const { chromium } = await import("playwright");
  const { ANDROID_MID_PROFILE } = await import("./web-vitals-report.mjs");
  const fontFile = FONT_CANDIDATES.find((f) => fs.existsSync(f));
  if (!fontFile) throw new Error("no font file available for the synthetic font host");
  if (!fs.existsSync(path.join(dist, "index.html"))) throw new Error(`${dist}/index.html absent — build first`);
  const state = { delay: 0, blocking: false };
  const { server, origin } = await fontServer(dist, fs.readFileSync(fontFile), state);
  const exe = ["/opt/pw-browsers"].flatMap((r) => (fs.existsSync(r) ? fs.readdirSync(r).map((d) => path.join(r, d, "chrome-linux/chrome")) : [])).find((p) => fs.existsSync(p));
  // Every host but this machine resolves to nothing: no backend, no third
  // party, nothing that can make two runs differ or touch a real lane.
  const args = ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'];
  const browser = await chromium.launch(exe ? { executablePath: exe, args } : { args });
  const variants = [
    { name: "policy, font 0 ms", delay: 0, blocking: false },
    { name: `policy, font ${delayMs} ms`, delay: delayMs, blocking: false },
    { name: `MUTANT render-blocking, font ${delayMs} ms`, delay: delayMs, blocking: true },
  ];
  const results = [];
  try {
    for (const v of variants) {
      Object.assign(state, { delay: v.delay, blocking: v.blocking });
      const samples = [];
      for (let i = 0; i < runs; i++) {
        const ctx = await browser.newContext({
          viewport: ANDROID_MID_PROFILE.viewport, deviceScaleFactor: ANDROID_MID_PROFILE.deviceScaleFactor,
          isMobile: true, hasTouch: true, userAgent: ANDROID_MID_PROFILE.userAgent,
        });
        const page = await ctx.newPage();
        if (process.env.P21_DEBUG) {
          page.on("request", (r) => console.error("req", r.url().slice(0, 110)));
          page.on("requestfailed", (r) => console.error("failed", r.url().slice(0, 110), r.failure()?.errorText));
        }
        const cdp = await ctx.newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: ANDROID_MID_PROFILE.cpuThrottlingRate });
        await cdp.send("Network.enable");
        await cdp.send("Network.emulateNetworkConditions", {
          offline: false, latency: ANDROID_MID_PROFILE.network.latencyMs,
          downloadThroughput: ANDROID_MID_PROFILE.network.downloadThroughputBps,
          uploadThroughput: ANDROID_MID_PROFILE.network.uploadThroughputBps,
        });
        await page.goto(origin + "/", { waitUntil: "load", timeout: 90000 });
        await page.waitForTimeout(v.delay + 1500);
        const s = await page.evaluate(() => {
          const fcp = performance.getEntriesByType("paint").find((p) => p.name === "first-contentful-paint");
          const font = performance.getEntriesByType("resource").find((r) => r.name.includes("/__fonts/inter.ttf"));
          const css = performance.getEntriesByType("resource").find((r) => r.name.includes("/__fonts/css2"));
          const faces = [...document.fonts].map((f) => `${f.family}:${f.status}`);
          return { fcpMs: fcp ? fcp.startTime : null, fontResponseEndMs: font ? font.responseEnd : null,
            cssResponseEndMs: css ? css.responseEnd : null, faces,
            interLoaded: [...document.fonts].some((f) => f.family.replace(/["']/g, "") === "Inter" && f.status === "loaded") };
        });
        samples.push(s);
        await ctx.close();
      }
      const med = (k) => { const a = samples.map((x) => x[k]).filter((x) => typeof x === "number").sort((x, y) => x - y); return a.length ? Math.round(a[Math.floor(a.length / 2)]) : null; };
      results.push({ variant: v.name, runs, fcpMsMedian: med("fcpMs"), fontResponseEndMsMedian: med("fontResponseEndMs"),
        cssResponseEndMsMedian: med("cssResponseEndMs"), faces: samples[0]?.faces,
        fcpSamples: samples.map((x) => (x.fcpMs == null ? null : Math.round(x.fcpMs))), interLoadedEveryRun: samples.every((x) => x.interLoaded) });
    }
  } finally {
    await browser.close();
    server.close();
  }
  return { profile: ANDROID_MID_PROFILE.name, realDevice: false, cpuThrottlingRate: ANDROID_MID_PROFILE.cpuThrottlingRate,
    network: ANDROID_MID_PROFILE.network, fontFile: path.basename(fontFile), measuredAt: new Date().toISOString(), results };
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  if (process.argv.includes("--self-test")) {
    const f = selfTest();
    f.forEach((x) => console.error("SELF-TEST FAIL · " + x));
    console.log(`self-test: ${SELF_TEST.length - f.length}/${SELF_TEST.length} shapes classified correctly`);
    process.exit(f.length ? 1 : 0);
  } else if (process.argv.includes("--measure")) {
    const out = await measure({});
    console.log(JSON.stringify(out, null, 2));
    const ji = process.argv.indexOf("--json");
    if (ji > 0 && process.argv[ji + 1]) fs.writeFileSync(process.argv[ji + 1], JSON.stringify(out, null, 2) + "\n");
  } else {
    const v = staticOnRepo();
    v.forEach((x) => console.error(`::error::P21 font policy · ${x}`));
    console.log(`font policy: ${v.length} violation(s) — ${v.length ? "FAIL" : "PASS"}`);
    process.exit(v.length ? 1 : 0);
  }
}
