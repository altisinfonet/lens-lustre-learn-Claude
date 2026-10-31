/**
 * VID-1 · fitting ANY length into 500 MB (Owner ruling A3.2: "restrict on MB
 * not on timing").
 *
 * The 500 MB limit counts the ENCODED package — every quality level plus the
 * sound (video_validate_version, VID-LIM-002). At the full ladder (240p +
 * 480p + 720p + sound) that is about 20 minutes. A longer video keeps its full
 * length and gives up quality instead, in this order, until the estimate fits
 * with a safety margin:
 *   1. the full ladder;
 *   2. without 720p;
 *   3. 240p only (the sound unchanged);
 *   4. 240p at a lower rate, sound 64 kb/s;
 *   5. 240p at the lowest rate, sound 48 kb/s.
 * Only a video too long even for step 5 (about 5½ hours) is refused, and the
 * message says it is the size, not the time.
 *
 * Pure (no browser APIs), so it is tested directly.
 */

export type RenditionName = "240p" | "480p" | "720p";
export interface RenditionTarget { name: RenditionName; width: number; height: number }
export interface PlannedRendition extends RenditionTarget { bitrate: number }
export interface LadderPlan { renditions: PlannedRendition[]; audioBitrate: number; estimatedBytes: number; step: number }

/** The DB's limit (VID-LIM-002). */
export const PACKAGE_MAX_BYTES = 524_288_000;
/** Encoders overshoot their target; containers and playlists add a little. Plan for 85 %. */
export const PLAN_BUDGET_BYTES = Math.floor(PACKAGE_MAX_BYTES * 0.85);

export const DEFAULT_BITRATE: Record<RenditionName, number> = { "240p": 300_000, "480p": 900_000, "720p": 2_000_000 };
export const DEFAULT_AUDIO_BITRATE = 96_000;

export const TOO_LONG_FOR_500MB =
  "This video is too long to fit in 500 MB, even at the smallest quality. Trim it or split it into parts.";

/** Bytes for `seconds` at these rates: video +8 % (encoder overshoot), sound +5 %, plus 2 MB of playlists/poster/inits. */
export function estimateBytes(videoBitrates: number[], audioBitrate: number, seconds: number): number {
  const bitsPerSecond = videoBitrates.reduce((a, b) => a + b * 1.08, 0) + audioBitrate * 1.05;
  return Math.ceil((bitsPerSecond / 8) * seconds) + 2_097_152;
}

export function planLadder(targets: RenditionTarget[], seconds: number, hasAudio: boolean): LadderPlan {
  const by = new Map(targets.map((t) => [t.name, t]));
  const t240 = by.get("240p");
  if (!t240) throw new Error("VID-ENC-005: no 240p rendition to plan");
  const audioAt = (rate: number) => (hasAudio ? rate : 0);
  const steps: Array<{ names: RenditionName[]; rate240: number; audio: number }> = [
    { names: targets.map((t) => t.name), rate240: DEFAULT_BITRATE["240p"], audio: DEFAULT_AUDIO_BITRATE },
    { names: targets.map((t) => t.name).filter((n) => n !== "720p"), rate240: DEFAULT_BITRATE["240p"], audio: DEFAULT_AUDIO_BITRATE },
    { names: ["240p"], rate240: DEFAULT_BITRATE["240p"], audio: DEFAULT_AUDIO_BITRATE },
    { names: ["240p"], rate240: 200_000, audio: 64_000 },
    { names: ["240p"], rate240: 120_000, audio: 48_000 },
  ];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const renditions: PlannedRendition[] = s.names.map((n) => ({
      ...(n === "240p" ? t240 : by.get(n)!), bitrate: n === "240p" ? s.rate240 : DEFAULT_BITRATE[n],
    }));
    const audioBitrate = audioAt(s.audio);
    const estimatedBytes = estimateBytes(renditions.map((r) => r.bitrate), audioBitrate, seconds);
    if (estimatedBytes <= PLAN_BUDGET_BYTES) return { renditions, audioBitrate: s.audio, estimatedBytes, step: i + 1 };
  }
  throw new Error(`VID-ENC-006: ${TOO_LONG_FOR_500MB}`);
}
