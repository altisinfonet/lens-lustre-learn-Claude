/**
 * The resumable photo job's encoder for a FEED post (Owner order, 4 Nov 2026) —
 * photoJobs.createPhotoJob's default, and what photoSetPhotoEncoder() returns:
 * full = the 2048 copy (the URL the post stores), thumb = the 600, rungs = the
 * 1080 (`-r1080`), marker `-l6` (imageLadder FEED PHOTO SET). No clean copy, no
 * credit. Throws when the encoder cannot run: the composer then takes the
 * non-resumable path, which tries the same set and falls back to today's set.
 */
import { FEED_PHOTO_MARKER, photoSetSuffix } from "@/lib/imageLadder";
import { encodeFeedPhotoSet } from "@/lib/photoSetEncode";
import type { EncodedPhoto, PhotoEncoder } from "@/lib/upload/photoJobs";

export const feedPhotoEncoder: PhotoEncoder = async (file: File): Promise<EncodedPhoto> => {
  const set = await encodeFeedPhotoSet(file);
  if (!set) throw new Error("this browser has no WebP encoder (toBlob returned another type)");
  const master = set.copies.find((c) => c.slot === "master");
  const thumb = set.copies.find((c) => c.slot === "thumb");
  if (!master || !thumb) throw new Error("feed photo set is incomplete");
  return {
    full: { blob: master.file, width: master.width, height: master.height },
    thumb: thumb.file,
    rungs: set.copies
      .filter((c) => c.slot !== "master" && c.slot !== "thumb")
      .map((c) => ({ rung: c.maxDimension, blob: c.file, suffix: photoSetSuffix(c.slot) })),
    marker: FEED_PHOTO_MARKER,
  };
};
