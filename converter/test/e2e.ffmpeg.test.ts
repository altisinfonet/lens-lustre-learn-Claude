// @vitest-environment node
/**
 * REAL FFmpeg, end to end-ish: generated test videos (lavfi testsrc2 + sine;
 * an iPhone-like multi-stream file; a 10-bit PQ HEVC source for HDR, A1)
 * converted with the worker's own command lines, packaged by
 * packageFromFragmented, judged by the server's own judge — zero problems,
 * segments ≤ 6 s, every byte ceiling respected.
 *
 * Runs when an ffmpeg binary is available (FFMPEG_PATH, or `ffmpeg` on PATH —
 * d2-converter.yml installs Ubuntu's); skipped cleanly otherwise. ffprobe
 * (FFPROBE_PATH or PATH) is optional: without it the facts are given, and the
 * tests that need the probe are skipped.
 */
import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { judgeUploadContent, smallFiles } from "../../src/lib/video/shared/judge";
import { findAll } from "../../src/lib/video/shared/mp4";
import { INIT_MAX_BYTES, manifestProblems, RENDITION_CEILING_BPS, renditionBytes, SEGMENT_MAX_BYTES, totalBytes } from "../../src/lib/video/shared/rules";
import { dbVersionProblems, DB_CEILING_BPS } from "../src/dbRules";
import { convertSource, probeSource } from "../src/convert";
import { runJob } from "../src/job";
import { DirectLauncher } from "../src/launcher";
import { mediaPlaylistSegments, targetDuration } from "../src/playlistFacts";
import { judgeProbe } from "../src/probe";
import { HDR_TAG_FILTER, selfTest, synthHdrArgs } from "../src/selftest";
import { apiFor, fakeServer, noSleep, probeJson, send, sha256, SRC, tempDir, TOKEN, VIDEO, withAuth, OWNER, type FakeServer } from "./helpers";

function findBinary(envName: string, name: string): string | null {
  const fromEnv = process.env[envName];
  if (fromEnv) return fromEnv;
  const r = spawnSync(name, ["-hide_banner", "-version"], { encoding: "utf8" });
  return r.status === 0 ? name : null;
}
const FFMPEG = findBinary("FFMPEG_PATH", "ffmpeg");
const FFPROBE = findBinary("FFPROBE_PATH", "ffprobe");
/** The converter workflow (d2-converter.yml) installs both and sets this: there, a skip would be a silent pass. */
const REQUIRED = process.env.CONVERTER_REQUIRE_FFMPEG === "1";

/** What this FFmpeg build has: the tone-mapping filters (amendment A1) and libx265 (to make a 10-bit PQ test source). */
function capability(kind: "-filters" | "-encoders", name: string): boolean {
  if (!FFMPEG) return false;
  const r = spawnSync(FFMPEG, ["-hide_banner", kind], { encoding: "utf8" });
  return new RegExp(`^\\s*\\S+\\s+${name}\\s`, "m").test(String(r.stdout));
}
const TONE_MAP = capability("-filters", "zscale") && capability("-filters", "tonemap");
const X265 = capability("-encoders", "libx265");

describe.runIf(REQUIRED)("converter · real FFmpeg is required here", () => {
  it("ffmpeg and ffprobe are both present, with zscale + tonemap (A1) and libx265 (the HDR test source)", () => {
    expect(FFMPEG, "ffmpeg").toBeTruthy();
    expect(FFPROBE, "ffprobe").toBeTruthy();
    expect(TONE_MAP, "zscale + tonemap filters").toBe(true);
    expect(X265, "libx265 encoder").toBe(true);
  });
});

/** ffprobe's view of a rendition FFmpeg wrote (the job directory still holds them after convertSource). */
function probeStream(file: string): Record<string, string> {
  const r = spawnSync(FFPROBE!, ["-v", "error", "-select_streams", "v:0", "-show_entries",
    "stream=profile,pix_fmt,bits_per_raw_sample,color_primaries,color_transfer,color_space,color_range", "-of", "json", file], { encoding: "utf8" });
  return (JSON.parse(String(r.stdout)) as { streams: Array<Record<string, string>> }).streams[0];
}
const dec = new TextDecoder();
const dirs: string[] = [];
let server: FakeServer | null = null;
afterEach(async () => {
  await server?.close(); server = null;
  for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

const launcher = () => new DirectLauncher({ ffmpeg: FFMPEG!, ffprobe: FFPROBE ?? "ffprobe" });

async function jobDir(): Promise<{ root: string; dir: string }> {
  const root = await tempDir("conv-e2e-");
  dirs.push(root);
  const dir = path.join(root, SRC);
  await fs.mkdir(dir);
  return { root, dir };
}

async function generate(dir: string, args: string[]): Promise<void> {
  const r = await launcher().run({ tool: "ffmpeg", args: ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", ...args], jobDir: dir, timeoutS: 120 });
  expect(r.exitCode, r.stderr).toBe(0);
}

async function makeSource(o: { width: number; height: number; fps: number; seconds: number; audio: boolean }): Promise<{ root: string; dir: string }> {
  const { root, dir } = await jobDir();
  const args = ["-f", "lavfi", "-i", `testsrc2=size=${o.width}x${o.height}:rate=${o.fps}:duration=${o.seconds}`];
  if (o.audio) args.push("-f", "lavfi", "-i", `sine=frequency=440:sample_rate=44100:duration=${o.seconds}`);
  args.push("-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", ...(o.audio ? ["-c:a", "aac", "-shortest"] : []), "-f", "mp4", "source");
  await generate(dir, args);
  return { root, dir };
}

/** avcC: profile_idc and level_idc of a video init segment. */
function avc(init: Uint8Array): { profile: number; level: number } {
  const avcC = findAll(init, ["moov", "trak", "mdia", "minf", "stbl", "stsd"])[0];
  for (let i = avcC.body; i < avcC.end - 8; i++) {
    if (init[i] === 0x61 && init[i + 1] === 0x76 && init[i + 2] === 0x63 && init[i + 3] === 0x43) return { profile: init[i + 5], level: init[i + 7] };
  }
  throw new Error("no avcC");
}

function expectServerAccepts(pkg: Awaited<ReturnType<typeof convertSource>>["pkg"], seconds: number) {
  expect(manifestProblems(pkg.manifest, "post")).toEqual([]);
  expect(judgeUploadContent(pkg.manifest, smallFiles(pkg.files))).toEqual([]);
  for (const [name, bytes] of pkg.files) {
    if (name.endsWith(".m3u8") && name !== "master.m3u8") expect(targetDuration(dec.decode(bytes)), name).toBeLessThanOrEqual(6);
    if (name.endsWith(".m4s")) expect(bytes.length, name).toBeLessThanOrEqual(SEGMENT_MAX_BYTES);
    if (name.endsWith(".mp4")) expect(bytes.length, name).toBeLessThanOrEqual(INIT_MAX_BYTES);
  }
  const segs = mediaPlaylistSegments(pkg.files);
  for (const s of segs) {
    expect(s.seconds, s.uri).toBeLessThanOrEqual(6);
    if (!s.last) expect(s.seconds, s.uri).toBeGreaterThanOrEqual(3.9);
    const rendition = s.playlist.replace(".m3u8", "") as keyof typeof RENDITION_CEILING_BPS;
    expect(s.bytes, s.uri).toBeLessThanOrEqual(RENDITION_CEILING_BPS[rendition] * s.seconds * 2 + (s.last ? 262_144 : 0));
  }
  for (const pl of new Set(segs.map((s) => s.playlist))) {
    const sum = segs.filter((s) => s.playlist === pl).reduce((a, s) => a + s.seconds, 0);
    expect(Math.abs(sum - seconds), pl).toBeLessThan(0.15);
  }
  expect(totalBytes(pkg.manifest)).toBe([...pkg.files.values()].reduce((a, b) => a + b.length, 0));
  const poster = pkg.files.get("poster.jpg")!;
  expect([poster[0], poster[1], poster[2]]).toEqual([0xff, 0xd8, 0xff]);
}

describe.skipIf(!FFMPEG)("converter · real FFmpeg", () => {
  it("1280x720 30 fps + sound, 10 s → 240p/480p/720p + audio that the server's judge accepts with zero problems", async () => {
    const { dir } = await makeSource({ width: 1280, height: 720, fps: 30, seconds: 10, audio: true });
    const facts = FFPROBE ? undefined : judgeProbe(probeJson({ width: 1280, height: 720, duration: 10, fps: "30/1" }));
    const { pkg, plan } = await convertSource({ launcher: launcher(), jobDir: dir, purpose: "post", preset: "veryfast", facts });
    expect(plan.video.map((v) => v.name)).toEqual(["240p", "480p", "720p"]);
    expectServerAccepts(pkg, plan.durationS);
    expect(pkg.manifest.has_audio).toBe(true);
    const master = dec.decode(pkg.files.get("master.m3u8")!);
    expect(master).toContain('RESOLUTION=426x240,CODECS="avc1.42E01E,mp4a.40.2"');
    expect(master).toContain('RESOLUTION=854x480,CODECS="avc1.42E01E,mp4a.40.2"');
    expect(master).toContain('RESOLUTION=1280x720,CODECS="avc1.42E01F,mp4a.40.2"');
    // The bytes say what the playlist says: Baseline (66), level 3.0 / 3.1.
    expect(avc(pkg.files.get("240p.mp4")!)).toEqual({ profile: 66, level: 30 });
    expect(avc(pkg.files.get("480p.mp4")!)).toEqual({ profile: 66, level: 30 });
    expect(avc(pkg.files.get("720p.mp4")!)).toEqual({ profile: 66, level: 31 });
    // 4 s segments: 4 + 4 + 2
    expect(mediaPlaylistSegments(pkg.files).filter((s) => s.playlist === "240p.m3u8").map((s) => Math.round(s.seconds * 10) / 10)).toEqual([4, 4, 2]);
    // SDR is untouched (A1): no tone mapping, no colour tags added to an untagged source
    expect(plan.toneMap).toBeNull();
    if (FFPROBE) expect(probeStream(path.join(dir, "720p.mp4")).color_transfer).toBeUndefined();
  }, 180_000);

  it.skipIf(!FFPROBE)("an iPhone-like file (A1): two audio tracks (the second is default), timecode tracks, cover art → video + the DEFAULT audio, the rest ignored", async () => {
    const { dir } = await jobDir();
    await generate(dir, ["-f", "lavfi", "-i", "testsrc2=size=320x240:duration=1", "-frames:v", "1", "-f", "image2", "cover.png"]);
    await generate(dir, [
      "-i", "cover.png", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=4",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=4", "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000:duration=4",
      "-map", "0:v", "-map", "1:v", "-map", "2:a", "-map", "3:a",
      "-c:v:0", "png", "-c:v:1", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac",
      "-disposition:v:0", "attached_pic", "-disposition:v:1", "default", "-disposition:a:0", "0", "-disposition:a:1", "default",
      "-timecode", "01:00:00:00", "-f", "mp4", "source",
    ]);
    const runs: string[][] = [];
    const spy = launcher();
    const recording = { run: (s: Parameters<typeof spy.run>[0]) => { runs.push(s.args); return spy.run(s); } };
    const { pkg, facts, plan } = await convertSource({ launcher: recording, jobDir: dir, purpose: "post", preset: "veryfast" });
    // what ffprobe lists for this file: video 0, audio 1 (not default), audio 2 (default), timecode data 3 & 4, cover picture 5
    expect(facts).toMatchObject({ videoIndex: 0, audioIndex: 2, width: 1280, height: 720, ignoredStreams: 4, hdr: false });
    expect(runs.find((a) => a.includes("aac"))!.join(" ")).toContain("-map 0:2");
    expectServerAccepts(pkg, plan.durationS);
    expect(pkg.manifest.has_audio).toBe(true);
  }, 180_000);

  it.skipIf(!FFPROBE || !TONE_MAP || !X265)("HDR (A1): a 10-bit PQ / BT.2020 HEVC source → every rendition 8-bit BT.709, accepted by the judge", async () => {
    const { dir } = await jobDir();
    await generate(dir, [
      "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=5", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=5",
      "-vf", "format=yuv420p10le", "-c:v", "libx265", "-preset", "ultrafast", "-x265-params", "log-level=error:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc",
      "-pix_fmt", "yuv420p10le", "-color_primaries", "bt2020", "-color_trc", "smpte2084", "-colorspace", "bt2020nc", "-color_range", "tv",
      "-tag:v", "hvc1", "-c:a", "aac", "-shortest", "-f", "mp4", "source",
    ]);
    const { pkg, facts, plan } = await convertSource({ launcher: launcher(), jobDir: dir, purpose: "post", preset: "veryfast" });
    expect(facts).toMatchObject({ hdr: true, videoCodec: "hevc", colour: { transfer: "smpte2084", primaries: "bt2020", pixFmt: "yuv420p10le" } });
    expect(plan.toneMap).toContain("tonemap=tonemap=hable:desat=0");
    expect(plan.video.map((v) => v.name)).toEqual(["240p", "480p", "720p"]);
    for (const v of plan.video) {
      const s = probeStream(path.join(dir, v.file));
      expect(s, v.name).toMatchObject({ pix_fmt: "yuv420p", color_primaries: "bt709", color_transfer: "bt709", color_space: "bt709", color_range: "tv" });
      expect(s.profile, v.name).toMatch(/Baseline/);
    }
    expect(avc(pkg.files.get("720p.mp4")!)).toEqual({ profile: 66, level: 31 });
    expectServerAccepts(pkg, plan.durationS);
    const poster = pkg.files.get("poster.jpg")!;
    expect([poster[0], poster[1], poster[2]]).toEqual([0xff, 0xd8, 0xff]);
  }, 240_000);

  it("no sound, 640x360 25 fps, 4.5 s → 240p only, has_audio false, accepted", async () => {
    const { dir } = await makeSource({ width: 640, height: 360, fps: 25, seconds: 4.5, audio: false });
    const facts = FFPROBE ? undefined : judgeProbe(probeJson({ width: 640, height: 360, duration: 4.5, fps: "25/1", audio: false }));
    const { pkg, plan } = await convertSource({ launcher: launcher(), jobDir: dir, purpose: "post", preset: "veryfast", facts });
    expect(plan.video.map((v) => v.name)).toEqual(["240p"]);
    expect(pkg.manifest.has_audio).toBe(false);
    expect([...pkg.files.keys()].some((n) => n.startsWith("audio"))).toBe(false);
    expectServerAccepts(pkg, plan.durationS);
  }, 180_000);

  it("portrait 720x1280 at 60 fps, 5 s → 30 fps out, 240x426 / 480x854 / 720x1280, accepted", async () => {
    const { dir } = await makeSource({ width: 720, height: 1280, fps: 60, seconds: 5, audio: true });
    const facts = FFPROBE ? undefined : judgeProbe(probeJson({ width: 720, height: 1280, duration: 5, fps: "60/1" }));
    const { pkg, plan } = await convertSource({ launcher: launcher(), jobDir: dir, purpose: "post", preset: "veryfast", facts });
    expect(plan.fps.text).toBe("30");
    expect(plan.video.map((v) => `${v.width}x${v.height}`)).toEqual(["240x426", "480x854", "720x1280"]);
    expectServerAccepts(pkg, plan.durationS);
  }, 180_000);

  it.skipIf(!FFPROBE)("ffprobe reads the real file: facts match what was generated", async () => {
    const { dir } = await makeSource({ width: 1280, height: 720, fps: 30, seconds: 3, audio: true });
    const { facts } = await convertSource({ launcher: launcher(), jobDir: dir, purpose: "post", preset: "ultrafast" });
    expect(facts).toMatchObject({ width: 1280, height: 720, hasAudio: true, videoCodec: "h264", fpsRational: "30/1" });
    expect(Math.abs(facts.durationS - 3)).toBeLessThan(0.2);
  }, 180_000);

  it.skipIf(!FFPROBE)("a whole job with real ffprobe + FFmpeg against the fake Supabase/Pages/R2: finish done, every byte uploaded", async () => {
    const { root, dir } = await makeSource({ width: 854, height: 480, fps: 30, seconds: 6, audio: true });
    const source = await fs.readFile(path.join(dir, "source"));
    await fs.rm(dir, { recursive: true, force: true }); // the job downloads it again
    const s = await fakeServer();
    server = s;
    withAuth(s);
    const stored = new Map<string, Buffer>();
    s.on("POST", "/api/video/convert/claim", (_req, res) => send(res, 200, {
      job: { source_id: SRC, owner_id: OWNER, purpose: "post", source_bytes: source.length, source_etag: "real", claim_token: TOKEN, lease_until: new Date(Date.now() + 1_800_000).toISOString(), attempt: 1 },
      source: { url: `${s.url}/r2/source`, headers: { "if-match": '"real"' }, bytes: source.length, expires_in: 1770 },
    }));
    s.on("GET", "/r2/source", (_req, res) => { res.writeHead(200, { etag: '"real"', "content-length": String(source.length) }); res.end(source); });
    s.on("POST", "/rest/v1/rpc/video_converter_begin_version", (_req, res) => send(res, 200, { video_id: VIDEO, version_no: 1, state: "uploading" }));
    s.on("POST", "/api/video/upload-urls", (req, res) => {
      const m = (req.json as { manifest: { files: Array<{ name: string; sha256: string }> } }).manifest;
      send(res, 200, { urls: m.files.map((f) => ({ name: f.name, url: `${s.url}/r2/put/${f.name}`, headers: { "content-type": "application/octet-stream" } })), done: [] });
    });
    s.on("PUT", "/r2/put/*", (req, res) => { stored.set(req.path.slice(8), req.body); res.writeHead(200); res.end(); });
    s.on("POST", "/api/video/complete", (_req, res) => send(res, 200, { state: "checking" }));
    s.on("POST", "/api/video/convert/finish", (_req, res) => send(res, 200, { status: "done" }));
    const { api } = apiFor(s);
    const claim = await api.claim();
    const out = await runJob(claim!, { api, launcher: launcher(), jobsRoot: root, preset: "veryfast", heartbeatMs: 60_000, sleep: noSleep, log: () => undefined, allowUrl: () => true });
    expect(out).toEqual({ result: "done", videoId: VIDEO, state: "checking" });
    const manifest = (s.requests.find((r) => r.path === "/api/video/upload-urls")!.json as { manifest: { files: Array<{ name: string; sha256: string }> } }).manifest;
    for (const f of manifest.files) expect(sha256(stored.get(f.name)!)).toBe(f.sha256);
  }, 180_000);

  /*
   * Review of #420, M1: very short, very detailed clips used to break the
   * database's bytes-per-second rule (a 0.5 s detailed 720p still: 670,972 B/s
   * against 358,400). Worst cases here: a full-colour noise still (nothing
   * compresses less) at 0.5 s and 1 s with noise sound, and 3 s of noise that
   * changes every frame. Each must pass checkPackage (convertSource runs it,
   * the DB arithmetic included) — and the DB arithmetic is checked again here.
   */
  const shortClip = async (o: { seconds: number; moving: boolean }) => {
    const { dir } = await jobDir();
    const noise = "format=yuv444p,noise=alls=100:allf=u" + (o.moving ? "+t" : "");
    if (o.moving) {
      await generate(dir, [
        "-f", "lavfi", "-i", `color=c=gray:s=1280x720:r=30:d=${o.seconds},${noise}`,
        "-f", "lavfi", "-i", `anoisesrc=d=${o.seconds}:c=white:r=48000:a=0.9`,
        "-c:v", "libx264", "-preset", "ultrafast", "-qp", "8", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "256k", "-ac", "2", "-shortest", "-f", "mp4", "source",
      ]);
    } else {
      await generate(dir, ["-f", "lavfi", "-i", `color=c=gray:s=1280x720:d=0.04,${noise}`, "-frames:v", "1", "-f", "image2", "still.png"]);
      await generate(dir, [
        "-loop", "1", "-framerate", "30", "-i", "still.png", "-f", "lavfi", "-i", `anoisesrc=d=${o.seconds}:c=white:r=48000:a=0.9`,
        "-t", String(o.seconds), "-c:v", "libx264", "-preset", "ultrafast", "-qp", "0", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "256k", "-ac", "2",
        "-f", "mp4", "source",
      ]);
    }
    const { pkg, plan } = await convertSource({ launcher: launcher(), jobDir: dir, purpose: "post", preset: "veryfast" });
    expect(dbVersionProblems(pkg.manifest)).toEqual([]);
    const per = renditionBytes(pkg.manifest) as Record<string, number>;
    const share: Record<string, number> = {};
    for (const [k, c] of Object.entries(DB_CEILING_BPS)) {
      if (per[k] === undefined) continue;
      share[k] = per[k] / pkg.manifest.duration_s / c;
      expect(share[k], `${k}: ${per[k]} B over ${pkg.manifest.duration_s} s`).toBeLessThan(1);
    }
    expectServerAccepts(pkg, plan.durationS);
    return { plan, share };
  };

  it.skipIf(!FFPROBE)("M1: a 0.5 s full-detail 1280x720 still with noise sound passes the database's bytes-per-second rule", async () => {
    const { plan, share } = await shortClip({ seconds: 0.5, moving: false });
    expect(plan.video.map((v) => v.name)).toEqual(["240p", "480p", "720p"]);
    expect(Object.keys(share).sort()).toEqual(["240p", "480p", "720p", "audio"]);
  }, 240_000);

  it.skipIf(!FFPROBE)("M1: a 1 s full-detail 1280x720 still with noise sound passes the database's bytes-per-second rule", async () => {
    const { share } = await shortClip({ seconds: 1, moving: false });
    expect(Object.keys(share).sort()).toEqual(["240p", "480p", "720p", "audio"]);
  }, 240_000);

  it.skipIf(!FFPROBE)("M1: worst case — 3 s of 1280x720 noise changing every frame — passes the database's bytes-per-second rule", async () => {
    const { share } = await shortClip({ seconds: 3, moving: true });
    expect(Object.keys(share).sort()).toEqual(["240p", "480p", "720p", "audio"]);
  }, 240_000);

  it.skipIf(!FFPROBE)("re-review N6f: a clip so short its sound cannot fit the per-second rule keeps its video and drops the sound — never a failure", async () => {
    for (const seconds of [0.04, 0.1]) {
      const { dir } = await jobDir();
      await generate(dir, [
        "-f", "lavfi", "-i", `testsrc2=size=1280x720:rate=30:duration=${seconds}`,
        "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${seconds}`,
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-f", "mp4", "source",
      ]);
      const events: string[] = [];
      const { pkg, plan } = await convertSource({ launcher: launcher(), jobDir: dir, purpose: "post", preset: "veryfast", log: (e) => { events.push(e); } });
      expect(dbVersionProblems(pkg.manifest), `${seconds} s`).toEqual([]);
      expectServerAccepts(pkg, plan.durationS);
      // the sound is either kept within the rule, or dropped — and then said so in the log
      expect(pkg.manifest.has_audio || events.includes("job.audio_dropped"), `${seconds} s: has_audio ${pkg.manifest.has_audio}`).toBe(true);
      if (seconds === 0.04) expect(pkg.manifest.has_audio, "0.04 s: the audio init segment alone is above 16,384 B/s").toBe(false);
    }
  }, 240_000);

  it.skipIf(!FFPROBE || !TONE_MAP || !X265)("HDR highlights (review of #420): a 4000-nit PQ frame rolls off — 100 < 1000 < 2000 < 4000 nits stay distinct and inside limited range", async () => {
    const { dir } = await jobDir();
    // 640x360 yuv420p10le, four bands at 100 / 1,000 / 2,000 / 4,000 nits (PQ, 10-bit limited-range codes), neutral chroma
    const W = 640, H = 360, codes = [509, 723, 789, 855];
    const y = Buffer.alloc(W * H * 2), c = Buffer.alloc((W / 2) * (H / 2) * 2);
    for (let r = 0; r < H; r++) for (let x = 0; x < W; x++) y.writeUInt16LE(codes[Math.floor((x * 4) / W)], (r * W + x) * 2);
    for (let i = 0; i < c.length; i += 2) c.writeUInt16LE(512, i);
    await fs.writeFile(path.join(dir, "frame.yuv"), Buffer.concat([y, c, c]));
    await generate(dir, [
      "-f", "rawvideo", "-pix_fmt", "yuv420p10le", "-s", `${W}x${H}`, "-r", "25", "-i", "frame.yuv", "-vf", `loop=loop=49:size=1,${HDR_TAG_FILTER}`,
      "-c:v", "libx265", "-preset", "ultrafast", "-x265-params", "log-level=error", "-pix_fmt", "yuv420p10le",
      "-color_primaries", "bt2020", "-color_trc", "smpte2084", "-colorspace", "bt2020nc", "-color_range", "tv", "-tag:v", "hvc1", "-f", "mp4", "source",
    ]);
    const { pkg, plan } = await convertSource({ launcher: launcher(), jobDir: dir, purpose: "post", preset: "veryfast" });
    expect(plan.toneMap).toContain("tonemap=tonemap=hable:desat=0:peak=100,");
    expectServerAccepts(pkg, plan.durationS);
    // the first frame of the 240p rendition, its luma plane as stored (limited range, no conversion)
    await generate(dir, ["-i", "240p.mp4", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "yuv420p", "frame0.yuv"]);
    const out = await fs.readFile(path.join(dir, "frame0.yuv"));
    const w = plan.video[0].width, row = Math.floor(plan.video[0].height / 2) * w;
    const luma = [0.125, 0.375, 0.625, 0.875].map((f) => out[row + Math.floor(f * w)]);
    for (let i = 1; i < luma.length; i++) expect(luma[i], `luma ${luma.join("/")}`).toBeGreaterThan(luma[i - 1]);
    for (const v of luma) { expect(v).toBeGreaterThanOrEqual(16); expect(v).toBeLessThanOrEqual(235); }
  }, 240_000);

  it.skipIf(!FFPROBE)("R-VM-1 (FFmpeg 9): the self-test's HDR source carries its tags on the frames — this ffprobe reads PQ / BT.2020; the output options alone are not relied on", async () => {
    const { dir } = await jobDir();
    const r = await launcher().run({ tool: "ffmpeg", args: synthHdrArgs(1), jobDir: dir, timeoutS: 120 });
    expect(r.exitCode, r.stderr).toBe(0);
    const facts = await probeSource({ launcher: launcher(), jobDir: dir });
    expect(facts).toMatchObject({ hdr: true, colour: { transfer: "smpte2084", primaries: "bt2020", matrix: "bt2020nc", range: "tv" } });
    expect(synthHdrArgs()).toContain(HDR_TAG_FILTER);
  }, 120_000);

  it.skipIf(!FFPROBE || !TONE_MAP)("the self-test passes (what the worker runs at every start), its HDR case tone-mapped", async () => {
    const root = await tempDir("conv-self-");
    dirs.push(root);
    const r = await selfTest({ launcher: launcher(), jobsRoot: root, preset: "ultrafast" });
    expect(r).toMatchObject({ ok: true, renditions: ["240p", "480p", "720p"], has_audio: true, hdr_tone_mapped: true });
    expect(r.max_segment_s!).toBeLessThanOrEqual(6);
    expect(await fs.readdir(root)).toEqual([]);
  }, 180_000);
});
