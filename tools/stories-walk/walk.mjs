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
  try {
    // two steps: e-mail → Proceed, then the password
    const mail = page.locator('input[type="email"]').first();
    await mail.fill(email);
    await mail.press("Enter");
    const pw = page.locator('input[type="password"]').first();
    await pw.fill(WALK_PW, { timeout: 15000 });
    await pw.press("Enter");
    await page.waitForURL(/\/feed/, { timeout: 30000 });
  } catch (e) {
    await shot(page, `00-${tag}-sign-in-failed`).catch(() => {});
    throw e;
  }
  await page.waitForTimeout(2500);
  await page.keyboard.press("Escape").catch(() => {});
  return { ctx, page };
}

const storyTile = (page, name) => page.locator("button", { hasText: name }).first();
/** The one story viewer (role=dialog, "Story"); everything in it is scoped to it. */
const V = (page) => page.getByRole("dialog", { name: "Story" });
const bars = (page) => V(page).locator(".h-\\[3px\\].flex-1").count();
const pause = (page) => V(page).getByRole("button", { name: "Pause" }).click({ timeout: 3000 }).catch(() => {});
const feed = async (page) => { await page.goto(`${SITE}/feed`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(3500); };
/** Reload the feed until fn() is true (the server needs a moment after a post). */
const until = async (page, fn, tries = 12) => { for (let i = 0; i < tries; i++) { if (await fn()) return true; await page.waitForTimeout(5000); await feed(page); } return fn(); };

let A, B;
try {
  A = await member(EMAIL_A, PHONE, "A");
  B = await member(EMAIL_B, PHONE, "B");
  check("A and B sign in and land on the feed", true);
} catch (e) {
  check("A and B sign in and land on the feed", false, String(e?.message || e).split("\n")[0]);
}

const CAPTION = `Stories walk ${new Date().toISOString().slice(0, 16)}`;
const COMMENT = "Lovely light - walk comment";
const PLAIN = "Plain story walk comment";

if (A && B) {
  // ── A posts two photos with "Also add to my story" ticked ───────────────
  await shot(A.page, "01-A-feed-before");
  await step("A posts 2 photos with the story box ticked", async () => {
    const p = A.page;
    await p.getByText("What's on your mind?").first().click({ timeout: 10000 });
    await p.waitForTimeout(1500);
    await p.locator('input[type="file"][multiple]').first().setInputFiles([await photo(40, 90, 140, "Slide 1"), await photo(60, 120, 60, "Slide 2")]);
    await p.waitForTimeout(3000);
    const dlg = p.getByRole("dialog").last();
    const box = dlg.locator('[data-testid="add-to-story"]').first();
    await box.waitFor({ timeout: 10000 });
    await box.scrollIntoViewIfNeeded();
    check("the 'Also add to my story' box is there and ticked by default", await box.locator('input[type="checkbox"]').isChecked());
    await shot(p, "02-A-composer-box");
    await dlg.getByRole("group", { name: "Categories" }).getByRole("button").first().click();
    const text = dlg.locator('textarea, [contenteditable="true"]').first();
    await text.click();
    await p.keyboard.type(CAPTION);
    await dlg.getByRole("button", { name: "Post", exact: true }).click();
    const seen = await until(p, async () => (await p.getByText(CAPTION).count()) > 0);
    check("the post appears in A's feed", seen);
  });

  await step("A's post becomes A's story", async () => {
    const p = A.page;
    const ok = await until(p, async () => (await p.locator('[alt="Your story"]').count()) > 0);
    check("the 'Your Story' tile shows the new story photo", ok);
    await shot(p, "03-A-feed-your-story");
  });

  // ── B sees A's story, comments and likes ────────────────────────────────
  await step("B sees A's story in the row and opens it", async () => {
    const p = B.page;
    const ok = await until(p, async () => (await storyTile(p, "Walk Tester A").count()) > 0, 6);
    check("B's row has a tile for Walk Tester A", ok);
    await shot(p, "04-B-feed-row");
    await storyTile(p, "Walk Tester A").click();
    await V(p).waitFor({ timeout: 15000 });
    await p.waitForTimeout(1500);
    await pause(p);
    const n = await bars(p);
    check("the viewer shows one bar per photo (2)", n === 2, `${n} bars`);
    check("the viewer offers 'View post'", (await V(p).getByText("View post").count()) > 0);
    await shot(p, "05-B-viewer");
    await V(p).locator('[aria-label="Add a comment"]').fill(COMMENT);
    await V(p).getByRole("button", { name: "Send" }).click();
    await V(p).getByRole("button", { name: "Like", exact: true }).click();
    await p.waitForTimeout(3000);
    check("B's like shows as liked", (await V(p).getByRole("button", { name: "Unlike" }).count()) > 0);
    check("B's comment floats on the story", (await V(p).getByText(COMMENT).count()) > 0);
    await shot(p, "06-B-viewer-commented");
    await V(p).getByText("View post").first().click();
    await p.waitForURL(/\/post\//, { timeout: 15000 });
    const onPost = await p.getByText(COMMENT).first().waitFor({ timeout: 20000 }).then(() => true, () => false);
    check("the story comment is a post comment (shown under the post)", onPost);
    await shot(p, "07-B-post-has-comment");
  });

  // ── A sees the counts on the own story ──────────────────────────────────
  await step("A sees seen / likes / comments on the own story", async () => {
    const p = A.page;
    await feed(p);
    await p.locator('button[aria-label="Your story"]').first().click();
    await V(p).getByText("Highlight").first().waitFor({ timeout: 15000 });
    await pause(p);
    await p.waitForTimeout(2000);
    const counts = await V(p).locator("div.pt-1 span.flex.items-center.gap-1\\.5").allInnerTexts();
    check("own story shows 1 seen · 1 like · 1 comment", counts.map((s) => s.trim()).join(",") === "1,1,1", `got ${counts.map((s) => s.trim()).join(" · ")}`);
    check("B's comment floats on A's own story", (await V(p).getByText(COMMENT).count()) > 0);
    await shot(p, "08-A-own-story-counts");
    await V(p).getByRole("button", { name: "Close" }).first().click().catch(() => {});
  });

  // ── a plain story from the row's "+", a plain-story comment, then Delete ─
  await step("A adds a plain story with +, B comments, A deletes it", async () => {
    const a = A.page;
    await feed(a);
    await a.locator('button[aria-label="Your story"]').first().locator('input[type="file"]').setInputFiles([await photo(150, 70, 40, "Plain")]);
    await a.waitForTimeout(8000);
    const b = B.page;
    await feed(b);
    await storyTile(b, "Walk Tester A").click();
    await V(b).waitFor({ timeout: 15000 });
    await b.waitForTimeout(1500);
    await pause(b);
    const n = await bars(b);
    check("A now has 3 slides (2 post photos + 1 plain)", n === 3, `${n} bars`);
    for (let i = 0; i < n - 1; i++) { await V(b).getByRole("button", { name: "Next", exact: true }).click(); await b.waitForTimeout(800); }
    await pause(b);
    check("the plain story has no 'View post'", (await V(b).getByText("View post").count()) === 0);
    await V(b).locator('[aria-label="Add a comment"]').fill(PLAIN);
    await V(b).getByRole("button", { name: "Send" }).click();
    await b.waitForTimeout(3000);
    check("B's plain-story comment floats on it", (await V(b).getByText(PLAIN).count()) > 0);
    await shot(b, "09-B-plain-story-comment");

    await feed(a);
    await a.locator('button[aria-label="Your story"]').first().click();
    await V(a).getByText("Highlight").first().waitFor({ timeout: 15000 });
    const m = await bars(a);
    for (let i = 0; i < m - 1; i++) { await V(a).getByRole("button", { name: "Next", exact: true }).click(); await a.waitForTimeout(800); }
    await pause(a);
    await a.waitForTimeout(2000);
    check("A sees B's plain-story comment", (await V(a).getByText(PLAIN).count()) > 0);
    await shot(a, "10-A-plain-story-own");
    await V(a).getByRole("button", { name: "Delete" }).click();
    const removed = await a.getByText("Story removed").first().waitFor({ timeout: 10000 }).then(() => true, () => false);
    check("Delete removes the plain story", removed);
    await a.waitForTimeout(1500);
    const left = await bars(a);
    check("2 slides left after Delete", left === 2, `${left} bars`);
    await shot(a, "11-A-after-delete");
  });

  // ── desktop layout ───────────────────────────────────────────────────────
  await step("desktop: B's feed row and the viewer", async () => {
    const D = await member(EMAIL_B, DESKTOP, "B-desktop");
    await D.page.waitForTimeout(2000);
    await shot(D.page, "12-B-desktop-feed");
    await storyTile(D.page, "Walk Tester A").click();
    await V(D.page).waitFor({ timeout: 15000 });
    await D.page.waitForTimeout(1500);
    await pause(D.page);
    await shot(D.page, "13-B-desktop-viewer");
    check("desktop viewer opens", true);
    await D.ctx.close();
  });
}

check("no Supabase call answered 4xx/5xx during the walk", apiErrors.length === 0, apiErrors.slice(0, 8).join(" | "));
writeFileSync(join(OUT, "results.json"), JSON.stringify({ site: SITE, at: new Date().toISOString(), results, apiErrors }, null, 2));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
