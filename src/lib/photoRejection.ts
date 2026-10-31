/**
 * Per-photo rejection helpers — "One Image, One Reject" policy.
 *
 * Each photo can be independently rejected by an admin. The flag lives in
 * `photo_meta[i].rejected` (boolean). When ALL photos are rejected, the
 * entry-level `status` is auto-flipped to "rejected" by the
 * `admin_set_photo_rejected` RPC.
 *
 * Public/voting/judging surfaces MUST filter rejected photos client-side
 * using `filterRejectedPhotos` so a single bad image does not nuke the
 * whole entry.
 */

export interface PhotoMetaItem {
  rejected?: boolean;
  rejected_at?: string | null;
  rejected_by?: string | null;
  rejected_reason?: string | null;
  [k: string]: unknown;
}

export const isPhotoRejected = (meta: unknown, index: number): boolean => {
  if (!Array.isArray(meta)) return false;
  const item = meta[index] as PhotoMetaItem | undefined;
  return item?.rejected === true;
};

/**
 * Returns the indices of photos that are NOT rejected.
 * If photo_meta is missing/empty, all photo indices are kept (back-compat).
 */
export const getActivePhotoIndices = (
  photos: string[] | null | undefined,
  photoMeta: unknown,
): number[] => {
  const total = Array.isArray(photos) ? photos.length : 0;
  if (total === 0) return [];
  if (!Array.isArray(photoMeta) || photoMeta.length === 0) {
    return Array.from({ length: total }, (_, i) => i);
  }
  const out: number[] = [];
  for (let i = 0; i < total; i++) {
    if (!isPhotoRejected(photoMeta, i)) out.push(i);
  }
  return out;
};

/**
 * Filters parallel arrays (photos, thumbnails, photo_meta) by rejection
 * state. Preserves alignment across all three. Returns the original
 * indices so callers can map back to vote/comment records.
 */
export const filterRejectedPhotos = <T = unknown>(input: {
  photos: string[] | null | undefined;
  photo_thumbnails?: (string | null)[] | null;
  photo_meta?: T[] | null;
}): {
  photos: string[];
  photo_thumbnails: (string | null)[];
  photo_meta: T[];
  /** Original DB indices, in display order. */
  originalIndices: number[];
} => {
  const photos = Array.isArray(input.photos) ? input.photos : [];
  const thumbs = Array.isArray(input.photo_thumbnails) ? input.photo_thumbnails : [];
  const meta = Array.isArray(input.photo_meta) ? input.photo_meta : [];
  const keep = getActivePhotoIndices(photos, meta);
  return {
    photos: keep.map((i) => photos[i]).filter((x): x is string => Boolean(x)),
    photo_thumbnails: keep.map((i) => thumbs[i] ?? null),
    photo_meta: keep.map((i) => meta[i]) as T[],
    originalIndices: keep,
  };
};
