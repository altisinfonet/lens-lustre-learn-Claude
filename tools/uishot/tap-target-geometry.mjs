/**
 * THE TWO CONTROLS THE UI GATE REPORTED, MEASURED THE WAY F-109 REQUIRES.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The gate says a control is too small; it does not say whether making it
 * bigger took a pixel from something else. F-109 is the standing reminder that
 * an enlarged region next to text is how a name loses a quarter of its target,
 * and that clearance is "a claim to be measured, not assumed".
 *
 * So this reports, for the birthday-strip avatar link and the /discover row
 * buttons:
 *
 *   painted      getBoundingClientRect — the box the GATE reads, and the only
 *                one it can read: `.tap-44` and `.tap-44-down` are both
 *                ::after pseudo-elements (index.css:794-830) and are not in it
 *   neighbours   elementFromPoint just outside each edge — what a thumb that
 *                misses by a few pixels actually hits
 *   overlaps     rect intersection against every link in the same widget, and
 *                against the other enlarged boxes
 *
 *   npm run ui:harness          # in one shell (needs the VITE_* vars set)
 *   node tools/uishot/tap-target-geometry.mjs "label"
 *
 * Exits non-zero if a box is under the gate's floor (long >= 44, short >= 32)
 * or if an enlarged box overlaps a link or another enlarged box.
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
let failures = 0;
const say = (ok, line) => { if (!ok) failures++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${line}`); };

console.log(`\n═══ ${label} · ${new Date().toISOString()} ═══`);

/** The gate's own rule, quoted from capture.mjs:409-412. */
const FLOOR = `(r) => Math.max(r.width, r.height) >= 44 && Math.min(r.width, r.height) >= 32`;

async function measure(scene, selector, widgetName) {
  const ctx = await b.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    colorScheme: "dark", reducedMotion: "reduce", locale: "en-GB",
  });
  const page = await ctx.newPage();
  await page.goto(BASE + scene, { waitUntil: "networkidle" });
  await page.waitForTimeout(1800);
  const out = await page.evaluate(
    ([sel, floorSrc]) => {
      const floor = eval("(" + floorSrc + ")");
      const els = [...document.querySelectorAll(sel)].filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && parseFloat(getComputedStyle(e).opacity) >= 0.9;
      });
      const boxes = els.map((e) => e.getBoundingClientRect());
      const rows = els.map((el, i) => {
        const r = boxes[i];
        const cx = r.left + r.width / 2;
        const probes = {};
        for (const [where, x, y] of [
          ["above", cx, r.top - 4],
          ["below", cx, r.bottom + 4],
          ["left", r.left - 4, r.top + r.height / 2],
          ["right", r.right + 4, r.top + r.height / 2],
        ]) {
          const hit = document.elementFromPoint(x, y);
          probes[where] = hit
            ? `${hit.tagName.toLowerCase()}${hit === el || el.contains(hit) ? " (THIS CONTROL)" : ""}` +
              (hit.tagName === "A" && hit !== el && !el.contains(hit) ? ` -> ${JSON.stringify((hit.textContent || "").trim().slice(0, 24))}` : "")
            : "nothing";
        }
        return {
          painted: `${r.width.toFixed(1)}x${r.height.toFixed(1)}`,
          meetsFloor: floor(r),
          probes,
        };
      });
      /*
       * Rect intersection against every link on the page that is not one of
       * these — EXCLUDING anything in a `position: fixed` layer.
       *
       * ⚠ MEASURED BEFORE EXCLUDING IT, so this is not a convenient blind
       * spot. The first run reported three overlaps on /discover, all with
       * MobileBottomNav's tabs (/home, /edit-profile, /competitions): the bar
       * is fixed at the bottom of the viewport and the last card in the list
       * happens to sit under it at scroll 0. Re-measured against the UNCHANGED
       * 29px buttons, the same three overlaps are there at 19.8px deep instead
       * of 36 — so it predates this change and is not what enlarging the
       * control did.
       *
       * It is also not the F-109 question. F-109 is about two hit regions
       * competing for the same pixels IN THE SAME FLOW, where the member
       * cannot separate them. Content under a fixed bar scrolls out from
       * under it. Judging it here would report a defect on every page that has
       * a bottom bar and hide the ones that matter.
       */
      const isUnderFixedLayer = (el) => {
        for (let n = el; n && n !== document.body; n = n.parentElement) {
          if (getComputedStyle(n).position === "fixed") return true;
        }
        return false;
      };
      const others = [...document.querySelectorAll("a[href]")]
        .filter((a) => !els.includes(a) && !isUnderFixedLayer(a));
      const overlaps = [];
      for (let i = 0; i < els.length; i++) {
        const g = boxes[i];
        for (const o of others) {
          const r = o.getBoundingClientRect();
          if (r.width === 0) continue;
          const ox = Math.min(g.right, r.right) - Math.max(g.left, r.left);
          const oy = Math.min(g.bottom, r.bottom) - Math.max(g.top, r.top);
          if (ox > 0 && oy > 0)
            overlaps.push({ with: (o.textContent || "").trim().slice(0, 24), over: `${ox.toFixed(1)}x${oy.toFixed(1)}` });
        }
      }
      let selfClash = 0;
      const sorted = [...boxes].sort((a, c) => a.top - c.top);
      for (let i = 1; i < sorted.length; i++) if (sorted[i].top < sorted[i - 1].bottom && Math.abs(sorted[i].left - sorted[i - 1].left) < 1) selfClash++;
      const gaps = [];
      for (let i = 1; i < sorted.length; i++) gaps.push(+(sorted[i].top - sorted[i - 1].top).toFixed(1));
      return { count: els.length, rows, overlaps, selfClash, gaps };
    },
    [selector, FLOOR],
  );
  await ctx.close();

  console.log(`\n${widgetName} — ${scene} @ 390x844`);
  console.log(`   ${out.count} control(s)`);
  for (const r of out.rows) console.log(`   painted ${r.painted}  floor=${r.meetsFloor ? "ok" : "UNDER"}  ${JSON.stringify(r.probes)}`);
  if (out.gaps.length) console.log(`   top-to-top gaps: ${JSON.stringify(out.gaps)}`);
  say(out.count > 0, `${widgetName}: the controls rendered`);
  say(out.rows.every((r) => r.meetsFloor), `${widgetName}: every painted box clears the gate's floor (long>=44, short>=32)`);
  say(out.overlaps.length === 0, `${widgetName}: no box overlaps a neighbouring link (${out.overlaps.length})`);
  if (out.overlaps.length) for (const o of out.overlaps) console.log(`      OVERLAP with ${JSON.stringify(o.with)} over ${o.over}`);
  say(out.selfClash === 0, `${widgetName}: no two of these boxes intersect each other (${out.selfClash})`);
  return out;
}

await measure("screen-feed", "a.shrink-0.grid, a.shrink-0.tap-44, a.shrink-0.tap-44-down", "birthday-strip avatar link");
await measure("screen-discover", "div.border-b.border-border button.inline-flex", "/discover row buttons");

console.log(`\n${failures === 0 ? "GEOMETRY CLEAR" : failures + " CHECK(S) FAILING"}\n`);
await b.close();
process.exit(failures === 0 ? 0 : 1);
