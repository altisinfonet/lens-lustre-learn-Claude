/**
 * Chrome takes back an idle encoder in a background tab ("Codec reclaimed due to
 * inactivity"); the web encoder reopens it instead of failing (Owner 2026-10-12).
 */
import { describe, expect, it } from "vitest";
import { isReclaimed, sameDecoderConfig } from "../webEncoder";

describe("isReclaimed", () => {
  it("recognises Chrome's reclaim error, and nothing else", () => {
    expect(isReclaimed(new DOMException("Codec reclaimed due to inactivity.", "QuotaExceededError"))).toBe(true);
    expect(isReclaimed({ name: "Error", message: "codec reclaimed" })).toBe(true);
    expect(isReclaimed(new DOMException("Encoding error.", "EncodingError"))).toBe(false);
    expect(isReclaimed(null)).toBe(false);
  });
});

describe("sameDecoderConfig — a reopened encoder must match the init segment", () => {
  const avcc = (b: number[]) => ({ codec: "avc1.42E01F", description: new Uint8Array(b).buffer });
  it("same codec + same parameter sets → same", () => {
    expect(sameDecoderConfig(avcc([1, 66, 0, 31, 255]), avcc([1, 66, 0, 31, 255]))).toBe(true);
  });
  it("different parameter sets or codec → not the same (the encode stops with a clear message)", () => {
    expect(sameDecoderConfig(avcc([1, 66, 0, 31, 255]), avcc([1, 66, 0, 30, 255]))).toBe(false);
    expect(sameDecoderConfig(avcc([1]), { codec: "avc1.42E01E", description: new Uint8Array([1]).buffer })).toBe(false);
  });
  it("views over a buffer compare by their bytes", () => {
    const big = new Uint8Array([9, 1, 66, 0, 31, 9]);
    expect(sameDecoderConfig({ codec: "c", description: big.subarray(1, 5) }, { codec: "c", description: new Uint8Array([1, 66, 0, 31]) })).toBe(true);
  });
});
