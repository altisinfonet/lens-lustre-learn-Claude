/**
 * Photo plan U2 · item 4 (review of #823): a browser WITHOUT a WebP encoder
 * (canvas.toBlob silently falls back to image/png for an unsupported type) must
 * not have its PNG bytes stored under a `.webp` name. encodePhotoSet returns
 * null instead, and the uploader falls back to today's path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/imageCompression", () => ({
  decodeImageForCanvas: vi.fn(async () => ({ width: 3000, height: 2000 })),
}));

import { encodePhotoSet } from "@/lib/photoSetEncode";

let blobType = "image/webp";
const origGetContext = HTMLCanvasElement.prototype.getContext;
const origToBlob = HTMLCanvasElement.prototype.toBlob;

beforeEach(() => {
  blobType = "image/webp";
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn() })) as unknown as typeof origGetContext;
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
    cb(new Blob([new Uint8Array([1, 2, 3])], { type: blobType }));
  } as typeof origToBlob;
});
afterEach(() => {
  HTMLCanvasElement.prototype.getContext = origGetContext;
  HTMLCanvasElement.prototype.toBlob = origToBlob;
});

const source = () => new File([new Uint8Array([9])], "photo.jpg", { type: "image/jpeg" });

describe("encodePhotoSet · WebP or nothing", () => {
  it("returns the v3 copies (private clean 2048, clean 1080 URL, 600, 320) when the browser really encodes WebP", async () => {
    const r = await encodePhotoSet(source(), false);
    expect(r).not.toBeNull();
    expect(r!.copies.map((c) => c.slot)).toEqual(["clean2048", "master", "thumb", "r320"]);
    expect(r!.copies.every((c) => c.file.type === "image/webp")).toBe(true);
  });

  it("credit U3: the browser draws no credit — no copy is credited and the canvas never draws text", async () => {
    const fillText = vi.fn();
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn(), fillText, measureText: () => ({ width: 1 }), save: vi.fn(), restore: vi.fn() })) as unknown as typeof origGetContext;
    for (const keepFull of [false, true]) {
      const r = await encodePhotoSet(source(), keepFull);
      expect(r!.copies.some((c) => c.slot === "r2048c")).toBe(false);
    }
    expect(fillText).not.toHaveBeenCalled();
  });

  it("returns null when toBlob hands back PNG (no WebP encoder) — never a PNG named .webp", async () => {
    blobType = "image/png";
    await expect(encodePhotoSet(source(), false)).resolves.toBeNull();
  });

  it("returns null when only a later copy comes back as something else", async () => {
    let n = 0;
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
      n += 1;
      cb(new Blob([new Uint8Array([1])], { type: n === 3 ? "image/png" : "image/webp" }));
    } as typeof origToBlob;
    await expect(encodePhotoSet(source(), true)).resolves.toBeNull();
  });
});
