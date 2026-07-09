/**
 * Single-pass tag count computation.
 * Replaces O(n²) nested loop (for each tag → for each photo).
 */
import { useMemo } from "react";
import type { FlatPhoto, JudgingTag, PhotoTagData } from "./types";

export function useTagCounts(
  allPhotos: FlatPhoto[],
  availableTags: JudgingTag[],
  photoTagsMap: Record<string, PhotoTagData>,
  getPhotoKey: (p: FlatPhoto) => string,
): Record<string, number> {
  return useMemo(() => {
    const counts: Record<string, number> = {};
    // Initialize all tags to 0
    for (const tag of availableTags) {
      counts[tag.id] = 0;
    }
    // Single pass through photos
    for (const p of allPhotos) {
      const myTags = photoTagsMap[getPhotoKey(p)]?.myTags;
      if (myTags) {
        for (const tagId of myTags) {
          if (tagId in counts) counts[tagId]++;
        }
      }
    }
    return counts;
  }, [allPhotos, availableTags, photoTagsMap, getPhotoKey]);
}
