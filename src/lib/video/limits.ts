/**
 * VID-1 §5 · the limits a member is told about BEFORE anything is encoded.
 *
 * UX only: the database re-checks every one (video_begin_upload, VID-LIM-001…006).
 * Members: 3 min / 500 MB / 10 a day. Ads (admins only): 5 min / 500 MB.
 * The daily count is the server's to judge — the app only shows its answer.
 */
import { VIDEO_LIMITS, type VideoPurpose } from "./shared/rules";

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
  else if (f.durationSeconds > lim.maxSeconds) {
    out.push(`This video is ${formatDuration(f.durationSeconds)}. Videos can be up to ${formatDuration(lim.maxSeconds)} — trim it first.`);
  }
  if (f.bytes > lim.maxBytes) out.push(`This video is ${Math.round(f.bytes / 1_048_576)} MB. Videos can be up to 500 MB.`);
  if (!(f.width > 0 && f.height > 0)) out.push("We couldn't read this video's size. Try another file.");
  return out;
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
      v.play().catch(() => { /* an undecodable video surfaces through the timer or onerror */ });
    };
    // Header read but frames refused = a format this browser cannot decode (Firefox
    // + HEVC / 10-bit): say why and what to do. No header at all = not a video.
    v.onerror = () => done(() => reject(new Error(headerRead
      ? `VID-META-003: ${UNDECODABLE_MESSAGE}`
      : "VID-META-002: this file is not a video we can play")));
    v.src = url;
  });
}
