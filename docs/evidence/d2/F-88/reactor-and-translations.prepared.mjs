import { chromium } from "playwright";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

// The exact class strings from the two components, copied verbatim.
const FFA_FIXED = "inline-flex h-9 min-w-fit flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[14px] font-semibold transition-colors disabled:opacity-50";
const FFA_BROKEN = "inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-[14px] font-semibold transition-colors disabled:opacity-50";
const RFA_BASE = "inline-flex items-center gap-1 text-[9px] tracking-wide uppercase font-semibold px-2 py-0.5 rounded-md border transition-colors whitespace-nowrap shrink-0";

// All six fr.addFriend translations shipped in the bundle, plus English.
const LABELS = {
  en: "Add Friend",
  hi: "मित्र जोड़ें",
  bn: "বন্ধু যোগ করুন",
  mr: "मित्र जोडा",
  gu: "મિત્ર ઉમેરો",
  ta: "நண்பரைச் சேர்",
  te: "స్నేహితుడిని జోడించు",
};

const b = await chromium.launch({ executablePath: EXE });
for (const width of [360, 1280]) {
  const ctx = await b.newContext({ viewport: { width, height: 800 } });
  const p = await ctx.newPage();
  // Real app stylesheet, real fonts: the harness page itself.
  await p.goto("http://127.0.0.1:5199/uiharness.html?scene=screen-wall-visitor", { waitUntil: "networkidle" });
  await p.waitForTimeout(1500);

  const res = await p.evaluate(({ FFA_FIXED, FFA_BROKEN, RFA_BASE, LABELS, width }) => {
    const host = document.createElement("div");
    host.style.cssText = `position:fixed;left:0;top:0;width:${width}px;z-index:99999;background:var(--background)`;
    document.body.appendChild(host);

    const lines = (el) => {
      const tn = [...el.childNodes].find((n) => n.nodeType === 3 && (n.textContent || "").trim().length);
      if (!tn) return 0;
      const r = document.createRange(); r.selectNodeContents(tn);
      return r.getClientRects().length;
    };
    const out = [];

    for (const [lang, text] of Object.entries(LABELS)) {
      // 1. FriendFollowActions row: two flex-1 buttons sharing the width.
      for (const [variant, cls] of [["FFA-broken", FFA_BROKEN], ["FFA-fixed", FFA_FIXED]]) {
        host.innerHTML = `<div class="flex w-full items-center gap-2">
            <button class="${cls} bg-muted text-foreground"><svg width="14" height="14"></svg>${text}</button>
            <button class="${cls} bg-primary text-primary-foreground"><svg width="14" height="14"></svg>Follow</button>
          </div>`;
        const btn = host.querySelector("button");
        const row = host.firstElementChild;
        out.push({ lang, variant, lines: lines(btn), w: Math.round(btn.getBoundingClientRect().width),
                   rowOverflow: row.scrollWidth > row.clientWidth + 1 });
      }
      // 2. ReactorFriendAction, in its REAL call-site container: an avatar, a
      //    flex-1 min-w-0 name that truncates, then the pill.
      host.innerHTML = `<div class="flex items-center gap-2">
          <div style="width:32px;height:32px;flex:none;background:#888;border-radius:50%"></div>
          <div class="flex-1 min-w-0"><div class="text-sm font-medium truncate">A Very Long Member Name That Must Truncate Before The Pill Does</div></div>
          <span class="${RFA_BASE} border-primary/40 text-primary"><svg width="12" height="12"></svg>${text}</span>
        </div>`;
      const pill = host.querySelector("span");
      const row2 = host.firstElementChild;
      out.push({ lang, variant: "RFA-as-shipped", lines: lines(pill), w: Math.round(pill.getBoundingClientRect().width),
                 rowOverflow: row2.scrollWidth > row2.clientWidth + 1 });
    }
    host.remove();
    return out;
  }, { FFA_FIXED, FFA_BROKEN, RFA_BASE, LABELS, width });

  console.log(`\n===== viewport ${width}px =====`);
  for (const r of res) {
    console.log(`  ${r.lang.padEnd(3)} ${r.variant.padEnd(16)} lines=${r.lines} wrapped=${String(r.lines > 1).padEnd(5)} w=${String(r.w).padEnd(5)} rowOverflow=${r.rowOverflow}`);
  }
  await ctx.close();
}
await b.close();
