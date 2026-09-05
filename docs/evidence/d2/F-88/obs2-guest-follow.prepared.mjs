import { chromium } from "playwright";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
// PublicProfile.tsx:893, verbatim — no whitespace-nowrap, no min-w-fit.
const GUEST = "inline-flex h-9 flex-1 items-center justify-center rounded-lg bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90";
const CASES = [
  { tag: "as-shipped: sole child, English", sibling: false, label: "Follow" },
  { tag: "sole child, 2-word label       ", sibling: false, label: "फ़ॉलो करें" },
  { tag: "+1 sibling, English            ", sibling: true,  label: "Follow" },
  { tag: "+1 sibling, 2-word label       ", sibling: true,  label: "फ़ॉलो करें" },
  { tag: "+1 sibling, Telugu 1-word      ", sibling: true,  label: "అనుసరించు" },
  { tag: "+1 sibling, 2 LONG words        ", sibling: true,  label: "Follow this photographer" },
  { tag: "+1 sibling, 1 very long word    ", sibling: true,  label: "Abonnementsbekreftelse" },
];
const b = await chromium.launch({ executablePath: EXE });
for (const width of [214, 324]) {
  const ctx = await b.newContext({ viewport: { width, height: 800 } });
  const p = await ctx.newPage();
  await p.goto("http://127.0.0.1:5199/uiharness.html?scene=screen-wall-visitor", { waitUntil: "networkidle" });
  await p.waitForTimeout(1200);
  console.log(`\n===== container ${width}px (214 = the real desktop profile column, 324 = the real 360px-phone row) =====`);
  for (const c of CASES) {
    const r = await p.evaluate(({ GUEST, c, width }) => {
      const host = document.createElement("div");
      host.style.cssText = `position:fixed;left:0;top:0;width:${width}px;z-index:99999`;
      document.body.appendChild(host);
      host.innerHTML = `<div class="mt-2 flex items-center gap-2 py-1">
        <a class="${GUEST}">${c.label}</a>
        ${c.sibling ? `<a class="${GUEST}">Message</a>` : ""}
      </div>`;
      const a = host.querySelector("a");
      const tn = [...a.childNodes].find((n) => n.nodeType === 3 && (n.textContent || "").trim().length);
      const rg = document.createRange(); rg.selectNodeContents(tn);
      const out = { lines: rg.getClientRects().length, w: Math.round(a.getBoundingClientRect().width),
                    overflow: a.scrollWidth > a.clientWidth + 1 };
      host.remove();
      return out;
    }, { GUEST, c, width });
    console.log(`  ${c.tag}  lines=${r.lines} WRAPPED=${String(r.lines > 1).padEnd(5)} overflow=${String(r.overflow).padEnd(5)} w=${r.w}`);
  }
  await ctx.close();
}
await b.close();
