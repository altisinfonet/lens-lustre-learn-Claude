import { describe, it, expect } from "vitest";
import { fakePackage } from "./fixtures";
import { trackHandlers } from "../shared/mp4";
import { judgePlaylist } from "../shared/playlist";
import { manifestProblems, renditionBytes, totalBytes, uploadOrder } from "../shared/rules";
import { renditionsFor } from "../hlsPackager";

const dec = new TextDecoder();

describe("VID-1 · the HLS package the app makes", () => {
  it("makes the VID-1 §2 file set, ~4 s segments, and a manifest the rules accept", async () => {
    const p = await fakePackage({ seconds: 10 });
    const names = [...p.files.keys()].sort();
    expect(names).toContain("master.m3u8");
    expect(names).toContain("240p.mp4");
    expect(names).toContain("audio.mp4");
    expect(names.filter((n) => /^240p_\d+\.m4s$/.test(n)).length).toBe(3); // 4 s + 4 s + 2 s
    expect(manifestProblems(p.manifest, "post")).toEqual([]);
    expect(totalBytes(p.manifest)).toBe([...p.files.values()].reduce((a, b) => a + b.length, 0));
    const rb = renditionBytes(p.manifest);
    expect(Object.keys(rb).sort()).toEqual(["240p", "480p", "audio", "other"]);
  });

  it("every video init holds one vide and no soun; the audio init one soun (SEC F-D3-17)", async () => {
    const p = await fakePackage({ seconds: 6 });
    expect(trackHandlers(p.files.get("240p.mp4")!)).toEqual(["vide"]);
    expect(trackHandlers(p.files.get("480p.mp4")!)).toEqual(["vide"]);
    expect(trackHandlers(p.files.get("audio.mp4")!)).toEqual(["soun"]);
  });

  it("its playlists pass the server's playlist rules and add up to the declared length", async () => {
    const p = await fakePackage({ seconds: 10 });
    const names = new Set(p.files.keys());
    for (const n of names) {
      if (!n.endsWith(".m3u8")) continue;
      const v = judgePlaylist(n, dec.decode(p.files.get(n)!), names, p.manifest.duration_s);
      expect(v.problems, n).toEqual([]);
      if (n !== "master.m3u8") expect(Math.abs(v.seconds - 10)).toBeLessThan(0.2);
    }
  });

  it("a muted video has no audio rendition and no audio codec", async () => {
    const p = await fakePackage({ seconds: 5, audio: false });
    expect([...p.files.keys()].some((n) => n.startsWith("audio"))).toBe(false);
    expect(dec.decode(p.files.get("master.m3u8")!)).not.toMatch(/mp4a|AUDIO=/);
    expect(manifestProblems(p.manifest, "post")).toEqual([]);
  });

  it("uploads 240p first, then audio, poster, master, 480p, 720p", async () => {
    const p = await fakePackage({ seconds: 6, renditions: ["240p", "480p", "720p"] });
    const order = uploadOrder([...p.files.keys()]);
    expect(order[0]).toBe("240p.m3u8");
    expect(order[1]).toBe("240p.mp4");
    const first = (pfx: string) => order.findIndex((n) => n.startsWith(pfx));
    expect(first("240p")).toBeLessThan(first("audio"));
    expect(first("audio")).toBeLessThan(order.indexOf("poster.jpg"));
    expect(order.indexOf("master.m3u8")).toBeLessThan(first("480p"));
    expect(first("480p")).toBeLessThan(first("720p"));
  });

  it("never upscales: renditions only at or below the source; 240p always", () => {
    expect(renditionsFor(1920, 1080).map((r) => r.name)).toEqual(["240p", "480p", "720p"]);
    expect(renditionsFor(640, 360).map((r) => r.name)).toEqual(["240p"]);
    expect(renditionsFor(1080, 1920)).toContainEqual({ name: "720p", width: 720, height: 1280 });
    expect(renditionsFor(200, 100).map((r) => r.name)).toEqual(["240p"]);
  });
});
