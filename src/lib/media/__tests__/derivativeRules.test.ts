import { describe, expect, it } from "vitest";
import { isDerivativeKey, isRung, webpSize } from "../derivativeRules";

const O = "11111111-1111-4111-8111-111111111111";
const M = "22222222-2222-4222-8222-222222222222";

describe("S3-b derivative writer rules", () => {
  it("accepts only the derivative key of this media, rung and audience", () => {
    expect(isDerivativeKey(`post-images/${O}/d/${M}/w1080.webp`, "public", M, 1080)).toBe(true);
    expect(isDerivativeKey(`photo/${O}/${M}/w600.webp`, "private", M, 600)).toBe(true);
    // an original is never a derivative key
    expect(isDerivativeKey(`post-images/${O}/posts/x-w4000h3000-l3.webp`, "public", M, 1080)).toBe(false);
    // wrong audience, rung, media, traversal, extension
    expect(isDerivativeKey(`photo/${O}/${M}/w600.webp`, "public", M, 600)).toBe(false);
    expect(isDerivativeKey(`post-images/${O}/d/${M}/w600.webp`, "private", M, 600)).toBe(false);
    expect(isDerivativeKey(`post-images/${O}/d/${M}/w1080.webp`, "public", M, 1440)).toBe(false);
    expect(isDerivativeKey(`post-images/${O}/d/${O}/w1080.webp`, "public", M, 1080)).toBe(false);
    expect(isDerivativeKey(`post-images/${O}/d/../${M}/w1080.webp`, "public", M, 1080)).toBe(false);
    expect(isDerivativeKey(`post-images/${O}/d/${M}/w1080.jpg`, "public", M, 1080)).toBe(false);
  });

  it("knows the three rungs only", () => {
    expect([600, 1080, 1440].every(isRung)).toBe(true);
    expect(isRung(720)).toBe(false);
    expect(isRung("600")).toBe(false);
  });

  it("reads WebP dimensions from VP8, VP8L and VP8X headers and refuses others", () => {
    const riff = (chunk: string, body: number[]) =>
      new Uint8Array([..."RIFF"].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [..."WEBP" + chunk].map((c) => c.charCodeAt(0)), body));
    // VP8: bytes 16..19 size, 20..22 frame tag, 23..25 start code, 26..29 dims
    const vp8 = riff("VP8 ", [0, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a, 1080 & 0xff, 1080 >> 8, 810 & 0xff, 810 >> 8]);
    expect(webpSize(vp8)).toEqual({ width: 1080, height: 810 });
    // VP8L: 0x2f then 14 bits (w-1), 14 bits (h-1)
    const bits = (600 - 1) | ((450 - 1) << 14);
    const vp8l = riff("VP8L", [0, 0, 0, 0, 0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >>> 24) & 0xff, 0, 0, 0, 0, 0]);
    expect(webpSize(vp8l)).toEqual({ width: 600, height: 450 });
    // VP8X: 24-bit (w-1), (h-1) at 24..29
    const vp8x = riff("VP8X", [0, 0, 0, 0, 0, 0, 0, 0, (1439) & 0xff, (1439 >> 8) & 0xff, 0, (959) & 0xff, (959 >> 8) & 0xff, 0]);
    expect(webpSize(vp8x)).toEqual({ width: 1440, height: 960 });
    expect(webpSize(new Uint8Array(40))).toBeNull();
    expect(webpSize(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
  });
});
