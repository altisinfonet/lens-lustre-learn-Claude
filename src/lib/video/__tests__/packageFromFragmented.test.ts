/**
 * packageFromFragmented — the server converter's way into the browser's own
 * packager (CONVERTER-DESIGN.md v2 §3 step 5): one fragmented MP4 per
 * rendition in, the same file set / playlists / manifest out.
 */
import { describe, it, expect, vi, onTestFinished } from "vitest";
import { fakeChunks, fakeAudio, fakeFragmentedAudio, fakeFragmentedVideo, JPEG } from "./fixtures";
import { packageFromFragmented, packageHls } from "../hlsPackager";
import { judgeUploadContent, smallFiles } from "../shared/judge";
import { judgePlaylist } from "../shared/playlist";
import { trackHandlers } from "../shared/mp4";
import { manifestProblems, totalBytes } from "../shared/rules";

const dec = new TextDecoder();
const AVC_DESC = new Uint8Array([1, 0x42, 0xc0, 0x1e, 0xff, 0xe1, 0, 4, 0x67, 0x42, 0xc0, 0x1e, 1, 0, 4, 0x68, 0xce, 0x3c, 0x80]);
const AAC_DESC = new Uint8Array([0x11, 0x90]);

function input(seconds: number, opts: { audio?: boolean; keyEverySec?: number } = {}) {
  return {
    video: [
      { name: "240p" as const, width: 426, height: 240, codecString: "avc1.42E01E", file: fakeFragmentedVideo({ seconds, width: 426, height: 240, ...opts }) },
      { name: "480p" as const, width: 854, height: 480, codecString: "avc1.42E01E", file: fakeFragmentedVideo({ seconds, width: 854, height: 480, bytesPerFrame: 2400, ...opts }) },
    ],
    audio: opts.audio === false ? null : { codecString: "mp4a.40.2", file: fakeFragmentedAudio({ seconds }) },
    poster: JPEG,
    durationSeconds: seconds,
    sourceWidth: 1280,
    sourceHeight: 720,
  };
}

describe("VID-1 · packageFromFragmented (server converter → the browser's packager)", () => {
  it("makes the VID-1 §2 file set from whole fragmented MP4 files, and the judge accepts it", async () => {
    const p = await packageFromFragmented(input(10));
    const names = [...p.files.keys()].sort();
    for (const n of ["master.m3u8", "240p.m3u8", "240p.mp4", "480p.m3u8", "480p.mp4", "audio.m3u8", "audio.mp4", "poster.jpg"]) expect(names).toContain(n);
    expect(names.filter((n) => /^240p_\d+\.m4s$/.test(n))).toEqual(["240p_0.m4s", "240p_1.m4s", "240p_2.m4s"]); // 4 s + 4 s + 2 s
    expect(manifestProblems(p.manifest, "post")).toEqual([]);
    expect(judgeUploadContent(p.manifest, smallFiles(p.files))).toEqual([]);
    expect(totalBytes(p.manifest)).toBe([...p.files.values()].reduce((a, b) => a + b.length, 0));
    expect(p.manifest).toMatchObject({ v: 1, duration_s: 10, has_audio: true, width: 1280, height: 720 });
  });

  it("is byte-for-byte the package packageHls makes from the same encoded chunks (one packaging path, two encoders)", async () => {
    // mp4-muxer writes the wall clock (whole seconds) into each init segment: freeze it, or two
    // muxes that straddle a second boundary differ in that field alone (seen once in CI).
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 9, 13, 12, 0, 0));
    onTestFinished(() => clock.mockRestore());
    const seconds = 9;
    const viaChunks = await packageHls({
      video: [{
        name: "240p", width: 426, height: 240, muxCodec: "avc", codecString: "avc1.42E01E", chunks: fakeChunks(seconds, 30, 2, 800),
        decoderConfig: { codec: "avc1.42C01E", codedWidth: 426, codedHeight: 240, description: AVC_DESC },
      }],
      audio: {
        muxCodec: "aac", codecString: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2, chunks: fakeAudio(seconds),
        decoderConfig: { codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2, description: AAC_DESC },
      },
      poster: JPEG, durationSeconds: seconds, sourceWidth: 1280, sourceHeight: 720,
    });
    const viaFiles = await packageFromFragmented({
      video: [{ name: "240p", width: 426, height: 240, codecString: "avc1.42E01E", file: fakeFragmentedVideo({ seconds, width: 426, height: 240 }) }],
      audio: { codecString: "mp4a.40.2", file: fakeFragmentedAudio({ seconds }) },
      poster: JPEG, durationSeconds: seconds, sourceWidth: 1280, sourceHeight: 720,
    });
    expect(viaFiles.manifestText).toBe(viaChunks.manifestText);
    expect(viaFiles.manifestSha256).toBe(viaChunks.manifestSha256);
  });

  it("reads each segment's length from its fragment, so the playlists say what the bytes say", async () => {
    // FFmpeg-like: keyframes every 2 s, fragments cut at the first keyframe ≥ 3.9 s → 4 s segments.
    const p = await packageFromFragmented(input(13, { keyEverySec: 2 }));
    const names = new Set(p.files.keys());
    for (const n of ["240p.m3u8", "480p.m3u8", "audio.m3u8"]) {
      const v = judgePlaylist(n, dec.decode(p.files.get(n)!), names, 13);
      expect(v.problems, n).toEqual([]);
      expect(Math.abs(v.seconds - 13)).toBeLessThan(0.1);
      v.segments.slice(0, -1).forEach((s) => expect(s.seconds).toBeGreaterThanOrEqual(3.9));
      v.segments.forEach((s) => expect(s.seconds).toBeLessThanOrEqual(6));
    }
    expect(dec.decode(p.files.get("240p.m3u8")!)).toMatch(/#EXT-X-TARGETDURATION:[45]\n/);
  });

  it("keeps one track per init: vide in every video rendition, soun in the audio one (SEC F-D3-17)", async () => {
    const p = await packageFromFragmented(input(6));
    expect(trackHandlers(p.files.get("240p.mp4")!)).toEqual(["vide"]);
    expect(trackHandlers(p.files.get("480p.mp4")!)).toEqual(["vide"]);
    expect(trackHandlers(p.files.get("audio.mp4")!)).toEqual(["soun"]);
  });

  it("no audio file → has_audio false, no audio files, and master CODECS without an audio codec", async () => {
    const p = await packageFromFragmented(input(5, { audio: false }));
    expect(p.manifest.has_audio).toBe(false);
    expect([...p.files.keys()].some((n) => n.startsWith("audio"))).toBe(false);
    expect(dec.decode(p.files.get("master.m3u8")!)).not.toMatch(/mp4a/);
    expect(judgeUploadContent(p.manifest, smallFiles(p.files))).toEqual([]);
  });

  it("the master names the codec strings it was given (the converter passes the browser's own)", async () => {
    const p = await packageFromFragmented(input(5));
    const master = dec.decode(p.files.get("master.m3u8")!);
    expect(master).toContain('CODECS="avc1.42E01E,mp4a.40.2"');
    expect(master).toContain("RESOLUTION=426x240");
  });

  it("refuses a package without 240p, and a file that is not a fragmented MP4", async () => {
    const base = input(5);
    await expect(packageFromFragmented({ ...base, video: base.video.filter((v) => v.name !== "240p") })).rejects.toThrow(/VID-PKG-001/);
    await expect(packageFromFragmented({ ...base, video: [{ ...base.video[0], file: new Uint8Array([0, 0, 0, 8, 0x66, 0x72, 0x65, 0x65]) }] }))
      .rejects.toThrow(/MP4-006/);
  });
});
