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
    expect(p.join("\n")).toMatch(/malformed EXTINF|above EXT-X-TARGETDURATION/);
  });

  it("a well-formed but too-long EXTINF (5000 s) is refused by the target duration", async () => {
    const p = await judgeWith((files, m) => {
      m.duration_s = 5000;
      files.set("240p.m3u8", enc.encode(dec.decode(files.get("240p.m3u8")!).replace(/#EXTINF:[0-9.]+,/, "#EXTINF:5000,")));
    });
    expect(p.join("\n")).toMatch(/claims 5000 s, above EXT-X-TARGETDURATION/);
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

describe("review #411: the playlist grammar — what the player reads is what was judged", () => {
  const swap = (name: string, f: (t: string) => string) => (files: Map<string, Uint8Array>) =>
    files.set(name, enc.encode(f(dec.decode(files.get(name)!))));

  it("C1: a lone CR (a second line to hls.js) smuggling an outside URL into the master is refused", async () => {
    const p = await judgeWith(swap("master.m3u8", (t) => t.replace(/(#EXT-X-STREAM-INF:[^\n]*)\n/, "$1\rhttps://evil.supabase.co/a.m3u8\n")));
    expect(p.join("\n")).toMatch(/master\.m3u8: contains characters other than printable ASCII/);
  });

  it("C1: U+2028 (also a line break to hls.js) in a media playlist is refused", async () => {
    const p = await judgeWith(swap("240p.m3u8", (t) => t.replace("#EXT-X-ENDLIST", "#EXT-X-ENDLIST\u2028https://evil.example/x.m4s")));
    expect(p.join("\n")).toMatch(/240p\.m3u8: contains characters/);
  });

  it("CRLF line endings are fine", async () => {
    expect(await judgeWith(swap("240p.m3u8", (t) => t.replace(/\n/g, "\r\n")))).toEqual([]);
  });

  it("C2: '#EXTINF: 0.01,' (a space hls.js accepts) is refused, not skipped", async () => {
    const p = await judgeWith(swap("240p.m3u8", (t) => t.replace(/#EXTINF:[0-9.]+,/, "#EXTINF: 0.01,")));
    expect(p.join("\n")).toMatch(/malformed EXTINF/);
  });

  it("C2: a URI line that does not follow an EXTINF is refused", async () => {
    const p = await judgeWith(swap("240p.m3u8", (t) => t.replace("#EXT-X-ENDLIST", "240p.mp4\n#EXT-X-ENDLIST")));
    expect(p.join("\n")).toMatch(/is not a segment after an EXTINF/);
  });

  it("C2: a tag outside the list (EXT-X-BYTERANGE, EXT-X-DISCONTINUITY, EXT-X-KEY) is refused", async () => {
    for (const tag of ["#EXT-X-BYTERANGE:100@0", "#EXT-X-DISCONTINUITY", '#EXT-X-KEY:METHOD=AES-128,URI="k"']) {
      const p = await judgeWith(swap("240p.m3u8", (t) => t.replace(/(#EXTINF:[0-9.]+,)/, `${tag}\n$1`)));
      expect(p.join("\n"), tag).toMatch(/is not allowed/);
    }
  });

  it("C3: EXT-X-MAP pointing at another init (one holding sound) is refused; two MAPs are refused", async () => {
    let p = await judgeWith(swap("240p.m3u8", (t) => t.replace('URI="240p.mp4"', 'URI="audio.mp4"')));
    expect(p.join("\n")).toMatch(/EXT-X-MAP must be 240p\.mp4/);
    p = await judgeWith(swap("240p.m3u8", (t) => t.replace('#EXT-X-MAP:URI="240p.mp4"', '#EXT-X-MAP:URI="240p.mp4"\n#EXT-X-MAP:URI="240p.mp4"')));
    expect(p.join("\n")).toMatch(/exactly one EXT-X-MAP/);
  });

  it("C3: the master may only name 240p/480p/720p.m3u8 as variants", async () => {
    const p = await judgeWith(swap("master.m3u8", (t) => t.replace(/\n240p\.m3u8/, "\naudio.m3u8")));
    expect(p.join("\n")).toMatch(/variant "audio\.m3u8" is not 240p\/480p\/720p/);
  });

  it("C3: file names the judge never reads are not allowed at all", async () => {
    const pkg = await fakePackage({ seconds: 12, audio: true });
    for (const bad of ["240p_3.mp4", "audio_1.mp4", "master.m4s", "240p_2.m3u8", "240p_007.m4s", "720p_10000.m4s"]) {
      const m: VideoManifest = { ...pkg.manifest, files: [...pkg.manifest.files, { name: bad, bytes: 10, sha256: "a".repeat(64) }] };
      expect(manifestProblems(m, "post").join("\n"), bad).toMatch(/is not allowed/);
    }
  });

  it("C4: more than 12,000 files is refused before a URL is given", async () => {
    const pkg = await fakePackage({ seconds: 12, audio: true });
    const many = Array.from({ length: 12_001 }, (_, i) => ({ name: `240p_${i % 9999}.m4s`, bytes: 10, sha256: "a".repeat(64) }));
    expect(manifestProblems({ ...pkg.manifest, files: many }, "post").join("\n")).toMatch(/12001 files is above 12000/);
  });

  it("C4: slivers — every segment but the last must be at least 1 s", async () => {
    const p = await judgeWith(swap("240p.m3u8", (t) => t.replace(/#EXTINF:[0-9.]+,/, "#EXTINF:0.200,")));
    expect(p.join("\n")).toMatch(/only the last segment may be under 1 s/);
  });

  it("C5: the +256 KB allowance is for the LAST segment only", async () => {
    const p = await judgeWith((_files, m) => {
      const f = m.files.find((x) => x.name === "240p_0.m4s")!;
      f.bytes = 61_440 * 4 * 2 + 200_000; // over 2 x ceiling x 4 s, under it + 256 KB
    });
    expect(p.join("\n")).toMatch(/240p_0\.m4s: .* above twice the 240p ceiling/);
  });
  it("re-review: an init with no playlist of its own (a spare 720p.mp4) is refused", async () => {
    const p = await judgeWith((_files, m) => { m.files.push({ name: "720p.mp4", bytes: 1000, sha256: "a".repeat(64) }); });
    expect(p.join("\n")).toMatch(/720p\.mp4 is uploaded but there is no 720p\.m3u8/);
  });
});
