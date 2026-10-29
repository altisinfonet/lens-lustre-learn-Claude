/**
 * S11 · a GIF / WebP / BMP the EXIF reader cannot parse is still refused
 * (fail closed), but the member is told the truth — "we couldn't check it",
 * not "this photo contains location data" (review of #597).
 */
import { describe, it, expect } from "vitest";
import { guardOriginalUpload, GPS_REFUSAL_MESSAGE, GPS_UNREADABLE_MESSAGE } from "@/lib/gpsGuard";

// jsdom's Blob has no arrayBuffer(); browsers do. Same bytes, via FileReader.
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function (this: Blob) {
    return new Promise<ArrayBuffer>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as ArrayBuffer); r.onerror = () => rej(r.error); r.readAsArrayBuffer(this); });
  };
}

const gif = () => new File([new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0, 0, 0x3b])], "a.gif", { type: "image/gif" });
const bmp = () => new File([new Uint8Array([0x42, 0x4d, ...new Array(60).fill(0)])], "a.bmp", { type: "image/bmp" });

describe("guardOriginalUpload — an unreadable non-JPEG", () => {
  it.each([["GIF", gif], ["BMP", bmp]])("%s: refused, with the 'couldn't check' copy, never the GPS claim", async (_n, make) => {
    const err = await guardOriginalUpload(make()).then(() => null, (e) => e);
    expect(err?.name).toBe("GpsPrivacyError");
    expect(err.message).toBe(GPS_UNREADABLE_MESSAGE);
    expect(err.message).not.toBe(GPS_REFUSAL_MESSAGE);
    expect(GPS_UNREADABLE_MESSAGE).not.toMatch(/contains location/i);
  });
});
