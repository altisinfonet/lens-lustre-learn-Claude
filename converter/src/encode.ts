/**
 * Step 4 · the FFmpeg command lines. Pure: facts in, argument lists out, so
 * every flag is tested without running anything.
 *
 * The package must have the SAME shape the browser makes (webEncoder.ts +
 * hlsPackager.ts), because the same judge checks both:
 *   • H.264 Baseline, yuv420p, the browser's codec strings: avc1.42E01E for a
 *     rendition ≤ 480 px tall, avc1.42E01F above (H264_AAC.video.codec) — the
 *     SPS level is set to match (3.0 / 3.1);
 *   • a keyframe every 2 s (`-force_key_frames expr:gte(t,n_forced*2)`, -g =
 *     2 s of frames, no scene-cut keyframes);
 *   • fragmented MP4, one fragment per ~4 s: a fragment is cut only at a
 *     keyframe (+frag_keyframe) and only once it is ≥ 3.9 s long
 *     (-min_frag_duration) → 4 s segments, the last one shorter — the same
 *     4 s the browser's mp4-muxer setting (KEYFRAME_SECONDS + 0.15) gives for
 *     2 s keyframes. The output is constant-frame-rate (the fps filter fills
 *     held pictures), and outputFps() keeps frames ≤ 0.1 s apart, so every
 *     segment but the last is 3.9–4.1 s: never near the judge's 6 s;
 *   • the planned bitrate as the ABR target, -maxrate ×1.2, -bufsize ×2;
 *   • AAC-LC (mp4a.40.2) as a SEPARATE rendition, 4 s fragments
 *     (-frag_duration), 48 kHz, at most 2 channels, at the plan's rate;
 *   • every output exactly the package's length: video padded at the start
 *     (fps start_time=0) and the end (tpad), audio likewise
 *     (aresample first_pts=0, apad), both cut with -t — so every playlist adds
 *     up to the declared length, as the judge requires (±2 s).
 * Hygiene on every run (design §3 step 5): -protocol_whitelist file, the
 * demuxer allow-list, bounded probing, -map of exactly the streams used,
 * -map_metadata -1, -map_chapters -1, -nostdin.
 */
import { planLadder, type LadderPlan, type RenditionName } from "../../src/lib/video/ladder";
import { KEYFRAME_SECONDS, renditionsFor, SEGMENT_SECONDS } from "../../src/lib/video/hlsPackager";
import { JobFailure } from "./failures";
import { inputGuardArgs, outputFps, type ProbeFacts } from "./probe";

/** Same strings as webEncoder.ts H264_AAC (asserted by a test). */
export function videoCodecFor(height: number): string {
  return height <= 480 ? "avc1.42E01E" : "avc1.42E01F";
}
export const AUDIO_CODEC = "mp4a.40.2";
const LEVEL: Record<string, string> = { "avc1.42E01E": "3.0", "avc1.42E01F": "3.1" };

export const X264_PRESETS = ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium"] as const;
export type X264Preset = (typeof X264_PRESETS)[number];

/** A fragment is cut at the first keyframe once it is at least this long (µs). */
export const MIN_FRAGMENT_US = Math.round((SEGMENT_SECONDS - 0.1) * 1e6);
/** Audio fragments: cut once ≥ 4 s (AAC frames are ~21 ms → ~4.01 s segments). */
export const AUDIO_FRAGMENT_US = SEGMENT_SECONDS * 1e6;
export const AUDIO_SAMPLE_RATE = 48_000;
/** A claim lives at most 6 h (20261012_0002): no run may outlast it. */
export const MAX_RUN_S = 6 * 3600;

export interface PlannedVideo {
  name: RenditionName;
  width: number;
  height: number;
  bitrate: number;
  codecString: string;
  level: string;
  file: string;
}

export interface EncodePlan {
  durationS: number;
  fps: { text: string; value: number };
  gop: number;
  ladder: LadderPlan;
  video: PlannedVideo[];
  audio: { bitrate: number; channels: number; codecString: string; file: string } | null;
  poster: { atS: number; width: number; file: string };
  sourceWidth: number;
  sourceHeight: number;
}

/** The ladder for these facts (shared planLadder, the browser's own). Too long for 500 MB → too_big. */
export function planEncode(f: ProbeFacts): EncodePlan {
  let ladder: LadderPlan;
  try {
    ladder = planLadder(renditionsFor(f.width, f.height), f.durationS, f.hasAudio);
  } catch (e) {
    throw new JobFailure("too_big", `no ladder fits 500 MB for ${Math.round(f.durationS)} s (${(e as Error).message.slice(0, 80)})`);
  }
  const fps = outputFps(f);
  const video = ladder.renditions.map((r) => {
    const codecString = videoCodecFor(r.height);
    return { name: r.name, width: r.width, height: r.height, bitrate: r.bitrate, codecString, level: LEVEL[codecString], file: `${r.name}.mp4` };
  });
  const posterWidth = Math.max(2, Math.min(1280, f.width) & ~1);
  return {
    durationS: f.durationS,
    fps,
    gop: Math.max(1, Math.round(KEYFRAME_SECONDS * fps.value)),
    ladder,
    video,
    audio: f.hasAudio ? { bitrate: ladder.audioBitrate, channels: Math.min(2, Math.max(1, f.audioChannels)), codecString: AUDIO_CODEC, file: "audio.mp4" } : null,
    poster: { atS: Math.min(1, f.durationS / 2), width: posterWidth, file: "poster.jpg" },
    sourceWidth: f.width,
    sourceHeight: f.height,
  };
}

const t = (s: number) => s.toFixed(3);

function common(): string[] {
  return ["-hide_banner", "-nostdin", "-nostats", "-loglevel", "error", "-y"];
}

/** ONE FFmpeg run for every video rendition: the source is decoded once, split, scaled per rendition. */
export function videoArgs(p: EncodePlan, preset: X264Preset = "veryfast", input = "source"): string[] {
  const n = p.video.length;
  const labels = p.video.map((_, i) => `[s${i}]`).join("");
  const graph = [
    `[0:v:0]fps=fps=${p.fps.text}:start_time=0,tpad=stop_mode=clone:stop_duration=${t(p.durationS)},split=${n}${labels}`,
    ...p.video.map((v, i) => `[s${i}]scale=w=${v.width}:h=${v.height}:flags=bicubic,setsar=1,format=yuv420p[o${i}]`),
  ].join(";");
  const args = [...common(), ...inputGuardArgs(), "-i", input, "-filter_complex", graph];
  p.video.forEach((v, i) => {
    args.push(
      "-map", `[o${i}]`, "-an", "-sn", "-dn",
      "-c:v", "libx264", "-preset", preset, "-profile:v", "baseline", "-level:v", v.level, "-pix_fmt", "yuv420p",
      "-b:v", String(v.bitrate), "-maxrate", String(Math.round(v.bitrate * 1.2)), "-bufsize", String(Math.round(v.bitrate * 2)),
      "-g", String(p.gop), "-keyint_min", String(p.gop), "-sc_threshold", "0", "-bf", "0",
      "-force_key_frames", `expr:gte(t,n_forced*${KEYFRAME_SECONDS})`,
      "-t", t(p.durationS),
      "-map_metadata", "-1", "-map_chapters", "-1",
      "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
      "-min_frag_duration", String(MIN_FRAGMENT_US),
      "-f", "mp4", v.file,
    );
  });
  return args;
}

/** The sound, as its own rendition. */
export function audioArgs(p: EncodePlan, input = "source"): string[] {
  if (!p.audio) throw new Error("audioArgs: this plan has no audio");
  return [
    ...common(), ...inputGuardArgs(), "-i", input,
    "-map", "0:a:0", "-vn", "-sn", "-dn",
    "-af", "aresample=async=1:first_pts=0,apad",
    "-c:a", "aac", "-b:a", String(p.audio.bitrate), "-ar", String(AUDIO_SAMPLE_RATE), "-ac", String(p.audio.channels),
    "-t", t(p.durationS),
    "-map_metadata", "-1", "-map_chapters", "-1",
    "-movflags", "+empty_moov+default_base_moof",
    "-frag_duration", String(AUDIO_FRAGMENT_US),
    "-f", "mp4", p.audio.file,
  ];
}

/** The poster: one frame at `atS` (1 s, or the middle of a shorter video — as webEncoder.ts), JPEG, ≤ 1280 wide. */
export function posterArgs(p: EncodePlan, atS: number = p.poster.atS, quality = 3, input = "source"): string[] {
  return [
    ...common(), ...inputGuardArgs(), "-ss", t(atS), "-i", input,
    "-map", "0:v:0", "-an", "-sn", "-dn", "-frames:v", "1",
    "-vf", `scale=w=${p.poster.width}:h=-2:flags=bicubic,setsar=1`,
    "-map_metadata", "-1",
    "-c:v", "mjpeg", "-q:v", String(quality), "-f", "image2", "-update", "1", p.poster.file,
  ];
}

/** RuntimeMaxSec of the design (§6): 3 × the video's length + 10 min, never past a claim's 6 h. */
export function runLimitS(durationS: number): number {
  return Math.min(MAX_RUN_S, Math.ceil(3 * durationS + 600));
}
