#!/usr/bin/env node
/**
 * VID-1 · THE WEB ENCODER IN A REAL BROWSER — `node tools/uishot/video-encode-harness.mjs`.
 *
 * A real Chromium loads /videoharness.html (src/uiharness/video/main.ts), which
 * encodes a real 3-second video file with the production encoder module
 * (src/lib/video/webEncoder.ts: frame capture → per-rendition scaling →
 * WebCodecs → mp4-muxer → segments → playlists → manifest). The page judges the
 * result with the SAME function /api/video/complete uses (shared/judge.ts) plus
 * the manifest rules; this script then writes the files to disk and asks
 * ffprobe — an independent decoder — whether the master playlist opens as HLS
 * with the expected streams.
 *
 * Cases: a landscape video with sound; a portrait video with "remove sound".
 * PASS = no problems from the server's rules, every hash matches, every
 * rendition under its bytes-per-second ceiling, and ffprobe reads a video
 * stream (+ an audio stream exactly when there is sound).
 *
 * Codecs: VP9 + Opus via the encoder's test seam (Playwright's Chromium has no
 * H.264/AAC encoder). Exit code = the verdict.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const PORT = 5197;
const BASE = `http://127.0.0.1:${PORT}`;
const out = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : null;

function chromePath() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  if (!existsSync(root)) return undefined;
  for (const d of readdirSync(root)) for (const rel of ["chrome-linux/chrome", "chrome-linux/headless_shell"]) {
    const p = join(root, d, rel);
    if (existsSync(p)) return p;
  }
  return undefined;
}

const server = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], { stdio: ["ignore", "pipe", "pipe"], detached: true });
const stop = () => { try { process.kill(-server.pid, "SIGTERM"); } catch { /* gone */ } };
process.on("exit", stop);

async function waitUp() {
  for (let i = 0; i < 180; i++) {
    try { const r = await fetch(`${BASE}/videoharness.html`); if (r.ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("dev server did not come up in 180 s");
}

function ffprobe(dir) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height", "-of", "json", join(dir, "master.m3u8")], { encoding: "utf8" });
  if (r.error) return { available: false };
  try { return { available: true, streams: JSON.parse(r.stdout).streams ?? [], stderr: r.stderr.trim().slice(0, 400) }; }
  catch { return { available: true, streams: [], stderr: (r.stderr || r.stdout).slice(0, 400) }; }
}

const result = { at: new Date().toISOString(), cases: [], verdict: "FAIL" };
let code = 1;
try {
  await waitUp();
  const exe = chromePath();
  const browser = await chromium.launch(exe ? { executablePath: exe, args: ["--autoplay-policy=no-user-gesture-required"] } : { args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  await page.goto(`${BASE}/videoharness.html`, { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.__vidEncode === "function", null, { timeout: 60_000 });
  for (const [which, mute] of [["landscape", false], ["portrait", true]]) {
    const r = await page.evaluate(([w, m]) => window.__vidEncode(w, m), [which, mute]);
    const dir = mkdtempSync(join(tmpdir(), `vid-${which}-`));
    for (const [name, b64] of Object.entries(r.files)) writeFileSync(join(dir, name), Buffer.from(b64, "base64"));
    const probe = ffprobe(dir);
    const types = (probe.streams ?? []).map((s) => s.codec_type);
    const c = {
      case: `${which}${mute ? " (remove sound)" : ""}`,
      ms: r.ms,
      files: Object.keys(r.files).sort(),
      has_audio: r.manifest.has_audio,
      duration_s: r.manifest.duration_s,
      totalBytes: r.totalBytes,
      problems: r.problems,
      hashOk: r.hashOk,
      ceilings: r.ceilings,
      ffprobe: { available: probe.available, streams: probe.streams, stderr: probe.stderr },
    };
    c.pass = r.problems.length === 0 && r.hashOk && r.ceilings.every((x) => x.bytesPerSecond <= x.ceiling)
      && (!probe.available || (types.includes("video") && types.includes("audio") === !mute));
    result.cases.push(c);
  }
  await browser.close();
  const ok = result.cases.length === 2 && result.cases.every((c) => c.pass);
  result.verdict = ok ? "PASS" : "FAIL";
  code = ok ? 0 : 1;
} catch (e) {
  result.error = String(e && e.message ? e.message : e);
} finally {
  stop();
}
console.log(JSON.stringify(result, null, 2));
if (out) writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
process.exit(code);
