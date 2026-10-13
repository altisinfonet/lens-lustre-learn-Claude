/**
 * Steps 3–5a · from the original in a job directory to the judged package:
 * probe → plan → encode (video renditions, audio, poster) → package with the
 * browser's own packager → judge with the server's own judge.
 *
 * Used by the job (job.ts) and by the self-test (selftest.ts), so the
 * self-test exercises exactly the code a member's video goes through.
 */
import path from "node:path";
import { packageFromFragmented, type HlsPackage } from "../../src/lib/video/hlsPackager";
import { judgeUploadContent, smallFiles } from "../../src/lib/video/shared/judge";
import { manifestProblems, type VideoPurpose } from "../../src/lib/video/shared/rules";
import { audioArgs, planEncode, posterArgs, runLimitS, videoArgs, type EncodePlan, type X264Preset } from "./encode";
import { classifyToolFailure, JobFailure } from "./failures";
import { readJobFile, STDOUT_MAX, type Launcher } from "./launcher";
import { judgeProbe, probeArgs, PROBE_TIMEOUT_S, type ProbeFacts } from "./probe";

/** A rendition file bigger than the whole package limit cannot be part of a package. */
export const MAX_RENDITION_FILE = 524_288_000;
/** Poster + playlists are at most 2 MB together (VID-LIM-005); a poster above this is re-made smaller. */
export const POSTER_SOFT_MAX = 1_000_000;
export const POSTER_HARD_MAX = 1_800_000;

export interface ConvertOptions {
  launcher: Launcher;
  jobDir: string;
  purpose: VideoPurpose;
  preset: X264Preset;
  signal?: AbortSignal;
  log?: (event: string, fields?: Record<string, unknown>) => void;
  /** tests without ffprobe: facts known in advance */
  facts?: ProbeFacts;
  now?: () => number;
}

export interface Converted { pkg: HlsPackage; facts: ProbeFacts; plan: EncodePlan }

export async function probeSource(o: Pick<ConvertOptions, "launcher" | "jobDir" | "signal">): Promise<ProbeFacts> {
  const r = await o.launcher.run({ tool: "ffprobe", args: probeArgs(), jobDir: o.jobDir, timeoutS: PROBE_TIMEOUT_S, signal: o.signal });
  if (r.exitCode !== 0) throw classifyToolFailure("ffprobe", r);
  if (r.stdout.length > STDOUT_MAX) throw new JobFailure("unsupported_format", "ffprobe output is too large");
  return judgeProbe(r.stdout);
}

async function output(dir: string, name: string, max: number, tooBig: JobFailure): Promise<Uint8Array> {
  let bytes: Uint8Array;
  try {
    bytes = await readJobFile(path.join(dir, name), max);
  } catch (e) {
    if (/above \d+$/.test((e as Error).message)) throw tooBig;
    throw new JobFailure("damaged", `FFmpeg made no ${name} (${(e as Error).message.slice(0, 80)})`);
  }
  if (bytes.length === 0) throw new JobFailure("damaged", `FFmpeg made an empty ${name}`);
  return bytes;
}

export async function makePoster(o: ConvertOptions, plan: EncodePlan): Promise<Uint8Array> {
  const attempts: Array<{ at: number; q: number }> = [{ at: plan.poster.atS, q: 3 }, { at: plan.poster.atS, q: 10 }, { at: 0, q: 10 }];
  let lastError: JobFailure | null = null;
  for (const a of attempts) {
    const r = await o.launcher.run({ tool: "ffmpeg", args: posterArgs(plan, a.at, a.q), jobDir: o.jobDir, timeoutS: 300, signal: o.signal });
    if (r.exitCode !== 0) { lastError = classifyToolFailure("ffmpeg", r); if (lastError.code !== "damaged") throw lastError; continue; }
    try {
      const jpeg = await output(o.jobDir, plan.poster.file, POSTER_HARD_MAX, new JobFailure("internal", "the poster is too large"));
      if (jpeg.length > POSTER_SOFT_MAX && a.q < 10) continue; // a noisy frame: same moment, smaller file
      return jpeg;
    } catch (e) {
      lastError = e instanceof JobFailure ? e : new JobFailure("internal", String(e));
    }
  }
  throw lastError ?? new JobFailure("damaged", "no poster frame");
}

export async function convertSource(o: ConvertOptions): Promise<Converted> {
  const log = o.log ?? (() => undefined);
  const now = o.now ?? Date.now;
  let t0 = now();
  const facts = o.facts ?? (await probeSource(o));
  log("job.probed", {
    format: facts.formatName, codec: facts.videoCodec, width: facts.width, height: facts.height, rotation: facts.rotation,
    fps: Math.round(facts.fps * 100) / 100, duration_s: Math.round(facts.durationS * 10) / 10, audio: facts.audioCodec,
    video_stream: facts.videoIndex, audio_stream: facts.audioIndex, ignored_streams: facts.ignoredStreams,
    hdr: facts.hdr, transfer: facts.colour.transfer || null, primaries: facts.colour.primaries || null, pix_fmt: facts.colour.pixFmt || null,
    ms: now() - t0,
  });
  const plan = planEncode(facts);
  log("job.planned", {
    step: plan.ladder.step, renditions: plan.video.map((v) => `${v.name}:${v.width}x${v.height}@${v.bitrate}`), audio_bps: plan.audio?.bitrate ?? 0,
    fps: plan.fps.text, tone_map: plan.toneMap !== null,
  });

  const limit = runLimitS(plan.durationS);
  t0 = now();
  const v = await o.launcher.run({ tool: "ffmpeg", args: videoArgs(plan, o.preset), jobDir: o.jobDir, timeoutS: limit, signal: o.signal });
  if (v.exitCode !== 0) throw classifyToolFailure("ffmpeg", v);
  log("job.encoded", { what: "video", ms: now() - t0 });
  if (plan.audio) {
    t0 = now();
    const a = await o.launcher.run({ tool: "ffmpeg", args: audioArgs(plan), jobDir: o.jobDir, timeoutS: limit, signal: o.signal });
    if (a.exitCode !== 0) throw classifyToolFailure("ffmpeg", a);
    log("job.encoded", { what: "audio", ms: now() - t0 });
  }
  const poster = await makePoster(o, plan);

  const tooBig = new JobFailure("too_big", "a rendition is larger than the whole package limit");
  const video = [];
  for (const r of plan.video) {
    video.push({ name: r.name, width: r.width, height: r.height, codecString: r.codecString, file: await output(o.jobDir, r.file, MAX_RENDITION_FILE, tooBig) });
  }
  const audio = plan.audio ? { codecString: plan.audio.codecString, file: await output(o.jobDir, plan.audio.file, MAX_RENDITION_FILE, tooBig) } : null;

  let pkg: HlsPackage;
  try {
    pkg = await packageFromFragmented({ video, audio, poster, durationSeconds: plan.durationS, sourceWidth: plan.sourceWidth, sourceHeight: plan.sourceHeight });
  } catch (e) {
    throw new JobFailure("internal", `packaging: ${(e as Error).message.slice(0, 160)}`);
  }
  for (const r of plan.video) {
    if (![...pkg.files.keys()].some((n) => n.startsWith(`${r.name}_`))) throw new JobFailure("damaged", `no ${r.name} frames could be decoded`);
  }
  checkPackage(pkg, o.purpose);
  log("job.packaged", { files: pkg.manifest.files.length, bytes: pkg.manifest.files.reduce((a, f) => a + f.bytes, 0) });
  return { pkg, facts, plan };
}

/** The server's own rules, run here first (design §3 step 5: fail fast, before any upload). */
export function checkPackage(pkg: HlsPackage, purpose: VideoPurpose): void {
  const problems = [...manifestProblems(pkg.manifest, purpose), ...judgeUploadContent(pkg.manifest, smallFiles(pkg.files))];
  if (!problems.length) return;
  // Only the package being too big overall is the FILE's fault; anything else is ours (retried).
  const size = problems.some((p) => /^total \d+ bytes is above|files is above/.test(p));
  throw new JobFailure(size ? "too_big" : "internal", `the package breaks the upload rules: ${problems.slice(0, 3).join("; ").slice(0, 200)}`);
}
