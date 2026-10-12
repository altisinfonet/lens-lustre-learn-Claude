/**
 * Review C1 (#410): with no time cap, the bytes-per-second ceilings divide by a
 * DECLARED length. These are the ways to make a short clip claim a long one —
 * each must be refused by the content judge (complete) or the manifest rules
 * (upload-urls), while a real package of any length passes.
 */
import { describe, expect, it } from "vitest";
import { fakePackage } from "./fixtures";
import { judgeUploadContent, smallFiles } from "../shared/judge";
import { manifestProblems, SEGMENT_MAX_BYTES, type VideoManifest } from "../shared/rules";

const enc = new TextEncoder();
const dec = new TextDecoder();

async function judgeWith(edit: (files: Map<string, Uint8Array>, m: VideoManifest) => void, seconds = 12) {
  const pkg = await fakePackage({ seconds, audio: true });
  const files = new Map(pkg.files);
  const manifest: VideoManifest = JSON.parse(JSON.stringify(pkg.manifest));
  edit(files, manifest);
  return judgeUploadContent(manifest, smallFiles(files));
}

describe("a real package passes, whatever its length", () => {
  it("12 s and 2 minutes", async () => {
    expect(await judgeWith(() => {}, 12)).toEqual([]);
    expect(await judgeWith(() => {}, 120)).toEqual([]);
  });
});

describe("review C1: a short clip cannot claim a long length", () => {
  it("one segment claiming 86400 s (the declared length) is refused", async () => {
    const p = await judgeWith((files, m) => {
      m.duration_s = 86400;
      files.set("240p.m3u8", enc.encode(dec.decode(files.get("240p.m3u8")!).replace(/#EXTINF:[0-9.]+/, "#EXTINF:86400")));
    });
    expect(p.join("\n")).toMatch(/claims 86400 s, above EXT-X-TARGETDURATION/);
  });

  it("the same segment listed many times to add up to the declared length is refused", async () => {
    const p = await judgeWith((files) => {
      const t = dec.decode(files.get("240p.m3u8")!);
      const first = /#EXTINF:[0-9.]+,?\r?\n(240p_0\.m4s)/.exec(t)![0];
      files.set("240p.m3u8", enc.encode(t.replace(first, `${first}\n${first}\n${first}`)));
    });
    expect(p.join("\n")).toMatch(/240p_0\.m4s is listed twice/);
  });

  it("a playlist borrowing another rendition's segments is refused", async () => {
    const p = await judgeWith((files) => {
      files.set("240p.m3u8", enc.encode(dec.decode(files.get("240p.m3u8")!).replace("240p_0.m4s", "480p_0.m4s")));
    });
    expect(p.join("\n")).toMatch(/480p_0\.m4s is not one of 240p's own segments/);
  });

  it("a segment far bigger than its claimed seconds allow is refused", async () => {
    const p = await judgeWith((_files, m) => {
      const f = m.files.find((x) => x.name === "240p_0.m4s")!;
      f.bytes = 5_000_000; // ~4 s at the 240p ceiling of 61,440 B/s would be ~0.5 MB
    });
    expect(p.join("\n")).toMatch(/240p_0\.m4s: 5000000 bytes .* above twice the 240p ceiling/);
  });

  it("a segment no playlist lists is refused (no hidden payload)", async () => {
    const p = await judgeWith((_files, m) => {
      m.files.push({ name: "240p_999.m4s", bytes: 1000, sha256: "a".repeat(64) });
    });
    expect(p.join("\n")).toMatch(/240p_999\.m4s is uploaded but no playlist lists it/);
  });

  it("the manifest rules refuse any segment above 8 MB before a URL is given", async () => {
    const pkg = await fakePackage({ seconds: 12, audio: true });
    const m: VideoManifest = JSON.parse(JSON.stringify(pkg.manifest));
    m.files.find((x) => x.name === "240p_0.m4s")!.bytes = SEGMENT_MAX_BYTES + 1;
    expect(manifestProblems(m, "post").join("\n")).toMatch(/segment 240p_0\.m4s is .* above 8388608/);
  });

  it("there is no time limit in the manifest rules any more (a 7:28 and a 3 h manifest pass)", async () => {
    const pkg = await fakePackage({ seconds: 12, audio: true });
    for (const d of [448, 10800]) {
      const m: VideoManifest = { ...pkg.manifest, duration_s: d };
      expect(manifestProblems(m, "post").filter((x) => /duration/.test(x))).toEqual([]);
    }
  });
});
