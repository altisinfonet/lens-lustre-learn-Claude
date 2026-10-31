import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import puppeteer from "puppeteer-core";
const [,, FIX, ROOT] = process.argv;
const PORT = 5199, BASE = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => { try { server.kill(); } catch {} });
for (let i = 0; i < 120; i++) { try { if ((await fetch(`${BASE}/videoharness.html`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 1000)); }
const b = await puppeteer.launch({ browser: "firefox", executablePath: "C:/Program Files/Mozilla Firefox/firefox.exe", headless: true, protocolTimeout: 900000 });
const p = await b.newPage();
p.on("console", (m) => { if (m.type() === "error") console.log("  [console]", m.text().slice(0, 200)); });
await p.goto(`${BASE}/videoharness.html`, { timeout: 240000, waitUntil: "domcontentloaded" });
await new Promise(r => setTimeout(r, 8000));
console.log("Firefox", await b.version());
const MIME = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska" };
for (const name of readdirSync(FIX).sort()) {
  const b64 = readFileSync(`${FIX}/${name}`).toString("base64");
  const r = await p.evaluate(async (name, b64, mime) => {
    const out = { name };
    try {
      const { readVideoFacts } = await import("/src/lib/video/limits.ts");
      const { encodeVideoToHls, encoderSupported } = await import("/src/lib/video/webEncoder.ts");
      const { judgeUploadContent, smallFiles } = await import("/src/lib/video/shared/judge.ts");
      const { manifestProblems } = await import("/src/lib/video/shared/rules.ts");
      const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const file = new File([u], name, { type: mime || "" });
      out.supported = await encoderSupported();
      const f = await readVideoFacts(file); out.facts = `${f.width}x${f.height}`;
      const t0 = performance.now(); const pkg = await encodeVideoToHls(file, {}); out.ms = Math.round(performance.now() - t0);
      out.audio = pkg.manifest.has_audio;
      out.problems = [...manifestProblems(pkg.manifest, "post"), ...judgeUploadContent(pkg.manifest, smallFiles(pkg.files))];
    } catch (e) { out.error = String(e && e.message || e); }
    return out;
  }, name, b64, MIME[name.split(".").pop()]);
  console.log(JSON.stringify(r));
}
await b.close(); process.exit(0);
