/**
 * Photo plan U2 · the URL a GRID tile loads (profile grid, My Photos,
 * notification thumbnails). With switch `photo_set_v2` on, a new photo
 * (-l4 / -l4f) loads its 320 copy; every other URL — and every URL while the
 * switch is off — comes back exactly as given.
 */
import { useCallback } from "react";
import { usePhotoSetV2 } from "@/hooks/core/usePhotoSetV2";
import { photoSetGridUrl } from "@/lib/imageLadder";

export function useGridPhotoUrl(): (url: string) => string {
  const on = usePhotoSetV2();
  return useCallback((url: string) => (on && url ? photoSetGridUrl(url) : url), [on]);
}
