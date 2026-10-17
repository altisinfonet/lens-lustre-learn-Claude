/**
 * The server converter (converter/, CONVERTER-DESIGN.md v2) must declare the
 * SAME codec strings the browser encoder declares (webEncoder.ts H264_AAC):
 * one judge, one player, two encoders. Kept on the app side because
 * webEncoder.ts uses the app's path aliases.
 */
import { describe, it, expect } from "vitest";
import { H264_AAC } from "../webEncoder";
import { AUDIO_CODEC, videoCodecFor } from "../../../../converter/src/encode";

describe("VID-1 · converter and browser declare the same codecs", () => {
  it("video: avc1.42E01E up to 480 px tall, avc1.42E01F above; audio: mp4a.40.2", () => {
    for (const h of [240, 360, 426, 480, 481, 720, 854, 1280]) expect(videoCodecFor(h)).toBe(H264_AAC.video.codec(h));
    expect(AUDIO_CODEC).toBe(H264_AAC.audio.playlist);
    expect(AUDIO_CODEC).toBe(H264_AAC.audio.codec);
  });
});
