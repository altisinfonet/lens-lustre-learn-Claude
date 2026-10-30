/**
 * S7-e · review of #540 (BLOCKING): the phone-fixture verdict in the VID-1
 * encoder harness.
 *  1. "as long as its source (±0.5 s)" compared manifest.duration_s — which is
 *     the SOURCE's own video.duration (src/lib/video/webEncoder.ts:197,414) —
 *     with the fixture length, so a package that came out 1.9 s short passed
 *     (the server's own rule only holds EXTINF sums to ±2 s).
 *     The output's length is the summed EXTINF of each media playlist.
 *  2. Nothing tied the package to the fixture that was served: iphone-hdr and
 *     android are both 6 s portrait with sound, so encoding one in place of the
 *     other passed. The page now reports the sha256 of the bytes it encoded.
 */
import { describe, expect, it } from "vitest";
import { judgeShape, playlistSeconds } from "../../tools/uishot/video-shape.mjs";

const pl = (...secs: number[]) =>
  ["#EXTM3U", "#EXT-X-TARGETDURATION:4", '#EXT-X-MAP:URI="i.mp4"', ...secs.flatMap((s, i) => [`#EXTINF:${s.toFixed(3)},`, `s${i}.m4s`]), "#EXT-X-ENDLIST"].join("\n");
const master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n240p.m3u8\n";
const SHA = "a".repeat(64);
const good = {
  manifest: { width: 1080, height: 1920, duration_s: 6 },
  playlists: { "master.m3u8": master, "240p.m3u8": pl(4, 2), "audio.m3u8": pl(4, 2.01) },
  sourceSha256: SHA,
  fixtureSha256: SHA,
};
const want = { portrait: true, seconds: 6 };

describe("phone-fixture verdict (S7-e)", () => {
  it("passes a portrait package as long as its 6 s source", () => {
    expect(judgeShape(good, want)).toMatchObject({ ok: true, reasons: [] });
  });

  it("sums EXTINF of a media playlist", () => {
    expect(playlistSeconds(pl(4, 4, 1.5))).toBeCloseTo(9.5, 6);
  });

  it("fails a package that came out 1.9 s short, though the source said 6 s", () => {
    const r = judgeShape({ ...good, playlists: { ...good.playlists, "240p.m3u8": pl(4, 0.1) } }, want);
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("length");
  });

  it("fails when the page encoded a different file than the fixture served", () => {
    const r = judgeShape({ ...good, sourceSha256: "b".repeat(64) }, want);
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("fixture");
  });

  it("fails closed when the identity or the playlists are missing", () => {
    expect(judgeShape({ ...good, sourceSha256: undefined }, want).ok).toBe(false);
    expect(judgeShape({ ...good, playlists: { "master.m3u8": master } }, want).ok).toBe(false);
  });

  it("fails a landscape package for a phone held upright", () => {
    const r = judgeShape({ ...good, manifest: { ...good.manifest, width: 1920, height: 1080 } }, want);
    expect(r.reasons).toContain("orientation");
  });
});
