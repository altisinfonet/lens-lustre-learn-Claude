import { readFileSync } from "node:fs";
import { chromium } from "playwright";
const [,, S] = process.argv;
const clip = readFileSync(`${S}/vidfix/mp4_h264_aac.mp4`);
const html = `<!doctype html><video id=v muted playsinline></video><script>
window.run = async () => { const b = await (await fetch('/clip.mp4')).blob();
  const v = document.getElementById('v'); return await new Promise((res) => {
  v.onloadedmetadata = () => res('LOADED ' + v.videoWidth + 'x' + v.videoHeight + ' ' + v.duration.toFixed(1) + 's');
  v.onerror = () => res('BLOCKED (error code ' + (v.error && v.error.code) + ')'); setTimeout(() => res('TIMEOUT'), 8000);
  v.src = URL.createObjectURL(b); }); };
window.mse = () => { try { const ms = new MediaSource(); const v = document.createElement('video'); return new Promise((res) => { ms.addEventListener('sourceopen', () => res('MSE OPEN'), { once: true }); v.onerror = () => res('MSE BLOCKED'); setTimeout(() => res('MSE TIMEOUT'), 5000); v.src = URL.createObjectURL(ms); }); } catch (e) { return 'MSE ERR ' + e.message; } };
window.worker = () => new Promise((res) => { try { const w = new Worker("/hls.worker.js"); w.onmessage = () => res("SAME-SITE WORKER OK"); w.onerror = () => res("SAME-SITE WORKER BLOCKED"); setTimeout(() => res("WORKER TIMEOUT"), 4000); } catch (e) { res("WORKER BLOCKED (" + e.name + ")"); } });
window.blobworker = () => new Promise((res) => { try { const w = new Worker(URL.createObjectURL(new Blob(["postMessage(1)"], { type: "text/javascript" }))); w.onmessage = () => res("blob worker ALLOWED"); w.onerror = () => res("blob worker refused"); setTimeout(() => res("blob worker refused (timeout)"), 3000); } catch (e) { res("blob worker refused"); } });
</script>`;
const b = await chromium.launch({ channel: "chrome" });
for (const which of ["old", "new"]) {
  const csp = readFileSync(`${S}/csp-${which}.txt`, "utf8").trim();
  const ctx = await b.newContext(); const p = await ctx.newPage();
  await p.route("https://staging-csp-test.example/**", (r) => { const u = r.request().url();
    if (u.endsWith("/hls.worker.js")) return r.fulfill({ body: "postMessage(1)", contentType: "text/javascript" });
    if (u.endsWith("/clip.mp4")) return r.fulfill({ body: clip, contentType: "video/mp4" });
    return r.fulfill({ body: html, contentType: "text/html", headers: { "content-security-policy": csp } }); });
  await p.goto("https://staging-csp-test.example/");
  console.log(which.toUpperCase().padEnd(4), "| preview/encoder:", await p.evaluate(() => window.run()), "| feed player (MediaSource):", await p.evaluate(() => window.mse()), "| hls worker (/assets):", await p.evaluate(() => window.worker()), "|", await p.evaluate(() => window.blobworker()));
  await ctx.close();
}
await b.close();
