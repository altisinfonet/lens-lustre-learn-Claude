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

/** Read duration and size from the file itself, with the browser's own decoder. */
export function readVideoFacts(file: File, timeoutMs = 15_000): Promise<VideoFacts> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    const done = (fn: () => void) => { clearTimeout(t); URL.revokeObjectURL(url); v.removeAttribute("src"); fn(); };
    const t = setTimeout(() => done(() => reject(new Error("VID-META-001: the video's details did not load"))), timeoutMs);
    v.onloadedmetadata = () => done(() => resolve({
      durationSeconds: Number.isFinite(v.duration) ? v.duration : 0,
      bytes: file.size,
      width: v.videoWidth,
      height: v.videoHeight,
    }));
    v.onerror = () => done(() => reject(new Error("VID-META-002: this file is not a video we can play")));
    v.src = url;
  });
}
