/**
 * P13 review #587: exifr is loaded on demand. If it cannot be loaded, the
 * guard can prove nothing — neither that the photo has no location, nor that
 * stripping removed it. An unprovable file does not go to the public CDN.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("exifr", () => { throw new Error("Failed to fetch dynamically imported module"); });

const { guardOriginalUpload, GpsPrivacyError } = await import("@/lib/gpsGuard");

// A minimal JPEG: SOI, an APP1 segment, SOS + data, EOI.
const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x04, 0x00, 0x00, 0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9]);

// jsdom's File has no arrayBuffer(); give it the bytes it was made from.
const file = (bytes: Uint8Array, name: string, type: string) =>
  Object.assign(new File([bytes], name, { type }), { arrayBuffer: async () => bytes.slice().buffer });

describe("the EXIF reader cannot be loaded", () => {
  it("a JPEG is refused, never uploaded unverified", async () => {
    const f = file(jpegBytes, "a.jpg", "image/jpeg");
    await expect(guardOriginalUpload(f)).rejects.toBeInstanceOf(GpsPrivacyError);
  });
  it("a non-JPEG is refused", async () => {
    const f = file(new Uint8Array([1, 2, 3, 4]), "a.png", "image/png");
    await expect(guardOriginalUpload(f)).rejects.toBeInstanceOf(GpsPrivacyError);
  });
});
