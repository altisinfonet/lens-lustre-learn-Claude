/**
 * Photo plan U2 · the URL a GRID tile loads (profile grid, My Photos,
 * notification thumbnails). A set photo (-l4 / -l4f / -l5 / -l5f) loads its
 * 320 copy; every other URL comes back exactly as given.
 *
 * Unit A (audit B1): chosen by the FILE, for every viewer — the switch answer
 * no longer decides it (a `-l4` URL is a credited file and must never be a
 * grid tile, signed out or not).
 */
import { useCallback, useState } from "react";
import { photoSetCleanUrl, photoSetGridUrl } from "@/lib/imageLadder";

export function useGridPhotoUrl(): (url: string) => string {
  return useCallback((url: string) => (url ? photoSetGridUrl(url) : url), []);
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
  // The fallback is the set's largest CLEAN public copy (Unit A: never a credited
  // file, never a competition full size).
  if (failedFor === url) return { src: photoSetCleanUrl(url), onError: undefined };
  return { src: small, onError: () => setFailedFor(url) };
}
