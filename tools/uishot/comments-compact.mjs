#!/usr/bin/env node
/**
 * COMMENTS · INSTAGRAM-COMPACT GEOMETRY — `node tools/uishot/comments-compact.mjs`
 *
 * Owner, 4 Nov 2026 (live web, desktop comments side panel, post "Mossy Roots"):
 * "this comment section has huge gap from each comment / reply — follow
 * Instagram style, more compact".
 *
 * Instagram's comment: avatar 32 px; name + age on line 1; the text directly
 * under it; ONE small grey line ("Reply") right under the text; the heart on
 * the right, level with the NAME line, its count tiny under it; ~12–16 px to the
 * next comment; replies indented under the parent behind "View N more replies".
 *
 * This photographs the REAL surfaces (commentsharness.html: the real
 * CommentsOverlay — desktop side panel and phone sheet — and the real
 * CommentsSection of a competition entry), web and the Android shell, in
 * Chromium, Firefox and WebKit, and measures in CSS px:
 *
 *   text → meta     the text's last line box → the Reply line box      ≤ 4
 *   meta → next     the Reply line (or "View replies" line) → the next
 *                   comment's avatar top                               12–16
 *   meta → toggle   Reply line → "View N more replies" line            ≤ 16
 *   heart           the heart's mark vs the NAME line, centre to centre
 *                   (at the top for every comment length — Owner,
 *                   4 Nov review of a long comment)                    |Δ| ≤ 2
 *   avatar          32 (top level), 24 (reply); reply indent           44
 *   overflow        no row wider than its box (320 px, long name + link)
 *
 * and, from elementFromPoint (what a finger really gets — boxes cannot show a
 * region taking a neighbour's pixels):
 *
 *   OWN BOX         every control (Reply, menu, heart, avatar, name, "View
 *                   replies", a mention link in the text) wins EVERY pixel of
 *                   its own painted box — no region steals from a neighbour
 *   44 × 44         Reply, menu, heart, avatar, "View replies": the longest
 *                   vertical AND horizontal run of points that hit the control
 *                   is ≥ 44 (the name's runs are reported; its 16 px line sits
 *                   between the previous comment's Reply region and its own
 *                   text, and the avatar beside it opens the same profile)
 *
 * Line boxes, not glyph ink: a Reply inside a 44 px box (the old row) has its
 * 16 px LINE centred in that box, and that line is what the eye reads.
 *
 *   --browsers a,b   chromium,firefox,webkit (default all three)
 *   --out <dir>      write each scene's PNG there (the Owner's pictures)
 *   --annotate       draw the measured gaps onto the PNGs
 *   --json <file>    write the result
 *   --base <url>     use a running server (else starts Vite on 5191)
 */
import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, firefox, webkit } from "playwright";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const OUT = arg("--out", null);
const JSON_OUT = arg("--json", null);
const ANNOTATE = process.argv.includes("--annotate");
const ENGINES = (arg("--browsers", "chromium,firefox,webkit")).split(",").map((s) => s.trim()).filter(Boolean);
const PORT = 5191;
const BASE = arg("--base", null) || `http://127.0.0.1:${PORT}`;

const LIMITS = { textToMetaMax: 4, nextMin: 12, nextMax: 16, toggleMax: 16, heartDelta: 2, indent: 44, hit: 44 };

let server = null;
const stop = () => {
  if (!server) return;
  try {
    if (process.platform === "win32") execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: "ignore" });
    else process.kill(-server.pid, "SIGTERM");
  } catch { /* gone */ }
  server = null;
};
if (!arg("--base", null)) {
  server = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
    stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32", shell: process.platform === "win32",
  });
  process.on("exit", stop);
}
async function waitUp() {
  for (let i = 0; i < 180; i++) {
    try { const r = await fetch(`${BASE}/commentsharness.html`); if (r.ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("dev server did not come up in 180 s");
}

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };
const SMALL = { width: 320, height: 720 };

/** [name, query, viewport, open replies?] */
const SCENES = [
  ["web-desktop-panel-owner", "thread=owner", DESKTOP, false],
  ["web-phone-sheet-owner", "thread=owner", PHONE, false],
  ["app-phone-sheet-owner", "thread=owner&app=1", PHONE, false],
  ["web-desktop-panel-replies-closed", "thread=replies", DESKTOP, false],
  ["web-desktop-panel-replies-open", "thread=replies", DESKTOP, true],
  ["web-phone-sheet-replies-open", "thread=replies", PHONE, true],
  ["app-phone-sheet-replies-open", "thread=replies&app=1", PHONE, true],
  ["web-phone-sheet-long", "thread=long", PHONE, false],
  ["web-320-sheet-long", "thread=long", SMALL, false],
  ["app-phone-sheet-long", "thread=long&app=1", PHONE, false],
  ["web-desktop-entry-replies-open", "surface=entry&thread=replies", DESKTOP, true],
  ["web-phone-entry-long", "surface=entry&thread=long", PHONE, false],
].map(([name, query, viewport, open]) => ({ name, query, viewport, open }));

/** Everything measured in the page. Pure DOM + elementFromPoint; no app import. */
function measureInPage({ LIMITS }) {
  const r = (el) => el.getBoundingClientRect();
  const lineBox = (el) => {
    // The element's own LINE box: its text's rect, grown to the computed line-height around its centre.
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((x) => x.width > 0 && x.height > 0);
    if (!rects.length) return null;
    const lh = parseFloat(getComputedStyle(el).lineHeight) || rects[0].height;
    const first = rects[0], last = rects[rects.length - 1];
    return {
      top: (first.top + first.bottom) / 2 - lh / 2,
      bottom: (last.top + last.bottom) / 2 + lh / 2,
      left: Math.min(...rects.map((x) => x.left)), right: Math.max(...rects.map((x) => x.right)),
    };
  };
  const rows = [...document.querySelectorAll("[data-comment-id]")];
  const fail = [];
  const out = { rows: [], pairs: [], hits: [], overflow: [] };
  const findReply = (row) => [...row.querySelectorAll("button")].find((b) => /^(Reply|उत्तर|জবাব)$/i.test(b.textContent.trim()) || b.textContent.trim() === "Reply");
  const info = rows.map((row) => {
    const content = row.children[1];
    const avatarLink = row.firstElementChild;
    const avatar = avatarLink?.querySelector("img, div.rounded-full, span.inline-block") ?? avatarLink;
    const p = content?.querySelector("p");
    const identity = p?.previousElementSibling ?? null;
    const reply = findReply(row);
    const replyLine = reply ? lineBox(reply) : null;
    const textLast = p ? (() => {
      const rr = [...p.getClientRects()];
      const lb = lineBox(p);
      return lb ? lb.bottom : rr[rr.length - 1]?.bottom;
    })() : null;
    const heart = row.querySelector("button[aria-pressed]");
    // A reply's block is indented (ml-11 before 4 Nov, ms-11 after) inside its parent's block,
    // whose first child is the parent's row.
    const isIndent = (el) => el.classList?.contains("ml-11") || el.classList?.contains("ms-11");
    let depth = 0;
    for (let el = row.parentElement; el; el = el.parentElement) if (isIndent(el)) depth++;
    const wrapper = isIndent(row.parentElement) ? row.parentElement : null;
    const parentRow = wrapper?.parentElement?.querySelector(":scope > [data-comment-id]") ?? null;
    return { row, content, avatarLink, avatar, p, identity, reply, replyLine, textLast, heart, parentRow, depth };
  });
  const toggles = [...document.querySelectorAll("[data-comment-replies-toggle]")];

  for (const it of info) {
    const name = it.identity?.querySelector("a,span")?.textContent?.trim().slice(0, 24) ?? "?";
    const ar = r(it.avatar);
    const rec = { name, avatar: Math.round(ar.width), depth: it.depth };
    if (it.replyLine && it.textLast != null) rec.textToMeta = +(it.replyLine.top - it.textLast).toFixed(1);
    if (it.identity && it.p) rec.nameToText = +(r(it.p).top - r(it.identity).bottom).toFixed(1);
    if (it.heart) {
      // Owner, 4 Nov (review of comments-REAL-7): the heart stays at the TOP, on the
      // NAME line, for every comment length — not centred on a long comment.
      // The heart's visible mark (its circle) vs the name's line box, centre to centre.
      const nameEl = it.identity?.querySelector("a, [data-unlinked]") ?? it.identity;
      const nl = nameEl ? lineBox(nameEl) : null;
      const mark = it.heart.querySelector("span") ?? it.heart;
      const mc = (r(mark).top + r(mark).bottom) / 2;
      if (nl) rec.heartDelta = +(mc - (nl.top + nl.bottom) / 2).toFixed(1);
    }
    out.rows.push(rec);
    if (rec.textToMeta != null && rec.textToMeta > LIMITS.textToMetaMax + 0.5) fail.push(`${name}: text → Reply line ${rec.textToMeta} px (≤ ${LIMITS.textToMetaMax})`);
    if (rec.heartDelta != null && Math.abs(rec.heartDelta) > LIMITS.heartDelta) fail.push(`${name}: heart ${rec.heartDelta} px off the NAME line (≤ ${LIMITS.heartDelta}; it stays at the top for every comment length)`);
    const want = it.depth > 0 ? 24 : 32;
    if (Math.abs(ar.width - want) > 0.5) fail.push(`${name}: avatar ${ar.width} px (want ${want})`);
    if (it.depth > 0) {
      if (it.parentRow) {
        const ind = r(it.row).left - r(it.parentRow).left;
        rec.indent = +ind.toFixed(1);
        if (Math.abs(ind - LIMITS.indent) > 0.5) fail.push(`${name}: reply indent ${ind} px (want ${LIMITS.indent})`);
      }
    }
    if (it.row.scrollWidth > it.row.clientWidth + 1) {
      out.overflow.push(name);
      fail.push(`${name}: the row overflows (${it.row.scrollWidth} > ${it.row.clientWidth})`);
    }
  }

  // Consecutive comments, in screen order: what lies between one comment's last line and the next avatar.
  const ordered = info.slice().sort((a, b) => r(a.row).top - r(b.row).top);
  for (let i = 0; i + 1 < ordered.length; i++) {
    const a = ordered[i], b = ordered[i + 1];
    const aBottom = a.replyLine ? a.replyLine.bottom : (a.p ? lineBox(a.p).bottom : r(a.row).bottom);
    const bTop = r(b.avatar).top;
    const between = toggles.filter((t) => r(t).top >= aBottom - 1 && r(t).bottom <= bTop + 1);
    const name = `${out.rows[info.indexOf(a)].name} → ${out.rows[info.indexOf(b)].name}`;
    if (between.length) {
      const tl = lineBox(between[0].querySelector("span:last-child") ?? between[0]);
      const toToggle = +(tl.top - aBottom).toFixed(1);
      const toggleToNext = +(bTop - tl.bottom).toFixed(1);
      out.pairs.push({ name, toToggle, toggleToNext });
      if (toToggle > LIMITS.toggleMax + 0.5) fail.push(`${name}: Reply line → "View replies" ${toToggle} px (≤ ${LIMITS.toggleMax})`);
      if (toggleToNext > LIMITS.nextMax + 0.5 || toggleToNext < LIMITS.nextMin - 0.5) fail.push(`${name}: "View replies" → next comment ${toggleToNext} px (${LIMITS.nextMin}–${LIMITS.nextMax})`);
    } else {
      const gap = +(bTop - aBottom).toFixed(1);
      out.pairs.push({ name, next: gap });
      if (gap > LIMITS.nextMax + 0.5 || gap < LIMITS.nextMin - 0.5) fail.push(`${name}: comment → next comment ${gap} px (${LIMITS.nextMin}–${LIMITS.nextMax})`);
    }
  }
  // The last comment's own toggle (nothing below it but the list's end).
  for (const t of toggles) {
    const owner = info.find((x) => x.row.parentElement === t.parentElement);
    if (!owner?.replyLine) continue;
    const tl = lineBox(t.querySelector("span:last-child") ?? t);
    const g = +(tl.top - owner.replyLine.bottom).toFixed(1);
    if (g > LIMITS.toggleMax + 0.5) fail.push(`${t.textContent.trim()}: Reply line → toggle ${g} px (≤ ${LIMITS.toggleMax})`);
  }

  // ── what a finger gets ────────────────────────────────────────────────────
  const controls = [];
  for (const it of info) {
    const nm = out.rows[info.indexOf(it)].name;
    if (it.reply) controls.push({ el: it.reply, label: `${nm} · Reply`, need44: true, p: it.p });
    const menu = it.row.querySelector("button[aria-label='Comment options']");
    if (menu) controls.push({ el: menu, label: `${nm} · menu`, need44: true, p: it.p });
    if (it.heart) controls.push({ el: it.heart, label: `${nm} · heart`, need44: true });
    if (it.avatarLink?.matches("a")) controls.push({ el: it.avatarLink, label: `${nm} · avatar`, need44: true });
    const nameLink = it.identity?.querySelector("a");
    if (nameLink) controls.push({ el: nameLink, label: `${nm} · name`, need44: false });
    for (const a of it.p?.querySelectorAll("a") ?? []) controls.push({ el: a, label: `${nm} · link "${a.textContent.trim().slice(0, 16)}"`, need44: false });
  }
  for (const t of toggles) controls.push({ el: t, label: `"${t.textContent.trim()}"`, need44: true });

  const owns = (c, x, y) => {
    const at = document.elementFromPoint(x, y);
    return !!at && (at === c.el || c.el.contains(at));
  };
  const VW = innerWidth, VH = innerHeight;
  for (const c of controls) {
    // Bring it out from under the pinned composer / sheet edge first: the thread scrolls.
    c.el.scrollIntoView({ block: "center", inline: "nearest" });
    const b = r(c.el);
    if (b.width === 0 || b.height === 0) continue;
    if (b.top < 0 || b.bottom > VH || b.left < 0 || b.right > VW) continue; // off screen: not judged
    // (1) OWN BOX — every pixel of its painted box (1 px grid, 1 px inset).
    let stolen = 0, total = 0, by = null;
    for (let y = Math.ceil(b.top + 1); y <= b.bottom - 1; y++) {
      for (let x = Math.ceil(b.left + 1); x <= b.right - 1; x++) {
        total++;
        if (!owns(c, x, y)) {
          stolen++;
          if (!by) { const at = document.elementFromPoint(x, y); by = at ? `${at.tagName.toLowerCase()} "${(at.getAttribute("aria-label") || at.textContent || "").trim().slice(0, 20)}"` : "nothing"; }
        }
      }
    }
    // (2) RUNS — longest vertical run in any column of its box, horizontal in any row.
    let vrun = 0, hrun = 0;
    // Half-pixel steps along the run (and pixel centres across it): a 44 px box at a fractional
    // offset reads 43 on an integer grid in one engine and 44 in another (Firefox, 320 px).
    for (let x = Math.floor(b.left) + 0.5; x <= b.right; x++) {
      let run = 0;
      for (let y = Math.max(0, Math.floor(b.top - 48)) + 0.25; y <= Math.min(VH - 1, b.bottom + 48); y += 0.5) {
        if (owns(c, x, y)) { run += 0.5; vrun = Math.max(vrun, run); } else run = 0;
      }
    }
    for (let y = Math.floor(b.top) + 0.5; y <= b.bottom; y++) {
      let run = 0;
      for (let x = Math.max(0, Math.floor(b.left - 48)) + 0.25; x <= Math.min(VW - 1, b.right + 48); x += 0.5) {
        if (owns(c, x, y)) { run += 0.5; hrun = Math.max(hrun, run); } else run = 0;
      }
    }
    /*
     * THE ONE GEOMETRIC EXCEPTION, MEASURED AND NAMED, NOT HIDDEN.
     * When a LINK in the comment's text (a reply's "@Name") sits directly above
     * Reply, the band Reply's columns can own is: the link's bottom → the next
     * comment's name ≈ 2 + 4 + 16 + 16 + 1 = 39 px. The link wins its own
     * pixels (F-109), so Reply keeps 44 wide and ≥ 32 tall there (the repo's
     * tap floor, long ≥ 44 / short ≥ 32) — and 44 × 44 everywhere else.
     */
    const linkAbove = !!c.p && [...c.p.querySelectorAll("a")].some((a) => {
      const ab = r(a);
      return ab.bottom > b.top - 17 && ab.bottom <= b.top + 1 && ab.left < b.right + 8 && ab.right > b.left - 8;
    });
    const needV = linkAbove ? 32 : LIMITS.hit;
    out.hits.push({ label: c.label, box: `${Math.round(b.width)}x${Math.round(b.height)}`, run: `${hrun}x${vrun}`, stolen, ...(linkAbove ? { linkAbove: true } : {}) });
    if (stolen > 0) fail.push(`${c.label}: ${stolen} of its own ${total} box pixels go to ${by}`);
    if (c.need44 && (vrun < needV - 0.5 || hrun < LIMITS.hit - 0.5)) fail.push(`${c.label}: a finger gets ${hrun} x ${vrun} px (≥ ${LIMITS.hit} x ${needV}${linkAbove ? ", a link sits right above it" : ""})`);
  }

  if (document.scrollingElement.scrollWidth > innerWidth + 1) fail.push(`the page scrolls sideways (${document.scrollingElement.scrollWidth} > ${innerWidth})`);
  return { ...out, fail };
}

/** Labels the measured gaps on the page itself (for the Owner's PNGs). */
function annotate() {
  const lay = document.createElement("div");
  lay.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
  document.body.appendChild(lay);
  // Only label what is on screen: a row scrolled under the pinned composer is not in the picture.
  const view = document.querySelector("[data-comment-id]")?.closest(".overflow-y-auto")?.getBoundingClientRect()
    ?? { top: 0, bottom: innerHeight };
  const tag = (x, y, h, text, color) => {
    if (y < view.top || y + h > view.bottom) return;
    const line = document.createElement("div");
    line.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:2px;height:${Math.max(1, h)}px;background:${color}`;
    const t = document.createElement("div");
    t.textContent = text;
    t.style.cssText = `position:fixed;left:${x + 4}px;top:${y + h / 2 - 7}px;font:600 10px/14px system-ui,sans-serif;color:#fff;background:${color};padding:0 3px;border-radius:3px`;
    lay.append(line, t);
  };
  const lineBox = (el) => {
    const range = document.createRange(); range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((x) => x.width > 0);
    if (!rects.length) return null;
    const lh = parseFloat(getComputedStyle(el).lineHeight) || rects[0].height;
    const f = rects[0], l = rects[rects.length - 1];
    return { top: (f.top + f.bottom) / 2 - lh / 2, bottom: (l.top + l.bottom) / 2 + lh / 2, left: f.left };
  };
  const rows = [...document.querySelectorAll("[data-comment-id]")].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  rows.forEach((row, i) => {
    const p = row.querySelector("p");
    const reply = [...row.querySelectorAll("button")].find((b) => b.textContent.trim() === "Reply");
    const av = row.firstElementChild.getBoundingClientRect();
    if (p && reply) {
      const pl = lineBox(p), rl = lineBox(reply);
      tag(av.left - 10, pl.bottom, rl.top - pl.bottom, `${(rl.top - pl.bottom).toFixed(0)}`, "#d9480f");
      const next = rows[i + 1];
      if (next) {
        const nTop = next.firstElementChild.firstElementChild.getBoundingClientRect().top;
        const tg = [...document.querySelectorAll("[data-comment-replies-toggle]")]
          .find((t) => t.getBoundingClientRect().top >= rl.bottom - 1 && t.getBoundingClientRect().bottom <= nTop + 1);
        if (tg) {
          const tl = lineBox(tg.querySelector("span:last-child") ?? tg);
          tag(av.left - 10, rl.bottom, tl.top - rl.bottom, `${(tl.top - rl.bottom).toFixed(0)}`, "#1971c2");
          tag(av.left - 10, tl.bottom, nTop - tl.bottom, `${(nTop - tl.bottom).toFixed(0)}`, "#1971c2");
        } else {
          tag(av.left - 10, rl.bottom, nTop - rl.bottom, `${(nTop - rl.bottom).toFixed(0)}`, "#1971c2");
        }
      }
    }
    const heart = row.querySelector("button[aria-pressed]");
    if (heart) {
      const h = heart.getBoundingClientRect();
      if (h.top < view.top || h.bottom > view.bottom) return;
      const o = document.createElement("div");
      o.style.cssText = `position:fixed;left:${h.left}px;top:${h.top}px;width:${h.width}px;height:${h.height}px;outline:1px dashed #2f9e44`;
      lay.append(o);
    }
  });
}

await waitUp().catch((e) => { console.error(e.message); stop(); process.exit(2); });
if (OUT) mkdirSync(OUT, { recursive: true });
const launchers = { chromium, firefox, webkit };
const results = [];
let failed = 0;
for (const engine of ENGINES) {
  const browser = await launchers[engine].launch();
  for (const s of SCENES) {
    const ctx = await browser.newContext({
      viewport: s.viewport, deviceScaleFactor: 2, reducedMotion: "reduce",
      ...(s.viewport.width < 768 && engine !== "firefox" ? { isMobile: true, hasTouch: true } : {}),
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/commentsharness.html?${s.query}`, { waitUntil: "load", timeout: 120000 });
    try {
      await page.waitForSelector("[data-comment-id]", { timeout: 20000 });
    } catch {
      results.push({ engine, scene: s.name, fail: ["no comment row ([data-comment-id]) rendered"] });
      console.log(`FAIL ${engine.padEnd(8)} ${s.name}\n   ✗ no comment row ([data-comment-id]) rendered`);
      failed++;
      if (OUT && engine === "chromium") {
        const box = await page.$("[role='dialog']") ?? await page.$("#entrywrap");
        await (box ?? page).screenshot({ path: join(OUT, `${s.name}.png`), animations: "disabled" }).catch(() => {});
      }
      await ctx.close();
      continue;
    }
    // Names and badges arrive a beat after the rows (profile map); wait for a stable layout.
    await page.waitForFunction(() => {
      const sig = [...document.querySelectorAll("[data-comment-id]")].map((e) => `${e.textContent}|${Math.round(e.getBoundingClientRect().height)}`).join("/");
      const same = window.__ccSig === sig; window.__ccSig = sig; return same && !/Photographer/.test(sig);
    }, undefined, { polling: 300, timeout: 15000 }).catch(() => {});
    if (s.open) {
      for (const t of await page.$$("[data-comment-replies-toggle][aria-expanded='false']")) await t.click();
      await page.waitForTimeout(300);
    }
    await page.mouse.move(1, 1);
    const m = await page.evaluate(measureInPage, { LIMITS });
    results.push({ engine, scene: s.name, ...m });
    if (m.fail.length) failed++;
    console.log(`${m.fail.length ? "FAIL" : "PASS"} ${engine.padEnd(8)} ${s.name}`);
    for (const row of m.rows) console.log(`       ${row.name.padEnd(24)} avatar ${row.avatar}  name→text ${row.nameToText ?? "-"}  text→Reply ${row.textToMeta ?? "-"}  heartΔ ${row.heartDelta ?? "-"}${row.indent != null ? `  indent ${row.indent}` : ""}`);
    for (const p of m.pairs) console.log(`       ${p.name.padEnd(40)} ${p.next != null ? `→ next ${p.next}` : `→ toggle ${p.toToggle}, toggle → next ${p.toggleToNext}`}`);
    for (const f of m.fail) console.log(`   ✗ ${f}`);
    if (OUT && engine === "chromium") {
      // The hit sweep scrolled the thread; photograph it from the top.
      await page.evaluate(() => { for (const el of document.querySelectorAll(".overflow-y-auto")) el.scrollTop = 0; window.scrollTo(0, 0); });
      if (ANNOTATE) await page.evaluate(annotate);
      const box = await page.$("[role='dialog']") ?? await page.$("#entrywrap");
      await (box ?? page).screenshot({ path: join(OUT, `${s.name}.png`), animations: "disabled" });
    }
    await ctx.close();
  }
  await browser.close();
}
stop();
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ limits: LIMITS, results }, null, 2));
console.log(failed ? `\n${failed} scene run(s) FAIL — the comment list is not Instagram-compact.` : `\nAll ${results.length} scene runs PASS.`);
process.exit(failed ? 1 : 0);
