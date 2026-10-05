/**
 * VID-1 §2 · turn encoded chunks into the HLS file set the server accepts.
 *
 * Input: per rendition, the encoded chunks (from WebCodecs in the browser, or
 * from the native encoder later) + the poster JPEG. Output: the exact files of
 * VID-1 §2 and their manifest:
 *
 *   master.m3u8                       one variant per video rendition, audio group "aud"
 *   240p.m3u8 / 480p.m3u8 / 720p.m3u8 video-only media playlists
 *   240p.mp4, 240p_0.m4s …       fMP4 init + ~4 s media segments
 *   audio.m3u8, audio.mp4, audio_0.m4s …   ONE separate audio rendition
 *   poster.jpg
 *
 * INIT NAMES: `<rendition>.mp4`, not `<rendition>_init.mp4`. The signed
 * allow-list (VID-1 §3, SEC condition 1) admits `(_\d{1,4})?` only, so
 * `240p_init.mp4` would be refused; §2/§6.1's prose says `*_init.mp4`. The
 * regex is the security condition, so the names follow it (F-D2-22, for D3's
 * amendment). Segments stay `<rendition>_<n>.m4s`.
 *
 * Each rendition is muxed on its own (mp4-muxer, fragmented, ≥ 4 s fragments,
 * which cut only at keyframes — the encoder puts one every 2 s), so every video
 * init holds exactly one `vide` track and the audio init exactly one `soun`
 * (SEC F-D3-17). Segment durations are read back from the fragments themselves,
 * not assumed, so the playlist says what the bytes say.
 */
import { Muxer, StreamTarget } from "mp4-muxer";
import { segmentDurationUnits, splitFragmented, trackTimescale, trexDefaultDuration } from "./shared/mp4";
import { masterPlaylist, mediaPlaylist, type VariantRef } from "./shared/playlist";
import { canonicalManifest, sha256Hex, type ManifestFile, type VideoManifest } from "./shared/rules";

export const SEGMENT_SECONDS = 4;
export const KEYFRAME_SECONDS = 2;

export interface RawChunk {
  data: Uint8Array;
  key: boolean;
  /** microseconds */
  timestamp: number;
  /** microseconds */
  duration: number;
}

export interface VideoRenditionInput {
  name: "240p" | "480p" | "720p";
  width: number;
  height: number;
  /** mp4-muxer codec family */
  muxCodec: "avc" | "vp9";
  /** RFC 6381 string for the master playlist, e.g. "avc1.42E01E" */
  codecString: string;
  chunks: RawChunk[];
  /** decoderConfig from the encoder's first metadata (avcC description etc.) */
  decoderConfig?: VideoDecoderConfig;
}

export interface AudioRenditionInput {
  muxCodec: "aac" | "opus";
  codecString: string;
  sampleRate: number;
  numberOfChannels: number;
  chunks: RawChunk[];
  decoderConfig?: AudioDecoderConfig;
}

export interface HlsPackage {
  files: Map<string, Uint8Array>;
  manifest: VideoManifest;
  manifestText: string;
  manifestSha256: string;
}

interface Muxed {
  init: Uint8Array;
  segments: { bytes: Uint8Array; seconds: number }[];
}

function collect(): { target: StreamTarget; bytes: () => Uint8Array } {
  const parts: { data: Uint8Array; position: number }[] = [];
  const target = new StreamTarget({ onData: (data, position) => parts.push({ data: data.slice(), position }) });
  return {
    target,
    bytes: () => {
      const size = parts.reduce((m, p) => Math.max(m, p.position + p.data.length), 0);
      const out = new Uint8Array(size);
      for (const p of parts) out.set(p.data, p.position);
      return out;
    },
  };
}

function toSegments(file: Uint8Array): Muxed {
  const { init, segments } = splitFragmented(file);
  const timescale = trackTimescale(init);
  const def = trexDefaultDuration(init);
  return {
    init,
    segments: segments.map((bytes) => ({ bytes, seconds: segmentDurationUnits(bytes, def) / timescale })),
  };
}

export function muxVideo(r: VideoRenditionInput): Muxed {
  const out = collect();
  const muxer = new Muxer({
    target: out.target,
    video: { codec: r.muxCodec, width: r.width, height: r.height },
    fastStart: "fragmented",
    minFragmentDuration: SEGMENT_SECONDS - 0.1, // mp4-muxer cuts only once a fragment is LONGER than this
    firstTimestampBehavior: "offset",
  });
  r.chunks.forEach((c, i) => {
    muxer.addVideoChunkRaw(c.data, c.key ? "key" : "delta", c.timestamp, c.duration,
      i === 0 && r.decoderConfig ? { decoderConfig: r.decoderConfig } : undefined);
  });
  muxer.finalize();
  return toSegments(out.bytes());
}

export function muxAudio(a: AudioRenditionInput): Muxed {
  const out = collect();
  const muxer = new Muxer({
    target: out.target,
    audio: { codec: a.muxCodec, sampleRate: a.sampleRate, numberOfChannels: a.numberOfChannels },
    fastStart: "fragmented",
    minFragmentDuration: SEGMENT_SECONDS - 0.1, // mp4-muxer cuts only once a fragment is LONGER than this
    firstTimestampBehavior: "offset",
  });
  a.chunks.forEach((c, i) => {
    muxer.addAudioChunkRaw(c.data, "key", c.timestamp, c.duration,
      i === 0 && a.decoderConfig ? { decoderConfig: a.decoderConfig } : undefined);
  });
  muxer.finalize();
  return toSegments(out.bytes());
}

const enc = new TextEncoder();

/** Build every file + the manifest. `durationSeconds` is the source's length (what the server checks EXTINF against). */
export async function packageHls(input: {
  video: VideoRenditionInput[];
  audio: AudioRenditionInput | null;
  poster: Uint8Array;
  durationSeconds: number;
  sourceWidth: number;
  sourceHeight: number;
}): Promise<HlsPackage> {
  if (!input.video.some((v) => v.name === "240p")) throw new Error("VID-PKG-001: the 240p rendition is always made");
  const files = new Map<string, Uint8Array>();
  const variants: VariantRef[] = [];
  for (const r of input.video) {
    const m = muxVideo(r);
    files.set(`${r.name}.mp4`, m.init);
    m.segments.forEach((s, i) => files.set(`${r.name}_${i}.m4s`, s.bytes));
    files.set(`${r.name}.m3u8`, enc.encode(mediaPlaylist(`${r.name}.mp4`, m.segments.map((s, i) => ({ name: `${r.name}_${i}.m4s`, seconds: s.seconds })))));
    const bytes = m.segments.reduce((a, s) => a + s.bytes.length, 0);
    const peak = Math.max(...m.segments.map((s) => (s.bytes.length * 8) / Math.max(0.5, s.seconds)));
    variants.push({ name: r.name, width: r.width, height: r.height, bandwidth: Math.max(peak, (bytes * 8) / input.durationSeconds), videoCodec: r.codecString });
  }
  if (input.audio) {
    const m = muxAudio(input.audio);
    files.set("audio.mp4", m.init);
    m.segments.forEach((s, i) => files.set(`audio_${i}.m4s`, s.bytes));
    files.set("audio.m3u8", enc.encode(mediaPlaylist("audio.mp4", m.segments.map((s, i) => ({ name: `audio_${i}.m4s`, seconds: s.seconds })))));
  }
  files.set("master.m3u8", enc.encode(masterPlaylist(variants, input.audio ? { codec: input.audio.codecString } : null)));
  files.set("poster.jpg", input.poster);

  const list: ManifestFile[] = [];
  for (const [name, bytes] of files) list.push({ name, bytes: bytes.length, sha256: await sha256Hex(bytes) });
  const manifest: VideoManifest = {
    v: 1,
    duration_s: Math.round(input.durationSeconds * 100) / 100,
    has_audio: input.audio !== null,
    width: input.sourceWidth,
    height: input.sourceHeight,
    files: list,
  };
  const manifestText = canonicalManifest(manifest);
  return { files, manifest, manifestText, manifestSha256: await sha256Hex(manifestText) };
}

/** No upscaling (VID-1 §2): only renditions at or below the source's short edge. 240p is always made. */
export function renditionsFor(width: number, height: number): Array<{ name: "240p" | "480p" | "720p"; width: number; height: number }> {
  const short = Math.min(width, height);
  const out: Array<{ name: "240p" | "480p" | "720p"; width: number; height: number }> = [];
  for (const [name, target] of [["240p", 240], ["480p", 480], ["720p", 720]] as const) {
    if (name !== "240p" && target > short) continue;
    const scale = Math.min(1, target / short);
    // even dimensions (H.264 4:2:0)
    const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
    out.push({ name, width: even(width * scale), height: even(height * scale) });
  }
  return out;
}
