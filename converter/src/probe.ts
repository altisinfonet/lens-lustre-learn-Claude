/**
 * Step 3 · what is in the member's file, read by ffprobe UNDER LIMITS and
 * judged here before any decoder runs over the whole file
 * (CONVERTER-DESIGN.md v2 §3 step 5).
 *
 * Refused (fixed codes, failures.ts):
 *   no video stream                                   → no_video
 *   more than one video stream, more than one audio
 *   stream, a cover picture (attached_pic), any data /
 *   subtitle / attachment stream, a demuxer outside
 *   the allow-list, fps outside 1–120                 → unsupported_format
 *   width or height above 4096                         → too_big
 *   longer than 15 h                                   → too_long
 *   unreadable size / length                           → damaged
 *
 * The facts that come out are the DISPLAY size (rotation and non-square
 * pixels applied — what a browser's video.videoWidth/Height says, which is
 * what the device path declares), the length the package will have, and
 * the output frame rate (see outputFps).
 */
import { JobFailure } from "./failures";

/** The only demuxers FFmpeg may use on a member's file (never hls, concat, subfile, lavfi, image2 …). */
export const INPUT_FORMATS = ["mov", "mp4", "m4a", "3gp", "3g2", "mj2", "matroska", "webm", "avi", "mpegts"] as const;
export const INPUT_FORMAT_WHITELIST = INPUT_FORMATS.join(",");

/** Bounded probing: never read more than this to find the streams. */
export const PROBE_SIZE_BYTES = 33_554_432; // 32 MiB
export const ANALYZE_DURATION_US = 20_000_000; // 20 s of media
export const PROBE_TIMEOUT_S = 120;

export const MAX_SIDE = 4096;
export const MIN_FPS = 1;
export const MAX_FPS = 120;
/** At ~2.9× real time a longer video cannot finish inside a claim's 6 h ceiling (design §3 step 5). */
export const MAX_DURATION_S = 15 * 3600;

/**
 * Design §3 step 5 refuses data/subtitle streams. Phones commonly add timed
 * metadata tracks (iPhone "mebx", "tmcd"), which this refuses as
 * unsupported_format — kept as specified; flip only on a recorded decision.
 */
export const ALLOW_DATA_STREAMS = false;

/** The input-side options every ffprobe/ffmpeg run on a member's file carries. */
export function inputGuardArgs(): string[] {
  return [
    "-protocol_whitelist", "file",
    "-format_whitelist", INPUT_FORMAT_WHITELIST,
    "-probesize", String(PROBE_SIZE_BYTES),
    "-analyzeduration", String(ANALYZE_DURATION_US),
  ];
}

/** ffprobe, run in the job directory on the file `source`. JSON on stdout. */
export function probeArgs(input = "source"): string[] {
  return [
    "-hide_banner", "-v", "error",
    ...inputGuardArgs(),
    "-print_format", "json",
    "-show_format", "-show_streams",
    "-i", input,
  ];
}

export interface ProbeFacts {
  formatName: string;
  /** seconds: the package's length (format duration; the longest stream when the container has none) */
  durationS: number;
  /** coded size of the video stream */
  codedWidth: number;
  codedHeight: number;
  /** display size: rotation + sample aspect ratio applied, even-rounded only later by renditionsFor */
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  videoCodec: string;
  /** source frame rate, as FFmpeg's rational ("30000/1001") and as a number */
  fpsRational: string;
  fps: number;
  hasAudio: boolean;
  audioChannels: number;
  audioCodec: string | null;
}

interface RawStream {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  duration?: string;
  channels?: number;
  sample_aspect_ratio?: string;
  disposition?: Record<string, number>;
  tags?: Record<string, string>;
  side_data_list?: Array<{ side_data_type?: string; rotation?: number | string }>;
}
interface RawProbe { format?: { format_name?: string; duration?: string; nb_streams?: number }; streams?: RawStream[] }

const RATIONAL = /^(\d{1,9})\/(\d{1,9})$/;

function rate(s: string | undefined): { text: string; value: number } | null {
  const m = RATIONAL.exec(String(s ?? ""));
  if (!m) return null;
  const n = Number(m[1]), d = Number(m[2]);
  if (!(n > 0) || !(d > 0)) return null;
  return { text: `${n}/${d}`, value: n / d };
}

function seconds(s: string | number | undefined): number {
  const v = typeof s === "number" ? s : Number.parseFloat(String(s ?? ""));
  return Number.isFinite(v) ? v : NaN;
}

function rotationOf(v: RawStream): 0 | 90 | 180 | 270 {
  let deg: number | undefined;
  for (const sd of v.side_data_list ?? []) {
    if (sd && sd.rotation !== undefined && Number.isFinite(Number(sd.rotation))) { deg = Number(sd.rotation); break; }
  }
  if (deg === undefined && v.tags?.rotate !== undefined && Number.isFinite(Number(v.tags.rotate))) deg = Number(v.tags.rotate);
  const r = ((Math.round((deg ?? 0) / 90) * 90) % 360 + 360) % 360;
  return r as 0 | 90 | 180 | 270;
}

/** Judge ffprobe's JSON. Throws JobFailure with the fixed code; returns the facts otherwise. */
export function judgeProbe(json: string): ProbeFacts {
  let p: RawProbe;
  try {
    p = JSON.parse(json) as RawProbe;
  } catch {
    throw new JobFailure("damaged", "ffprobe output is not JSON");
  }
  if (!p || typeof p !== "object" || !p.format || !Array.isArray(p.streams)) throw new JobFailure("damaged", "ffprobe found no container");
  const formatName = String(p.format.format_name ?? "");
  const allowed = new Set<string>(INPUT_FORMATS);
  if (!formatName.split(",").some((f) => allowed.has(f))) throw new JobFailure("unsupported_format", `container ${formatName.slice(0, 40) || "unknown"}`);

  const streams = p.streams;
  if (streams.length > 64) throw new JobFailure("unsupported_format", `${streams.length} streams`);
  const pictures = streams.filter((s) => s.codec_type === "video" && s.disposition?.attached_pic === 1);
  if (pictures.length) throw new JobFailure("unsupported_format", "the file carries a cover picture stream (attached_pic)");
  const video = streams.filter((s) => s.codec_type === "video");
  const audio = streams.filter((s) => s.codec_type === "audio");
  const other = streams.filter((s) => s.codec_type !== "video" && s.codec_type !== "audio");
  if (video.length === 0) throw new JobFailure("no_video", "no video stream");
  if (video.length > 1) throw new JobFailure("unsupported_format", `${video.length} video streams`);
  if (audio.length > 1) throw new JobFailure("unsupported_format", `${audio.length} audio streams`);
  const refusedOther = ALLOW_DATA_STREAMS ? other.filter((s) => s.codec_type !== "data") : other;
  if (refusedOther.length) {
    throw new JobFailure("unsupported_format", `extra streams: ${refusedOther.map((s) => s.codec_type ?? "unknown").join(",").slice(0, 60)}`);
  }

  const v = video[0];
  const codedWidth = Number(v.width), codedHeight = Number(v.height);
  if (!Number.isInteger(codedWidth) || !Number.isInteger(codedHeight) || codedWidth < 2 || codedHeight < 2) {
    throw new JobFailure("damaged", "the video has no readable size");
  }
  if (codedWidth > MAX_SIDE || codedHeight > MAX_SIDE) throw new JobFailure("too_big", `${codedWidth}x${codedHeight} is above ${MAX_SIDE} on a side`);
  if (!v.codec_name || v.codec_name === "none") throw new JobFailure("unsupported_format", "unknown video codec");

  const r = rate(v.avg_frame_rate) ?? rate(v.r_frame_rate);
  if (!r) throw new JobFailure("unsupported_format", "no frame rate");
  if (r.value < MIN_FPS || r.value > MAX_FPS) throw new JobFailure("unsupported_format", `${r.value.toFixed(2)} fps is outside ${MIN_FPS}–${MAX_FPS}`);

  let durationS = seconds(p.format.duration);
  if (!(durationS > 0)) {
    const each = streams.filter((s) => s.codec_type === "video" || s.codec_type === "audio").map((s) => seconds(s.duration)).filter((x) => x > 0);
    durationS = each.length ? Math.max(...each) : NaN;
  }
  if (!(durationS > 0) || !Number.isFinite(durationS)) throw new JobFailure("damaged", "no readable length");
  if (durationS > MAX_DURATION_S) throw new JobFailure("too_long", `${Math.round(durationS)} s is above ${MAX_DURATION_S} s`);

  const rotation = rotationOf(v);
  let width = codedWidth, height = codedHeight;
  const sar = /^(\d{1,6}):(\d{1,6})$/.exec(String(v.sample_aspect_ratio ?? ""));
  if (sar && Number(sar[1]) > 0 && Number(sar[2]) > 0 && sar[1] !== sar[2]) {
    width = Math.max(2, Math.round((codedWidth * Number(sar[1])) / Number(sar[2])));
    if (width > MAX_SIDE) throw new JobFailure("too_big", `display width ${width} is above ${MAX_SIDE}`);
  }
  if (rotation === 90 || rotation === 270) [width, height] = [height, width];

  const a = audio[0];
  const channels = a ? Math.max(1, Math.min(64, Number(a.channels) || 2)) : 0;
  return {
    formatName, durationS, codedWidth, codedHeight, width, height, rotation,
    videoCodec: String(v.codec_name), fpsRational: r.text, fps: r.value,
    hasAudio: !!a, audioChannels: channels, audioCodec: a ? String(a.codec_name ?? "unknown") : null,
  };
}

/**
 * The output frame rate: the source's own when it is 10–30 fps, 30 above
 * that, 10 below. Why: keyframes are forced every 2 s and a fragment is cut at
 * the first keyframe ≥ 3.9 s into it; with frames ≤ 0.1 s apart that keyframe
 * is < 4.1 s in, so every segment but the last is ~4 s and EXT-X-TARGETDURATION
 * stays ≤ 5. At 2 fps a segment could reach ~6.9 s and break the ≤ 6 rule.
 * Duplicating frames of a slideshow-rate video costs almost nothing in bytes;
 * 30 matches the browser encoder's framerate setting (webEncoder.ts).
 */
export function outputFps(f: Pick<ProbeFacts, "fps" | "fpsRational">): { text: string; value: number } {
  if (f.fps > 30) return { text: "30", value: 30 };
  if (f.fps < 10) return { text: "10", value: 10 };
  return { text: f.fpsRational, value: f.fps };
}
