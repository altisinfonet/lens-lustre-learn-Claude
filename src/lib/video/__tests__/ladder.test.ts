/**
 * Any length fits 500 MB: a long video keeps its length and gives up quality.
 */
import { describe, expect, it } from "vitest";
import { PLAN_BUDGET_BYTES, planLadder, estimateBytes, DEFAULT_AUDIO_BITRATE } from "../ladder";
import { renditionsFor } from "../hlsPackager";

const hd = renditionsFor(1080, 1920); // 240p, 480p, 720p
const min = (m: number) => m * 60;

describe("planLadder", () => {
  it("a 3-minute HD video keeps the full ladder at full rates", () => {
    const p = planLadder(hd, min(3), true);
    expect(p.step).toBe(1);
    expect(p.renditions.map((r) => r.name)).toEqual(["240p", "480p", "720p"]);
    expect(p.audioBitrate).toBe(DEFAULT_AUDIO_BITRATE);
  });

  it("the Owner's 7:28 video keeps the full ladder too (about 190 MB)", () => {
    const p = planLadder(hd, 448, true);
    expect(p.step).toBe(1);
    expect(p.estimatedBytes).toBeLessThan(PLAN_BUDGET_BYTES);
  });

  it("40 minutes drops 720p, 1 hour 30 drops to 240p, 3 hours lowers the rates — never refuses", () => {
    expect(planLadder(hd, min(40), true).renditions.map((r) => r.name)).toEqual(["240p", "480p"]);
    expect(planLadder(hd, min(90), true).renditions.map((r) => r.name)).toEqual(["240p"]);
    const three = planLadder(hd, min(180), true);
    expect(three.step).toBeGreaterThanOrEqual(4);
    expect(three.renditions[0].bitrate).toBeLessThan(300_000);
  });

  it("every plan fits the budget", () => {
    for (const m of [1, 5, 10, 20, 30, 45, 60, 90, 120, 180, 240]) {
      const p = planLadder(hd, min(m), true);
      expect(p.estimatedBytes, `${m} min`).toBeLessThanOrEqual(PLAN_BUDGET_BYTES);
      expect(estimateBytes(p.renditions.map((r) => r.bitrate), p.audioBitrate, min(m))).toBe(p.estimatedBytes);
    }
  });

  it("only a video longer than ~5½ hours is refused, and the message is about size, not time", () => {
    expect(() => planLadder(hd, min(360), true)).toThrow(/too long to fit in 500 MB/);
    expect(planLadder(hd, min(300), true).step).toBe(5); // 5 h still fits
  });

  it("a small source (only 240p) and a silent video plan too", () => {
    const small = renditionsFor(320, 240);
    expect(planLadder(small, min(10), false).renditions.map((r) => r.name)).toEqual(["240p"]);
  });
});
