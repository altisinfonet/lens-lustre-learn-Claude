/**
 * VID-1 · WHERE A NEW VIDEO IS PREPARED (CONVERTER-DESIGN.md v2 §8).
 *
 * site_settings 'video_conversion':
 *   "device" — the member's browser encodes it (the default, and today's path);
 *   "server" — the original is uploaded once and our Oracle converter makes it.
 * Switched by an admin (Admin → Video Feature → Video Conversion).
 *
 * The app's reading is a HINT. The database decides: video_source_begin
 * refuses with VID-SRC-001 unless the setting is "server" [R7], and the device
 * path never depends on it — so a stale "device" just encodes on the device,
 * and a stale "server" is answered on screen with the way back to the device.
 *
 * Read through the shared site-settings cache (the edge first, a KEYED query
 * as the fallback — P4's guard: no unfiltered site_settings read in src/), at
 * most a minute old, so a switch reaches a member's next post quickly without
 * a request per screen.
 */
import { useEffect, useState } from "react";
import { getSiteSetting } from "@/lib/siteSettingsCache";

export type ConversionMode = "device" | "server";

export const VIDEO_CONVERSION_KEY = "video_conversion";

/** A cached value older than this is read again. */
export const CONVERSION_MAX_AGE_MS = 60_000;

/** Anything but the exact word "server" is the device — the safe default. */
export function parseConversionMode(value: unknown): ConversionMode {
  return value === "server" ? "server" : "device";
}

export async function readConversionMode(): Promise<ConversionMode> {
  try {
    return parseConversionMode(await getSiteSetting(VIDEO_CONVERSION_KEY, { maxAgeMs: CONVERSION_MAX_AGE_MS }));
  } catch {
    return "device";
  }
}

/**
 * The mode for a screen that is open (`active`). "device" until the setting
 * says otherwise, so nothing waits on this read. `forced` is the UI harness's
 * seam.
 */
export function useConversionMode(active: boolean, forced?: ConversionMode): ConversionMode {
  const [mode, setMode] = useState<ConversionMode>(forced ?? "device");
  useEffect(() => {
    if (forced) { setMode(forced); return; }
    if (!active) return;
    let live = true;
    void readConversionMode().then((m) => { if (live) setMode(m); });
    return () => { live = false; };
  }, [active, forced]);
  return mode;
}
