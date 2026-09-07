/**
 * ITEM 5 — IS THE PERSON'S NAME IN A PEOPLE LIST A LINK AT ALL?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The Auditor, 2026-09-07, on BOTH 75f14f80 and 0e30d46e: in "People You May
 * Know", the name and avatar are not links. Walking up from the name text to
 * the row container finds ZERO anchor tags; only Add Friend / Add and Remove
 * are interactive; clicking the name leaves location.href unchanged. Predates
 * the four-item work; not a regression.
 *
 * This walks the same two surfaces here and reports, per widget:
 *
 *   anchors      how many <a> the row actually contains
 *   unlinked     ProfileLink's own marker on the span it renders instead —
 *                data-unlinked="missing" (nobody supplied a handle) vs
 *                "deliberate" (a caller stated null). That marker exists
 *                precisely so a walking probe can tell an omission from a
 *                decision, and it is what turns "no link" into a CAUSE.
 *
 * ⚠ THE FIXTURE HAD TO BE CORRECTED BEFORE THIS COULD REPRODUCE ANYTHING.
 * `src/uiharness/fixtures.ts` was giving dashboard-init's `suggestions` a
 * custom_url that dashboard-init/index.ts does not send on this branch (grep:
 * two hits in that file, both for the viewer and the winners). So the harness
 * showed seven links in a widget the deployed build renders with none. A
 * fixture's only job is to be the shape production sends.
 *
 *   npm run ui:harness          # in one shell (needs the VITE_* vars set)
 *   node tools/uishot/profile-links-in-people-lists.mjs "label"
 *
 * Exits non-zero if a people row renders a name that cannot be clicked.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { chromium } from "playwright";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

function chromePath() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  if (!existsSync(root)) return;
  for (const d of readdirSync(root))
    for (const rel of ["chrome-linux/chrome", "chrome-linux/headless_shell"]) {
      const p = join(root, d, rel);
      if (existsSync(p)) return p;
    }
}

const label = process.argv[2] ?? "run";
const BASE = "http://127.0.0.1:5199/uiharness.html?scene=";
const b = await chromium.launch({ executablePath: chromePath() });
const ctx = await b.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: "dark",
  reducedMotion: "reduce",
  locale: "en-GB",
});
const page = await ctx.newPage();
let failures = 0;
const say = (ok, line) => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${line}`);
};

console.log(`\n═══ ${label} · ${new Date().toISOString()} ═══`);

/** Walk up from a text node to its row, exactly as the Auditor described. */
const ROW_WALK = `(rows) => rows.map((row) => {
  const anchors = [...row.querySelectorAll("a")];
  const unlinked = [...row.querySelectorAll("[data-unlinked]")].map((el) => ({
    mark: el.getAttribute("data-unlinked"),
    text: (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 40),
  }));
  const nameText = (row.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 48);
  return {
    row: nameText,
    anchors: anchors.length,
    hrefs: anchors.map((a) => a.getAttribute("href")).slice(0, 4),
    unlinked,
  };
})`;

/* ─────────── 5a — the main list on /discover ─────────── */
console.log("\nITEM 5a — /discover, the main-list row (DiscoverCard)");
await page.goto(BASE + "screen-discover", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const discover = await page.evaluate((walkSrc) => {
  const walk = eval("(" + walkSrc + ")");
  const rows = [...document.querySelectorAll("div")].filter(
    (d) =>
      d.className &&
      String(d.className).includes("border-b border-border") &&
      String(d.className).includes("items-start") &&
      d.querySelector("button")
  );
  return walk(rows);
}, ROW_WALK);
for (const r of discover) console.log(`   [${r.row}]\n      anchors=${r.anchors} ${JSON.stringify(r.hrefs)} unlinked=${JSON.stringify(r.unlinked)}`);
say(discover.length > 0, `the page rendered ${discover.length} people rows`);
say(discover.length > 0 && discover.every((r) => r.anchors >= 2),
  `every row has a link on BOTH the avatar and the name (min ${Math.min(...discover.map((r) => r.anchors))})`);
say(discover.every((r) => r.unlinked.length === 0),
  `no row renders an unlinked name (${discover.reduce((n, r) => n + r.unlinked.length, 0)} found)`);
say(discover.every((r) => r.hrefs.every((h) => h && !/^\/profile\//.test(h))),
  "every href is the handle-based /<handle> form, never /profile/<id> (F-95)");

/* ─────────── 5b — the sidebar widget on /feed ─────────── */
console.log("\nITEM 5b — People You May Know, right sidebar (FeedRightSidebar)");
await page.goto(BASE + "screen-feed", { waitUntil: "networkidle" });
await page.waitForTimeout(1800);
const sidebar = await page.evaluate((walkSrc) => {
  const walk = eval("(" + walkSrc + ")");
  const head = [...document.querySelectorAll("span")].find((e) => /people you may know/i.test(e.textContent || ""));
  if (!head) return null;
  const widget = head.closest("div.border");
  const rows = [...widget.querySelectorAll("div.flex.items-center")].filter((d) => d.querySelector("button, [data-unlinked]"));
  return walk(rows);
}, ROW_WALK);
if (!sidebar) say(false, "the People You May Know widget did not render");
else {
  for (const r of sidebar) console.log(`   [${r.row}]\n      anchors=${r.anchors} ${JSON.stringify(r.hrefs)} unlinked=${JSON.stringify(r.unlinked)}`);
  say(sidebar.length > 0, `the widget rendered ${sidebar.length} people rows`);
  say(sidebar.length > 0 && sidebar.every((r) => r.anchors >= 2),
    `every row has a link on BOTH the avatar and the name (min ${sidebar.length ? Math.min(...sidebar.map((r) => r.anchors)) : 0})`);
  say(sidebar.every((r) => r.unlinked.length === 0),
    `no row renders an unlinked name (${sidebar.reduce((n, r) => n + r.unlinked.length, 0)} found)`);
  say(sidebar.every((r) => r.hrefs.every((h) => h && !/^\/profile\//.test(h))),
    "every href is the handle-based /<handle> form, never /profile/<id> (F-95)");
}

/* ── 5c — the whole page, so a dead name in a NEIGHBOURING list is not missed ── */
console.log("\nITEM 5c — every unlinked name left on /feed, by widget");
const strays = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('[data-unlinked]')) {
    let widget = "page";
    let n = el;
    for (let i = 0; i < 10 && n; i++, n = n.parentElement) {
      const head = n.querySelector?.("span, h2, h3");
      const t = (head?.textContent || "").replace(/\s+/g, " ").trim();
      if (t && t.length < 40 && n !== el) { widget = t; break; }
    }
    out.push({
      widget,
      mark: el.getAttribute("data-unlinked"),
      text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 36),
    });
  }
  return out;
});
if (strays.length === 0) console.log("   none");
for (const s of strays) console.log(`   [${s.widget}] ${s.mark}: ${JSON.stringify(s.text)}`);
console.log(`   total unlinked names on the page: ${strays.length}`);

console.log(`\n${failures === 0 ? "ITEM 5 CLEAR" : failures + " CHECK(S) FAILING"}\n`);
await b.close();
process.exit(failures === 0 ? 0 : 1);
