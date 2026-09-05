/**
 * F-89 — COUNT NotFound MOUNTS. Do not eyeball a spinner.
 *
 * Every NotFound mount logs UI-8006 ROUTE_NOT_FOUND. That log is the instrument
 * the deployed-staging regression was found with, so it is the instrument the
 * regression test uses. Under React StrictMode a healthy mount logs TWICE per
 * visit; the deployed regression logged roughly twice a SECOND without bound.
 *
 * Verdict is a RATE over a fixed window, not a total, so it cannot be gamed by
 * a slower loop.
 */
import { chromium } from "playwright";

const SCENE = process.argv[2] || "screen-not-found-in-place";
const BASE = process.argv[3] || "http://127.0.0.1:5207";
const WINDOW_MS = 12000;
const HEALTHY_MAX = 4; // StrictMode double-render, with headroom

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const p = await ctx.newPage();

const stamps = [];
p.on("console", (m) => {
  const t = m.text();
  if (t.includes("ROUTE_NOT_FOUND")) stamps.push(Date.now());
});

const t0 = Date.now();
await p.goto(`${BASE}/uiharness.html?scene=${SCENE}`, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(WINDOW_MS);

const secs = (Date.now() - t0) / 1000;
const body = (await p.evaluate(() => document.body.innerText || "")).replace(/\s+/g, " ");
const rendered404 = /This frame is empty/.test(body);
const asides = await p.evaluate(() =>
  [...document.querySelectorAll("aside")].filter((a) => a.getBoundingClientRect().width > 0).length);

console.log(`scene            : ${SCENE}`);
console.log(`window           : ${secs.toFixed(1)}s`);
console.log(`NotFound mounts  : ${stamps.length}   (healthy <= ${HEALTHY_MAX}; StrictMode logs 2)`);
console.log(`rate             : ${(stamps.length / secs).toFixed(2)} / sec`);
console.log(`404 rendered     : ${rendered404}`);
console.log(`visible asides   : ${asides}`);
console.log(`body head        : ${body.slice(0, 110)}`);
const ok = stamps.length <= HEALTHY_MAX && rendered404 && asides === 0;
console.log(ok ? "\nMOUNT CHECK: PASS" : `\nMOUNT CHECK: FAIL — ${stamps.length} mounts in ${secs.toFixed(1)}s, 404=${rendered404}, asides=${asides}`);
await b.close();
process.exit(ok ? 0 : 1);
