/**
 * THE FOUR ITEMS THE AUDITOR MEASURED ON THE DEPLOYED PREVIEW, 2026-09-07 —
 * REPRODUCED IN REAL CHROMIUM, AGAINST THE REAL SCREENS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * All four were reproduced live on
 * https://0e30d46e.lens-lustre-learn-claude.pages.dev (tip 6bc9d2f) with
 * DOM/accessibility-tree checks. This drives the same four surfaces here, so
 * they can be measured before and after rather than argued about:
 *
 *   1. /discover  every card control announces the person it acts on, and no
 *                 button on the page is nameless
 *   2. /feed      People You May Know: named Add buttons with a 44px region,
 *                 and — F-109 — a region that takes no pixel from any link
 *   3. /feed      the @mention list is not sliced by a clipping ancestor, and
 *                 still does not run off the right edge (F-101's guard)
 *   4. /feed      the photo lightbox is a named dialog with named controls and
 *                 the photographer as a link
 *
 * Run against the pre-fix tree it fails SIX checks:
 *
 *     item 1  no name on any card button · 1 nameless button on the page
 *     item 2  aria-label null · hit region 55.4x27.4, under the 44px floor
 *     item 3  188px of a 308px list hidden — 61% — at 1440px AND at 390px
 *     item 4  passes, because 23f0332 is present here and absent from the
 *             promotion branch: that item is a MERGE, not a repair
 *
 *   npm run ui:harness          # in one shell (needs the VITE_* vars set)
 *   node tools/uishot/a11y-four-items.mjs "label"
 *
 * ⚠ TWO MEASUREMENT TRAPS, both of which this script fell into first.
 *
 *  1. IT COMPUTED THE ACCESSIBLE NAME FROM textContent ALONE, so two sidebar
 *     tiles whose only child is <img alt="Monsoon Light"> were reported as
 *     nameless. An image's alt IS the name. Fixed in NAME_FN below.
 *  2. IT OPENED THE FIRST POST'S COMMENTS, which already has a thread — that
 *     pushes the composer far down the panel and leaves a 3.6px hairline of
 *     the list above the clipping edge instead of 61% of it. A post with NO
 *     comments is where a member writing the first comment stands, and where
 *     the fault is at its worst. Reproducing a fault at its mildest is not
 *     reproducing it.
 *
 * Exits non-zero if any check fails.
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

/**
 * The accessible name, computed the way a screen reader does for these
 * controls: aria-label, then aria-labelledby, then the flat text content —
 * WITH the alt text of any image inside it, which is how an icon-in-a-button
 * gets a name. Getting that last part wrong is how a first draft of this probe
 * reported two named sidebar tiles as nameless.
 */
const NAME_FN = `(el) => {
  const aria = el.getAttribute("aria-label");
  if (aria && aria.trim()) return aria.trim();
  const by = el.getAttribute("aria-labelledby");
  if (by) {
    const t = by.split(/\\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim();
    if (t) return t;
  }
  const parts = [];
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) parts.push(c.textContent);
      else if (c.nodeType === 1) {
        if (c.getAttribute("aria-hidden") === "true") continue;
        const a = c.getAttribute("aria-label");
        if (a && a.trim()) { parts.push(a); continue; }
        if (c.tagName === "IMG") { parts.push(c.getAttribute("alt") || ""); continue; }
        walk(c);
      }
    }
  };
  walk(el);
  const txt = parts.join(" ").replace(/\\s+/g, " ").trim();
  if (txt) return txt;
  const title = el.getAttribute("title");
  return title && title.trim() ? title.trim() : "";
}`;

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

/* ─────────── ITEM 1 — /discover ─────────── */
console.log("\nITEM 1 — /discover control names");
await page.goto(BASE + "screen-discover", { waitUntil: "networkidle" });
await page.waitForTimeout(1400);

const item1 = await page.evaluate((nameSrc) => {
  const name = eval("(" + nameSrc + ")");
  const cards = [...document.querySelectorAll("div")].filter(
    (d) =>
      d.className &&
      String(d.className).includes("border-b border-border") &&
      String(d.className).includes("items-start") &&
      d.querySelector("button")
  );
  const people = cards.map((card) => {
    // The person's NAME link, not the avatar link (which has no text).
    const link = [...card.querySelectorAll("a")]
      .map((a) => ({ a, t: (a.textContent || "").replace(/\s+/g, " ").trim() }))
      .filter((x) => x.t.length > 1)[0]?.a;
    const person = (link?.textContent || "").replace(/\s+/g, " ").trim();
    return {
      person,
      buttons: [...card.querySelectorAll("button")].map((btn) => name(btn)),
    };
  });
  const nameless = [...document.querySelectorAll("button")]
    .filter((btn) => !name(btn))
    .map((btn) => btn.outerHTML.slice(0, 120));
  return { cardCount: cards.length, people, namelessCount: nameless.length, nameless };
}, NAME_FN);

console.log("   cards:", item1.cardCount, "· nameless buttons on the page:", item1.namelessCount);
for (const p of item1.people) console.log(`   [${p.person}] -> ${JSON.stringify(p.buttons)}`);
say(item1.cardCount > 0, `the page rendered ${item1.cardCount} people cards`);
const carriesName = item1.people.length > 0 && item1.people.every(
  (p) => p.person && p.buttons.length > 0 && p.buttons.every((b) => b.includes(p.person))
);
say(carriesName, "every card button's accessible name carries that person's name");
say(item1.namelessCount === 0, `no button on /discover is nameless (found ${item1.namelessCount})`);
if (item1.namelessCount) console.log("   nameless:", item1.nameless);

/* ─────────── ITEM 2 — People You May Know ─────────── */
console.log("\nITEM 2 — People You May Know, right sidebar");
await page.goto(BASE + "screen-feed", { waitUntil: "networkidle" });
await page.waitForTimeout(1600);

const item2 = await page.evaluate((nameSrc) => {
  const name = eval("(" + nameSrc + ")");
  const head = [...document.querySelectorAll("span")].find((e) => /people you may know/i.test(e.textContent || ""));
  if (!head) return { found: false };
  const widget = head.closest("div.border");
  const rows = [...widget.querySelectorAll("button")].map((btn) => {
    const r = btn.getBoundingClientRect();
    const cs = getComputedStyle(btn, "::after");
    const hitW = cs.content === "none" ? r.width : Math.max(r.width, parseFloat(cs.minWidth) || 0);
    const hitH = cs.content === "none" ? r.height : Math.max(r.height, parseFloat(cs.minHeight) || 0);
    // where the enlarged region actually sits, relative to the painted button
    let anchor = "none";
    if (cs.content !== "none") anchor = cs.top === "0px" ? "top (grows DOWN)" : "centre (grows BOTH ways)";
    const row = btn.closest("div.flex");
    // The NAME link, not the avatar link (which has no text of its own).
    const person = row
      ? ([...row.querySelectorAll("a")]
          .map((a) => (a.textContent || "").replace(/\s+/g, " ").trim())
          .filter((t) => t.length > 1)[0] || "")
      : "";
    return {
      person,
      name: name(btn),
      painted: `${r.width.toFixed(1)}x${r.height.toFixed(1)}`,
      hit: `${hitW.toFixed(1)}x${hitH.toFixed(1)}`,
      anchor,
      rectTop: +r.top.toFixed(1),
      rectBottom: +r.bottom.toFixed(1),
    };
  });
  return { found: true, rows };
}, NAME_FN);

if (!item2.found) { say(false, "the People You May Know widget did not render"); }
else {
  for (const r of item2.rows) console.log(`   [${r.person}] name=${JSON.stringify(r.name)} painted=${r.painted} hit=${r.hit} anchor=${r.anchor}`);
  say(item2.rows.length > 0 && item2.rows.every((r) => r.person && r.name.includes(r.person)),
    "every Add button's accessible name carries that person's name");
  say(item2.rows.every((r) => parseFloat(r.hit.split("x")[1]) >= 44), "every Add button's hit region is at least 44px tall");
}

/* ── ITEM 2b — F-109: does the enlarged region take a pixel from a link? ──
   The F-109 finding was a RECT INTERSECTION — "Copy Photo Link" grew 13.5px UP
   into the photographer's name and elementFromPoint at the centre of the
   overlap returned the button. So the check is the same shape: take every
   enlarged region in this widget and every link in it, and look for overlap. */
if (item2.found && item2.rows.length) {
  const f109 = await page.evaluate(() => {
    const head = [...document.querySelectorAll("span")].find((e) => /people you may know/i.test(e.textContent || ""));
    const widget = head.closest("div.border");
    const region = (btn) => {
      const r = btn.getBoundingClientRect();
      const cs = getComputedStyle(btn, "::after");
      if (cs.content === "none") return { ...r.toJSON(), grew: false };
      const mh = parseFloat(cs.minHeight) || 0, mw = parseFloat(cs.minWidth) || 0;
      const h = Math.max(r.height, mh), w = Math.max(r.width, mw);
      const anchoredTop = cs.top === "0px";
      const top = anchoredTop ? r.top : r.top - (h - r.height) / 2;
      const left = r.left - (w - r.width) / 2;
      return { top, bottom: top + h, left, right: left + w, height: h, width: w, grew: true };
    };
    const btns = [...widget.querySelectorAll("button")];
    const links = [...widget.querySelectorAll("a")].map((a) => ({
      text: (a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 34),
      r: a.getBoundingClientRect(),
    })).filter((l) => l.r.width > 0 && l.r.height > 0);
    const overlaps = [];
    for (const btn of btns) {
      const g = region(btn);
      for (const l of links) {
        const ox = Math.min(g.right, l.r.right) - Math.max(g.left, l.r.left);
        const oy = Math.min(g.bottom, l.r.bottom) - Math.max(g.top, l.r.top);
        if (ox > 0 && oy > 0) {
          const cx = Math.max(g.left, l.r.left) + ox / 2, cy = Math.max(g.top, l.r.top) + oy / 2;
          const hit = document.elementFromPoint(cx, cy);
          overlaps.push({ link: l.text, over: `${ox.toFixed(1)}x${oy.toFixed(1)}`,
            hitAtCentre: hit === btn || btn.contains(hit) ? "THE BUTTON" : (hit?.tagName || "?") });
        }
      }
    }
    // and two adjacent enlarged regions must not swallow each other either
    const gs = btns.map(region).sort((a, b) => a.top - b.top);
    let regionClash = 0;
    for (let i = 1; i < gs.length; i++) if (gs[i].top < gs[i - 1].bottom) regionClash++;
    return { linkCount: links.length, overlaps, regionClash,
      grew: gs.map((g) => `${g.width.toFixed(1)}x${g.height.toFixed(1)}`) };
  });
  console.log(`   F-109 rect check: ${f109.linkCount} links in the widget, regions ${JSON.stringify(f109.grew)}`);
  for (const o of f109.overlaps) console.log(`     OVERLAP with ${JSON.stringify(o.link)} over ${o.over}, centre hits ${o.hitAtCentre}`);
  say(f109.overlaps.length === 0, `no enlarged Add region overlaps a link (${f109.overlaps.length} overlaps)`);
  say(f109.regionClash === 0, `no two Add regions overlap each other (${f109.regionClash})`);
}

/* ─────────── ITEM 3 — the @mention list in a real feed comment box ─────── */
console.log("\nITEM 3 — @mention suggestions inside a real post's comment box");

async function mentionCase(w, h) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(BASE + "screen-feed", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  /*
   * THE SECOND POST, NOT THE FIRST — deliberately.
   *
   * The first fixture post already has a comment thread, which pushes the
   * composer far down inside the section and leaves only a hairline of the
   * upward-opening list above the clipping edge. A post with NO comments yet
   * puts the composer at the very top of the section, which is where a member
   * writing the first comment on a photograph actually stands, and where the
   * slice is at its worst. Reproducing a fault at its mildest is not
   * reproducing it.
   */
  const all = page.locator('button[aria-label="Comment"]');
  const n = await all.count();
  if (n === 0) return { reached: false, why: "no Comment button on the feed" };
  const commentBtn = all.nth(n > 1 ? 1 : 0);
  await commentBtn.click();
  await page.waitForTimeout(900);
  const box = page.locator("textarea").first();
  if ((await box.count()) === 0) return { reached: false, why: "no comment textarea after opening comments" };
  await box.click();
  await page.keyboard.type("@a", { delay: 60 });
  await page.waitForTimeout(1300);
  return page.evaluate(() => {
    const list = document.querySelector('[class*="suggestions"] ul, ul[class*="suggestions"]') ||
      document.querySelector('[class*="__suggestions"]');
    if (!list) return { reached: false, why: "the suggestion list never appeared" };
    const painted = [...list.querySelectorAll("li")].map((li) => li.getBoundingClientRect());
    const bb = list.getBoundingClientRect();
    const union = painted.length
      ? { top: Math.min(...painted.map((r) => r.top)), bottom: Math.max(...painted.map((r) => r.bottom)),
          left: Math.min(...painted.map((r) => r.left)), right: Math.max(...painted.map((r) => r.right)) }
      : { top: bb.top, bottom: bb.bottom, left: bb.left, right: bb.right };
    // the LOWEST clipping edge above the list is the one that actually slices it
    let clipTop = -Infinity, clipper = null;
    let n = list.parentElement;
    while (n && n !== document.body) {
      const cs = getComputedStyle(n);
      if (cs.overflow !== "visible" || cs.overflowY !== "visible") {
        const r = n.getBoundingClientRect();
        if (r.top > clipTop) { clipTop = r.top; clipper = (n.className ? String(n.className) : n.tagName).slice(0, 64); }
      }
      n = n.parentElement;
    }
    const hiddenPx = clipTop === -Infinity ? 0 : Math.max(0, Math.min(clipTop, union.bottom) - union.top);
    return {
      reached: true, rowCount: painted.length,
      list: { top: +union.top.toFixed(1), bottom: +union.bottom.toFixed(1), right: +union.right.toFixed(1) },
      clipTop: clipTop === -Infinity ? null : +clipTop.toFixed(1), clipper,
      hiddenPx: +hiddenPx.toFixed(1),
      hiddenPct: union.bottom > union.top ? +((hiddenPx / (union.bottom - union.top)) * 100).toFixed(1) : 0,
      offRight: +Math.max(0, union.right - document.documentElement.clientWidth).toFixed(1),
    };
  });
}

for (const [w, h] of [[1440, 900], [390, 844]]) {
  const r = await mentionCase(w, h);
  console.log(`   ${w}x${h}:`, JSON.stringify(r));
  if (!r.reached) say(false, `${w}px — could not reach the @mention list: ${r.why}`);
  else {
    say(r.hiddenPx === 0, `${w}px — no part of the list is clipped by an ancestor (hidden ${r.hiddenPx}px = ${r.hiddenPct}%${r.clipper ? ", clipper " + JSON.stringify(r.clipper) : ""})`);
    say(r.offRight === 0, `${w}px — the list stays on screen (F-101's guard still armed; over by ${r.offRight}px)`);
  }
}
await page.setViewportSize({ width: 1440, height: 900 });

/* ─────────── ITEM 4 — the feed's own photo lightbox ─────────── */
console.log("\nITEM 4 — the feed lightbox (PostMedia CarouselLightbox)");
await page.goto(BASE + "screen-feed", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const item4 = await (async () => {
  const target = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll("img")]
      .map((i) => ({ i, r: i.getBoundingClientRect() }))
      .filter((x) => x.r.width > 120);
    if (!imgs.length) return null;
    imgs.sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height);
    imgs[0].i.scrollIntoView({ block: "center" });
    const r = imgs[0].i.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (!target) return { opened: false, why: "no feed photograph" };
  // The FIRST tap belongs to the engagement figures (interceptFirstTap in
  // PostCard), so the viewer needs a SECOND, separate tap — far enough apart
  // not to read as a double tap, which likes the photo instead.
  await page.mouse.click(target.x, target.y);
  await page.waitForTimeout(700);
  await page.mouse.click(target.x, target.y);
  await page.waitForTimeout(1000);
  return page.evaluate((nameSrc) => {
    const name = eval("(" + nameSrc + ")");
    const el = [...document.querySelectorAll("div")].find((d) => {
      const cs = getComputedStyle(d);
      const r = d.getBoundingClientRect();
      return cs.position === "fixed" && r.width >= window.innerWidth - 2 && r.height >= window.innerHeight - 2 && d.querySelector("img");
    });
    if (!el) return { opened: false, why: "no fullscreen viewer" };
    return {
      opened: true,
      role: el.getAttribute("role"),
      ariaModal: el.getAttribute("aria-modal"),
      ariaLabel: el.getAttribute("aria-label"),
      buttonNames: [...el.querySelectorAll("button")].map((btn) => name(btn)),
      anchors: [...el.querySelectorAll("a")].map((a) => (a.textContent || "").replace(/\s+/g, " ").trim()),
    };
  }, NAME_FN);
})();
console.log("  ", JSON.stringify(item4));
if (!item4.opened) say(false, "the lightbox did not open: " + item4.why);
else {
  say(item4.role === "dialog", `the viewer has role="dialog" (got ${JSON.stringify(item4.role)})`);
  say(item4.ariaModal === "true", `it is aria-modal (got ${JSON.stringify(item4.ariaModal)})`);
  say(!!item4.ariaLabel, `it has an accessible name (got ${JSON.stringify(item4.ariaLabel)})`);
  say(item4.buttonNames.length > 0 && item4.buttonNames.every((n) => n), `every control in it has a name (got ${JSON.stringify(item4.buttonNames)})`);
  say(item4.anchors.length > 0, `the photographer is a link inside it (got ${JSON.stringify(item4.anchors)})`);
}

console.log(`\n${failures === 0 ? "ALL FOUR CLEAR" : failures + " CHECK(S) FAILING"}\n`);
await b.close();
process.exit(failures === 0 ? 0 : 1);
