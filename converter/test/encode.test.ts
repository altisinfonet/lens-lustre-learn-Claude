// @vitest-environment node
/**
 * Step 4 · the FFmpeg command lines, flag by flag: the server must make the
 * same package shape as the browser (webEncoder.ts), and every run on a
 * member's file carries the input hygiene of design §3 step 5.
 */
import { describe, it, expect } from "vitest";
import { audioArgs, AUDIO_CODEC, MIN_FRAGMENT_US, planEncode, posterArgs, runLimitS, videoArgs, videoCodecFor } from "../src/encode";
import { judgeProbe, INPUT_FORMAT_WHITELIST } from "../src/probe";
import { JobFailure } from "../src/failures";
import { probeJson } from "./helpers";

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
    expect(graph).toMatch(/^\[0:v:0\]fps=fps=30\/1:start_time=0,tpad=stop_mode=clone:stop_duration=10\.000,split=3\[s0\]\[s1\]\[s2\];/);
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
      expect(Number(after(block, "-maxrate"))).toBe(Math.round(v.bitrate * 1.2));
      expect(Number(after(block, "-bufsize"))).toBe(v.bitrate * 2);
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
    expect(after(a, "-map")).toBe("0:a:0");
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
