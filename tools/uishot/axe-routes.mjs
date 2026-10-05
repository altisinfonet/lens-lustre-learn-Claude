/**
 * P23 · read-only axe probe over routes of a RUNNING site (production, staging
 * or a local preview). Same tags and phone as the UI-gate ratchet; prints one
 * line per failing node WITH its selector, so a finding names the element.
 * It is a measuring tool, not a gate: it never fails a build (DECISION.md C7).
 *
 * AXE_SITE_SETTINGS=<file.json> (local runs only): answers `site_settings`
 * reads of key=eq.<k> with {value: file[k]}. Production's header and footer
 * render from site_settings (managed_pages, navigation_menu); a local server
 * with no database renders neither, and so cannot show the shared-chrome
 * pattern F-D3-11 without them. The fixture is public config read from staging.
 */
import { chromium } from "playwright";
import { createRequire } from "node:module";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { AXE_TAGS } from "./axe-ratchet.mjs";

const AXE_SOURCE = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const [origin, ...routes] = process.argv.slice(2);
if (!origin || !routes.length) { console.error("usage: axe-routes.mjs <origin> <route>..."); process.exit(2); }
const exe = (() => {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  if (!existsSync(root)) return undefined;
  for (const d of readdirSync(root)) for (const rel of ["chrome-linux/chrome", "chrome-linux/headless_shell"]) {
    const p = join(root, d, rel); if (existsSync(p)) return p;
  }
})();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const out = { at: new Date().toISOString(), origin, tags: AXE_TAGS, viewport: "390x844 mobile", routes: {} };
for (const route of routes) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "en-GB" });
  const page = await ctx.newPage();
  if (process.env.AXE_SITE_SETTINGS) {
    const fx = JSON.parse((await import("node:fs")).readFileSync(process.env.AXE_SITE_SETTINGS, "utf8"));
    await page.route(/\/rest\/v1\/site_settings\?.*key=eq\.([a-z_]+)/, (r) => {
      const k = /key=eq\.([a-z_]+)/.exec(r.request().url())[1];
      if (!(k in fx)) return r.continue();
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ value: fx[k] }) });
    });
  }
  try {
    await page.goto(origin + route, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await page.addScriptTag({ path: AXE_SOURCE });
    const v = await page.evaluate(async (tags) => (await window.axe.run(document, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] }))
      .violations.map((x) => ({ id: x.id, nodes: x.nodes.map((n) => ({ target: n.target.join(" "), html: n.html.slice(0, 200), why: (n.failureSummary || "").split("\n").slice(1, 2).join(" ").slice(0, 160) })) })), AXE_TAGS);
    out.routes[route] = v;
    const total = v.reduce((a, x) => a + x.nodes.length, 0);
    console.log(`${route}  ${total} node(s)  ${v.map((x) => `${x.id}:${x.nodes.length}`).join(" ")}`);
    for (const x of v) for (const n of x.nodes) console.log(`    ${x.id}  ${n.target}  ${n.html}  ${n.why}`);
  } catch (e) { out.routes[route] = { error: String(e.message ?? e) }; console.log(`${route}  ERROR ${e.message}`); }
  await ctx.close();
}
await browser.close();
if (process.env.AXE_ROUTES_OUT) (await import("node:fs")).writeFileSync(process.env.AXE_ROUTES_OUT, JSON.stringify(out, null, 2) + "\n");
