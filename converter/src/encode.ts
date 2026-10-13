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
 *   • AAC-LC (mp4a.40.2) as a SEPARATE rendition, 4 s fragments
 *     (-frag_duration), 48 kHz, at most 2 channels;
 *   • every output exactly the package's length: video padded at the start
 *     (fps start_time=0) and the end (tpad), audio likewise
 *     (aresample first_pts=0, apad), both cut with -t — so every playlist adds
 *     up to the declared length, as the judge requires (±2 s).
 *
 * RATE CONTROL THAT CANNOT BREAK THE DATABASE'S BYTES-PER-SECOND RULE (review
 * of #420, M1). video_validate_version refuses a rendition whose bytes ÷
 * declared seconds exceed its ceiling (VID-LIM-006, no slack); a 0.5 s
 * detailed 720p still made 670,972 B/s against 358,400 with -bufsize = 2 × the
 * bitrate. x264's VBV bounds a stream by (buffer + maxrate × t), so:
 *   • -bufsize is capped per rendition, in proportion to its ceiling (720p
 *     2,000,000 bits, 480p 914,285, 240p 342,857);
 *   • when buffer + maxrate × length could exceed 85 % of ceiling × length
 *     (less a 4 KB reserve for the init segment and fragment headers) — short
 *     clips — the buffer and maxrate shrink in proportion to the length
 *     (vbvFor). Measured worst cases (a noise still at 0.5 s and 1 s, 3 s of
 *     moving noise, 1280x720): 22–57 % of the ceilings;
 *   • the sound's bitrate shrinks the same way for clips of a few seconds
 *     (audioBitrateFor: the 700-byte init segment alone is a large share of
 *     a 0.3 s clip);
 *   • convert.ts then runs the database's exact arithmetic (dbRules.ts) before
 *     anything is declared.
 *
 * Streams (amendment A1, 2026-10-13): the chosen video and audio streams are
 * mapped BY INDEX (`0:<index>`, never `0:v:0` / `0:a:0`), so a cover picture
 * or a second audio track can never be picked by position; nothing else is
 * mapped (-sn -dn as well), so metadata / timecode / subtitle tracks are
 * ignored.
 * HDR (amendment A1): a PQ / HLG / BT.2020 source is tone-mapped to SDR
 * BT.709 8-bit ONCE, at the largest rendition's size, and the smaller
 * renditions are scaled down from that: zscale to linear light (the source's
 * own transfer, primaries, matrix and range stated explicitly) → BT.709
 * primaries → tonemap hable with the content's PEAK (HDR10 MaxCLL / mastering
 * peak when the file states one, else PQ's 10,000 nits or HLG's 1,000), so
 * highlights roll off instead of clipping → BT.709 transfer/matrix, limited
 * range → yuv420p → clamped to the legal limited range (luma 16–235, chroma
 * 16–240: no super-white). BT.2020 primaries with an SDR transfer get the
 * gamut conversion only (tonemap clip = identity up to white). Outputs are
 * tagged bt709. SDR sources are untouched.
 * Hygiene on every run (design §3 step 5): -protocol_whitelist file, the
 * demuxer allow-list, bounded probing, -map of exactly the streams used,
 * -map_metadata -1, -map_chapters -1, -nostdin.
 */
import { planLadder, type LadderPlan, type RenditionName } from "../../src/lib/video/ladder";
import { KEYFRAME_SECONDS, renditionsFor, SEGMENT_SECONDS } from "../../src/lib/video/hlsPackager";
import { DB_CEILING_BPS } from "./dbRules";
import { JobFailure } from "./failures";
import { inputGuardArgs, outputFps, type ColourFacts, type ProbeFacts } from "./probe";

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

/** Share of a rendition's DB ceiling × length the worst case may reach (VBV bound + container). */
export const CEILING_SHARE = 0.85;
/** Kept out of the video budget for the init segment and the fragment headers. */
export const VIDEO_RESERVE_BYTES = 4096;
/** Kept out of the sound's budget: its init segment (~700 B), the encoder's priming frame, fragment headers. */
export const AUDIO_RESERVE_BYTES = 1500;
const MIN_BUFSIZE = 16_000;
const MIN_MAXRATE = 32_000;
const MIN_AUDIO_BPS = 24_000;

export interface PlannedVideo {
  name: RenditionName;
  width: number;
  height: number;
  /** what planLadder chose */
  plannedBitrate: number;
  /** -b:v / -maxrate / -bufsize after the ceiling budget (vbvFor) */
  bitrate: number;
  maxrate: number;
  bufsize: number;
  codecString: string;
  level: string;
  file: string;
}

export interface EncodePlan {
  durationS: number;
  fps: { text: string; value: number };
  gop: number;
  ladder: LadderPlan;
  /** the chosen streams' indices in the source (probe.ts) */
  videoIndex: number;
  audioIndex: number | null;
  /** the HDR → SDR BT.709 filter chain, or null for an SDR source (untouched) */
  toneMap: string | null;
  video: PlannedVideo[];
  audio: { plannedBitrate: number; bitrate: number; channels: number; codecString: string; file: string } | null;
  poster: { atS: number; width: number; file: string };
  sourceWidth: number;
  sourceHeight: number;
}

/** -bufsize cap: 720p 2,000,000 bits, every other rendition in proportion to its ceiling. */
export function bufferCapBits(name: RenditionName): number {
  return Math.floor((2_000_000 * DB_CEILING_BPS[name]) / DB_CEILING_BPS["720p"]);
}

/**
 * x264 rate control for one rendition of a `durationS`-long video. VBV keeps
 * the stream under bufsize (the initial buffer, at most full) + maxrate × t;
 * that worst case must stay inside CEILING_SHARE of the DB ceiling × length.
 */
export function vbvFor(name: RenditionName, plannedBitrate: number, durationS: number): { bitrate: number; maxrate: number; bufsize: number } {
  const budgetBits = Math.max(0, (CEILING_SHARE * DB_CEILING_BPS[name] * durationS - VIDEO_RESERVE_BYTES) * 8);
  let maxrate = Math.round(plannedBitrate * 1.2);
  let bufsize = Math.min(Math.round(plannedBitrate * 2), bufferCapBits(name));
  if (bufsize + maxrate * durationS > budgetBits) {
    bufsize = Math.max(MIN_BUFSIZE, Math.min(bufsize, Math.floor(0.4 * budgetBits)));
    maxrate = Math.max(MIN_MAXRATE, Math.min(maxrate, Math.floor((budgetBits - bufsize) / Math.max(durationS, 0.01))));
  }
  return { bitrate: Math.min(plannedBitrate, Math.floor(maxrate * 0.9)), maxrate, bufsize };
}

/** The sound's bitrate: the plan's, less for a clip so short that its fixed overhead matters (VID-LIM-006 for "audio"). */
export function audioBitrateFor(plannedBitrate: number, durationS: number): number {
  const fits = ((CEILING_SHARE * DB_CEILING_BPS.audio * durationS - AUDIO_RESERVE_BYTES) * 8) / (1.08 * Math.max(durationS, 0.01));
  return Math.max(MIN_AUDIO_BPS, Math.min(plannedBitrate, Math.floor(fits / 1000) * 1000));
}

/*
 * The source's colour description in zscale's own constant names (ffprobe
 * names in, zscale names out). A value the file does not state, or one not
 * listed here, takes the HDR default: BT.2020 primaries / non-constant-
 * luminance matrix / limited range; and for the transfer, BT.2020's SDR curve
 * (the case of BT.2020 primaries with no PQ/HLG transfer). Stated explicitly
 * so an untagged frame can never leave zscale without a conversion path.
 */
const Z_TRANSFER: Record<string, string> = {
  smpte2084: "smpte2084", "arib-std-b67": "arib-std-b67", bt709: "709", "bt2020-10": "2020_10", "bt2020-12": "2020_12", smpte170m: "601", bt470bg: "601",
};
const Z_PRIMARIES: Record<string, string> = { bt2020: "2020", bt709: "709", smpte170m: "170m", smpte240m: "240m" };
const Z_MATRIX: Record<string, string> = { bt2020nc: "2020_ncl", bt2020c: "2020_cl", bt709: "709", smpte170m: "170m", bt470bg: "470bg" };
const Z_RANGE: Record<string, string> = { tv: "limited", pc: "full" };

/** The legal limited range: luma 16–235, chroma 16–240 — no super-white, nothing below black. */
export const LIMITED_RANGE_CLAMP = "limiter=min=16:max=235:planes=1,limiter=min=16:max=240:planes=6";

/**
 * How bright the source can be, in tonemap's units (1.0 = 100 nits, zscale's
 * npl=100): the file's HDR10 MaxCLL / mastering peak when it states one, else
 * PQ's own maximum (10,000 nits — nothing a PQ file holds can clip) or HLG's
 * nominal 1,000 nits (zscale maps HLG's full signal to ~10.07). A BT.2020 file
 * with an SDR transfer needs the gamut conversion only: "clip" (identity up
 * to white).
 */
export function toneMapOperator(c: ColourFacts): { op: "hable" | "clip"; peak: number | null } {
  if (c.transfer === "smpte2084") return { op: "hable", peak: (c.peakNits ?? 10_000) / 100 };
  if (c.transfer === "arib-std-b67") return { op: "hable", peak: (c.peakNits ?? 1_000) / 100 };
  return { op: "clip", peak: null };
}

/** The HDR → SDR BT.709 8-bit chain (amendment A1; peak + clamp: review of #420). Ends in clamped yuv420p. */
export function toneMapChain(c: ColourFacts): string {
  const tin = Z_TRANSFER[c.transfer] ?? "2020_10";
  const pin = Z_PRIMARIES[c.primaries] ?? "2020";
  const min = Z_MATRIX[c.matrix] ?? "2020_ncl";
  const rin = Z_RANGE[c.range] ?? "limited";
  const { op, peak } = toneMapOperator(c);
  // `p=` too: zscale takes an unstated OUTPUT property from the frame, and an
  // untagged frame would leave it "unspecified" → "no path between colorspaces"
  // (measured with FFmpeg 6.0 on an untagged 10-bit source).
  return [
    `zscale=tin=${tin}:pin=${pin}:min=${min}:rin=${rin}:t=linear:npl=100:p=${pin}`,
    "format=gbrpf32le",
    "zscale=p=709",
    `tonemap=tonemap=${op}:desat=0${peak !== null ? `:peak=${Number(peak.toFixed(2))}` : ""}`,
    "zscale=t=709:m=709:r=limited",
    "format=yuv420p",
    LIMITED_RANGE_CLAMP,
  ].join(",");
}

/** What a tone-mapped output says about itself (H.264 VUI): BT.709, limited range. */
export const BT709_TAGS = ["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv"];

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
    return {
      name: r.name, width: r.width, height: r.height, plannedBitrate: r.bitrate, ...vbvFor(r.name, r.bitrate, f.durationS),
      codecString, level: LEVEL[codecString], file: `${r.name}.mp4`,
    };
  });
  const posterWidth = Math.max(2, Math.min(1280, f.width) & ~1);
  return {
    durationS: f.durationS,
    fps,
    gop: Math.max(1, Math.round(KEYFRAME_SECONDS * fps.value)),
    ladder,
    videoIndex: f.videoIndex,
    audioIndex: f.hasAudio ? f.audioIndex : null,
    toneMap: f.hdr ? toneMapChain(f.colour) : null,
    video,
    audio: f.hasAudio ? {
      plannedBitrate: ladder.audioBitrate, bitrate: audioBitrateFor(ladder.audioBitrate, f.durationS),
      channels: Math.min(2, Math.max(1, f.audioChannels)), codecString: AUDIO_CODEC, file: "audio.mp4",
    } : null,
    poster: { atS: Math.min(1, f.durationS / 2), width: posterWidth, file: "poster.jpg" },
    sourceWidth: f.width,
    sourceHeight: f.height,
  };
}

const t = (s: number) => s.toFixed(3);

function common(): string[] {
  return ["-hide_banner", "-nostdin", "-nostats", "-loglevel", "error", "-y"];
}

/** ONE FFmpeg run for every video rendition: the source is decoded once and split. */
export function videoArgs(p: EncodePlan, preset: X264Preset = "veryfast", input = "source"): string[] {
  const n = p.video.length;
  const labels = p.video.map((_, i) => `[s${i}]`).join("");
  const head = `[0:${p.videoIndex}]fps=fps=${p.fps.text}:start_time=0,tpad=stop_mode=clone:stop_duration=${t(p.durationS)}`;
  let graph: string;
  if (p.toneMap) {
    // HDR: scaled to the largest rendition and tone-mapped ONCE there; every rendition is scaled from that.
    const top = p.video.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
    graph = [
      `${head},scale=w=${top.width}:h=${top.height}:flags=bicubic,setsar=1,${p.toneMap},split=${n}${labels}`,
      ...p.video.map((v, i) => `[s${i}]scale=w=${v.width}:h=${v.height}:flags=bicubic,setsar=1,format=yuv420p,${LIMITED_RANGE_CLAMP}[o${i}]`),
    ].join(";");
  } else {
    // SDR: untouched — each rendition scaled from the source.
    graph = [
      `${head},split=${n}${labels}`,
      ...p.video.map((v, i) => `[s${i}]scale=w=${v.width}:h=${v.height}:flags=bicubic,setsar=1,format=yuv420p[o${i}]`),
    ].join(";");
  }
  const args = [...common(), ...inputGuardArgs(), "-i", input, "-filter_complex", graph];
  p.video.forEach((v, i) => {
    args.push(
      "-map", `[o${i}]`, "-an", "-sn", "-dn",
      "-c:v", "libx264", "-preset", preset, "-profile:v", "baseline", "-level:v", v.level, "-pix_fmt", "yuv420p",
      ...(p.toneMap ? BT709_TAGS : []),
      "-b:v", String(v.bitrate), "-maxrate", String(v.maxrate), "-bufsize", String(v.bufsize),
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
  if (!p.audio || p.audioIndex === null) throw new Error("audioArgs: this plan has no audio");
  return [
    ...common(), ...inputGuardArgs(), "-i", input,
    "-map", `0:${p.audioIndex}`, "-vn", "-sn", "-dn",
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
export function posterArgs(p: EncodePlan, atS: number = p.poster.atS, quality = 3, width: number = p.poster.width, input = "source"): string[] {
  return [
    ...common(), ...inputGuardArgs(), "-ss", t(atS), "-i", input,
    "-map", `0:${p.videoIndex}`, "-an", "-sn", "-dn", "-frames:v", "1",
    "-vf", `scale=w=${Math.max(2, width & ~1)}:h=-2:flags=bicubic,setsar=1${p.toneMap ? `,${p.toneMap}` : ""}`,
    "-map_metadata", "-1", "-map_chapters", "-1",
    "-c:v", "mjpeg", "-q:v", String(quality), "-f", "image2", "-update", "1", p.poster.file,
  ];
}

/** RuntimeMaxSec of the design (§6): 3 × the video's length + 10 min, never past a claim's 6 h. */
export function runLimitS(durationS: number): number {
  return Math.min(MAX_RUN_S, Math.ceil(3 * durationS + 600));
}
