/**
 * S7-c · VID-5 "Add a video ad" — a NEW ad made straight from a video in the
 * admin picture library (story-card zone, Video ads switch on for this admin).
 *
 * The ad library's rules stay exactly as they are (adSpotOrder.ts): the new ad
 * takes a freed spot before going after the last one, like any new picture.
 * Its picture is a frame of the video (1 s in, or the first frame) — what the
 * ad shows until the video is ready, and if the video is ever removed (the
 * same "the ad's picture stays" rule as AdVideoButton). The video itself then
 * goes through the ONE existing video pipeline (AdVideoButton → upload jobs).
 */
import { spotsForNew, type SpotRow } from "./adSpotOrder";

export interface VideoAdDeps {
  /** JPEG bytes of a frame at `seconds` (src/lib/video/cover.ts coverFromVideoAt). */
  frame: (file: Blob, seconds: number) => Promise<Uint8Array>;
  /** Stores the picture the way every library picture is stored; returns its URL. */
  uploadPicture: (picture: File) => Promise<string>;
  /** Inserts the ad_creatives row; returns its id. */
  insert: (row: { zone: string; image_url: string; click_url: string; alt_text: string; is_active: boolean; sort_order: number }) => Promise<string>;
}

export async function createVideoAdCreative(video: File, zone: string, rows: SpotRow[], deps: VideoAdDeps): Promise<{ creativeId: string; spot: number }> {
  let jpeg: Uint8Array;
  try {
    jpeg = await deps.frame(video, 1);
  } catch {
    jpeg = await deps.frame(video, 0); // a video shorter than 1 s, or slow to seek
  }
  const picture = new File([jpeg], "video-ad-cover.jpg", { type: "image/jpeg" });
  const url = await deps.uploadPicture(picture);
  const [spot] = spotsForNew(rows, 1);
  const creativeId = await deps.insert({ zone, image_url: url, click_url: "", alt_text: "", is_active: true, sort_order: spot });
  return { creativeId, spot };
}
