import { describe, it, expect } from "vitest";
import { VIDEO_FRAME_ASPECT, videoFillAxis, videoFrameAspect, videoNeedsFill } from "../videoFrame";

describe("the 9:16 video card (Owner 2026-10-05)", () => {
  it("is always 9:16, whatever the video", () => {
    expect(videoFrameAspect()).toBeCloseTo(0.5625, 6);
    expect(VIDEO_FRAME_ASPECT).toBe(9 / 16);
  });
  it("a 9:16 video (and phone rounding like 1080x1918) fills it", () => {
    expect(videoNeedsFill(1080 / 1920)).toBe(false);
    expect(videoNeedsFill(1080 / 1918)).toBe(false);
    expect(videoFillAxis(1080 / 1920)).toBe("none");
  });
  it("wider videos are fitted with fill above and below; narrower ones at the sides", () => {
    expect(videoFillAxis(16 / 9)).toBe("top-bottom");
    expect(videoFillAxis(1)).toBe("top-bottom");
    expect(videoFillAxis(4 / 5)).toBe("top-bottom");
    expect(videoFillAxis(9 / 21)).toBe("sides");
  });
  it("an unreadable size never claims a fill", () => {
    expect(videoNeedsFill(null)).toBe(false);
    expect(videoNeedsFill(NaN)).toBe(false);
    expect(videoNeedsFill(0)).toBe(false);
  });
});
