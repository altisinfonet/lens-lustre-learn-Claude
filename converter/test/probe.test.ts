// @vitest-environment node
/**
 * Step 3 · what ffprobe found, judged before any decoder runs over the file
 * (CONVERTER-DESIGN.md v2 §3 step 5): the refusals map to the fixed codes.
 */
import { describe, it, expect } from "vitest";
import { ALLOW_DATA_STREAMS, INPUT_FORMAT_WHITELIST, judgeProbe, outputFps, probeArgs } from "../src/probe";
import { JobFailure } from "../src/failures";
import { probeJson } from "./helpers";

function code(json: string): string {
  try { judgeProbe(json); return "ok"; } catch (e) { return e instanceof JobFailure ? e.code : `threw ${String(e)}`; }
}

describe("converter · ffprobe facts", () => {
  it("a normal phone video: one H.264 video + one AAC audio → facts", () => {
    const f = judgeProbe(probeJson({ width: 1920, height: 1080, duration: 448.2, fps: "30000/1001" }));
    expect(f).toMatchObject({ width: 1920, height: 1080, rotation: 0, hasAudio: true, audioChannels: 2, videoCodec: "h264", fpsRational: "30000/1001" });
    expect(f.durationS).toBeCloseTo(448.2);
    expect(f.fps).toBeCloseTo(29.97, 2);
  });

  it("rotation (display matrix -90 / tags.rotate 90) gives the DISPLAY size, as the browser's videoWidth/Height", () => {
    expect(judgeProbe(probeJson({ width: 1920, height: 1080, rotation: -90 }))).toMatchObject({ width: 1080, height: 1920, rotation: 270 });
    const tagged = JSON.parse(probeJson({ width: 1280, height: 720 }));
    tagged.streams[0].tags = { rotate: "90" };
    expect(judgeProbe(JSON.stringify(tagged))).toMatchObject({ width: 720, height: 1280, rotation: 90 });
    expect(judgeProbe(probeJson({ width: 1280, height: 720, rotation: 180 }))).toMatchObject({ width: 1280, height: 720, rotation: 180 });
  });

  it("non-square pixels: the display width", () => {
    const p = JSON.parse(probeJson({ width: 720, height: 576 }));
    p.streams[0].sample_aspect_ratio = "16:11";
    expect(judgeProbe(JSON.stringify(p))).toMatchObject({ width: 1047, height: 576, codedWidth: 720 });
  });

  it("no audio is fine (a version without sound)", () => {
    expect(judgeProbe(probeJson({ audio: false }))).toMatchObject({ hasAudio: false, audioChannels: 0, audioCodec: null });
  });

  it("refusals → the fixed codes", () => {
    const video = { codec_type: "video", codec_name: "h264", width: 640, height: 360, avg_frame_rate: "30/1" };
    const audio = { codec_type: "audio", codec_name: "aac", channels: 2 };
    expect(code(JSON.stringify({ format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "5" }, streams: [audio] }))).toBe("no_video");
    expect(code(probeJson({ extra: [video] }))).toBe("unsupported_format"); // two video streams
    expect(code(probeJson({ extra: [audio] }))).toBe("unsupported_format"); // two audio streams
    expect(code(probeJson({ extra: [{ ...video, codec_name: "mjpeg", disposition: { attached_pic: 1 } }] }))).toBe("unsupported_format");
    expect(code(probeJson({ extra: [{ codec_type: "subtitle", codec_name: "mov_text" }] }))).toBe("unsupported_format");
    expect(code(probeJson({ extra: [{ codec_type: "attachment", codec_name: "ttf" }] }))).toBe("unsupported_format");
    expect(code(probeJson({ width: 4097, height: 2160 }))).toBe("too_big");
    expect(code(probeJson({ width: 2160, height: 4097 }))).toBe("too_big");
    expect(code(probeJson({ width: 4096, height: 2160 }))).toBe("ok");
    expect(code(probeJson({ fps: "1/2" }))).toBe("unsupported_format");
    expect(code(probeJson({ fps: "240/1" }))).toBe("unsupported_format");
    expect(code(probeJson({ fps: "120/1" }))).toBe("ok");
    expect(code(probeJson({ fps: "1/1" }))).toBe("ok");
    expect(code(probeJson({ duration: 15 * 3600 + 1 }))).toBe("too_long");
    expect(code(probeJson({ duration: 15 * 3600 }))).toBe("ok");
    expect(code(probeJson({ format: "hls" }))).toBe("unsupported_format");
    expect(code(probeJson({ format: "image2" }))).toBe("unsupported_format");
    expect(code("not json")).toBe("damaged");
    expect(code(JSON.stringify({ streams: [] }))).toBe("damaged");
    expect(code(probeJson({ width: 0, height: 0 }))).toBe("damaged");
  });

  it("data streams (phone timed metadata) are refused while ALLOW_DATA_STREAMS is false, as the design says", () => {
    expect(ALLOW_DATA_STREAMS).toBe(false);
    expect(code(probeJson({ extra: [{ codec_type: "data", codec_name: "bin_data" }] }))).toBe("unsupported_format");
  });

  it("a length: the container's, else the longest stream's; none → damaged", () => {
    const p = JSON.parse(probeJson());
    delete p.format.duration;
    p.streams[0].duration = "12.5";
    p.streams[1].duration = "12.7";
    expect(judgeProbe(JSON.stringify(p)).durationS).toBeCloseTo(12.7);
    delete p.streams[0].duration;
    delete p.streams[1].duration;
    expect(code(JSON.stringify(p))).toBe("damaged");
  });

  it("frame rate: avg_frame_rate, else r_frame_rate (WebM often has 0/0)", () => {
    const p = JSON.parse(probeJson({ format: "matroska,webm" }));
    p.streams[0].avg_frame_rate = "0/0";
    p.streams[0].r_frame_rate = "25/1";
    expect(judgeProbe(JSON.stringify(p))).toMatchObject({ fps: 25, fpsRational: "25/1" });
    p.streams[0].r_frame_rate = "0/0";
    expect(code(JSON.stringify(p))).toBe("unsupported_format");
  });

  it("output frame rate: 10–30 kept as it is, above 30 → 30, below 10 → 10 (so no segment can reach 6 s)", () => {
    expect(outputFps({ fps: 60, fpsRational: "60/1" })).toEqual({ text: "30", value: 30 });
    expect(outputFps({ fps: 30000 / 1001, fpsRational: "30000/1001" }).text).toBe("30000/1001");
    expect(outputFps({ fps: 24, fpsRational: "24/1" }).text).toBe("24/1");
    expect(outputFps({ fps: 2.4, fpsRational: "12/5" })).toEqual({ text: "10", value: 10 });
  });

  it("ffprobe runs with the protocol and demuxer allow-lists and bounded probing; no hls/concat/subfile", () => {
    const a = probeArgs();
    expect(a.slice(a.indexOf("-protocol_whitelist"), a.indexOf("-protocol_whitelist") + 2)).toEqual(["-protocol_whitelist", "file"]);
    expect(a[a.indexOf("-format_whitelist") + 1]).toBe(INPUT_FORMAT_WHITELIST);
    expect(INPUT_FORMAT_WHITELIST.split(",")).toEqual(["mov", "mp4", "m4a", "3gp", "3g2", "mj2", "matroska", "webm", "avi", "mpegts"]);
    for (const bad of ["hls", "concat", "subfile", "lavfi", "image2", "http", "data"]) expect(INPUT_FORMAT_WHITELIST.split(",")).not.toContain(bad);
    expect(Number(a[a.indexOf("-probesize") + 1])).toBeLessThanOrEqual(64 * 1024 * 1024);
    expect(Number(a[a.indexOf("-analyzeduration") + 1])).toBeLessThanOrEqual(60_000_000);
    expect(a.slice(-2)).toEqual(["-i", "source"]);
  });
});
