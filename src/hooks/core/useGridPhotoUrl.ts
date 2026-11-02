/**
 * Photo plan U2 · the URL a GRID tile loads (profile grid, My Photos,
 * notification thumbnails). With switch `photo_set_v2` on, a new photo
 * (-l4 / -l4f) loads its 320 copy; every other URL — and every URL while the
 * switch is off — comes back exactly as given.
 */
import { useCallback, useState } from "react";
import { usePhotoSetV2 } from "@/hooks/core/usePhotoSetV2";
import { photoSetGridUrl } from "@/lib/imageLadder";

export function useGridPhotoUrl(): (url: string) => string {
  const on = usePhotoSetV2();
  return useCallback((url: string) => (on && url ? photoSetGridUrl(url) : url), [on]);
}

/**
 * U4 (the U2 review follow-up) · one grid tile: its 320 copy, and if that copy
 * fails to load, the URL it was given — once (a 320 that never made it to the
 * store must not leave an empty tile). Switch off / an old photo: the given URL
 * and no handler, exactly today's tile. A tile whose URL changes starts over.
 */
export function useGridPhotoSrc(url: string | null | undefined): { src: string | undefined; onError: (() => void) | undefined } {
  const gridUrl = useGridPhotoUrl();
  const [failedFor, setFailedFor] = useState<string | null>(null);
  if (!url) return { src: url ?? undefined, onError: undefined };
  const small = gridUrl(url);
  if (small === url) return { src: url, onError: undefined };
  if (failedFor === url) return { src: url, onError: undefined };
  return { src: small, onError: () => setFailedFor(url) };
}
