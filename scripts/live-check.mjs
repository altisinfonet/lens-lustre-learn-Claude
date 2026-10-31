#!/usr/bin/env node
/**
 * LIVE CHECK — the carry-to-main rule's last step, in all three engines.
 *
 * "Check live in Chromium, Firefox, WebKit: home + /feed (+ /notifications) 200, same text, no NEW
 * console errors." For each engine and path it loads the public site twice and
 * prints: HTTP status, whether the visible text is the same both times
 * (digits masked — live counters move), and every console error / page error.
 *
 * Exit 1 only on a non-200 or a page that renders no text. Console errors are
 * PRINTED, not judged: "new" means "not there before the change", and only the
 * person carrying the change can compare against the run before it. Read-only:
 * anonymous GETs of public pages, nothing signed in, nothing written.
 *
 *   node scripts/live-check.mjs [origin] [engines]
 *   default origin https://www.50mmretina.com, engines chromium,firefox,webkit
 */
import { chromium, firefox, webkit } from "playwright";

const ORIGIN = process.argv[2] || "https://www.50mmretina.com";
const ENGINES = (process.argv[3] || "chromium,firefox,webkit").split(",");
// "/notifications" added for the notification centre carries. Logged out it
// lands on the sign-in screen (measured 2026-10-31: 200, /login, text shown),
// like /feed — so it proves the route and the page bundle still load.
const PATHS = ["/", "/feed", "/notifications"];
const B = { chromium, firefox, webkit };
/** Never echo a key or token that a browser puts in a logged URL. */
const scrub = (t) => t.replace(/([?&](?:apikey|access_token|token|key)=)[^&\s"']+/gi, "$1<redacted>");
let bad = 0;

for (const name of ENGINES) {
  const browser = await B[name].launch();
  for (const path of PATHS) {
    const texts = [];
    let status = 0;
    let errors = [];
    for (let i = 0; i < 2; i++) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const e = [];
      page.on("console", (m) => { if (m.type() === "error") e.push(m.text().replace(/\s+/g, " ").slice(0, 200)); });
      page.on("pageerror", (x) => e.push("pageerror: " + String(x).slice(0, 200)));
      page.on("response", (r) => { if (r.status() >= 400) e.push(`http ${r.status()} ${r.request().method()} ${r.url().replace(/\?.*/, "")}`); });
      const res = await page.goto(ORIGIN + path, { waitUntil: "networkidle", timeout: 60_000 }).catch(() => null);
      status = res ? res.status() : 0;
      await page.waitForTimeout(2_000);
      texts.push((await page.evaluate(() => document.body?.innerText ?? "")).replace(/\d+/g, "#").replace(/\s+/g, " ").trim());
      if (i === 1) errors = e;
      await ctx.close();
    }
    const ok = status === 200 && texts[1].length > 0;
    if (!ok) bad++;
    console.log(`${ok ? "✓" : "✗"} ${name.padEnd(8)} ${path.padEnd(6)} status=${status} text=${texts[1].length} chars same-both-loads=${texts[0] === texts[1]}`);
    console.log(`    starts: ${texts[1].slice(0, 100)}`);
    for (const x of [...new Set(errors)]) console.log(`    console: ${scrub(x)}`);
  }
  await browser.close();
}
if (bad) { console.error(`\n${bad} page(s) not 200 / empty`); process.exit(1); }
console.log("\nLIVE CHECK: every page 200 with text (console errors above are for the carrier to compare)");
