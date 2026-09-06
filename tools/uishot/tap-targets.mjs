/**
 * IS EVERY INTERACTIVE ELEMENT AT LEAST 44px TO A FINGER? EVERY SCENE. NO LIST.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS. The UI gate reported ONE tap-target problem on
 * screen-notifications. A full scan of the same page found ELEVEN at 360px, and
 * the Auditor's scan of the deployed page found THIRTY-TWO. The gate was not
 * wrong about the one; it simply was not asking about the rest.
 *
 * Eight times today an instrument that ENUMERATED WHAT TO CHECK failed to see
 * what nobody enumerated — the SURFACES list that missed the sidebar and then
 * missed /notifications, the fixture too small to contain the defect, the probe
 * that skipped a scene rendering nobody. So this enumerates nothing. It takes
 * every element matching the interactive selector, on every scene the harness
 * offers, and measures it.
 *
 * ⚠ IT MEASURES THE HIT AREA, NOT THE PAINTED BOX. The fix for a 28px icon is
 * NOT to make the icon bigger — 28px is the design — it is to extend the
 * touchable region around it, which `.tap-44` does with an ::after that paints
 * nothing and moves no layout. getBoundingClientRect() cannot see a
 * pseudo-element, so a probe reading only the element's own rect would report
 * a correctly-fixed control as still broken, and somebody would then "fix" it
 * by making the icon bigger. The union of the element's rect and its ::after
 * box is the honest number.
 *
 * A control is EXEMPT only if it is invisible to a finger anyway: zero-sized,
 * display:none, visibility:hidden, or pointer-events:none.
 *
 *   npm run ui:harness    # in one shell, with the VITE_* vars set
 *   node tools/uishot/tap-targets.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { chromium } from "playwright";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * A RATCHET, NOT A GATE — AND THAT IS A DELIBERATE CHOICE, NOT A COMPROMISE.
 *
 * The first full run measured 250 controls under 44px across 48 scenes:
 * screen-dashboard 29 of 57, screen-feed 20 of 71, screen-notifications 15 of
 * 63, every not-found variant 7 or 8. This is site-wide and it is YEARS OLD.
 * 216 files under src/ use a raw <button>, so the fix in the shared component
 * reaches almost none of them.
 *
 * A check that fails every scene blocks every pull request for ever, and it
 * gets switched off inside a week — and then there is neither the check nor the
 * fix. So this fails only when a scene gets WORSE than its recorded baseline.
 * The bleeding stops tonight without demanding an impossible repair tonight,
 * and every future change that lowers a number lowers the baseline with it.
 *
 * ⚠ THE BASELINE IS A DEBT, NOT A STANDARD. Every number in it above zero is a
 * control somebody cannot reliably tap. Lowering them is the work, written up
 * as its own item in docs/evidence/d2/F-104-raw-buttons.md rather than left as
 * a footnote for someone to rediscover in three weeks and file as new.
 *
 * Run with UPDATE_TAP_BASELINE=1 to re-record. Never do that to make a red go
 * away: a baseline raised to fit a regression is Standing Rule 19 in reverse.
 * ═══════════════════════════════════════════════════════════════════════════
 */
const BASELINE_PATH = "tools/uishot/tap-targets.baseline.json";
const UPDATE = process.env.UPDATE_TAP_BASELINE === "1";
const baseline = existsSync(BASELINE_PATH)
  ? JSON.parse(readFileSync(BASELINE_PATH, "utf8"))
  : null;

const BASE = process.env.UI_HARNESS_BASE ?? "http://127.0.0.1:5199";
const FLOOR = 44;
/* The phone the Owner actually holds. A desktop reading is not the phone's:
   fixed icon buttons hold their size, but anything fluid does not, and the
   mobile bottom navigation does not exist at desktop width at all. */
const VIEWPORT = { width: 360, height: 800 };

const browser = await chromium.launch({ executablePath: chromePath() });
const probe = await browser.newPage();
await probe.goto(`${BASE}/uiharness.html`, { waitUntil: "networkidle" });
const scenes = await probe.$$eval("a[href^='?scene=']", (as) =>
  as.map((a) => new URL(a.href).searchParams.get("scene")).filter(Boolean),
);
await probe.close();

if (scenes.length === 0) {
  console.error("no scenes found — the harness is not serving; refusing to pass vacuously");
  process.exit(2);
}

let checked = 0;
const failures = [];
const improved = [];
const unrecorded = [];
const counts = {};

for (const scene of scenes) {
  const ctx = await browser.newContext({
    viewport: VIEWPORT, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/uiharness.html?scene=${scene}`, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => {
      const n = document.querySelectorAll('button, a, [role="button"], input, select, textarea').length;
      const prev = window.__tapCount;
      window.__tapCount = n;
      return prev !== undefined && prev === n;
    },
    undefined,
    { timeout: 10000, polling: 250 },
  ).catch(() => {});

  const found = await page.evaluate((floor) => {
    const SEL = 'button, a, [role="button"], input, select, textarea';
    const out = [];
    const clipped = [], stolen = [];
    const describe = (n) => {
      const c = typeof n.className === "string"
        ? n.className.split(/\s+/).filter(Boolean).slice(0, 2).join(".") : "";
      const t = (n.getAttribute && (n.getAttribute("aria-label") || n.textContent) || "").trim().slice(0, 20);
      return `${n.tagName.toLowerCase()}${c ? "." + c : ""}${t ? ` "${t}"` : ""}`;
    };
    for (const el of document.querySelectorAll(SEL)) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.pointerEvents === "none") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;

      // The ::after hit region, which the rect cannot see.
      const after = getComputedStyle(el, "::after");
      let hitW = r.width, hitH = r.height;
      const region = { l: r.left, t: r.top, r: r.right, b: r.bottom, grown: false };
      if (after && after.content && after.content !== "none") {
        const px = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
        hitW = Math.max(hitW, px(after.minWidth), px(after.width));
        hitH = Math.max(hitH, px(after.minHeight), px(after.height));
        region.grown = hitW > r.width + 0.5 || hitH > r.height + 0.5;
        const cx = r.left + r.width / 2;
        // `top: 0` means the region is anchored at the control's top and can
        // only grow DOWNWARD (.tap-44-down). Anything else grows from centre.
        const anchoredTop = after.top === "0px" || after.top === "0";
        region.l = cx - hitW / 2;
        region.r = cx + hitW / 2;
        region.t = anchoredTop ? r.top : r.top - (hitH - r.height) / 2;
        region.b = region.t + hitH;
      }
      /*
       * ── F-108 / F-109: WHAT ELSE DOES THIS REGION TOUCH? ──────────────────
       *
       * Both found by the Auditor by hand, both invisible to a size check.
       *
       * F-108: a region that extends past its control can be CLIPPED by an
       * ancestor with overflow:hidden, and getComputedStyle on a pseudo-element
       * cannot see that. Only asking what is actually painted at a coordinate
       * can. elementFromPoint at the region's corners is that question.
       *
       * F-109: a SYMMETRIC region is the wrong default next to text. Text is
       * short and an inline link has no region of its own, so it loses every
       * contested pixel. Measured in the deployed lightbox: Copy Photo Link
       * grew 13.5px UP into a 15px name and took 27% of it — on the very link
       * that night's work had created.
       *
       * Recorded so the next reader knows why this is two questions and not
       * one: a region can claim a neighbour's CENTRE without any two regions
       * intersecting, which is a weaker condition than overlap and is what
       * caught Close taking the nav search button's centre.
       */
      if (region.grown) {
        for (const [cx, cy, corner] of [
          [region.l + 1, region.t + 1, "top-left"],
          [region.r - 1, region.t + 1, "top-right"],
          [region.l + 1, region.b - 1, "bottom-left"],
          [region.r - 1, region.b - 1, "bottom-right"],
        ]) {
          if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) continue;
          const at = document.elementFromPoint(cx, cy);
          // Clipped: the corner of our own hit region is painted by something
          // that is neither us nor a descendant, and is not another control.
          if (at && at !== el && !el.contains(at) && !at.matches(SEL)) {
            clipped.push(`${describe(el)} ${corner} of its hit region is painted by ${describe(at)}`);
            break;
          }
        }
        for (const other of document.querySelectorAll(SEL)) {
          if (other === el || el.contains(other) || other.contains(el)) continue;
          const o = other.getBoundingClientRect();
          if (o.width === 0 || o.height === 0) continue;
          const ocx = o.left + o.width / 2, ocy = o.top + o.height / 2;
          if (ocx >= region.l && ocx <= region.r && ocy >= region.t && ocy <= region.b) {
            const at = document.elementFromPoint(ocx, ocy);
            /*
             * REPORT THE PAINTER, NOT MERELY THE COLLISION. Whether a claimed
             * centre MATTERS depends on what was already covering that point:
             * Close claiming the nav search button's centre was harmless
             * because a full-screen modal already covered it, while the same
             * mechanism next to a name took a quarter of the name. A bare
             * collision count would shout about the first and say nothing
             * useful about the second.
             */
            stolen.push(
              `${describe(el)} hit region contains the centre of ${describe(other)}` +
              ` — that point is painted by ${at ? describe(at) : "nothing"}`,
            );
            continue;
          }
          /*
           * ⚠ THE CENTRE TEST ALONE IS NOT ENOUGH, AND A PLANT PROVED IT.
           *
           * Restoring the symmetric region on Copy Photo Link did NOT trip the
           * centre test, correctly: the name's bottom sits 8px above the button
           * (mt-2), the region reaches 13.5px up — 5.5px past the name's bottom
           * — and the name's centre is 7px up. So it ate the name's bottom
           * pixels WITHOUT EVER REACHING ITS CENTRE. That is the exact case
           * that cost 27% of the photographer's name.
           *
           * So the region is also tested against the other control's BOX. Any
           * real overlap where WE win the contested pixels is a fault: the
           * neighbour loses part of its target to us.
           */
          const ox = Math.max(0, Math.min(region.r, o.right) - Math.max(region.l, o.left));
          const oy = Math.max(0, Math.min(region.b, o.bottom) - Math.max(region.t, o.top));
          if (ox > 0.5 && oy > 0.5) {
            const mx = (Math.max(region.l, o.left) + Math.min(region.r, o.right)) / 2;
            const my = (Math.max(region.t, o.top) + Math.min(region.b, o.bottom)) / 2;
            const at2 = document.elementFromPoint(mx, my);
            // Only a fault if WE take the pixels. If the neighbour still wins
            // them, its target is intact and nothing was stolen.
            if (at2 && (at2 === el || el.contains(at2))) {
              const pct = Math.round((oy / o.height) * 100);
              stolen.push(
                `${describe(el)} hit region covers ${Math.round(ox)}x${Math.round(oy)}px of ` +
                `${describe(other)} (${pct}% of its height) and WINS those pixels`,
              );
            }
          }
        }
      }
      if (hitW >= floor && hitH >= floor) continue;
      out.push({
        tag: el.tagName.toLowerCase(),
        cls: typeof el.className === "string"
          ? el.className.split(/\s+/).filter(Boolean).slice(0, 2).join(".") : "",
        label: (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 30),
        w: +r.width.toFixed(1), h: +r.height.toFixed(1),
        hitW: +hitW.toFixed(1), hitH: +hitH.toFixed(1),
      });
    }
    return { total: document.querySelectorAll(SEL).length, small: out, clipped, stolen };
  }, FLOOR);

  checked += found.total;
  counts[scene] = found.small.length;
  const was = baseline?.scenes?.[scene];
  const n = found.small.length;

  if (was === undefined) {
    // A scene nobody has measured yet cannot regress, but it must not slip in
    // silently either — an unrecorded scene is how a surface stays unexamined.
    console.log(`NEW  ${scene.padEnd(36)} ${n} under ${FLOOR}px of ${found.total} — not in the baseline`);
    if (!UPDATE) unrecorded.push(`${scene} (${n})`);
  } else if (n > was) {
    console.log(`WORSE ${scene.padEnd(35)} ${n} under ${FLOOR}px, baseline ${was} — REGRESSION`);
    for (const f of found.small) {
      console.log(`       ${String(f.hitW).padStart(6)} x ${String(f.hitH).padEnd(6)}  ${f.tag}.${f.cls.padEnd(30)} ${f.label}`);
    }
    failures.push(`${scene}: ${n} under ${FLOOR}px, was ${was}`);
  } else if (n < was) {
    console.log(`BETTER ${scene.padEnd(34)} ${n} under ${FLOOR}px, baseline ${was} — ratchet down`);
    improved.push(`${scene}: ${was} -> ${n}`);
  } else {
    console.log(`held ${scene.padEnd(36)} ${n} under ${FLOOR}px of ${found.total} (baseline ${was})`);
  }
  await ctx.close();
}
await browser.close();

const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`\n${checked} interactive elements measured across ${scenes.length} scenes at ${VIEWPORT.width}px.`);
console.log(`${total} under ${FLOOR}px — the standing debt.`);

if (UPDATE) {
  writeFileSync(BASELINE_PATH, JSON.stringify({
    note: "Controls under 44px per scene. A DEBT, not a standard. Lowering these is the work; raising one is a regression.",
    recorded: new Date().toISOString().slice(0, 10),
    viewport: VIEWPORT,
    floor: FLOOR,
    total,
    scenes: counts,
  }, null, 2) + "\n");
  console.log(`baseline re-recorded to ${BASELINE_PATH} (total ${total}).`);
  process.exit(0);
}

if (improved.length) {
  console.log(`\n${improved.length} scene(s) IMPROVED — re-record the baseline so the gain is locked in:`);
  for (const i of improved) console.log(`  ${i}`);
}
if (unrecorded.length) {
  console.log(`\n${unrecorded.length} scene(s) are NOT in the baseline: ${unrecorded.join(", ")}`);
}
if (failures.length) {
  console.log(`\n${failures.length} scene(s) got WORSE than baseline:`);
  for (const f of failures) console.log(`  ${f}`);
}
/*
 * ⚠ NOT RATCHETED. The size debt is hundreds of controls old and needs a
 * baseline to stop the bleeding without demanding an impossible repair. A
 * region that clips, or claims another control's centre, is DIFFERENT: it can
 * only exist where somebody has ADDED a hit region, which is new work by
 * definition, so there is no legacy to grandfather. Every one of these is ours
 * and every one fails.
 */
if (regionFaults.length) {
  console.log(`\n${regionFaults.length} hit-region fault(s) — a region that clips, or claims another control's centre:`);
  for (const f of regionFaults) console.log(`  ${f}`);
}
/*
 * An unrecorded scene fails too. Otherwise a new surface arrives carrying any
 * number of untappable controls and the ratchet says nothing — which is the
 * silent-zero shape that has caught us repeatedly today.
 */
process.exit(failures.length === 0 && unrecorded.length === 0 && regionFaults.length === 0 ? 0 : 1);
