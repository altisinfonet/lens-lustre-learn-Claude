/**
 * VID-1 §5 · the limits a member is told about BEFORE anything is encoded.
 *
 * UX only: the database re-checks every one (video_begin_upload, VID-LIM-001…006).
 * Owner ruling 2026-10-11 (A3.2): NO time limit — 500 MB (the picked file),
 * 10 a day. A long video is fitted into the 500 MB package by giving up
 * quality, never length (ladder.ts). The daily count is the server's to judge.
 *
 * The one real bound on length today is THIS DEVICE: the web encoder decodes
 * the whole sound track into memory (about 1.4 GB per hour of stereo), so a
 * very long video can be too big for a phone's browser. That is said plainly,
 * with the way out ("Remove sound", or a computer) — see memoryProblem().
 */
import { VIDEO_LIMITS, type VideoPurpose } from "./shared/rules";
import { planLadder } from "./ladder";
import { renditionsFor } from "./hlsPackager";

export interface VideoFacts {
  durationSeconds: number;
  bytes: number;
  width: number;
  height: number;
}

export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Member-facing reasons a picked video cannot be posted. Empty = it can. */
export function videoLimitProblems(f: VideoFacts, purpose: VideoPurpose): string[] {
  const lim = VIDEO_LIMITS[purpose];
  const out: string[] = [];
  if (!(f.durationSeconds > 0)) out.push("This video has no length we can read. Try another file.");
  else if (f.durationSeconds > lim.maxSeconds) out.push("This video is longer than 24 hours. Split it into parts.");
  if (f.bytes > lim.maxBytes) out.push(`This video is ${Math.round(f.bytes / 1_048_576)} MB. Videos can be up to 500 MB.`);
  if (!(f.width > 0 && f.height > 0)) out.push("We couldn't read this video's size. Try another file.");
  return out;
}

/** Decoded stereo sound at 48 kHz, 32-bit float — what decodeAudioData holds for the whole track. */
const PCM_BYTES_PER_SECOND = 48_000 * 2 * 4;

/** About how much memory the web encoder needs: the file, the whole decoded sound, and the package twice (encoded + packaged). */
export function encodeMemoryBytes(f: VideoFacts, mute: boolean): number {
  let pkg = 0;
  try {
    pkg = planLadder(renditionsFor(Math.max(2, f.width), Math.max(2, f.height)), Math.max(1, f.durationSeconds), !mute).estimatedBytes;
  } catch {
    pkg = 524_288_000;
  }
  return f.bytes + (mute ? 0 : f.durationSeconds * PCM_BYTES_PER_SECOND) + 2 * pkg;
}

/** The share of this device's memory the encoder may plan to use. navigator.deviceMemory is capped at 8 (GB); Firefox/Safari don't say → 4. */
export function deviceMemoryBudget(nav: { deviceMemory?: number } = (typeof navigator !== "undefined" ? navigator : {}) as { deviceMemory?: number }): number {
  const gb = typeof nav.deviceMemory === "number" && nav.deviceMemory > 0 ? nav.deviceMemory : 4;
  return gb * 1e9 * 0.35;
}

const gb = (b: number) => (b / 1e9).toFixed(1);

/** Null when this device can prepare the video; otherwise what to do. */
export function memoryProblem(f: VideoFacts, mute: boolean, budget = deviceMemoryBudget()): string | null {
  const need = encodeMemoryBytes(f, mute);
  if (need <= budget) return null;
  const withoutSound = encodeMemoryBytes(f, true);
  return withoutSound <= budget && !mute
    ? `This video is long for this browser to prepare with its sound (needs about ${gb(need)} GB of memory). Turn on "Remove sound", or post it from a computer in Chrome or Edge.`
    : `This video is too long for this browser to prepare (needs about ${gb(need)} GB of memory). Post it from a computer in Chrome or Edge.`;
}

/**
 * Said when the browser reads a video's header but cannot decode its frames —
 * in practice H.265/HEVC or 10-bit H.264 in Firefox (cross-browser run,
 * 2026-10-11). Without this check the encoder waited forever on a video that
 * never played.
 */
export const UNDECODABLE_MESSAGE =
  "This browser can't play this video's format — usually H.265 (HEVC) or 10-bit video from a newer phone. " +
  "Open the site in Chrome or Edge, or on iPhone set Settings → Camera → Formats → Most Compatible.";

/**
 * Read duration and size from the file itself, with the browser's own decoder,
 * and prove the browser can decode a frame of it (VID-META-003) before the
 * member is offered "Post".
 */
export function readVideoFacts(file: File, timeoutMs = 15_000, firstFrameMs = 8_000): Promise<VideoFacts> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata"; // header first; play() then proves a frame decodes
    v.muted = true;
    v.playsInline = true;
    let frameTimer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      clearTimeout(frameTimer);
      v.pause();
      URL.revokeObjectURL(url);
      v.removeAttribute("src");
      v.load(); // releases the decoder now, not at garbage collection
      fn();
    };
    const t = setTimeout(() => done(() => reject(new Error("VID-META-001: the video's details did not load"))), timeoutMs);
    let headerRead = false;
    v.onloadedmetadata = () => {
      headerRead = true;
      clearTimeout(t);
      const facts: VideoFacts = {
        durationSeconds: Number.isFinite(v.duration) ? v.duration : 0,
        bytes: file.size,
        width: v.videoWidth,
        height: v.videoHeight,
      };
      frameTimer = setTimeout(() => done(() => reject(new Error(`VID-META-003: ${UNDECODABLE_MESSAGE}`))), firstFrameMs);
      const ok = () => done(() => resolve(facts));
      if (typeof v.requestVideoFrameCallback === "function") v.requestVideoFrameCallback(() => ok());
      else v.addEventListener("timeupdate", () => { if (v.currentTime > 0) ok(); });
      v.play().catch((e: unknown) => {
        // Autoplay refused by the browser's policy says nothing about the format:
        // accept the header and let the encoder's own watchdog judge decoding.
        if ((e as { name?: string })?.name === "NotAllowedError") ok();
        // Otherwise an undecodable video surfaces through the timer or onerror.
      });
    };
    // Header read but frames refused = a format this browser cannot decode (Firefox
    // + HEVC / 10-bit): say why and what to do. No header at all = not a video.
    v.onerror = () => done(() => reject(new Error(headerRead
      ? `VID-META-003: ${UNDECODABLE_MESSAGE}`
      : "VID-META-002: this file is not a video we can play")));
    v.src = url;
  });
}
