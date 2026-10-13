/**
 * Step 3 · what is in the member's file, read by ffprobe UNDER LIMITS and
 * judged here before any decoder runs over the whole file
 * (CONVERTER-DESIGN.md v2 §3 step 5, as amended 2026-10-13 — A1).
 *
 * WHICH STREAMS (amendment A1, "iPhone videos must work and keep their colours"):
 *   video  the first video stream that is NOT a cover picture (attached_pic)
 *          and has a codec FFmpeg knows — mapped BY ITS INDEX, so a cover
 *          picture listed first can never be the one converted;
 *   audio  the stream marked default, else the first audio stream (among
 *          those with a codec FFmpeg knows), by its index — never mixed;
 *   every other stream (iPhone timed metadata "mebx", timecode "tmcd",
 *          subtitles, attachments, cover pictures, more audio) is ALLOWED and
 *          IGNORED: never mapped.
 *
 * Refused (fixed codes, failures.ts) — OWNER GOAL "any format, like
 * Instagram" (re-review of #420, N5): everything a phone records is accepted,
 * up to 4K at 120 fps; only what is beyond any camera is refused, and as
 * "too large", never as "export it as MP4" (which would not help):
 *   no real video stream (none, or only cover pictures) → no_video
 *   video streams, but none with a codec FFmpeg knows,
 *   a demuxer outside the allow-list, under 1 fps,
 *   more than 64 streams                                 → unsupported_format
 *   width or height above 4096, more than 240 fps (up to
 *   1920×1080) / 120 fps (above), more than just above
 *   4096×2160×120 decoded pixels per second (1 % slack
 *   for variable-rate phone files, FPS_SLACK)            → too_big
 *   longer than 15 h                                     → too_long
 *   unreadable size / length, a length under 0.005 s     → damaged
 *
 * The facts that come out are the DISPLAY size (rotation and non-square
 * pixels applied — what a browser's video.videoWidth/Height says, which is
 * what the device path declares), the length the package will have, the
 * chosen streams' indices, and the colour description (HDR → tone-mapped to
 * SDR BT.709 by encode.ts).
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
/** Above 1920×1080 (either orientation): 4K120 is accepted (re-review N5). */
export const MAX_FPS = 120;
/** Up to 1920×1080: iPhone slow motion records 240 fps (review of #420, M2). The output is ≤ 30 fps either way. */
export const MAX_FPS_UP_TO_1080P = 240;
/**
 * A phone's variable-rate file reports an AVERAGE rate a hair off its nominal one
 * (a 120 fps clip can say 120.04): the fps limits and the pixel-rate ceiling
 * carry 1 % slack, so a real 120 / 240 fps recording is never "too big".
 */
export const FPS_SLACK = 1.01;
/**
 * Decoding cost bound, width × height × fps: just above 4096×2160 at 120 fps
 * (4096 × 2160 × 121.2 = 1,072,300,032; re-review N5) — UHD/DCI 4K120 and
 * 1080p240 pass; the per-run time cap (3 × length + 10 min) bounds how long
 * any of them may take.
 */
export const MAX_PIXEL_RATE = 1_072_300_032;
/** At ~2.9× real time a longer video cannot finish inside a claim's 6 h ceiling (design §3 step 5). */
export const MAX_DURATION_S = 15 * 3600;
/** A sanity bound on a hostile file, far above any camera's (an iPhone .mov has ~5). */
export const MAX_STREAMS = 64;

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

/** The source's colour description, as ffprobe names it ("" when the file does not say). */
export interface ColourFacts {
  transfer: string;
  primaries: string;
  matrix: string;
  range: string;
  pixFmt: string;
  /** HDR10 metadata: MaxCLL, else the mastering display's peak (nits); null when the file has neither */
  peakNits?: number | null;
}

export interface ProbeFacts {
  formatName: string;
  /** seconds: the package's length (format duration; the longest stream when the container has none) */
  durationS: number;
  /** the chosen video stream's index in the file (`-map 0:<index>`) */
  videoIndex: number;
  /** the chosen audio stream's index, or null when the version has no sound */
  audioIndex: number | null;
  /** streams in the file that are not converted (metadata, timecode, cover pictures, other audio …) */
  ignoredStreams: number;
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
  colour: ColourFacts;
  /** PQ or HLG transfer, or BT.2020 primaries → tone-mapped to SDR BT.709 (encode.ts) */
  hdr: boolean;
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
  pix_fmt?: string;
  color_range?: string;
  color_space?: string;
  color_transfer?: string;
  color_primaries?: string;
  disposition?: Record<string, number>;
  tags?: Record<string, string>;
  side_data_list?: Array<{ side_data_type?: string; rotation?: number | string; max_content?: number | string; max_luminance?: number | string }>;
}
interface RawProbe { format?: { format_name?: string; duration?: string; nb_streams?: number }; streams?: RawStream[] }

const RATIONAL = /^(\d{1,9})\/(\d{1,9})$/;
/** ffprobe prints "unknown" for a codec FFmpeg has no descriptor for (e.g. Apple's spatial audio, APAC). */
const knownCodec = (s: RawStream) => !!s.codec_name && s.codec_name !== "unknown" && s.codec_name !== "none";
const isPicture = (s: RawStream) => s.disposition?.attached_pic === 1;

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

/** A number or an ffprobe rational ("10000000/10000"). */
function num(v: number | string | undefined): number {
  if (typeof v === "number") return v;
  const m = /^(-?\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/.exec(String(v ?? "").trim());
  if (!m) return NaN;
  return m[2] !== undefined ? Number(m[1]) / Number(m[2]) : Number(m[1]);
}

/** HDR10 peak: Content light level MaxCLL, else Mastering display max luminance (nits), within 100–10,000. */
function peakNitsOf(v: RawStream): number | null {
  const sd = v.side_data_list ?? [];
  const cll = num(sd.find((x) => /content light level/i.test(String(x?.side_data_type)))?.max_content);
  const mastering = num(sd.find((x) => /mastering display/i.test(String(x?.side_data_type)))?.max_luminance);
  for (const n of [cll, mastering]) if (Number.isFinite(n) && n >= 100 && n <= 10_000) return n;
  return null;
}

function streamIndex(s: RawStream, fallback: number): number {
  const i = Number(s.index);
  return Number.isInteger(i) && i >= 0 ? i : fallback;
}

/** HDR as decision A1 defines it: a PQ or HLG transfer, or BT.2020 primaries. */
export function isHdr(c: Pick<ColourFacts, "transfer" | "primaries">): boolean {
  return c.transfer === "smpte2084" || c.transfer === "arib-std-b67" || c.primaries === "bt2020";
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
  if (streams.length > MAX_STREAMS) throw new JobFailure("unsupported_format", `${streams.length} streams`);

  // The video: the first real (not cover-picture) video stream FFmpeg can decode.
  const realVideo = streams.filter((s) => s.codec_type === "video" && !isPicture(s));
  if (realVideo.length === 0) throw new JobFailure("no_video", streams.some((s) => s.codec_type === "video") ? "only a cover picture, no video" : "no video stream");
  const v = realVideo.find(knownCodec);
  if (!v) throw new JobFailure("unsupported_format", "unknown video codec");

  // The sound: the default stream, else the first — among streams FFmpeg can decode.
  const audio = streams.filter((s) => s.codec_type === "audio" && knownCodec(s));
  const a = audio.find((s) => s.disposition?.default === 1) ?? audio[0];

  const codedWidth = Number(v.width), codedHeight = Number(v.height);
  if (!Number.isInteger(codedWidth) || !Number.isInteger(codedHeight) || codedWidth < 2 || codedHeight < 2) {
    throw new JobFailure("damaged", "the video has no readable size");
  }
  if (codedWidth > MAX_SIDE || codedHeight > MAX_SIDE) throw new JobFailure("too_big", `${codedWidth}x${codedHeight} is above ${MAX_SIDE} on a side`);

  const r = rate(v.avg_frame_rate) ?? rate(v.r_frame_rate);
  if (!r) throw new JobFailure("unsupported_format", "no frame rate");
  const upTo1080p = Math.max(codedWidth, codedHeight) <= 1920 && Math.min(codedWidth, codedHeight) <= 1080;
  const maxFps = upTo1080p ? MAX_FPS_UP_TO_1080P : MAX_FPS;
  if (r.value < MIN_FPS) throw new JobFailure("unsupported_format", `${r.value.toFixed(2)} fps is below ${MIN_FPS}`);
  // Beyond any camera: a resource limit, so "too large to convert" (re-review N5).
  if (r.value > maxFps * FPS_SLACK) throw new JobFailure("too_big", `${r.value.toFixed(2)} fps is above ${maxFps} at ${codedWidth}x${codedHeight}`);
  const pixelRate = codedWidth * codedHeight * r.value;
  if (pixelRate > MAX_PIXEL_RATE) {
    throw new JobFailure("too_big", `${codedWidth}x${codedHeight} at ${r.value.toFixed(2)} fps is ${Math.round(pixelRate)} pixels/s, above ${MAX_PIXEL_RATE}`);
  }

  let durationS = seconds(p.format.duration);
  if (!(durationS > 0)) {
    const each = streams.filter((s) => s.codec_type === "video" || s.codec_type === "audio").map((s) => seconds(s.duration)).filter((x) => x > 0);
    durationS = each.length ? Math.max(...each) : NaN;
  }
  if (!(durationS > 0) || !Number.isFinite(durationS)) throw new JobFailure("damaged", "no readable length");
  // The declared length has 2 decimals (numeric(7,2)): one that rounds to 0 is not a video (re-review N6f).
  if (Math.round(durationS * 100) < 1) throw new JobFailure("damaged", `a length of ${durationS} s rounds to 0`);
  if (durationS > MAX_DURATION_S) throw new JobFailure("too_long", `${Math.round(durationS)} s is above ${MAX_DURATION_S} s`);

  const rotation = rotationOf(v);
  let width = codedWidth, height = codedHeight;
  const sar = /^(\d{1,6}):(\d{1,6})$/.exec(String(v.sample_aspect_ratio ?? ""));
  if (sar && Number(sar[1]) > 0 && Number(sar[2]) > 0 && sar[1] !== sar[2]) {
    width = Math.max(2, Math.round((codedWidth * Number(sar[1])) / Number(sar[2])));
    if (width > MAX_SIDE) throw new JobFailure("too_big", `display width ${width} is above ${MAX_SIDE}`);
  }
  if (rotation === 90 || rotation === 270) [width, height] = [height, width];

  const tag = (x: string | undefined) => (x && x !== "unknown" && x !== "reserved" ? x : "");
  const colour: ColourFacts = {
    transfer: tag(v.color_transfer), primaries: tag(v.color_primaries), matrix: tag(v.color_space),
    range: tag(v.color_range), pixFmt: String(v.pix_fmt ?? ""), peakNits: peakNitsOf(v),
  };
  const videoIndex = streamIndex(v, streams.indexOf(v));
  const audioIndex = a ? streamIndex(a, streams.indexOf(a)) : null;
  return {
    formatName, durationS, videoIndex, audioIndex,
    ignoredStreams: streams.length - 1 - (a ? 1 : 0),
    codedWidth, codedHeight, width, height, rotation,
    videoCodec: String(v.codec_name), fpsRational: r.text, fps: r.value,
    hasAudio: !!a, audioChannels: a ? Math.max(1, Math.min(64, Number(a.channels) || 2)) : 0,
    audioCodec: a ? String(a.codec_name) : null,
    colour, hdr: isHdr(colour),
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
