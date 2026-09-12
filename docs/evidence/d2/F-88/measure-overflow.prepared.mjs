import { chromium } from "playwright";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const b = await chromium.launch({ executablePath: EXE });
const LONG = { english: null, te: "స్నేహితుడిని జోడించు", ta: "நண்பரைச் சேர்", RequestSent: "Request Sent" };
for (const w of [360, 390, 1280]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 800 } });
  const p = await ctx.newPage();
  await p.goto("http://127.0.0.1:5199/uiharness.html?scene=screen-wall-visitor", { waitUntil: "networkidle" });
  await p.waitForTimeout(1500);
  await p.locator("button:visible", { hasText: "Add Friend" }).first().waitFor({ timeout: 20000 });
  for (const [tag, text] of Object.entries(LONG)) {
    if (text) {
      await p.evaluate((t) => {
        document.querySelectorAll("button").forEach((btn) => {
          const tn = [...btn.childNodes].find((n) => n.nodeType === 3 && (n.textContent || "").trim().length);
          if (tn && !/^\s*(Follow|Following)\s*$/.test(tn.textContent)) tn.textContent = " " + t;
        });
      }, text);
      await p.waitForTimeout(200);
    }
    const m = await p.evaluate(() => {
      const rows = [...document.querySelectorAll("div")].filter(
        (d) => typeof d.className === "string" && d.className.includes("flex w-full items-center gap-2") && d.querySelector("button") && d.getBoundingClientRect().width > 0,
      );
      const row = rows[0];
      const rr = row ? row.getBoundingClientRect() : null;
      return {
        docScrollW: document.documentElement.scrollWidth,
        viewportW: window.innerWidth,
        pageOverflowPx: document.documentElement.scrollWidth - window.innerWidth,
        rowW: rr ? Math.round(rr.width) : null,
        rowScrollW: row ? row.scrollWidth : null,
        rowClientW: row ? row.clientWidth : null,
        rowOverflowing: row ? row.scrollWidth > row.clientWidth + 1 : null,
        rowRight: rr ? Math.round(rr.right) : null,
      };
    });
    console.log(`w=${String(w).padEnd(5)} ${tag.padEnd(12)} pageOverflow=${String(m.pageOverflowPx).padEnd(4)} rowW=${String(m.rowW).padEnd(5)} rowScrollW=${String(m.rowScrollW).padEnd(5)} rowOverflowing=${m.rowOverflowing} rowRight=${m.rowRight}`);
  }
  await ctx.close();
}
await b.close();
