import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { chromium } from "playwright";
const [,, FIX, ROOT] = process.argv;
const PORT = 5202, BASE = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => { try { server.kill(); } catch {} });
for (let i = 0; i < 120; i++) { try { if ((await fetch(`${BASE}/videoharness.html`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 1000)); }
const b64 = readFileSync(`${FIX}/mp4_h264_aac.mp4`).toString("base64");
const test = async ({ b64 }) => {
  const { encodeVideoToHls } = await import("/src/lib/video/webEncoder.ts");
  const { judgeUploadContent, smallFiles } = await import("/src/lib/video/shared/judge.ts");
  const { manifestProblems } = await import("/src/lib/video/shared/rules.ts");
  const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  let hidden = false; Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  // "Switch tabs" 1 s into a 3 s clip for 12 s (longer than the 10 s watchdog), then come back.
  setTimeout(() => { hidden = true; document.dispatchEvent(new Event("visibilitychange")); }, 1000);
  setTimeout(() => { hidden = false; document.dispatchEvent(new Event("visibilitychange")); }, 13000);
  try {
    const t0 = performance.now(); const pkg = await encodeVideoToHls(new File([u], "clip.mp4"), {});
    const v = pkg.manifest.files.filter((f) => /^480p_\d+\.m4s$/.test(f.name)).length;
    const probs=[...manifestProblems(pkg.manifest, "post"), ...judgeUploadContent(pkg.manifest, smallFiles(pkg.files))]; return { ok: true, firstProblems: probs.slice(0,2), ms: Math.round(performance.now() - t0), problems: [...manifestProblems(pkg.manifest, "post"), ...judgeUploadContent(pkg.manifest, smallFiles(pkg.files))].length, segments480: v, durationS: pkg.manifest.duration_s };
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 100) }; }
};
const fb = await puppeteer.launch({ browser: "firefox", executablePath: "C:/Program Files/Mozilla Firefox/firefox.exe", headless: true, protocolTimeout: 600000 });
const fp = await fb.newPage(); await fp.goto(`${BASE}/videoharness.html`, { timeout: 240000, waitUntil: "domcontentloaded" }); await new Promise(r => setTimeout(r, 8000));
console.log("Firefox tab-switch:", JSON.stringify(await fp.evaluate(test, { b64 }))); await fb.close();
const cb = await chromium.launch({ channel: "chrome" }); const cp = await cb.newPage(); await cp.goto(`${BASE}/videoharness.html`, { timeout: 240000, waitUntil: "domcontentloaded" }); await cp.waitForTimeout(5000);
console.log("Chrome  tab-switch:", JSON.stringify(await cp.evaluate(test, { b64 }))); await cb.close();
process.exit(0);
