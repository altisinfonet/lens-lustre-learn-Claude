// @vitest-environment node
/**
 * The database's version rules (video_validate_version,
 * 20261012_0001_vid1_no_duration_cap.sql), mirrored by dbRules.ts and run in
 * checkPackage before anything is declared (review of #420, M1).
 */
import { describe, it, expect } from "vitest";
import { dbVersionProblems, DB_CEILING_BPS } from "../src/dbRules";
import { checkPackage } from "../src/convert";
import { JobFailure } from "../src/failures";
import type { VideoManifest } from "../../src/lib/video/shared/rules";
import { packageFromFragmented } from "../../src/lib/video/hlsPackager";
import { fakeFragmentedAudio, fakeFragmentedVideo, JPEG } from "../../src/lib/video/__tests__/fixtures";

const sha = "0".repeat(64);
function manifest(duration_s: number, bytes: Partial<Record<"240p" | "480p" | "720p" | "audio" | "other", number>>, has_audio = "audio" in bytes): VideoManifest {
  const files = [];
  for (const [k, b] of Object.entries(bytes)) {
    const name = k === "other" ? "poster.jpg" : k === "audio" ? "audio_0.m4s" : `${k}_0.m4s`;
    files.push({ name, bytes: b as number, sha256: sha });
  }
  return { v: 1, duration_s, has_audio, width: 1280, height: 720, files };
}
const codes = (m: VideoManifest) => dbVersionProblems(m).map((p) => p.code);

describe("converter · the database's version arithmetic", () => {
  it("VID-LIM-006: bytes ÷ declared seconds may EQUAL the ceiling, never exceed it — exact, as Postgres numerics", () => {
    for (const [k, c] of Object.entries(DB_CEILING_BPS)) {
      expect(codes(manifest(0.5, { "240p": 1000, [k]: c / 2 })), `${k} at the ceiling`).toEqual([]);
      expect(codes(manifest(0.5, { "240p": 1000, [k]: c / 2 + 1 })), `${k} one byte over`).toEqual(["VID-LIM-006"]);
    }
    // the reviewer's case: a 0.5 s detailed 720p still at 670,972 B/s
    expect(dbVersionProblems(manifest(0.5, { "240p": 1000, "720p": 335_486 }))).toEqual([
      { code: "VID-LIM-006", message: "720p is 670972 bytes/s, above its ceiling of 358400" },
    ]);
    // two decimals, like the numeric(7,2) column: 12.35 s × 61,440 = 758,784
    expect(codes(manifest(12.35, { "240p": 758_784 }))).toEqual([]);
    expect(codes(manifest(12.35, { "240p": 758_785 }))).toEqual(["VID-LIM-006"]);
  });

  it("VID-LIM-005 (poster + playlists ≤ 2 MiB), VID-LIM-001 (0 < length ≤ 24 h), VID-LIM-002 (≤ 500 MiB)", () => {
    expect(codes(manifest(10, { "240p": 1000, other: 2_097_152 }))).toEqual([]);
    expect(codes(manifest(10, { "240p": 1000, other: 2_097_153 }))).toEqual(["VID-LIM-005"]);
    expect(codes(manifest(86_400, { "240p": 1000 }))).toEqual([]);
    expect(codes(manifest(86_400.01, { "240p": 1000 }))).toEqual(["VID-LIM-001"]);
    expect(codes(manifest(0, { "240p": 1000 }))).toContain("VID-LIM-001");
    expect(codes(manifest(86_400, { "240p": 524_288_001 }))).toContain("VID-LIM-002");
  });

  it("VID-UP-006: 240p required; audio exactly when has_audio", () => {
    expect(codes(manifest(10, { "480p": 1000 }))).toEqual(["VID-UP-006"]);
    expect(codes(manifest(10, { "240p": 1000, audio: 100 }, false))).toEqual(["VID-UP-006"]);
    expect(codes(manifest(10, { "240p": 1000 }, true))).toEqual(["VID-UP-006"]);
  });

  it("checkPackage refuses what the database would refuse: VID-LIM-006 → too_big (final), before any upload", async () => {
    // a real package whose 240p rendition is far above 61,440 B/s for its declared second
    const pkg = await packageFromFragmented({
      video: [{ name: "240p", width: 426, height: 240, codecString: "avc1.42E01E", file: fakeFragmentedVideo({ seconds: 1, width: 426, height: 240, bytesPerFrame: 5000 }) }],
      audio: { codecString: "mp4a.40.2", file: fakeFragmentedAudio({ seconds: 1 }) },
      poster: JPEG, durationSeconds: 1, sourceWidth: 640, sourceHeight: 360,
    });
    const e = (() => { try { checkPackage(pkg, "post"); return null; } catch (x) { return x as JobFailure; } })();
    expect(e).toBeInstanceOf(JobFailure);
    expect(e!.code).toBe("too_big");
    expect(e!.detail).toMatch(/VID-LIM-006 240p is \d+ bytes\/s, above its ceiling of 61440/);
  });
});
