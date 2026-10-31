import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
const FIX = process.argv[2]; const BROWSER = process.argv[3] || "chrome";
const PORT = 5198, BASE = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
const stop = () => { try { server.kill(); } catch {} };
process.on("exit", stop);
for (let i = 0; i < 120; i++) { try { if ((await fetch(`${BASE}/videoharness.html`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 1000)); }
const b = await chromium.launch({ channel: BROWSER });
const p = await b.newPage();
await p.route(`${BASE}/__fix/**`, (r) => { const n = decodeURIComponent(r.request().url().split("/__fix/")[1]); r.fulfill({ body: readFileSync(join(FIX, n)), contentType: "application/octet-stream" }); });
await p.goto(`${BASE}/videoharness.html`, { timeout: 240000, waitUntil: "domcontentloaded" }); await p.waitForFunction(() => document.getElementById("root")?.textContent?.includes("ready"), null, { timeout: 120000 });
const MIME = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska" };
for (const name of readdirSync(FIX).sort()) {
  const ext = name.split(".").pop();
  const r = await p.evaluate(async ({ name, mime }) => {
    const out = { name };
    const { readVideoFacts, videoLimitProblems } = await import("/src/lib/video/limits.ts");
    const { encodeVideoToHls } = await import("/src/lib/video/webEncoder.ts");
    const { judgeUploadContent, smallFiles } = await import("/src/lib/video/shared/judge.ts");
    const { manifestProblems } = await import("/src/lib/video/shared/rules.ts");
    const blob = await (await fetch(`/__fix/${encodeURIComponent(name)}`)).blob();
    const file = new File([blob], name, { type: mime || "" });
    try { const f = await readVideoFacts(file); out.facts = `${f.width}x${f.height} ${f.durationSeconds.toFixed(1)}s`; out.limits = videoLimitProblems(f, "post"); }
    catch (e) { out.step = "read"; out.error = e.message; return out; }
    try { const t0 = performance.now(); const pkg = await encodeVideoToHls(file, {}); out.encodeMs = Math.round(performance.now() - t0);
      out.renditions = pkg.manifest.renditions?.map?.(x => x.name).join(",") ?? Object.keys(pkg.manifest).join(",");
      out.audio = pkg.manifest.has_audio; out.problems = [...manifestProblems(pkg.manifest, "post"), ...judgeUploadContent(pkg.manifest, smallFiles(pkg.files))]; }
    catch (e) { out.step = "encode"; out.error = e.message; }
    return out;
  }, { name, mime: MIME[ext] });
  console.log(JSON.stringify(r));
}
await b.close(); stop(); process.exit(0);
