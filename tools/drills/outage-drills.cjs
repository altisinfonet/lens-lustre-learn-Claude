#!/usr/bin/env node
/**
 * S11 disaster drills D2–D6 against a deployed site, in Chromium, Firefox and
 * WebKit. READ-ONLY: it only loads pages as a signed-out visitor and blocks or
 * corrupts responses inside the test browser. Nothing is written anywhere.
 *
 *   D2 storage/photo CDN down   — every request to the lane's CDN host fails
 *   D3 site edge config down    — /config/* (Cloudflare Pages Functions) fails
 *   D4 Supabase down            — every request to <ref>.supabase.co fails
 *   D5 edge functions down      — <ref>.supabase.co/functions/v1/* fails
 *   D6 corrupted derivative     — every CDN image answers 200 with garbage bytes
 *
 * Per drill and browser it reports: document status, visible text length,
 * uncaught page errors, whether the app's crash screen ("Something went wrong")
 * shows, and how many requests hit the failed host in 20 s (a retry storm shows
 * up as a large number). PASS = page 200, no crash screen, no uncaught error,
 * text present, and NO request to the failed host in the last SETTLE_MS of the
 * watch window. A bounded fallback (thumbnail → render URL → original, measured
 * at ~5 requests per photo inside the first ~5 s in Chromium and WebKit) settles;
 * a retry storm keeps going.
 *
 * Usage: node tools/drills/outage-drills.cjs [base] [supabaseRef] [cdnHost] > out.json
 *   defaults: staging (https://staging.50mmretina.com, fpszggreishhuvdpkmdr, cdn-staging.50mmretina.com)
 * Needs playwright with chromium/firefox/webkit (PLAYWRIGHT_BROWSERS_PATH).
 */
const pw = require(process.env.PW_PATH || "playwright");
const BASE = process.argv[2] || "https://staging.50mmretina.com";
const REF = process.argv[3] || "fpszggreishhuvdpkmdr";
const CDN = process.argv[4] || "cdn-staging.50mmretina.com";
const WATCH_MS = 20_000;
const SETTLE_MS = 10_000;
const GARBAGE = Buffer.from("not an image — drill D6 ".repeat(40));

const DRILLS = {
  baseline: { match: () => false },
  "D2 photo CDN down": { match: (u) => u.host === CDN, mode: "abort" },
  "D3 site edge config down": { match: (u) => u.host === new URL(BASE).host && u.pathname.startsWith("/config/"), mode: "abort" },
  "D4 Supabase down": { match: (u) => u.host === `${REF}.supabase.co`, mode: "abort" },
  "D5 edge functions down": { match: (u) => u.host === `${REF}.supabase.co` && u.pathname.startsWith("/functions/v1/"), mode: "abort" },
  "D6 corrupted derivative": { match: (u) => u.host === CDN && /\.(webp|jpe?g|png|avif)$/i.test(u.pathname), mode: "garbage" },
};

(async () => {
  const out = {};
  for (const name of ["chromium", "firefox", "webkit"]) {
    const browser = await pw[name].launch();
    out[name] = {};
    for (const [drill, d] of Object.entries(DRILLS)) {
      out[name][drill] = {};
      for (const path of ["/", "/feed"]) {
        const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
        let hits = 0;
        const perUrl = new Map();
        let loadedAt = Infinity; const late = [];
        await ctx.route("**/*", (route) => {
          const u = new URL(route.request().url());
          if (!d.match(u)) return route.continue();
          hits++;
          perUrl.set(u.href, (perUrl.get(u.href) || 0) + 1);
          if (Date.now() - loadedAt > WATCH_MS - SETTLE_MS) late.push(u.pathname);
          if (d.mode === "garbage") return route.fulfill({ status: 200, contentType: "image/webp", body: GARBAGE });
          return route.abort("failed");
        });
        const page = await ctx.newPage();
        const pageErrors = [];
        page.on("pageerror", (e) => pageErrors.push(String(e.message).slice(0, 160)));
        let status = null;
        try { const r = await page.goto(BASE + path, { waitUntil: "load", timeout: 45_000 }); status = r && r.status(); loadedAt = Date.now(); }
        catch (e) { pageErrors.push("goto: " + String(e.message).slice(0, 120)); }
        await page.waitForTimeout(WATCH_MS);
        const text = (await page.evaluate(() => document.body ? document.body.innerText : "").catch(() => "")).replace(/\s+/g, " ").trim();
        const crash = /Something went wrong while loading this page/.test(text);
        const brokenImgs = await page.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.getBoundingClientRect().width > 0).length).catch(() => -1);
        const maxPerUrl = Math.max(0, ...perUrl.values());
        const pass = status === 200 && !crash && pageErrors.length === 0 && text.length > 100 && late.length === 0;
        out[name][drill][path] = { status, textLen: text.length, crash, pageErrors, hitsToFailedHost: hits, maxRequestsToOneFailedUrl: maxPerUrl, requestsAfterSettle: late.length, visibleBrokenImages: brokenImgs, pass };
        await ctx.close();
      }
    }
    await browser.close();
  }
  process.stdout.write(JSON.stringify({ base: BASE, ref: REF, cdn: CDN, at: new Date().toISOString(), results: out }, null, 1));
})();
