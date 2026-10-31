// @vitest-environment node
/**
 * Step 4 · the FFmpeg command lines, flag by flag: the server must make the
 * same package shape as the browser (webEncoder.ts), and every run on a
 * member's file carries the input hygiene of design §3 step 5; streams by index
 * and HDR tone mapping as amendment A1 (2026-10-13) says.
 */
import { describe, it, expect } from "vitest";
import {
  audioArgs, audioBitrateFor, AUDIO_CODEC, BT709_TAGS, bufferCapBits, CEILING_SHARE, LIMITED_RANGE_CLAMP, MIN_FRAGMENT_US, planEncode, posterArgs, runLimitS,
  toneMapChain, toneMapOperator, vbvFor, videoArgs, videoCodecFor, VIDEO_RESERVE_BYTES,
} from "../src/encode";
import { DB_CEILING_BPS } from "../src/dbRules";
import { judgeProbe, INPUT_FORMAT_WHITELIST } from "../src/probe";
import { JobFailure } from "../src/failures";
import { iphoneProbeJson, probeJson } from "./helpers";

const facts = (o: Parameters<typeof probeJson>[0] = {}) => judgeProbe(probeJson(o));
const after = (args: string[], flag: string, from = 0) => args[args.indexOf(flag, from) + 1];

describe("converter · the FFmpeg commands", () => {
  it("uses the browser's codec strings and the matching H.264 level", () => {
    // Parity with webEncoder.ts H264_AAC is asserted in src/lib/video/__tests__/converterCodecs.test.ts.
    expect([240, 480, 481, 720, 1280].map(videoCodecFor)).toEqual(["avc1.42E01E", "avc1.42E01E", "avc1.42E01F", "avc1.42E01F", "avc1.42E01F"]);
    expect(AUDIO_CODEC).toBe("mp4a.40.2");
    const p = planEncode(facts({ width: 1280, height: 720 }));
    expect(p.video.map((v) => [v.name, `${v.width}x${v.height}`, v.codecString, v.level])).toEqual([
      ["240p", "426x240", "avc1.42E01E", "3.0"], ["480p", "854x480", "avc1.42E01E", "3.0"], ["720p", "1280x720", "avc1.42E01F", "3.1"],
    ]);
  });

  it("plans with the shared ladder: no upscaling, portrait sizes, long videos give up quality, too long for 500 MB → too_big", () => {
    expect(planEncode(facts({ width: 640, height: 360 })).video.map((v) => v.name)).toEqual(["240p"]);
    const portrait = planEncode(facts({ width: 1920, height: 1080, rotation: -90 }));
    expect(portrait.video.map((v) => `${v.width}x${v.height}`)).toEqual(["240x426", "480x854", "720x1280"]);
    expect(portrait.video.map((v) => v.codecString)).toEqual(["avc1.42E01E", "avc1.42E01F", "avc1.42E01F"]);
    expect(portrait).toMatchObject({ sourceWidth: 1080, sourceHeight: 1920 });
    const long = planEncode(facts({ width: 1920, height: 1080, duration: 3 * 3600 }));
    expect(long.video.map((v) => v.name)).toEqual(["240p"]);
    expect(long.ladder.step).toBeGreaterThan(2);
    try { planEncode(facts({ duration: 6 * 3600 })); throw new Error("no"); } catch (e) { expect((e as JobFailure).code).toBe("too_big"); }
  });

  it("video: one run, decode once, split per rendition; baseline, 2 s keyframes, ~4 s fragments, VBV from the plan", () => {
    const p = planEncode(facts({ width: 1280, height: 720, duration: 10, fps: "30/1" }));
    const a = videoArgs(p);
    expect(after(a, "-protocol_whitelist")).toBe("file");
    expect(after(a, "-format_whitelist")).toBe(INPUT_FORMAT_WHITELIST);
    expect(a).toContain("-nostdin");
    expect(after(a, "-i")).toBe("source");
    const graph = after(a, "-filter_complex");
    expect(graph).toMatch(/^\[0:0\]fps=fps=30\/1:start_time=0,tpad=stop_mode=clone:stop_duration=10\.000,split=3\[s0\]\[s1\]\[s2\];/);
    expect(graph).toContain("[s0]scale=w=426:h=240:flags=bicubic,setsar=1,format=yuv420p[o0]");
    expect(graph).toContain("[s2]scale=w=1280:h=720:flags=bicubic,setsar=1,format=yuv420p[o2]");
    // one output block per rendition
    const outputs = a.map((x, i) => (x === "-f" && a[i + 1] === "mp4" ? a[i + 2] : null)).filter(Boolean);
    expect(outputs).toEqual(["240p.mp4", "480p.mp4", "720p.mp4"]);
    const starts = a.map((x, i) => (x === "-map" ? i : -1)).filter((i) => i >= 0);
    expect(starts.map((i) => a[i + 1])).toEqual(["[o0]", "[o1]", "[o2]"]);
    p.video.forEach((v, i) => {
      const block = a.slice(starts[i], starts[i + 1] ?? a.length);
      expect(block.at(-1)).toBe(v.file);
      expect(block).toEqual(expect.arrayContaining(["-an", "-sn", "-dn", "-map_metadata", "-1", "-map_chapters"]));
      expect(after(block, "-c:v")).toBe("libx264");
      expect(after(block, "-profile:v")).toBe("baseline");
      expect(after(block, "-level:v")).toBe(v.level);
      expect(after(block, "-pix_fmt")).toBe("yuv420p");
      expect(Number(after(block, "-b:v"))).toBe(v.bitrate);
      expect(Number(after(block, "-maxrate"))).toBe(v.maxrate);
      expect(Number(after(block, "-bufsize"))).toBe(v.bufsize);
      // the VBV worst case stays inside 85 % of the DB ceiling × length, less the container reserve (M1)
      expect(v.bufsize + v.maxrate * 10).toBeLessThanOrEqual((CEILING_SHARE * DB_CEILING_BPS[v.name] * 10 - VIDEO_RESERVE_BYTES) * 8);
      expect(v.bufsize).toBeLessThanOrEqual(bufferCapBits(v.name));
      expect(v.bitrate).toBeLessThanOrEqual(v.maxrate);
      expect(after(block, "-g")).toBe("60");
      expect(after(block, "-keyint_min")).toBe("60");
      expect(after(block, "-sc_threshold")).toBe("0");
      expect(after(block, "-bf")).toBe("0");
      expect(after(block, "-force_key_frames")).toBe("expr:gte(t,n_forced*2)");
      expect(after(block, "-t")).toBe("10.000");
      expect(after(block, "-movflags")).toBe("+frag_keyframe+empty_moov+default_base_moof");
      expect(after(block, "-min_frag_duration")).toBe(String(MIN_FRAGMENT_US));
    });
    expect(MIN_FRAGMENT_US).toBe(3_900_000);
    // never a network or playlist input, never FFmpeg's own HLS muxer
    expect(a.join(" ")).not.toMatch(/\bhls\b|concat|subfile|http/);
    // SDR: untouched — no tone mapping, no colour tags forced
    expect(p.toneMap).toBeNull();
    expect(graph).not.toMatch(/zscale|tonemap/);
    expect(a).not.toContain("-color_primaries");
  });

  it("streams by INDEX (A1): an iPhone .mov maps its real video (not the cover picture) and its AAC track; nothing else", () => {
    const p = planEncode(judgeProbe(iphoneProbeJson()));
    expect(p).toMatchObject({ videoIndex: 1, audioIndex: 3 });
    const v = videoArgs(p);
    expect(after(v, "-filter_complex")).toMatch(/^\[0:1\]fps=/);
    expect(v.filter((x) => x === "-map")).toHaveLength(p.video.length); // only the filter outputs
    expect(v.join(" ")).not.toMatch(/0:v:0|0:a:0/);
    const a = audioArgs(p);
    expect(a.filter((x) => x === "-map")).toEqual(["-map"]);
    expect(after(a, "-map")).toBe("0:3");
    expect(after(posterArgs(p), "-map")).toBe("0:1");
    for (const args of [v, a, posterArgs(p)]) expect(args).toEqual(expect.arrayContaining(["-sn", "-dn", "-map_metadata"]));
  });

  it("HDR (A1 + review): tone-mapped ONCE at the largest rendition's size, PQ peak 10,000 nits, clamped to limited range; tagged bt709; the poster too", () => {
    const p = planEncode(facts({ width: 1920, height: 1080, colour: { transfer: "smpte2084", primaries: "bt2020", matrix: "bt2020nc", range: "tv", pixFmt: "yuv420p10le" } }));
    const clamp = "limiter=min=16:max=235:planes=1,limiter=min=16:max=240:planes=6";
    const chain = "zscale=tin=smpte2084:pin=2020:min=2020_ncl:rin=limited:t=linear:npl=100:p=2020,format=gbrpf32le,zscale=p=709,"
      + `tonemap=tonemap=hable:desat=0:peak=100,zscale=t=709:m=709:r=limited,format=yuv420p,${clamp}`;
    expect(LIMITED_RANGE_CLAMP).toBe(clamp);
    expect(p.toneMap).toBe(chain);
    const a = videoArgs(p);
    const graph = after(a, "-filter_complex");
    // one tone-mapping, at 1280x720 (the largest rendition), then split
    expect(graph.split("tonemap=tonemap=").length - 1).toBe(1);
    expect(graph).toContain(`tpad=stop_mode=clone:stop_duration=10.000,scale=w=1280:h=720:flags=bicubic,setsar=1,${chain},split=3[s0][s1][s2];`);
    p.video.forEach((v, i) => expect(graph).toContain(`[s${i}]scale=w=${v.width}:h=${v.height}:flags=bicubic,setsar=1,format=yuv420p,${clamp}[o${i}]`));
    const starts = a.map((x, i) => (x === "-map" ? i : -1)).filter((i) => i >= 0);
    starts.forEach((s, i) => {
      const block = a.slice(s, starts[i + 1] ?? a.length);
      expect(block.join(" ")).toContain("-color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv");
      expect(after(block, "-pix_fmt")).toBe("yuv420p");
      expect(after(block, "-profile:v")).toBe("baseline");
    });
    expect(after(posterArgs(p), "-vf")).toBe(`scale=w=1280:h=-2:flags=bicubic,setsar=1,${chain}`);
  });

  it("HDR input description: HLG, untagged values take the HDR defaults; BT.2020 primaries with an SDR transfer", () => {
    expect(toneMapChain({ transfer: "arib-std-b67", primaries: "bt2020", matrix: "bt2020nc", range: "tv", pixFmt: "" }))
      .toMatch(/^zscale=tin=arib-std-b67:pin=2020:min=2020_ncl:rin=limited:t=linear:npl=100:p=2020,/);
    expect(toneMapChain({ transfer: "smpte2084", primaries: "", matrix: "", range: "", pixFmt: "" }))
      .toMatch(/^zscale=tin=smpte2084:pin=2020:min=2020_ncl:rin=limited:/);
    expect(toneMapChain({ transfer: "bt2020-10", primaries: "bt2020", matrix: "bt2020c", range: "pc", pixFmt: "" }))
      .toMatch(/^zscale=tin=2020_10:pin=2020:min=2020_cl:rin=full:/);
    expect(toneMapChain({ transfer: "", primaries: "bt2020", matrix: "", range: "", pixFmt: "" })).toMatch(/^zscale=tin=2020_10:/);
    expect(BT709_TAGS).toEqual(["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv"]);
  });

  it("tone-map peak (review of #420): the file's HDR10 peak, else PQ 10,000 / HLG 1,000 nits; BT.2020-SDR gets the gamut conversion only", () => {
    const c = (o: Partial<Parameters<typeof toneMapOperator>[0]>) => ({ transfer: "", primaries: "bt2020", matrix: "", range: "", pixFmt: "", ...o });
    expect(toneMapOperator(c({ transfer: "smpte2084" }))).toEqual({ op: "hable", peak: 100 });
    expect(toneMapOperator(c({ transfer: "smpte2084", peakNits: 4000 }))).toEqual({ op: "hable", peak: 40 });
    expect(toneMapOperator(c({ transfer: "arib-std-b67" }))).toEqual({ op: "hable", peak: 10 });
    expect(toneMapOperator(c({ transfer: "bt2020-10" }))).toEqual({ op: "clip", peak: null });
    expect(toneMapChain(c({ transfer: "smpte2084", peakNits: 1500 }))).toContain("tonemap=tonemap=hable:desat=0:peak=15,");
    expect(toneMapChain(c({ transfer: "bt2020-10" }))).toContain("tonemap=tonemap=clip:desat=0,");
  });

  it("rate control (review of #420, M1): buffer caps in proportion to each ceiling; short clips get buffer + maxrate scaled to ceiling × length", () => {
    expect([bufferCapBits("240p"), bufferCapBits("480p"), bufferCapBits("720p")]).toEqual([342_857, 914_285, 2_000_000]);
    // a long video keeps the plan (720p: 2 Mb/s target, 2.4 Mb/s max), buffer capped at 2 Mbit (was 4)
    expect(vbvFor("720p", 2_000_000, 60)).toEqual({ bitrate: 2_000_000, maxrate: 2_400_000, bufsize: 2_000_000 });
    for (const name of ["240p", "480p", "720p"] as const) {
      for (const d of [0.2, 0.5, 1, 2, 4, 10, 30, 600]) {
        const planned = { "240p": 300_000, "480p": 900_000, "720p": 2_000_000 }[name];
        const v = vbvFor(name, planned, d);
        const budget = (CEILING_SHARE * DB_CEILING_BPS[name] * d - VIDEO_RESERVE_BYTES) * 8;
        if (budget > 100_000) expect(v.bufsize + v.maxrate * d, `${name} ${d}s`).toBeLessThanOrEqual(budget);
        expect(v.bufsize, `${name} ${d}s`).toBeLessThanOrEqual(bufferCapBits(name));
        expect(v.bitrate).toBeLessThanOrEqual(v.maxrate);
        expect(v.maxrate).toBeLessThanOrEqual(Math.round(planned * 1.2));
      }
    }
    // the sound: the plan for anything but a very short clip
    expect(audioBitrateFor(96_000, 10)).toBe(96_000);
    expect(audioBitrateFor(96_000, 2)).toBe(96_000);
    expect(audioBitrateFor(96_000, 0.5)).toBeLessThan(96_000);
    expect(audioBitrateFor(96_000, 0.2)).toBeLessThanOrEqual(48_000);
    expect(audioBitrateFor(48_000, 0.05)).toBe(24_000); // the floor
    expect(audioBitrateFor(48_000, 3600)).toBe(48_000); // never above the plan
  });

  it("frame rate and GOP follow the output frame rate (60 → 30, 29.97 kept, 5 → 10)", () => {
    expect(after(videoArgs(planEncode(facts({ fps: "60/1" }))), "-g")).toBe("60");
    expect(after(videoArgs(planEncode(facts({ fps: "60/1" }))), "-filter_complex")).toContain("fps=fps=30:");
    expect(after(videoArgs(planEncode(facts({ fps: "30000/1001" }))), "-filter_complex")).toContain("fps=fps=30000/1001:");
    expect(after(videoArgs(planEncode(facts({ fps: "24/1" }))), "-g")).toBe("48");
    expect(after(videoArgs(planEncode(facts({ fps: "5/1" }))), "-g")).toBe("20");
  });

  it("audio: its own run and rendition — AAC-LC, the plan's rate, 48 kHz, ≤ 2 channels, 4 s fragments, padded/cut to the length", () => {
    const p = planEncode(facts({ duration: 12.345 }));
    const a = audioArgs(p);
    expect(after(a, "-protocol_whitelist")).toBe("file");
    expect(after(a, "-format_whitelist")).toBe(INPUT_FORMAT_WHITELIST);
    expect(after(a, "-map")).toBe("0:1");
    expect(a).toEqual(expect.arrayContaining(["-vn", "-sn", "-dn"]));
    expect(after(a, "-c:a")).toBe("aac");
    expect(after(a, "-b:a")).toBe("96000");
    expect(after(a, "-ar")).toBe("48000");
    expect(after(a, "-ac")).toBe("2");
    expect(after(a, "-af")).toBe("aresample=async=1:first_pts=0,apad");
    expect(after(a, "-t")).toBe("12.345");
    expect(after(a, "-movflags")).toBe("+empty_moov+default_base_moof");
    expect(after(a, "-frag_duration")).toBe("4000000");
    expect(a.at(-1)).toBe("audio.mp4");
    // a long video's ladder lowers the sound's rate too
    expect(after(audioArgs(planEncode(facts({ duration: 5 * 3600 }))), "-b:a")).toBe("48000");
    // mono stays mono
    const mono = JSON.parse(probeJson());
    mono.streams[1].channels = 1;
    expect(after(audioArgs(planEncode(judgeProbe(JSON.stringify(mono)))), "-ac")).toBe("1");
    expect(() => audioArgs(planEncode(facts({ audio: false })))).toThrow();
  });

  it("poster: the frame at 1 s (the middle of a shorter video), JPEG, at most 1280 wide", () => {
    const p = planEncode(facts({ width: 1920, height: 1080, duration: 10 }));
    const a = posterArgs(p);
    expect(after(a, "-ss")).toBe("1.000");
    expect(a.indexOf("-ss")).toBeLessThan(a.indexOf("-i"));
    expect(after(a, "-frames:v")).toBe("1");
    expect(after(a, "-vf")).toBe("scale=w=1280:h=-2:flags=bicubic,setsar=1");
    expect(after(a, "-map_chapters")).toBe("-1"); // review of #420 nit
    expect(after(posterArgs(p, 1, 15, 640), "-vf")).toContain("scale=w=640:h=-2"); // the narrower fallback
    expect(after(posterArgs(p, 1, 15, 640), "-q:v")).toBe("15");
    expect(after(a, "-c:v")).toBe("mjpeg");
    expect(a.at(-1)).toBe("poster.jpg");
    expect(after(posterArgs(planEncode(facts({ duration: 1.2 }))), "-ss")).toBe("0.600");
    expect(after(posterArgs(planEncode(facts({ width: 640, height: 360 }))), "-vf")).toContain("scale=w=640:");
  });

  it("time cap per run: 3 × length + 10 min, never past a claim's 6 h", () => {
    expect(runLimitS(10)).toBe(630);
    expect(runLimitS(3600)).toBe(11_400);
    expect(runLimitS(5 * 3600)).toBe(21_600);
  });
});
