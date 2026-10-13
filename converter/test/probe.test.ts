// @vitest-environment node
/**
 * Step 3 · what ffprobe found, judged before any decoder runs over the file
 * (CONVERTER-DESIGN.md v2 §3 step 5, amendment A1 of 2026-10-13): which
 * streams are converted, which are ignored, the refusals that remain (fixed
 * codes), and the HDR test.
 */
import { describe, it, expect } from "vitest";
import { INPUT_FORMAT_WHITELIST, isHdr, judgeProbe, outputFps, probeArgs } from "../src/probe";
import { JobFailure } from "../src/failures";
import { iphoneProbeJson, probeJson } from "./helpers";

function code(json: string): string {
  try { judgeProbe(json); return "ok"; } catch (e) { return e instanceof JobFailure ? e.code : `threw ${String(e)}`; }
}

describe("converter · ffprobe facts", () => {
  it("a normal phone video: one H.264 video + one AAC audio → facts, both streams by index", () => {
    const f = judgeProbe(probeJson({ width: 1920, height: 1080, duration: 448.2, fps: "30000/1001" }));
    expect(f).toMatchObject({
      width: 1920, height: 1080, rotation: 0, hasAudio: true, audioChannels: 2, videoCodec: "h264", fpsRational: "30000/1001",
      videoIndex: 0, audioIndex: 1, ignoredStreams: 0, hdr: false,
    });
    expect(f.durationS).toBeCloseTo(448.2);
    expect(f.fps).toBeCloseTo(29.97, 2);
  });

  it("an iPhone .mov (A1): cover picture listed FIRST, HLG HEVC, spatial audio FFmpeg does not know, 4 metadata tracks → converted, not refused", () => {
    const f = judgeProbe(iphoneProbeJson());
    expect(f).toMatchObject({
      videoIndex: 1,          // the real video, never the cover picture at index 0
      audioIndex: 3,          // the AAC track: the spatial track (index 2, codec unknown) is skipped
      audioCodec: "aac", audioChannels: 2,
      ignoredStreams: 6,      // cover, spatial audio, 4 × mebx — never mapped
      width: 1080, height: 1920, rotation: 270, videoCodec: "hevc", hdr: true,
    });
    expect(f.colour).toEqual({ transfer: "arib-std-b67", primaries: "bt2020", matrix: "bt2020nc", range: "tv", pixFmt: "yuv420p10le", peakNits: null });
  });

  it("data, timecode, subtitle and attachment streams are allowed and ignored (A1)", () => {
    const extra = [
      { codec_type: "data", codec_name: "none", tags: { handler_name: "Core Media Metadata" } },
      { codec_type: "data", codec_name: "none", tags: { handler_name: "Time Code Media Handler" } },
      { codec_type: "subtitle", codec_name: "mov_text" },
      { codec_type: "attachment", codec_name: "ttf" },
    ];
    expect(judgeProbe(probeJson({ extra }))).toMatchObject({ videoIndex: 0, audioIndex: 1, ignoredStreams: 4 });
  });

  it("several video streams: the first real one; a cover picture is never chosen, wherever it is listed", () => {
    const cover = { codec_type: "video", codec_name: "mjpeg", width: 600, height: 600, avg_frame_rate: "0/0", disposition: { attached_pic: 1 } };
    // cover picture after the video
    expect(judgeProbe(probeJson({ extra: [cover] }))).toMatchObject({ videoIndex: 0, width: 1280 });
    // cover picture first, real video second (indices as the file says)
    const p = JSON.parse(probeJson());
    p.streams = [{ ...cover, index: 0 }, { ...p.streams[0], index: 1 }, { ...p.streams[1], index: 2 }];
    expect(judgeProbe(JSON.stringify(p))).toMatchObject({ videoIndex: 1, audioIndex: 2, width: 1280, ignoredStreams: 1 });
    // a second real video stream is ignored
    expect(judgeProbe(probeJson({ extra: [{ codec_type: "video", codec_name: "h264", width: 640, height: 360, avg_frame_rate: "30/1" }] })))
      .toMatchObject({ videoIndex: 0, width: 1280, ignoredStreams: 1 });
    // a video stream with a codec FFmpeg does not know is skipped for one it knows
    const q = JSON.parse(probeJson());
    q.streams = [{ ...q.streams[0], index: 0, codec_name: "unknown" }, { ...q.streams[0], index: 1, width: 800, height: 600 }, { ...q.streams[1], index: 2 }];
    expect(judgeProbe(JSON.stringify(q))).toMatchObject({ videoIndex: 1, width: 800 });
  });

  it("several audio streams (A1): the default one, else the first; never mixed", () => {
    const second = { codec_type: "audio", codec_name: "aac", channels: 1 };
    // both default (as mov files usually say) → the first
    expect(judgeProbe(probeJson({ extra: [{ ...second, disposition: { default: 1 } }] }))).toMatchObject({ audioIndex: 1, audioChannels: 2 });
    // only the second is default → the second
    const p = JSON.parse(probeJson({ extra: [{ ...second, disposition: { default: 1 } }] }));
    p.streams[1].disposition.default = 0;
    expect(judgeProbe(JSON.stringify(p))).toMatchObject({ audioIndex: 2, audioChannels: 1 });
    // none default → the first
    p.streams[2].disposition.default = 0;
    expect(judgeProbe(JSON.stringify(p))).toMatchObject({ audioIndex: 1 });
    // only audio FFmpeg does not know → a version without sound (as the browser path does with sound it cannot decode)
    const q = JSON.parse(probeJson());
    q.streams[1].codec_name = "unknown";
    expect(judgeProbe(JSON.stringify(q))).toMatchObject({ hasAudio: false, audioIndex: null, audioCodec: null });
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
    expect(judgeProbe(probeJson({ audio: false }))).toMatchObject({ hasAudio: false, audioChannels: 0, audioCodec: null, audioIndex: null });
  });

  it("HDR (A1): PQ or HLG transfer, or BT.2020 primaries; SDR stays SDR", () => {
    expect(judgeProbe(probeJson({ colour: { transfer: "smpte2084", primaries: "bt2020", matrix: "bt2020nc", range: "tv", pixFmt: "yuv420p10le" } })).hdr).toBe(true);
    expect(judgeProbe(probeJson({ colour: { transfer: "arib-std-b67", primaries: "bt2020" } })).hdr).toBe(true);
    expect(judgeProbe(probeJson({ colour: { transfer: "bt2020-10", primaries: "bt2020" } })).hdr).toBe(true);
    expect(judgeProbe(probeJson({ colour: { transfer: "smpte2084" } })).hdr).toBe(true);
    expect(judgeProbe(probeJson({ colour: { transfer: "bt709", primaries: "bt709", matrix: "bt709" } })).hdr).toBe(false);
    expect(judgeProbe(probeJson({ colour: { transfer: "smpte170m", primaries: "smpte170m" } })).hdr).toBe(false);
    expect(judgeProbe(probeJson()).hdr).toBe(false); // untagged
    expect(judgeProbe(probeJson({ colour: { transfer: "unknown", primaries: "unknown" } })).colour).toMatchObject({ transfer: "", primaries: "" });
    expect(isHdr({ transfer: "", primaries: "" })).toBe(false);
  });

  it("HDR10 peak (review of #420): MaxCLL, else the mastering display's max luminance (ffprobe's rational), within 100–10,000 nits", () => {
    const withSideData = (sd: unknown[]) => {
      const p = JSON.parse(probeJson({ colour: { transfer: "smpte2084", primaries: "bt2020" } }));
      p.streams[0].side_data_list = sd;
      return judgeProbe(JSON.stringify(p)).colour.peakNits;
    };
    const mastering = { side_data_type: "Mastering display metadata", max_luminance: "40000000/10000", min_luminance: "50/10000" };
    const cll = { side_data_type: "Content light level metadata", max_content: 1500, max_average: 400 };
    expect(withSideData([mastering, cll])).toBe(1500);
    expect(withSideData([mastering])).toBe(4000);
    expect(withSideData([{ ...cll, max_content: 0 }, mastering])).toBe(4000); // MaxCLL 0 = unknown
    expect(withSideData([{ side_data_type: "Display Matrix", rotation: 0 }])).toBeNull();
    expect(withSideData([{ ...mastering, max_luminance: "20/1" }])).toBeNull(); // nonsense → the default
  });

  it("the refusals that remain → their fixed codes", () => {
    const audio = { codec_type: "audio", codec_name: "aac", channels: 2 };
    expect(code(JSON.stringify({ format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "5" }, streams: [audio] }))).toBe("no_video");
    // only a cover picture: still no video
    expect(code(JSON.stringify({ format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "5" }, streams: [
      { index: 0, codec_type: "video", codec_name: "mjpeg", width: 600, height: 600, disposition: { attached_pic: 1 } }, { index: 1, ...audio },
    ] }))).toBe("no_video");
    const unknownVideo = JSON.parse(probeJson());
    unknownVideo.streams[0].codec_name = "unknown";
    expect(code(JSON.stringify(unknownVideo))).toBe("unsupported_format");
    expect(code(probeJson({ extra: Array.from({ length: 63 }, () => ({ codec_type: "data", codec_name: "none" })) }))).toBe("unsupported_format"); // 65 streams
    expect(code(probeJson({ width: 4097, height: 2160 }))).toBe("too_big");
    expect(code(probeJson({ width: 2160, height: 4097 }))).toBe("too_big");
    expect(code(probeJson({ width: 4096, height: 2160 }))).toBe("ok");
    expect(code(probeJson({ fps: "1/2" }))).toBe("unsupported_format");
    expect(code(probeJson({ fps: "240/1" }))).toBe("ok");                       // 1280x720 slow motion (M2)
    expect(code(probeJson({ fps: "241/1" }))).toBe("unsupported_format");
    expect(code(probeJson({ width: 1080, height: 1920, fps: "240/1" }))).toBe("ok"); // portrait 1080p240
    expect(code(probeJson({ width: 1920, height: 1080, fps: "240/1" }))).toBe("ok"); // 497,664,000 px/s
    expect(code(probeJson({ width: 2560, height: 1440, fps: "240/1" }))).toBe("unsupported_format"); // above 1080p: 120 max
    expect(code(probeJson({ width: 2560, height: 1440, fps: "121/1" }))).toBe("unsupported_format");
    expect(code(probeJson({ width: 2560, height: 1440, fps: "120/1" }))).toBe("ok"); // 442,368,000 px/s
    expect(code(probeJson({ width: 3840, height: 2160, fps: "60/1" }))).toBe("ok");  // UHD 4K60
    expect(code(probeJson({ width: 4096, height: 2160, fps: "60/1" }))).toBe("ok");  // DCI 4K60: the pixel-rate ceiling itself
    expect(code(probeJson({ width: 4096, height: 2160, fps: "61/1" }))).toBe("unsupported_format"); // above 530,841,600 px/s
    expect(code(probeJson({ width: 3840, height: 2160, fps: "120/1" }))).toBe("unsupported_format");
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
