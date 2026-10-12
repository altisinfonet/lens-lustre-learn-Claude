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
 *   poster — the member's chosen cover (cover.ts: a picked frame or an uploaded
 *            image) when there is one; otherwise the frame at 1 s (or the
 *            middle of a shorter video), JPEG.
 * Then hlsPackager muxes each rendition on its own (one `vide` per video init,
 * one `soun` in the audio init) and writes the playlists and the manifest.
 *
 * AAC: the browser's own AudioEncoder when it has one (Chrome, Edge, Safari);
 * otherwise FFmpeg's AAC encoder in WASM (aacWasm.ts — Firefox has WebCodecs
 * H.264 but no AAC). Only a browser without WebCodecs H.264 encoding at all is
 * told "Video upload isn't supported in this browser — use the app" (VID-1 §2.4).
 */
import { packageHls, renditionsFor, KEYFRAME_SECONDS, type HlsPackage, type RawChunk, type VideoRenditionInput } from "./hlsPackager";
import { DEFAULT_AUDIO_BITRATE, planLadder } from "./ladder";
import { UNDECODABLE_MESSAGE } from "./limits";
import { startVisibilityInterval } from "@/lib/timers/visibilityInterval";

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

/** The sound's rate when the ladder keeps full quality; long videos use less (ladder.ts). */
const AUDIO_BITRATE = DEFAULT_AUDIO_BITRATE;

/**
 * Chrome takes back an IDLE codec when its tab is in the background: the
 * encoder's error callback fires with "QuotaExceededError: Codec reclaimed due
 * to inactivity" (Owner, staging 2026-10-12, a 7:28 video; reproduced with the
 * tab hidden for 2 minutes). Encoding pauses while the tab is hidden (no frame
 * callbacks run there), so its encoders are idle — and get reclaimed. That is
 * not a failure of the video: the encoder is opened again and encoding goes on.
 */
export function isReclaimed(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name;
  const message = String((e as { message?: string } | null)?.message ?? "");
  return name === "QuotaExceededError" || /reclaim/i.test(message);
}

const bytesOf = (d: AllowSharedBufferSource | undefined): Uint8Array | null =>
  !d ? null : d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array(d.buffer, d.byteOffset, d.byteLength);

/** Same codec and the same parameter sets (avcC / vpcC) — a reopened encoder must match the init segment already planned. */
export function sameDecoderConfig(a: { codec: string; description?: AllowSharedBufferSource }, b: { codec: string; description?: AllowSharedBufferSource }): boolean {
  if (a.codec !== b.codec) return false;
  const x = bytesOf(a.description), y = bytesOf(b.description);
  if (!x || !y) return x === y;
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

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
  /** The member's chosen cover, JPEG (cover.ts). Absent → the frame at 1 s. */
  poster?: Uint8Array;
}

async function encodeAudio(file: File, choice: CodecChoice, signal?: AbortSignal, bitrate: number = AUDIO_BITRATE) {
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
    const r = await encodeAacWasm(planes, buf.sampleRate, bitrate, signal);
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
  enc.configure({ codec: choice.audio.codec, sampleRate, numberOfChannels: channels, bitrate });
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
    // Any length fits 500 MB: a long video keeps its length and gives up quality (ladder.ts).
    const plan = planLadder(renditionsFor(sw, sh), duration, !opts.mute);
    const targets = plan.renditions;

    // The sound is encoded in one go; an encoder taken back mid-way (a tab
    // hidden at the wrong moment) is simply run again, once.
    const encodeSound = () => encodeAudio(file, choice, opts.signal, plan.audioBitrate);
    let audio: Awaited<ReturnType<typeof encodeAudio>> = null;
    if (!opts.mute) {
      try { audio = await encodeSound(); } catch (e) { if (!isReclaimed(e)) throw e; audio = await encodeSound(); }
    }

    // Video encoders are opened only when frames actually flow (never while
    // waiting in a hidden tab), and opened AGAIN if the browser takes one back.
    type Rendition = {
      t: (typeof targets)[number]; chunks: RawChunk[]; encoder: VideoEncoder | null;
      canvas: OffscreenCanvas; ctx2d: OffscreenCanvasRenderingContext2D;
      state: { failure: unknown; lastKey: number; reopened: number }; decoderConfig?: VideoDecoderConfig;
    };
    const renditions: Rendition[] = targets.map((t) => {
      const canvas = new OffscreenCanvas(t.width, t.height);
      return { t, chunks: [], encoder: null, canvas, ctx2d: canvas.getContext("2d")!, state: { failure: null, lastKey: -Infinity, reopened: 0 } };
    });
    const open = (r: Rendition) => {
      const enc = new VideoEncoder({
        output: (chunk, meta) => {
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          r.chunks.push({ data, key: chunk.type === "key", timestamp: chunk.timestamp, duration: chunk.duration ?? 0 });
          const dc = meta?.decoderConfig;
          if (!dc) return;
          if (!r.decoderConfig) r.decoderConfig = dc;
          else if (!sameDecoderConfig(r.decoderConfig, dc)) {
            r.state.failure = new Error("VID-ENC-007: the video encoder restarted with different settings. Keep this tab in front while the video is prepared, then try again.");
          }
        },
        error: (e) => {
          if (isReclaimed(e)) { if (r.encoder === enc) r.encoder = null; return; } // reopened on the next frame
          r.state.failure = e;
        },
      });
      enc.configure({
        codec: choice.video.codec(r.t.height), width: r.t.width, height: r.t.height, bitrate: r.t.bitrate, framerate: 30,
        ...(choice.video.mux === "avc" ? { avc: { format: "avc" as const } } : {}),
      });
      if (r.encoder !== null || r.chunks.length > 0) {
        r.state.reopened++;
        console.info(`VID-ENC: ${r.t.name} encoder reopened after the browser took it back (${r.state.reopened})`);
      }
      r.encoder = enc;
      r.state.lastKey = -Infinity; // a new encoder starts on a keyframe
    };

    let poster: Blob | null = opts.poster ? new Blob([opts.poster as BlobPart], { type: "image/jpeg" }) : null;
    const posterCanvas = new OffscreenCanvas(Math.min(1280, sw), Math.round(Math.min(1280, sw) * (sh / sw)));
    const posterAt = Math.min(1, duration / 2);

    await new Promise<void>((resolve, reject) => {
      // Is playback MOVING? That — not "a new picture arrived" — is what tells
      // a video the browser cannot decode (it never starts) from one that holds
      // a still picture for many seconds (a slideshow, a title card: no new
      // frame while it plays). Owner, staging 2026-10-12: a 1:00 promo with an
      // address card, playing fine in the preview, was refused as "can't play
      // this format" because no new frame came for 10 s.
      let lastPlayhead = -1;
      let lastMoveAt = performance.now();
      // The last timestamp handed to the encoders: frames go in strictly in
      // order (a held picture is re-sent, never an earlier one).
      let lastTs = -1;
      // Exactly one frame callback outstanding at a time (a second one would
      // encode the same frame twice).
      let waiting = false;
      const ask = () => { if (!waiting) { waiting = true; video.requestVideoFrameCallback(onFrame); } };
      /**
       * The picture on screen now, into every rendition, at `ts` µs. A re-sent
       * HELD picture is always a keyframe (`held`): a keyframe of a still picture
       * costs little, and it keeps every segment within the judge's 6 s when the
       * re-sends are ~1 s apart (a keyframe only every 2 s could then land 3 s apart).
       */
      const encodeAt = (ts: number, held = false) => {
        if (ts <= lastTs) return;
        lastTs = ts;
        for (const r of renditions) {
          if (r.state.failure) throw r.state.failure;
          if (!r.encoder || r.encoder.state === "closed") open(r);
          const enc = r.encoder!;
          if (enc.encodeQueueSize > 8) continue; // the encoder is behind: drop this frame for this rendition
          r.ctx2d.drawImage(video, 0, 0, r.t.width, r.t.height);
          const f = new VideoFrame(r.canvas, { timestamp: ts });
          const key = held || ts - r.state.lastKey >= KEYFRAME_SECONDS * 1e6;
          if (key) r.state.lastKey = ts;
          enc.encode(f, { keyFrame: key });
          f.close();
        }
      };
      const onFrame = async (_now: number, meta: VideoFrameCallbackMetadata) => {
        waiting = false;
        try {
          if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
          encodeAt(Math.round(meta.mediaTime * 1e6));
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
      // Once a second (P10: the client's one repeating timer; it stops while the
      // tab is hidden — encoding is paused then anyway):
      //   • a HELD picture (playback moves, no new frame for 0.5 s) is sent again
      //     at the playhead as a keyframe. With video fragments cut only after
      //     KEYFRAME_SECONDS + 0.15 (hlsPackager muxVideo), the worst segment is
      //     ~2.15 + 2 + 1.5 ≈ 5.65 s — within the judge's 6 s even for a slideshow
      //     with cross-fades (independent review #418 F1: at 0.9 s / 3.9 s it
      //     reached 6.0–7.8 s); a normal 30 fps video still gets 4 s segments;
      //   • stall guard: a video the browser cannot decode never moves
      //     (Firefox + HEVC / 10-bit). Fail clearly after 10 s of NO PLAYBACK
      //     instead of waiting forever.
      const stopWatchdog = startVisibilityInterval(() => {
        if (video.ended || document.hidden) return;
        const now = performance.now();
        const at = video.currentTime;
        if (at > lastPlayhead + 0.001) {
          lastPlayhead = at;
          lastMoveAt = now;
          if (at * 1e6 - lastTs >= 500_000) {
            try { encodeAt(Math.round(at * 1e6), true); } catch (e) { stop(); reject(e); }
          }
          return;
        }
        if (now - lastMoveAt > 10_000) {
          stop();
          reject(new Error(`VID-ENC-004: ${UNDECODABLE_MESSAGE}`));
        }
      }, 1_000);
      // A background tab gets no frame callbacks while the muted video keeps
      // playing — frames would be lost and the watchdog would misfire. Pause
      // while hidden; resume (and restart the watchdog clock) when visible.
      const onVisibility = () => {
        if (document.hidden) { video.pause(); return; }
        lastMoveAt = performance.now();
        if (!video.ended) {
          try { takeOpening(); } catch (e) { stop(); reject(e); return; }
          ask();
          video.play().catch((e) => { stop(); reject(e); });
        }
      };
      document.addEventListener("visibilitychange", onVisibility);
      const stop = () => { stopWatchdog(); document.removeEventListener("visibilitychange", onVisibility); };
      video.onended = () => {
        stop();
        // A picture held to the very end: close it at the real end, so the
        // segments add up to the declared length.
        try { if (lastTs >= 0 && duration * 1e6 - lastTs > 500_000) encodeAt(Math.round((duration - 0.04) * 1e6)); } // a delta frame: never a lone 0.03 s segment (review #418 F3)
        catch (e) { reject(e); return; }
        resolve();
      };
      video.onerror = () => { stop(); reject(new Error("VID-ENC-002: playback failed while encoding")); };
      // The opening picture is on screen before playback starts, and a frame
      // callback only fires for the NEXT one — which, for a held title card,
      // may come many seconds later (the first 12 s of a slideshow were lost).
      // So the picture at 0:00 is taken now.
      const takeOpening = () => {
        if (lastTs < 0 && video.readyState >= 2 && video.currentTime === 0) encodeAt(0);
      };
      // Started while the tab is hidden (e.g. switched away during the audio
      // step): wait — onVisibility starts playback when the member comes back.
      if (!document.hidden) {
        try { takeOpening(); } catch (e) { stop(); reject(e); return; }
        ask();
        video.play().catch((e) => { stop(); reject(e); });
      }
    });

    const videoInputs: VideoRenditionInput[] = [];
    for (const r of renditions) {
      const enc = r.encoder;
      if (enc && enc.state !== "closed") {
        try { await enc.flush(); } catch (e) { if (!isReclaimed(e)) throw e; } // taken back at the very end: its output is already in
        if ((enc.state as string) !== "closed") enc.close(); // it may have been taken back during the flush
      }
      if (r.state.failure) throw r.state.failure;
      if (r.chunks.length === 0) throw new Error("VID-ENC-008: no video frames were encoded");
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
