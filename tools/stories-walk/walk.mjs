/**
 * Stories v2 — signed-in walk on STAGING with two throwaway members (A posts,
 * B watches). Real site, real database; every step leaves a screenshot and a
 * PASS/FAIL line, and the run fails if any check failed.
 *
 *   SITE        https://staging.50mmretina.com (refused if it is not staging)
 *   EMAIL_A / EMAIL_B / WALK_PW   from the workflow (never printed)
 *   OUT         screenshot folder
 *
 * Owner order 6 Nov 2026 ("go stories"); test design approved 7 Nov
 * ("Make 2 test members").
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SITE = process.env.SITE || "https://staging.50mmretina.com";
if (!/^https:\/\/staging\.50mmretina\.com$/.test(SITE)) { console.error("REFUSED: not the staging site"); process.exit(2); }
const OUT = process.env.OUT || "/tmp/stories-walk";
const { EMAIL_A, EMAIL_B, WALK_PW } = process.env;
if (!EMAIL_A || !EMAIL_B || !WALK_PW) { console.error("missing EMAIL_A / EMAIL_B / WALK_PW"); process.exit(2); }
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const step = async (name, fn) => {
  try { await fn(); } catch (e) { check(name, false, String(e?.message || e).split("\n")[0]); }
};

const PHONE = { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESKTOP = { viewport: { width: 1440, height: 900 } };
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) });
const browser = await chromium.launch();

/** A 1200×1500 test photo drawn by the browser itself (PNG). */
const painter = await (await browser.newContext({ viewport: { width: 1200, height: 1500 } })).newPage();
const photo = async (r, g, b, label) => {
  await painter.setContent(`<body style="margin:0;width:1200px;height:1500px;background:rgb(${r},${g},${b});display:flex;align-items:center;justify-content:center;font:bold 120px sans-serif;color:#fff">${label}</body>`);
  return { name: `${label.replace(/\s+/g, "-")}.png`, mimeType: "image/png", buffer: await painter.screenshot({ type: "png" }) };
};
const apiErrors = [];

async function member(email, opts, tag) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on("response", (r) => {
    const u = r.url();
    if (r.status() >= 400 && /supabase\.co\/(rest|auth|storage)\//.test(u) && !/\/auth\/v1\/token/.test(u)) {
      apiErrors.push(`${tag} ${r.status()} ${r.request().method()} ${u.replace(/\?.*$/, "")}`);
    }
  });
  await page.goto(`${SITE}/login`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Essential only" }).first().click({ timeout: 4000 }).catch(() => {});
  await page.locator('input[type="email"]').first().fill(email);
  const pw = page.locator('input[type="password"]').first();
  await pw.fill(WALK_PW);
  await pw.press("Enter");
  await page.waitForURL(/\/feed/, { timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.keyboard.press("Escape").catch(() => {});
  return { ctx, page };
}

const storyTile = (page, name) => page.locator("button", { hasText: name }).first();
const viewer = (page) => page.locator('[aria-label="Add a comment"], button:has-text("Highlight")').first();

// ── A posts two photos with "Also add to my story" ticked ─────────────────
const A = await member(EMAIL_A, PHONE, "A");
check("A signs in and lands on the feed", /\/feed/.test(A.page.url()), A.page.url());
await shot(A.page, "01-A-feed-before");

const CAPTION = `Stories walk ${new Date().toISOString().slice(0, 16)}`;
await step("A posts 2 photos with the story box ticked", async () => {
  const p = A.page;
  await p.getByText("What's on your mind?").first().click({ timeout: 10000 });
  await p.waitForTimeout(1200);
  await p.locator('input[type="file"][multiple]').first().setInputFiles([await photo(40, 90, 140, "Slide 1"), await photo(60, 120, 60, "Slide 2")]);
  await p.waitForTimeout(3000);
  const box = p.locator('[data-testid="add-to-story"]').first();
  await box.scrollIntoViewIfNeeded();
  const ticked = await box.locator('input[type="checkbox"]').isChecked();
  check("the 'Also add to my story' box is there and ticked by default", ticked);
  await shot(p, "02-A-composer-box");
  await p.getByRole("group", { name: "Categories" }).getByRole("button").first().click();
  const text = p.locator('textarea, [contenteditable="true"]').first();
  await text.click().catch(() => {});
  await p.keyboard.type(CAPTION);
  await p.getByRole("button", { name: "Post", exact: true }).click();
  await p.getByText(CAPTION).first().waitFor({ timeout: 90000 });
  check("the post appears in A's feed", true);
});

let storyOk = false;
await step("A's post becomes A's story", async () => {
  const p = A.page;
  for (let i = 0; i < 12 && !storyOk; i++) {
    await p.waitForTimeout(5000);
    await p.goto(`${SITE}/feed`, { waitUntil: "domcontentloaded" });
    await p.waitForTimeout(3000);
    const own = p.locator("button", { hasText: "Your Story" }).first();
    storyOk = (await own.locator("img").count()) > 0;
  }
  check("the 'Your Story' tile shows the new story photo", storyOk);
  await shot(p, "03-A-feed-your-story");
});

// ── B sees A's story, comments and likes ──────────────────────────────────
const B = await member(EMAIL_B, PHONE, "B");
const COMMENT = "Lovely light — walk comment";
await step("B sees A's story in the row and opens it", async () => {
  const p = B.page;
  await p.waitForTimeout(2000);
  const tile = storyTile(p, "Walk Tester A");
  await tile.waitFor({ timeout: 20000 });
  check("B's row has a tile for Walk Tester A", true);
  await shot(p, "04-B-feed-row");
  await tile.click();
  await viewer(p).waitFor({ timeout: 15000 });
  await p.getByRole("button", { name: "Pause" }).click().catch(() => {});
  const bars = await p.locator(".h-\\[3px\\].flex-1").count();
  check("the viewer shows one bar per photo (2)", bars === 2, `${bars} bars`);
  check("the viewer offers 'View post'", (await p.getByText("View post").count()) > 0);
  await shot(p, "05-B-viewer");
  await p.locator('[aria-label="Add a comment"]').fill(COMMENT);
  await p.getByRole("button", { name: "Send" }).click();
  await p.getByRole("button", { name: "Like" }).click();
  await p.waitForTimeout(2500);
  check("B's like shows as liked", (await p.getByRole("button", { name: "Unlike" }).count()) > 0);
  check("B's comment floats on the story", (await p.getByText(COMMENT).count()) > 0);
  await shot(p, "06-B-viewer-commented");
  await p.getByText("View post").first().click();
  await p.waitForURL(/\/post\//, { timeout: 15000 });
  await p.getByText(COMMENT).first().waitFor({ timeout: 20000 });
  check("the story comment is a post comment (shown under the post)", true);
  await shot(p, "07-B-post-has-comment");
});

// ── A sees the counts on the own story ────────────────────────────────────
await step("A sees seen / likes / comments on the own story", async () => {
  const p = A.page;
  await p.goto(`${SITE}/feed`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(3000);
  await p.locator("button", { hasText: "Your Story" }).first().click();
  await p.getByText("Highlight").first().waitFor({ timeout: 15000 });
  await p.getByRole("button", { name: "Pause" }).click().catch(() => {});
  await p.waitForTimeout(1500);
  const counts = await p.locator("span.flex.items-center.gap-1\\.5").allInnerTexts();
  check("own story shows 1 seen · 1 like · 1 comment", counts.join(",") === "1,1,1", `got ${counts.join(" · ")}`);
  check("B's comment floats on A's own story", (await p.getByText(COMMENT).count()) > 0);
  await shot(p, "08-A-own-story-counts");
  await p.getByRole("button", { name: "Close" }).first().click().catch(() => {});
});

// ── a plain story from the row's "+", a plain-story comment, then Delete ──
const PLAIN = "Plain story walk comment";
await step("A adds a plain story with +, B comments, A deletes it", async () => {
  const a = A.page;
  await a.locator('input[type="file"][accept="image/*"]:not([multiple])').first().setInputFiles([await photo(150, 70, 40, "Plain")]);
  await a.waitForTimeout(8000);
  const b = B.page;
  await b.goto(`${SITE}/feed`, { waitUntil: "domcontentloaded" });
  await b.waitForTimeout(3000);
  await storyTile(b, "Walk Tester A").click();
  await viewer(b).waitFor({ timeout: 15000 });
  await b.getByRole("button", { name: "Pause" }).click().catch(() => {});
  const bars = await b.locator(".h-\\[3px\\].flex-1").count();
  check("A now has 3 slides (2 post photos + 1 plain)", bars === 3, `${bars} bars`);
  // go to the newest (plain) slide
  for (let i = 0; i < 2; i++) { await b.getByRole("button", { name: "Next" }).click(); await b.waitForTimeout(700); }
  await b.getByRole("button", { name: "Pause" }).click().catch(() => {});
  check("the plain story has no 'View post'", (await b.getByText("View post").count()) === 0);
  await b.locator('[aria-label="Add a comment"]').fill(PLAIN);
  await b.getByRole("button", { name: "Send" }).click();
  await b.waitForTimeout(2500);
  check("B's plain-story comment floats on it", (await b.getByText(PLAIN).count()) > 0);
  await shot(b, "09-B-plain-story-comment");

  await a.goto(`${SITE}/feed`, { waitUntil: "domcontentloaded" });
  await a.waitForTimeout(3000);
  await a.locator("button", { hasText: "Your Story" }).first().click();
  await a.getByText("Highlight").first().waitFor({ timeout: 15000 });
  for (let i = 0; i < 2; i++) { await a.getByRole("button", { name: "Next" }).click(); await a.waitForTimeout(700); }
  await a.getByRole("button", { name: "Pause" }).click().catch(() => {});
  await a.waitForTimeout(1500);
  check("A sees B's plain-story comment", (await a.getByText(PLAIN).count()) > 0);
  await shot(a, "10-A-plain-story-own");
  await a.getByRole("button", { name: "Delete" }).click();
  await a.getByText("Story removed").first().waitFor({ timeout: 10000 });
  check("Delete removes the plain story", true);
  await a.waitForTimeout(1500);
  const left = await a.locator(".h-\\[3px\\].flex-1").count();
  check("2 slides left after Delete", left === 2, `${left} bars`);
  await shot(a, "11-A-after-delete");
});

// ── the bell link opens the story (/feed?story=<id>) and desktop layout ───
await step("desktop: B's feed row and the viewer with side cards", async () => {
  const D = await member(EMAIL_B, DESKTOP, "B-desktop");
  await shot(D.page, "12-B-desktop-feed");
  await storyTile(D.page, "Walk Tester A").click();
  await viewer(D.page).waitFor({ timeout: 15000 });
  await D.page.getByRole("button", { name: "Pause" }).click().catch(() => {});
  await D.page.waitForTimeout(1500);
  await shot(D.page, "13-B-desktop-viewer");
  check("desktop viewer opens", true);
  await D.ctx.close();
});

check("no Supabase call answered 4xx/5xx during the walk", apiErrors.length === 0, apiErrors.slice(0, 8).join(" | "));
writeFileSync(join(OUT, "results.json"), JSON.stringify({ site: SITE, at: new Date().toISOString(), results, apiErrors }, null, 2));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
