/**
 * VID-1 §2.4 · the WEB encoder: a picked video → the HLS file set, in the browser.
 *
 * Lazy-loaded (P13): only the video composer imports it, never the entry bundle.
 *
 * HOW
 *   audio — the file's audio track is decoded whole by the browser
 *           (AudioContext.decodeAudioData), then fed to WebCodecs' AudioEncoder
 *           in 1024-frame chunks: faster than real time and sample-exact. A file
 *           with no audio track (or "remove sound") gives a version with no
 *           audio rendition at all.
 *   video — the file plays MUTED in a hidden <video>; every presented frame
 *           (requestVideoFrameCallback) is scaled once per rendition and handed
 *           to that rendition's VideoEncoder, a keyframe every 2 s. This runs in
 *           real time: a 3-minute video takes about 3 minutes. The app path
 *           (Capacitor + Media3 Transformer) is the fast one; the web path is the
 *           fallback for members on a desktop browser.
 *   poster — the frame at 1 s (or the first frame of a shorter video), JPEG.
 * Then hlsPackager muxes each rendition on its own (one `vide` per video init,
 * one `soun` in the audio init) and writes the playlists and the manifest.
 *
 * AAC: the browser's own AudioEncoder when it has one (Chrome, Edge, Safari);
 * otherwise FFmpeg's AAC encoder in WASM (aacWasm.ts — Firefox has WebCodecs
 * H.264 but no AAC). Only a browser without WebCodecs H.264 encoding at all is
 * told "Video upload isn't supported in this browser — use the app" (VID-1 §2.4).
 */
import { packageHls, renditionsFor, KEYFRAME_SECONDS, type HlsPackage, type RawChunk, type VideoRenditionInput } from "./hlsPackager";
import { UNDECODABLE_MESSAGE } from "./limits";

export const UNSUPPORTED_MESSAGE = "Video upload isn't supported in this browser — use the app.";

export interface CodecChoice {
  video: { mux: "avc" | "vp9"; codec: (height: number) => string };
  audio: { mux: "aac" | "opus"; codec: string; playlist: string };
}

/** Production: H.264 (Baseline, level by size) + AAC-LC — what every phone and HLS player plays. */
export const H264_AAC: CodecChoice = {
  video: { mux: "avc", codec: (h) => (h <= 480 ? "avc1.42E01E" : "avc1.42E01F") },
  audio: { mux: "aac", codec: "mp4a.40.2", playlist: "mp4a.40.2" },
};

const BITRATE: Record<string, number> = { "240p": 300_000, "480p": 900_000, "720p": 2_000_000 };
const AUDIO_BITRATE = 96_000;

export class VideoEncodeUnsupported extends Error {
  constructor() { super(UNSUPPORTED_MESSAGE); }
}

/** Native WebCodecs encoding of this audio config? (false when AudioEncoder is missing) */
async function nativeAudioSupported(codec: string, sampleRate: number, numberOfChannels: number): Promise<boolean> {
  if (typeof AudioEncoder === "undefined") return false;
  try {
    return Boolean((await AudioEncoder.isConfigSupported({ codec, sampleRate, numberOfChannels, bitrate: AUDIO_BITRATE })).supported);
  } catch {
    return false;
  }
}

/**
 * AAC without a native encoder (Firefox): FFmpeg's AAC encoder in WASM, in a
 * worker served from /assets/ (aacWasm.ts). Needs WASM + workers and the CSP's
 * script-src 'wasm-unsafe-eval'.
 */
function wasmAacPossible(choice: CodecChoice): boolean {
  return choice.audio.mux === "aac" && typeof WebAssembly === "object" && typeof Worker !== "undefined";
}

export async function encoderSupported(choice: CodecChoice = H264_AAC): Promise<boolean> {
  if (typeof VideoEncoder === "undefined") return false;
  try {
    const v = await VideoEncoder.isConfigSupported({ codec: choice.video.codec(720), width: 1280, height: 720, bitrate: 2_000_000, framerate: 30 });
    if (!v.supported) return false;
    return (await nativeAudioSupported(choice.audio.codec, 48_000, 2)) || wasmAacPossible(choice);
  } catch {
    return false;
  }
}

export interface EncodeOptions {
  /** Encode without sound (the member chose "remove sound"). */
  mute?: boolean;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  /** Test seam: the CI browser has no H.264/AAC encoder, so the harness passes VP9 + Opus. */
  codecs?: CodecChoice;
}

async function encodeAudio(file: File, choice: CodecChoice, signal?: AbortSignal) {
  let decoded: AudioBuffer;
  const ctx = new AudioContext();
  try {
    decoded = await ctx.decodeAudioData(await file.arrayBuffer());
  } catch {
    return null; // no audio track we can read → a version without audio
  } finally {
    void ctx.close();
  }
  if (!decoded || decoded.length === 0) return null;
  const channels = Math.min(2, decoded.numberOfChannels);

  if (!(await nativeAudioSupported(choice.audio.codec, decoded.sampleRate, channels))) {
    if (!wasmAacPossible(choice)) throw new VideoEncodeUnsupported();
    const { encodeAacWasm, AAC_SAMPLE_RATES } = await import("./aacWasm");
    let buf = decoded;
    if (!AAC_SAMPLE_RATES.includes(buf.sampleRate)) {
      // An odd device rate (e.g. 192 kHz): resample to 48 kHz first.
      const off = new OfflineAudioContext(channels, Math.ceil(buf.duration * 48_000), 48_000);
      const src = off.createBufferSource();
      src.buffer = buf;
      src.connect(off.destination);
      src.start();
      buf = await off.startRendering();
    }
    const planes = Array.from({ length: channels }, (_, c) => buf.getChannelData(c));
    const r = await encodeAacWasm(planes, buf.sampleRate, AUDIO_BITRATE, signal);
    return { chunks: r.chunks, decoderConfig: r.decoderConfig, sampleRate: buf.sampleRate, channels };
  }

  const sampleRate = decoded.sampleRate;
  const chunks: RawChunk[] = [];
  let decoderConfig: AudioDecoderConfig | undefined;
  let failure: unknown = null;
  const enc = new AudioEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      chunks.push({ data, key: true, timestamp: chunk.timestamp, duration: chunk.duration ?? 0 });
      if (meta?.decoderConfig && !decoderConfig) decoderConfig = meta.decoderConfig;
    },
    error: (e) => { failure = e; },
  });
  enc.configure({ codec: choice.audio.codec, sampleRate, numberOfChannels: channels, bitrate: AUDIO_BITRATE });
  const frame = 1024;
  const planes = Array.from({ length: channels }, (_, c) => decoded.getChannelData(c));
  for (let off = 0; off < decoded.length; off += frame) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const n = Math.min(frame, decoded.length - off);
    const buf = new Float32Array(n * channels);
    for (let c = 0; c < channels; c++) buf.set(planes[c].subarray(off, off + n), c * n);
    const ad = new AudioData({ format: "f32-planar", sampleRate, numberOfFrames: n, numberOfChannels: channels, timestamp: Math.round((off / sampleRate) * 1e6), data: buf });
    enc.encode(ad);
    ad.close();
  }
  await enc.flush();
  enc.close();
  if (failure) throw failure;
  return { chunks, decoderConfig, sampleRate, channels };
}

export async function encodeVideoToHls(file: File, opts: EncodeOptions = {}): Promise<HlsPackage> {
  const choice = opts.codecs ?? H264_AAC;
  if (!(await encoderSupported(choice))) throw new VideoEncodeUnsupported();

  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  try {
    await new Promise<void>((res, rej) => {
      video.onloadedmetadata = () => res();
      video.onerror = () => rej(new Error("VID-ENC-001: this file is not a video the browser can play"));
    });
    const duration = video.duration;
    const sw = video.videoWidth, sh = video.videoHeight;
    const targets = renditionsFor(sw, sh);

    const audio = opts.mute ? null : await encodeAudio(file, choice, opts.signal);

    const renditions = targets.map((t) => {
      const chunks: RawChunk[] = [];
      let decoderConfig: VideoDecoderConfig | undefined;
      const state = { failure: null as unknown, lastKey: -Infinity };
      const encoder = new VideoEncoder({
        output: (chunk, meta) => {
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          chunks.push({ data, key: chunk.type === "key", timestamp: chunk.timestamp, duration: chunk.duration ?? 0 });
          if (meta?.decoderConfig && !decoderConfig) decoderConfig = meta.decoderConfig;
        },
        error: (e) => { state.failure = e; },
      });
      encoder.configure({
        codec: choice.video.codec(t.height), width: t.width, height: t.height, bitrate: BITRATE[t.name], framerate: 30,
        ...(choice.video.mux === "avc" ? { avc: { format: "avc" as const } } : {}),
      });
      const canvas = new OffscreenCanvas(t.width, t.height);
      const ctx2d = canvas.getContext("2d")!;
      return { t, chunks, encoder, canvas, ctx2d, state, get decoderConfig() { return decoderConfig; } };
    });

    let poster: Blob | null = null;
    const posterCanvas = new OffscreenCanvas(Math.min(1280, sw), Math.round(Math.min(1280, sw) * (sh / sw)));
    const posterAt = Math.min(1, duration / 2);

    await new Promise<void>((resolve, reject) => {
      let lastFrameAt = performance.now();
      // Exactly one frame callback outstanding at a time (a second one would
      // encode the same frame twice).
      let waiting = false;
      const ask = () => { if (!waiting) { waiting = true; video.requestVideoFrameCallback(onFrame); } };
      const onFrame = async (_now: number, meta: VideoFrameCallbackMetadata) => {
        waiting = false;
        lastFrameAt = performance.now();
        try {
          if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
          const ts = Math.round(meta.mediaTime * 1e6);
          for (const r of renditions) {
            if (r.state.failure) throw r.state.failure;
            if (r.encoder.encodeQueueSize > 8) continue; // the encoder is behind: drop this frame for this rendition
            r.ctx2d.drawImage(video, 0, 0, r.t.width, r.t.height);
            const f = new VideoFrame(r.canvas, { timestamp: ts });
            const key = ts - r.state.lastKey >= KEYFRAME_SECONDS * 1e6;
            if (key) r.state.lastKey = ts;
            r.encoder.encode(f, { keyFrame: key });
            f.close();
          }
          if (!poster && meta.mediaTime >= posterAt) {
            posterCanvas.getContext("2d")!.drawImage(video, 0, 0, posterCanvas.width, posterCanvas.height);
            poster = await posterCanvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
          }
          opts.onProgress?.(Math.min(0.95, meta.mediaTime / duration));
          if (video.ended) return;
          // Hidden by now (the event may have fired before this loop listened):
          // stop here; onVisibility resumes from this exact frame.
          if (document.hidden) { video.pause(); return; }
          ask();
        } catch (e) {
          stop();
          reject(e);
        }
      };
      // Stall guard: a video the browser cannot decode never fires another frame
      // and never ends (Firefox + HEVC / 10-bit). Fail clearly after 10 s without
      // a frame instead of waiting forever.
      const watchdog = setInterval(() => {
        if (!video.ended && !document.hidden && performance.now() - lastFrameAt > 10_000) {
          stop();
          reject(new Error(`VID-ENC-004: ${UNDECODABLE_MESSAGE}`));
        }
      }, 1_000);
      // A background tab gets no frame callbacks while the muted video keeps
      // playing — frames would be lost and the watchdog would misfire. Pause
      // while hidden; resume (and restart the watchdog clock) when visible.
      const onVisibility = () => {
        if (document.hidden) { video.pause(); return; }
        lastFrameAt = performance.now();
        if (!video.ended) {
          ask();
          video.play().catch((e) => { stop(); reject(e); });
        }
      };
      document.addEventListener("visibilitychange", onVisibility);
      const stop = () => { clearInterval(watchdog); document.removeEventListener("visibilitychange", onVisibility); };
      video.onended = () => { stop(); resolve(); };
      video.onerror = () => { stop(); reject(new Error("VID-ENC-002: playback failed while encoding")); };
      // Started while the tab is hidden (e.g. switched away during the audio
      // step): wait — onVisibility starts playback when the member comes back.
      if (!document.hidden) {
        ask();
        video.play().catch((e) => { stop(); reject(e); });
      }
    });

    const videoInputs: VideoRenditionInput[] = [];
    for (const r of renditions) {
      await r.encoder.flush();
      r.encoder.close();
      if (r.state.failure) throw r.state.failure;
      // chunk durations from the next timestamp; the last frame lasts one 30 fps frame
      r.chunks.sort((a, b) => a.timestamp - b.timestamp);
      r.chunks.forEach((c, i) => { c.duration = i + 1 < r.chunks.length ? r.chunks[i + 1].timestamp - c.timestamp : 33_333; });
      videoInputs.push({
        name: r.t.name, width: r.t.width, height: r.t.height, muxCodec: choice.video.mux,
        codecString: choice.video.codec(r.t.height), chunks: r.chunks, decoderConfig: r.decoderConfig,
      });
    }
    if (!poster) {
      posterCanvas.getContext("2d")!.drawImage(video, 0, 0, posterCanvas.width, posterCanvas.height);
      poster = await posterCanvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
    }
    const pkg = await packageHls({
      video: videoInputs,
      audio: audio ? {
        muxCodec: choice.audio.mux, codecString: choice.audio.playlist, sampleRate: audio.sampleRate,
        numberOfChannels: audio.channels, chunks: audio.chunks, decoderConfig: audio.decoderConfig,
      } : null,
      poster: new Uint8Array(await (poster as Blob).arrayBuffer()),
      durationSeconds: duration,
      sourceWidth: sw,
      sourceHeight: sh,
    });
    opts.onProgress?.(1);
    return pkg;
  } finally {
    video.pause();
    video.removeAttribute("src");
    URL.revokeObjectURL(url);
  }
}
