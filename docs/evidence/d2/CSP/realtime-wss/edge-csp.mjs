import { chromium } from "playwright";
for (const ch of ["msedge", "chrome"]) {
  const b = await chromium.launch({ channel: ch }); const p = await b.newPage();
  await p.addInitScript(() => { window.__v = []; document.addEventListener("securitypolicyviolation", (e) => window.__v.push(e.violatedDirective + " → " + (e.blockedURI || "").slice(0, 70))); });
  await p.goto(process.env.SITE, { waitUntil: "load" }); await p.waitForTimeout(6000);
  console.log(ch, JSON.stringify(await p.evaluate(() => window.__v)));
  await b.close();
}
