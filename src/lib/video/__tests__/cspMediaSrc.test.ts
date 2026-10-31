/**
 * VID-1 · the security policy must let a video element load video.
 *
 * Owner, 2026-10-11, staging: picking a plain H.264 + AAC MP4 showed "this file
 * is not a video we can play" and the preview stayed at 0:00. Cause: the CSP in
 * public/_headers had no media-src, so it fell back to default-src 'self' and
 * Chrome refused every blob: video — the composer's preview and readVideoFacts
 * (URL.createObjectURL(file)), the web encoder's hidden <video>, AND feed
 * playback (hls.js plays through a MediaSource blob: URL). Safari's native HLS
 * loads the playlist straight from the lane's CDN host, so that host is needed
 * too. hls.js runs its demuxer in a worker built from a blob: URL (worker-src).
 *
 * Proven in real Chrome with the exact staging policy: docs/evidence/d2/VID/csp-media-src/.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const HEADERS = readFileSync("public/_headers", "utf8");
const csp = HEADERS.split("\n").find((l) => l.includes("Content-Security-Policy:")) || "";
const directive = (name: string) => (csp.split(";").find((d) => d.trim().startsWith(name + " ")) || "").trim();

describe("CSP lets video play (VID-1)", () => {
  it("media-src allows the page itself, blob: (preview, encoder, MediaSource) and the lane's CDN host", () => {
    const m = directive("media-src");
    expect(m).toMatch(/^media-src /);
    expect(m).toMatch(/'self'/);
    expect(m).toMatch(/(^|\s)blob:(\s|$)/);
    expect(m).toMatch(/https:\/\/__CDN_HOST__(\s|$)/);
  });

  it("worker-src is 'self' only — hls.js's worker is served from /assets/, never blob:", () => {
    // Security review of #396: blob: here is unnecessary once hls.js gets a
    // workerPath; without one, a blocked blob: worker silently falls back to
    // inline demuxing (slower, still plays).
    expect(directive("worker-src")).toBe("worker-src 'self'");
    const card = readFileSync("src/components/video/FeedVideoCard.tsx", "utf8");
    expect(card).toMatch(/import\("hls\.js\/dist\/hls\.worker\.js\?url"\)/);
    expect(card).toMatch(/new Hls\(\{[^}]*\bworkerPath\b/);
  });

  it("nothing is widened beyond that: no wildcard, no data:, no http:", () => {
    for (const d of [directive("media-src"), directive("worker-src")]) {
      expect(d).not.toMatch(/(^|\s)(\*|data:|http:|https:)(\s|$)/);
    }
    expect(csp).toMatch(/object-src 'none'/);
    expect(directive("frame-src")).not.toMatch(/blob:/);
  });
});
