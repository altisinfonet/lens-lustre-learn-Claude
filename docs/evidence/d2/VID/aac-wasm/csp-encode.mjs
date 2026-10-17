import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { chromium } from "playwright";
const [,, FIX, ROOT, CSPFILE] = process.argv;
const PORT = 5201, BASE = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--config", ".vite.csp-test.config.ts", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore", env: { ...process.env, CSP_FILE: CSPFILE } });
process.on("exit", () => { try { server.kill(); } catch {} });
for (let i = 0; i < 120; i++) { try { if ((await fetch(`${BASE}/videoharness.html`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 1000)); }
const hdr = (await fetch(`${BASE}/videoharness.html`)).headers.get("content-security-policy") || "";
console.log("page CSP served:", hdr.includes("wasm-unsafe-eval") && hdr.includes("worker-src 'self'") ? "staging CSP + wasm-unsafe-eval ✔" : "MISSING");
const files = ["mp4_h264_aac.mp4", "mov_h264_aac.mov", "webm_vp9_opus.webm", "mp4_hevc_aac.mp4"];
const run = async (label, evalFn) => {
  for (const name of files) {
    const b64 = readFileSync(`${FIX}/${name}`).toString("base64");
    const r = await evalFn(async ({ name, b64 }) => {
      const out = { name };
      const v = []; document.addEventListener("securitypolicyviolation", (e) => v.push(e.violatedDirective + " " + (e.blockedURI || "")));
      try {
        const { readVideoFacts } = await import("/src/lib/video/limits.ts");
        const { encodeVideoToHls } = await import("/src/lib/video/webEncoder.ts");
        const { judgeUploadContent, smallFiles } = await import("/src/lib/video/shared/judge.ts");
        const { manifestProblems } = await import("/src/lib/video/shared/rules.ts");
        const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        const file = new File([u], name);
        await readVideoFacts(file);
        const pkg = await encodeVideoToHls(file, {});
        out.audio = pkg.manifest.has_audio;
        out.problems = [...manifestProblems(pkg.manifest, "post"), ...judgeUploadContent(pkg.manifest, smallFiles(pkg.files))].length;
      } catch (e) { out.error = String(e && e.message || e).slice(0, 90); }
      const media = v.filter((x) => !/^connect-src ws/.test(x));
      if (media.length) out.cspViolations = media.slice(0, 3);
      return out;
    }, { name, b64 });
    console.log(label.padEnd(9), JSON.stringify(r));
  }
};
const fb = await puppeteer.launch({ browser: "firefox", executablePath: "C:/Program Files/Mozilla Firefox/firefox.exe", headless: true, protocolTimeout: 900000 });
const fp = await fb.newPage(); await fp.goto(`${BASE}/videoharness.html`, { timeout: 240000, waitUntil: "domcontentloaded" }); await new Promise(r => setTimeout(r, 8000));
if (!process.env.SKIP_FF) { await run("Firefox", (fn, a) => fp.evaluate(fn, a)); } await fb.close();
for (const ch of ["chrome", "msedge"]) {
  const b = await chromium.launch({ channel: ch }); const p = await b.newPage();
  await p.goto(`${BASE}/videoharness.html`, { timeout: 240000, waitUntil: "domcontentloaded" }); await p.waitForTimeout(5000);
  await run(ch === "chrome" ? "Chrome" : "Edge", (fn, a) => p.evaluate(fn, a)); await b.close();
}
process.exit(0);
