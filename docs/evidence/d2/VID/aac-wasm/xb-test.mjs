import { readFileSync, readdirSync } from "node:fs";
import { chromium, webkit } from "playwright";
import puppeteer from "puppeteer-core";
const FIX = process.argv[2];
const files = readdirSync(FIX).sort().map((n) => ({ n, b64: readFileSync(`${FIX}/${n}`).toString("base64") }));
const MIME = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska" };
async function probe(evalFn) {
  const caps = await evalFn(async () => {
    const o = {};
    o.webcodecs = typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined";
    const v = async (c) => { try { return (await VideoEncoder.isConfigSupported({ codec: c, width: 1280, height: 720, bitrate: 2e6, framerate: 30 })).supported; } catch { return false; } };
    const a = async (c) => { try { return (await AudioEncoder.isConfigSupported({ codec: c, sampleRate: 48000, numberOfChannels: 2, bitrate: 96000 })).supported; } catch { return false; } };
    o.h264enc = o.webcodecs ? await v("avc1.42E01F") : false;
    o.aacenc = o.webcodecs ? await a("mp4a.40.2") : false;
    o.opusenc = o.webcodecs ? await a("opus") : false;
    o.mse = await new Promise((res) => { try { const ms = new MediaSource(); const el = document.createElement("video"); ms.addEventListener("sourceopen", () => res(true), { once: true }); el.onerror = () => res(false); setTimeout(() => res(false), 5000); el.src = URL.createObjectURL(ms); } catch { res(false); } });
    o.nativeHls = document.createElement("video").canPlayType("application/vnd.apple.mpegurl") !== "";
    return o;
  });
  const reads = {};
  for (const f of files) {
    reads[f.n] = await evalFn(async ({ b64, mime }) => {
      const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([u], { type: mime }));
      const el = document.createElement("video"); el.muted = true; el.preload = "metadata";
      return await new Promise((res) => { el.onloadedmetadata = () => res(`ok ${el.videoWidth}x${el.videoHeight}`); el.onerror = () => res(`FAIL(${el.error && el.error.code})`); setTimeout(() => res("TIMEOUT"), 10000); el.src = url; });
    }, { b64: f.b64, mime: MIME[f.n.split(".").pop()] });
  }
  return { caps, reads };
}
const results = {};
const URL0 = "https://staging.50mmretina.com/";
for (const [name, launch] of [["Chrome", () => chromium.launch({ channel: "chrome" })], ["Edge", () => chromium.launch({ channel: "msedge" })], ["WebKit (Safari engine)", () => webkit.launch()]]) {
  try { const b = await launch(); const p = await b.newPage(); await p.goto(URL0, { waitUntil: "domcontentloaded", timeout: 60000 }); results[name] = await probe((fn, arg) => p.evaluate(fn, arg)); await b.close(); }
  catch (e) { results[name] = { error: String(e.message).split("\n")[0] }; }
}
try {
  const b = await puppeteer.launch({ browser: "firefox", executablePath: "C:/Program Files/Mozilla Firefox/firefox.exe", headless: true });
  const p = await b.newPage(); await p.goto(URL0, { waitUntil: "domcontentloaded", timeout: 60000 });
  results["Firefox " + (await b.version())] = await probe((fn, arg) => p.evaluate(fn, arg)); await b.close();
} catch (e) { results["Firefox"] = { error: String(e.message).split("\n")[0] }; }
console.log(JSON.stringify(results, null, 1));
