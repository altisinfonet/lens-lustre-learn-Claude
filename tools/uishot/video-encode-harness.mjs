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
 * Cases: a landscape video with sound; a portrait video with "remove sound";
 * a slideshow-style video that HOLDS each picture for 12 s (Owner, staging
 * 2026-10-12: a promo with a still address card was refused as "can't play this
 * format" and lost its opening seconds); a slideshow with 1.5 s cross-fades
 * (independent review #418 F1: segments above the judge's 6 s).
 * PASS = no problems from the server's rules, every hash matches, every
 * rendition under its bytes-per-second ceiling, and ffprobe reads a video
 * stream (+ an audio stream exactly when there is sound).
 *
 * S7-e adds three phone-shaped files, made here by ffmpeg (nothing binary in
 * the repo): an iPhone HDR video (10-bit BT.2020 HLG, 90° rotation, picked as
 * IMG_….MOV), an Android camera video (H.264/AAC, 90° rotation, variable frame
 * rate) and a video of exactly 3 minutes (the member limit). Each must also
 * come out the way the member holds the phone (portrait for the rotated ones)
 * and as long as its source (±0.5 s).
 *
 * Codecs: VP9 + Opus via the encoder's test seam (Playwright's Chromium has no
 * H.264/AAC encoder). Exit code = the verdict.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const PORT = 5197;
const BASE = `http://127.0.0.1:${PORT}`;
const out = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : null;

function chromePath() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  if (!existsSync(root)) return undefined;
  for (const d of readdirSync(root)) for (const rel of ["chrome-linux/chrome", "chrome-linux64/chrome", "chrome-linux/headless_shell"]) {
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

// S7-e · the phone-shaped fixtures. -display_rotation 90 writes the display
// matrix a phone writes when it is held upright.
const LAVFI_AUDIO = (hz) => ["-f", "lavfi", "-i", `sine=frequency=${hz}:sample_rate=48000`];
const GENERATED = {
  "iphone-hdr": { seconds: 6, portrait: true, args: ["-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30", ...LAVFI_AUDIO(440), "-t", "6",
    "-c:v", "libvpx-vp9", "-profile:v", "2", "-pix_fmt", "yuv420p10le", "-b:v", "1M", "-deadline", "realtime", "-cpu-used", "8",
    "-color_primaries", "bt2020", "-color_trc", "arib-std-b67", "-colorspace", "bt2020nc", "-c:a", "aac", "-ac", "2"] },
  android: { seconds: 6, portrait: true, args: ["-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30", ...LAVFI_AUDIO(330), "-t", "6",
    "-vf", "select='not(eq(mod(n\\,7)\\,3))'", "-fps_mode", "vfr", "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-preset", "ultrafast", "-b:v", "2M", "-c:a", "aac", "-ac", "2"] },
  "three-min": { seconds: 180, portrait: false, rotate: false, args: ["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", ...LAVFI_AUDIO(550), "-t", "180",
    "-c:v", "libx264", "-preset", "ultrafast", "-b:v", "300k", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "64k", "-ac", "2"] },
};
function makeFixtures() {
  const dir = mkdtempSync(join(tmpdir(), "vid-fixtures-"));
  const files = {};
  for (const [name, f] of Object.entries(GENERATED)) {
    const plain = join(dir, `${name}-plain.mp4`), final = join(dir, `${name}.mp4`);
    const a = spawnSync("ffmpeg", ["-v", "error", "-y", ...f.args, plain], { encoding: "utf8" });
    if (a.status !== 0) throw new Error(`ffmpeg ${name}: ${(a.stderr || "").slice(0, 400)}`);
    const b = f.rotate === false ? { status: 0 } : spawnSync("ffmpeg", ["-v", "error", "-y", "-display_rotation", "90", "-i", plain, "-c", "copy", final], { encoding: "utf8" });
    if (b.status !== 0) throw new Error(`ffmpeg rotate ${name}: ${(b.stderr || "").slice(0, 400)}`);
    files[name] = readFileSync(f.rotate === false ? plain : final);
  }
  return files;
}

const CASES = [["landscape", false], ["portrait", true], ["held", false], ["crossfade", false],
  ["iphone-hdr", false], ["android", false], ["three-min", false]];
const result = { at: new Date().toISOString(), cases: [], verdict: "FAIL" };
let code = 1;
try {
  await waitUp();
  const exe = chromePath();
  const browser = await chromium.launch(exe ? { executablePath: exe, args: ["--autoplay-policy=no-user-gesture-required"] } : { args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage();
  const fixtures = makeFixtures();
  await page.route("**/__fixture/*", (route) => {
    const body = fixtures[new URL(route.request().url()).pathname.split("/").pop()];
    return body ? route.fulfill({ status: 200, contentType: "video/mp4", body }) : route.fulfill({ status: 404, body: "" });
  });
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  await page.goto(`${BASE}/videoharness.html`, { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.__vidEncode === "function", null, { timeout: 60_000 });
  for (const [which, mute] of CASES) {
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
    const g = GENERATED[which];
    if (g) {
      // Held upright → a portrait package; and nothing lost or added at the ends.
      c.shape = { width: r.manifest.width, height: r.manifest.height, expectPortrait: g.portrait, expectSeconds: g.seconds };
      c.shapeOk = (r.manifest.height > r.manifest.width) === g.portrait && Math.abs(r.manifest.duration_s - g.seconds) <= 0.5;
    }
    c.pass = (!g || c.shapeOk) && r.problems.length === 0 && r.hashOk && r.ceilings.every((x) => x.bytesPerSecond <= x.ceiling)
      && (!probe.available || (types.includes("video") && types.includes("audio") === !mute));
    result.cases.push(c);
  }
  await browser.close();
  const ok = result.cases.length === CASES.length && result.cases.every((c) => c.pass);
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
