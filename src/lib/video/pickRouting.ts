/**
 * VID-1 · one picker for photos AND videos, like Instagram / Facebook.
 *
 * The composer's photo picker (and its drop zone, and the native gallery) hands
 * every picked file here first. A video goes to the video uploader
 * (VideoPostComposer) instead of being refused as "File format not supported";
 * photos continue into the photo flow unchanged.
 *
 * Formats: Instagram takes MP4 and MOV; Facebook also takes M4V, WebM, MKV and
 * 3GP. All of them are re-encoded on the device into the platform's own HLS
 * ladder (webEncoder.ts), so what the browser can decode is what can be posted —
 * proven in real Chrome for MP4/MOV with H.264 and H.265, WebM and MKV.
 *
 * A video post holds exactly one video (VID-1): when a video is picked together
 * with other files, the first video is used and the rest are counted, so the
 * caller can say so instead of losing them silently.
 */
export const VIDEO_PICK_EXTENSIONS = ["mp4", "mov", "m4v", "webm", "mkv", "3gp"] as const;

const VIDEO_EXT_RE = new RegExp(`\\.(${VIDEO_PICK_EXTENSIONS.join("|")})$`, "i");

export function isVideoFile(file: File): boolean {
  if (file.type) return file.type.toLowerCase().startsWith("video/");
  return VIDEO_EXT_RE.test(file.name);
}

export interface PickedFiles {
  /** Files for the photo flow (empty when a video was picked). */
  photos: File[];
  /** The one video for the video uploader, or null. */
  video: File | null;
  /** Files left out because a video post holds one video. */
  droppedForVideo: number;
}

export function routePickedFiles(files: File[]): PickedFiles {
  const video = files.find(isVideoFile) ?? null;
  if (!video) return { photos: files, video: null, droppedForVideo: 0 };
  return { photos: [], video, droppedForVideo: files.length - 1 };
}
